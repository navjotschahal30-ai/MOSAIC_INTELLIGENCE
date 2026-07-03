import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { pool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const sql = readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  await pool.query(sql);
  console.log('[migrate] schema applied successfully.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('[migrate] failed:', err.message);
  process.exit(1);
});
