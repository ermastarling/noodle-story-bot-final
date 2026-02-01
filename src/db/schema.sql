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

-- Social Systems Tables (Phase D)

CREATE TABLE IF NOT EXISTS guild_parties (
  party_id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  party_name TEXT NOT NULL,
  leader_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  disbanded_at INTEGER,
  max_members INTEGER NOT NULL DEFAULT 4,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS party_members (
  party_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  left_at INTEGER,
  contribution_points INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (party_id, user_id)
);

CREATE TABLE IF NOT EXISTS shared_orders (
  shared_order_id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  servings INTEGER NOT NULL DEFAULT 5,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS shared_order_contributions (
  shared_order_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  ingredient_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  contributed_at INTEGER NOT NULL,
  PRIMARY KEY (shared_order_id, user_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS tips (
  tip_id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  message TEXT
);

CREATE INDEX IF NOT EXISTS idx_guild_parties_server ON guild_parties(server_id, status);
CREATE INDEX IF NOT EXISTS idx_party_members_user ON party_members(user_id);
CREATE INDEX IF NOT EXISTS idx_shared_orders_party ON shared_orders(party_id, status);
CREATE INDEX IF NOT EXISTS idx_tips_server ON tips(server_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tips_users ON tips(from_user_id, to_user_id);

-- Recipe Discovery Tables (Phase 15)

CREATE TABLE IF NOT EXISTS recipes (
  recipe_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tier TEXT NOT NULL,
  ingredients TEXT NOT NULL,
  unlock_conditions TEXT
);

CREATE TABLE IF NOT EXISTS recipe_clues (
  clue_id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL,
  hint_text TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recipe_scrolls (
  scroll_id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL,
  rarity TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recipe_clues_recipe ON recipe_clues(recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_scrolls_recipe ON recipe_scrolls(recipe_id);
