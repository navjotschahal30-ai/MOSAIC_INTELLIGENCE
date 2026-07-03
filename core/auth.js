import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const SALT_ROUNDS = 12;
const TOKEN_TTL = '7d';
export const AUTH_COOKIE_NAME = 'mosaic_session';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not set');
  return secret;
}

/** @param {string} password @returns {Promise<string>} bcrypt hash */
export function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/** @returns {Promise<boolean>} */
export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/** @param {{ id: number, email: string, userType: string }} user @returns {string} signed JWT */
export function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, userType: user.userType }, getJwtSecret(), { expiresIn: TOKEN_TTL });
}

/** @returns {{ sub: number, email: string, userType: string } | null} */
export function verifyToken(token) {
  try {
    return jwt.verify(token, getJwtSecret());
  } catch {
    return null;
  }
}

/** Express middleware — requires a valid session cookie, attaches req.user, else 401. */
export function requireAuth(req, res, next) {
  const token = req.cookies?.[AUTH_COOKIE_NAME];
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: 'Not authenticated' });
  req.user = { id: payload.sub, email: payload.email, userType: payload.userType };
  next();
}

/** Sets the session cookie on a response. httpOnly — never readable from client JS (XSS-resistant). */
export function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE_NAME);
}
