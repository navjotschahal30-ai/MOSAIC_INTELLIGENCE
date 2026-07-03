import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { pool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Applies schema.sql (idempotent — CREATE TABLE IF NOT EXISTS). Does not close the pool. */
export async function runMigration() {
  const sql = readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  await pool.query(sql);
  console.log('[migrate] schema applied successfully.');
}

// Only run-and-exit when invoked directly (`npm run migrate`), not when imported by server.js.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runMigration()
    .then(() => pool.end())
    .catch((err) => {
      console.error('[migrate] failed:', err.message);
      process.exit(1);
    });
}
