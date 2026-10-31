-- Redline's durable state. Applied by `npm run store -- migrate`, in one transaction.
--
-- Letters can be confidential. Only redline_reports.doc and short-lived redline_jobs.value hold customer content.
-- Rate limits hold a keyed hash of the client address and never the address itself.
-- Writes use a version column (compare and swap), so several instances can't overwrite each other's changes.

CREATE TABLE IF NOT EXISTS redline_reports (
  id            text PRIMARY KEY,
  doc           jsonb NOT NULL,
  -- Copied from doc on every write, in the same statement, so they can be indexed.
  permit_number text,
  unlocked      boolean NOT NULL,
  created_at    timestamptz NOT NULL,
  version       integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS redline_reports_created_at ON redline_reports (created_at);
CREATE INDEX IF NOT EXISTS redline_reports_unlocked_permit ON redline_reports (permit_number) WHERE unlocked;

-- value is a report id, a stop message, or an error. A report's drafts are never copied here.
CREATE TABLE IF NOT EXISTS redline_jobs (
  id           text PRIMARY KEY,
  status       text NOT NULL CHECK (status IN ('running', 'done')),
  code         integer,
  value        jsonb,
  created_at   timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  expires_at   timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS redline_jobs_expires_at ON redline_jobs (expires_at);

CREATE TABLE IF NOT EXISTS redline_rate_limits (
  key_hash   text PRIMARY KEY,
  hits       jsonb NOT NULL,
  version    integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS redline_rate_limits_expires_at ON redline_rate_limits (expires_at);

-- The same four fields as the local waitlist file.
CREATE TABLE IF NOT EXISTS redline_waitlist (
  id     bigserial PRIMARY KEY,
  at     timestamptz NOT NULL,
  email  text NOT NULL,
  place  text NOT NULL,
  reason text NOT NULL
);
