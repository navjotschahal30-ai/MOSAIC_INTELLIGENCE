import { Router } from 'express';
import { pool } from '../db/pool.js';
import { hashPassword, verifyPassword, signToken, setAuthCookie, clearAuthCookie, requireAuth } from '../core/auth.js';

const router = Router();

const VALID_USER_TYPES = ['team_mosaic', 'external_agent'];

function publicUser(row) {
  return { id: row.id, email: row.email, userType: row.user_type, createdAt: row.created_at };
}

// POST /api/auth/register  { email, password, userType, privacyAgreed, companyName? }
router.post('/register', async (req, res) => {
  const { email, password, userType, privacyAgreed, companyName } = req.body || {};

  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (!VALID_USER_TYPES.includes(userType)) {
    return res.status(400).json({ error: `userType must be one of: ${VALID_USER_TYPES.join(', ')}` });
  }
  if (privacyAgreed !== true) {
    return res.status(400).json({ error: 'You must accept the privacy policy to register' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    const passwordHash = await hashPassword(password);
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, user_type, privacy_agreed, privacy_agreed_at)
       VALUES ($1, $2, $3, true, now())
       RETURNING id, email, user_type, created_at`,
      [email.toLowerCase(), passwordHash, userType],
    );
    const user = userResult.rows[0];

    // Every user gets an agent profile — this is where per-tenant VOW token,
    // branding, and billing will live (see db/schema.sql).
    await client.query(
      `INSERT INTO agents (user_id, company_name) VALUES ($1, $2)`,
      [user.id, companyName || null],
    );

    await client.query('COMMIT');

    const token = signToken({ id: user.id, email: user.email, userType: user.user_type });
    setAuthCookie(res, token);
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[auth] register error:', err.message);
    res.status(500).json({ error: 'Registration failed' });
  } finally {
    if (client) client.release();
  }
});

// POST /api/auth/login  { email, password }
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [String(email).toLowerCase()]);
    const row = result.rows[0];
    // No password_hash means an OAuth-only account (not yet supported) —
    // same generic error, so we don't leak account existence or auth method.
    if (!row || !row.password_hash) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await verifyPassword(password, row.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const token = signToken({ id: row.id, email: row.email, userType: row.user_type });
    setAuthCookie(res, token);
    res.json({ user: publicUser(row) });
  } catch (err) {
    console.error('[auth] login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.user_type, u.created_at, a.id AS agent_id, a.company_name, a.paid_tier
       FROM users u LEFT JOIN agents a ON a.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id],
    );
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'User not found' });

    res.json({
      user: {
        id: row.id,
        email: row.email,
        userType: row.user_type,
        createdAt: row.created_at,
        agent: row.agent_id ? { id: row.agent_id, companyName: row.company_name, paidTier: row.paid_tier } : null,
      },
    });
  } catch (err) {
    console.error('[auth] me error:', err.message);
    res.status(500).json({ error: 'Failed to load user' });
  }
});

export default router;
