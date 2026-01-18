PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS players (
  server_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  state_rev INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE IF NOT EXISTS servers (
  server_id TEXT PRIMARY KEY,
  state_rev INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  data_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS locks (
  key TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  result_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  day_key TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_server_kind_day ON jobs(server_id, kind, day_key);
