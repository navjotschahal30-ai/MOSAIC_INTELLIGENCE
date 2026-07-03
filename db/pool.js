import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn('[db] DATABASE_URL not set — auth/database routes will fail until it is configured.');
}

// Railway's internal Postgres URL isn't TLS-terminated the way most managed
// providers expect; rejectUnauthorized:false avoids cert-validation failures
// without disabling encryption in transit.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});
