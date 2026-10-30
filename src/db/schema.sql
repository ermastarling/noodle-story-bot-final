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

CREATE INDEX IF NOT EXISTS idx_players_user_last_active ON players(user_id, last_active_at);
CREATE INDEX IF NOT EXISTS idx_players_server_last_active ON players(server_id, last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_players_server_coins_desc
  ON players(server_id, CAST(json_extract(data_json, '$.coins') AS INTEGER) DESC, last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_players_server_rep_desc
  ON players(server_id, CAST(json_extract(data_json, '$.rep') AS INTEGER) DESC, last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_players_server_bowls_desc
  ON players(server_id, CAST(json_extract(data_json, '$.lifetime.bowls_served_total') AS INTEGER) DESC, last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_players_server_last_guild
  ON players(server_id, json_extract(data_json, '$.notifications.last_noodle_guild_id'), last_active_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_locks_expires_at ON locks(expires_at);

CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  result_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires_at ON idempotency(expires_at);

CREATE TABLE IF NOT EXISTS store_purchase_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  server_id TEXT,
  spec_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'granted',
  purchased_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_store_purchase_events_source_event
  ON store_purchase_events(source, external_event_id);
CREATE INDEX IF NOT EXISTS idx_store_purchase_events_spec_status
  ON store_purchase_events(spec_id, status);
CREATE INDEX IF NOT EXISTS idx_store_purchase_events_purchased_at
  ON store_purchase_events(purchased_at DESC);

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

CREATE TABLE IF NOT EXISTS scheduled_message_state (
  job_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_message_delivery (
  job_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  attempt_started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_game_updates (
  schedule_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  update_id TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  rollout_summary INTEGER NOT NULL DEFAULT 0 CHECK (rollout_summary IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'pending',
  message_id TEXT,
  attempt_channel_id TEXT,
  attempt_canary INTEGER CHECK (attempt_canary IN (0, 1) OR attempt_canary IS NULL),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_game_updates_due
  ON scheduled_game_updates(guild_id, status, scheduled_at);

CREATE TABLE IF NOT EXISTS game_update_release_state (
  guild_id TEXT PRIMARY KEY,
  first_update_sent_at INTEGER,
  first_update_id TEXT
);

CREATE TABLE IF NOT EXISTS game_update_season_state (
  guild_id TEXT PRIMARY KEY,
  last_season TEXT NOT NULL,
  last_event_id TEXT NOT NULL,
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  message_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS weekly_giveaway_batches (
  guild_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  contest_count INTEGER NOT NULL CHECK (contest_count BETWEEN 1 AND 3),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, week_key)
);

CREATE TABLE IF NOT EXISTS weekly_giveaways (
  giveaway_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  contest_number INTEGER NOT NULL,
  prize_json TEXT NOT NULL,
  closes_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  award_status TEXT NOT NULL,
  confirmation_status TEXT NOT NULL DEFAULT 'pending',
  confirmation_started_at INTEGER,
  valor_confirmation_status TEXT NOT NULL DEFAULT 'pending',
  valor_confirmation_started_at INTEGER,
  valor_confirmation_message_id TEXT,
  winner_user_id TEXT,
  message_id TEXT,
  confirmation_message_id TEXT,
  created_at INTEGER NOT NULL,
  posting_started_at INTEGER,
  UNIQUE (guild_id, week_key, contest_number)
);

CREATE INDEX IF NOT EXISTS idx_weekly_giveaways_due
  ON weekly_giveaways(status, closes_at);

CREATE TABLE IF NOT EXISTS weekly_giveaway_entries (
  giveaway_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  entered_at INTEGER NOT NULL,
  PRIMARY KEY (giveaway_id, user_id)
);

CREATE TABLE IF NOT EXISTS weekly_giveaway_wins (
  guild_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  giveaway_id TEXT NOT NULL UNIQUE,
  won_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, week_key, user_id)
);

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

CREATE TABLE IF NOT EXISTS counting_state (
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1,
  last_user_id TEXT,
  last_message_id TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, channel_id)
);

CREATE TABLE IF NOT EXISTS counting_milestone_rewards (
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  milestone INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  reward_json TEXT NOT NULL,
  result_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  granted_at INTEGER,
  notice_sent_at INTEGER,
  PRIMARY KEY (guild_id, channel_id, milestone)
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

CREATE TABLE IF NOT EXISTS recent_social_users (
  server_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (server_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_guild_parties_server ON guild_parties(server_id, status);
CREATE INDEX IF NOT EXISTS idx_party_members_user ON party_members(user_id);
CREATE INDEX IF NOT EXISTS idx_shared_orders_party ON shared_orders(party_id, status);
CREATE INDEX IF NOT EXISTS idx_tips_server ON tips(server_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tips_users ON tips(from_user_id, to_user_id);
CREATE INDEX IF NOT EXISTS idx_recent_social_users_server_last_seen
  ON recent_social_users(server_id, last_seen_at DESC);

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
