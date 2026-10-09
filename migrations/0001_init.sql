-- Orbitry D1 schema
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  api_plan TEXT NOT NULL DEFAULT 'free',        -- 'free' | 'pro'
  planner_active INTEGER NOT NULL DEFAULT 0,
  stripe_customer TEXT
);

CREATE TABLE login_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  next TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX login_tokens_email ON login_tokens (email, created_at);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  lat REAL NOT NULL, lon REAL NOT NULL, height REAL NOT NULL DEFAULT 0,
  tz TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX locations_user ON locations (user_id);

CREATE TABLE favorites (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  norad INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, norad)
);

CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                 -- 'pass' | 'reentry'
  norad INTEGER NOT NULL,
  lat REAL, lon REAL, height REAL, place TEXT, tz TEXT,
  min_el REAL NOT NULL DEFAULT 20,
  lead_minutes INTEGER NOT NULL DEFAULT 60,
  webhook_url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX alerts_kind ON alerts (kind, active);
CREATE INDEX alerts_user ON alerts (user_id);

CREATE TABLE alert_sends (
  alert_id TEXT NOT NULL REFERENCES alerts (id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (alert_id, event_key)
);

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX api_keys_user ON api_keys (user_id);

CREATE TABLE usage (
  subject TEXT NOT NULL,   -- 'key:<id>' or 'ip:<hash>'
  day TEXT NOT NULL,       -- YYYY-MM-DD (UTC)
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (subject, day)
);

CREATE TABLE planner_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  profile TEXT NOT NULL,          -- JSON: location, equipment, horizon, targets
  email_nightly INTEGER NOT NULL DEFAULT 0,
  last_sent_day TEXT,
  updated_at TEXT NOT NULL
);

-- Element sets as published, for the paid history endpoint. Filled by the deploy workflow.
CREATE TABLE element_history (
  norad INTEGER NOT NULL,
  epoch TEXT NOT NULL,
  omm TEXT NOT NULL,
  PRIMARY KEY (norad, epoch)
);
