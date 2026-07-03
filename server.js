import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import propertySearchRoute from './routes/propertySearch.js';
import compsRoute from './routes/comps.js';
import chatRoute from './routes/chat.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const corsOrigins = (process.env.CORS_ORIGINS || '*').split(',').map((o) => o.trim());
app.use(cors({ origin: corsOrigins.includes('*') ? '*' : corsOrigins }));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    vowConfigured: !!process.env.VOW_API_KEY,
    claudeConfigured: !!process.env.CLAUDE_API_KEY,
  });
});

app.use('/api/property-search', propertySearchRoute);
app.use('/api/comps', compsRoute);
app.use('/api/chat', chatRoute);

// Serve the built React frontend in production (npm run build → client/dist)
const clientDist = path.join(__dirname, 'client', 'dist');
app.use(express.static(clientDist));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(200).send('Mosaic API is running. Build the client with `npm run build` to serve the frontend here.');
  });
});

app.listen(PORT, () => {
  console.log(`[SERVER] Mosaic Real Estate Intelligence listening on port ${PORT}`);
  console.log('[SERVER] VOW_API_KEY present:', !!process.env.VOW_API_KEY);
  console.log('[SERVER] CLAUDE_API_KEY present:', !!process.env.CLAUDE_API_KEY);
});
