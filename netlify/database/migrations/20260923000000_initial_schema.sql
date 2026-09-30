-- Northfield Mills: initial schema.
-- Netlify applies this automatically on deploy. Never edit it after it has run;
-- add a new, later-dated migration file for any change.

-- Team members who can use the portal. Logins themselves live in Netlify Identity;
-- this table decides access level and whether the account is active.
CREATE TABLE IF NOT EXISTS staff (
  identity_id  TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  full_name    TEXT NOT NULL DEFAULT '',
  job_title    TEXT NOT NULL DEFAULT '',
  role         TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','staff')),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
  id              TEXT PRIMARY KEY,
  subject         TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 140),
  type            TEXT NOT NULL,
  priority        TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status          TEXT NOT NULL DEFAULT 'open'   CHECK (status IN ('open','progress','waiting','resolved')),
  customer_name   TEXT NOT NULL DEFAULT '',
  customer_email  TEXT NOT NULL DEFAULT '',
  order_number    TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  created_by      TEXT,
  assignee        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tickets_updated_idx ON tickets (updated_at DESC);

CREATE TABLE IF NOT EXISTS ticket_notes (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id   TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author      TEXT,
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 3000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_notes_ticket_idx ON ticket_notes (ticket_id, created_at);

-- Copies of Netlify Forms submissions, so the portal can show and manage them.
-- (Netlify Forms keeps the originals too.)
CREATE TABLE IF NOT EXISTS signups (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  source      TEXT NOT NULL DEFAULT 'hero',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  topic       TEXT NOT NULL DEFAULT '',
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','handled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_requests (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  full_name    TEXT NOT NULL,
  email        TEXT NOT NULL,
  job_title    TEXT NOT NULL DEFAULT '',
  department   TEXT NOT NULL DEFAULT '',
  manager      TEXT NOT NULL DEFAULT '',
  reason       TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  reviewed_by  TEXT,
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
