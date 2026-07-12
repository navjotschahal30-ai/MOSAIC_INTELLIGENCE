-- Mosaic Phase 2 — multi-tenant + auth schema.
-- Run via `npm run migrate` (db/migrate.js). Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  -- Nullable, not NOT NULL: this phase is email/password only (see
  -- legal-compliance-style note in routes/auth.js), but OAuth is an explicit
  -- planned fast-follow — OAuth-only accounts won't have a password. Making
  -- this nullable now avoids a breaking migration later.
  password_hash  TEXT,
  user_type      TEXT NOT NULL CHECK (user_type IN ('team_mosaic', 'external_agent')),
  privacy_agreed BOOLEAN NOT NULL DEFAULT FALSE,
  privacy_agreed_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per tenant needing their own VOW access, branding, and billing.
-- Both team_mosaic and external_agent users get one on registration.
CREATE TABLE IF NOT EXISTS agents (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  company_name      TEXT,           -- brokerage name; required for external_agent, see routes/auth.js
  reco_license      TEXT,           -- RECO registrant license number; required for external_agent, see routes/auth.js
  custom_branding   JSONB,          -- { logoUrl, primaryColor, accentColor, ... } — set later, not this phase
  vow_token_encrypted TEXT,         -- AES-256-GCM ciphertext, see core/crypto.js — never store plaintext
  stripe_id         TEXT,
  paid_tier         TEXT NOT NULL DEFAULT 'free' CHECK (paid_tier IN ('free', 'basic', 'pro')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- schema.sql is applied via CREATE TABLE IF NOT EXISTS on every boot (see
-- server.js) — that alone doesn't add columns to an already-existing table,
-- so new columns need an explicit idempotent ALTER TABLE below.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS reco_license TEXT;

CREATE TABLE IF NOT EXISTS subscriptions (
  id             SERIAL PRIMARY KEY,
  agent_id       INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('inactive', 'active', 'past_due', 'canceled')),
  billing_cycle  TEXT CHECK (billing_cycle IN ('monthly', 'annual')),
  stripe_subscription_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_agent_id ON subscriptions(agent_id);
