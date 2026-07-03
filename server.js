import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import propertySearchRoute from './routes/propertySearch.js';
import compsRoute from './routes/comps.js';
import chatRoute from './routes/chat.js';
import disclaimerRoute from './routes/disclaimer.js';
import geocodeRoute from './routes/geocode.js';
import autocompleteRoute from './routes/autocomplete.js';
import authRoute from './routes/auth.js';
import { pool, testConnection } from './db/pool.js';
import { runMigration } from './db/migrate.js';

dotenv.config();

// Express 4 doesn't catch rejected promises from async route handlers — a
// missed try/catch anywhere becomes an unhandled rejection that crashes the
// whole process by default in modern Node. Log instead of dying; a single
// request should never take the server down.
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const corsOrigins = (process.env.CORS_ORIGINS || '*').split(',').map((o) => o.trim());
app.use(cors({ origin: corsOrigins.includes('*') ? '*' : corsOrigins, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get('/api/health', async (req, res) => {
  let databaseConnected = false;
  if (process.env.DATABASE_URL) {
    try {
      await pool.query('SELECT 1');
      databaseConnected = true;
    } catch {
      databaseConnected = false;
    }
  }

  res.json({
    ok: true,
    vowConfigured: !!process.env.VOW_API_KEY,
    claudeConfigured: !!process.env.CLAUDE_API_KEY,
    databaseConfigured: !!process.env.DATABASE_URL,
    databaseConnected,
  });
});

app.use('/api/property-search', propertySearchRoute);
app.use('/api/comps', compsRoute);
app.use('/api/chat', chatRoute);
app.use('/api/disclaimer', disclaimerRoute);
app.use('/api/geocode', geocodeRoute);
app.use('/api/autocomplete', autocompleteRoute);
app.use('/api/auth', authRoute);

// Serve the built React frontend in production (npm run build → client/dist)
const clientDist = path.join(__dirname, 'client', 'dist');
app.use(express.static(clientDist));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(200).send('Mosaic API is running. Build the client with `npm run build` to serve the frontend here.');
  });
});

app.listen(PORT, async () => {
  console.log(`[SERVER] Mosaic Real Estate Intelligence listening on port ${PORT}`);
  console.log('[SERVER] VOW_API_KEY present:', !!process.env.VOW_API_KEY);
  console.log('[SERVER] CLAUDE_API_KEY present:', !!process.env.CLAUDE_API_KEY);
  await testConnection();

  // Idempotent (CREATE TABLE IF NOT EXISTS) — safe to run on every boot, and
  // the only practical way to apply schema changes on Railway without
  // dashboard/CLI access to run `npm run migrate` there directly.
  if (process.env.DATABASE_URL) {
    try {
      await runMigration();
    } catch (err) {
      console.error('[migrate] failed on startup:', err.message);
    }
  }
});
