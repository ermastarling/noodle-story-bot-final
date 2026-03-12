import { createRequire } from "module";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { nowTs } from "../util/time.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const playerCacheStorage = new AsyncLocalStorage();
const sharedPlayerCache = new Map();
const SHARED_CACHE_TTL_MS = 30_000;
const SHARED_CACHE_MAX = 1000;
const sharedProjectionCache = new Map();
const SHARED_PROJECTION_TTL_MS = 30_000;
const SHARED_PROJECTION_MAX = 2000;
const statementCache = new WeakMap();
const sharedServerCache = new Map();
const SHARED_SERVER_TTL_MS = 30_000;
const SHARED_SERVER_MAX = 500;

export function withPlayerCache(fn) {
  return playerCacheStorage.run(new Map(), fn);
}

function getPlayerCache() {
  return playerCacheStorage.getStore() ?? null;
}

function prepareCached(db, sql) {
  let cache = statementCache.get(db);
  if (!cache) {
    cache = new Map();
    statementCache.set(db, cache);
  }
  let stmt = cache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    cache.set(sql, stmt);
  }
  return stmt;
}

function makePlayerCacheKey(serverId, userId) {
  return `${serverId}:${userId}`;
}

function evictSharedCacheIfNeeded() {
  while (sharedPlayerCache.size > SHARED_CACHE_MAX) {
    const oldestKey = sharedPlayerCache.keys().next().value;
    if (oldestKey === undefined) break;
    sharedPlayerCache.delete(oldestKey);
  }
}

function evictProjectionCacheIfNeeded() {
  while (sharedProjectionCache.size > SHARED_PROJECTION_MAX) {
    const oldestKey = sharedProjectionCache.keys().next().value;
    if (oldestKey === undefined) break;
    sharedProjectionCache.delete(oldestKey);
  }
}

function evictServerCacheIfNeeded() {
  while (sharedServerCache.size > SHARED_SERVER_MAX) {
    const oldestKey = sharedServerCache.keys().next().value;
    if (oldestKey === undefined) break;
    sharedServerCache.delete(oldestKey);
  }
}

function getSharedPlayer(serverId, userId) {
  const key = makePlayerCacheKey(serverId, userId);
  const entry = sharedPlayerCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    sharedPlayerCache.delete(key);
    return null;
  }
  return entry.player;
}

function setSharedPlayer(serverId, userId, player) {
  const key = makePlayerCacheKey(serverId, userId);
  const expiresAt = Date.now() + SHARED_CACHE_TTL_MS;
  sharedPlayerCache.delete(key); // refresh LRU order
  sharedPlayerCache.set(key, { player, expiresAt });
  evictSharedCacheIfNeeded();
}

function invalidateSharedPlayer(serverId, userId) {
  sharedPlayerCache.delete(makePlayerCacheKey(serverId, userId));
  sharedProjectionCache.delete(makePlayerCacheKey(serverId, userId));
}
export function openDb() {
  if (process.env.NOODLE_SKIP_DB === "1") {
    return null;
  }
  // Load the native SQLite module dynamically using require() to keep openDb synchronous while allowing conditional skipping via NOODLE_SKIP_DB.
  const Database = require("better-sqlite3");
  const dataDir = path.join(__dirname, "..", "..", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "noodlestory.sqlite");
  const db = new Database(dbPath);
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  db.exec(schema);
  return db;
}

export function getServer(db, serverId) {
  const cached = sharedServerCache.get(serverId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.server;
  }

  const row = prepareCached(db, "SELECT data_json, state_rev FROM servers WHERE server_id=?").get(serverId);
  if (!row) return null;
  const server = { ...JSON.parse(row.data_json), state_rev: row.state_rev };
  sharedServerCache.set(serverId, { server, expiresAt: Date.now() + SHARED_SERVER_TTL_MS });
  evictServerCacheIfNeeded();
  return server;
}

export function upsertServer(db, serverId, serverData, expectedRev=null) {
  const tx = db.transaction(() => {
    const existing = prepareCached(db, "SELECT state_rev FROM servers WHERE server_id=?").get(serverId);
    if (!existing) {
      prepareCached(db, "INSERT INTO servers(server_id, state_rev, created_at, data_json) VALUES (?,?,?,?)")
        .run(serverId, 1, nowTs(), JSON.stringify(serverData));
      return 1;
    }
    if (expectedRev !== null && existing.state_rev !== expectedRev) {
      const err = new Error("CONFLICT");
      err.code = "ERR_CONFLICT";
      throw err;
    }
    const newRev = existing.state_rev + 1;
    prepareCached(db, "UPDATE servers SET state_rev=?, data_json=? WHERE server_id=?")
      .run(newRev, JSON.stringify(serverData), serverId);
    return newRev;
  });
  const rev = tx();
  sharedServerCache.delete(serverId);
  return rev;
}

export function getPlayer(db, serverId, userId) {
  const cache = getPlayerCache();
  const cacheKey = cache ? makePlayerCacheKey(serverId, userId) : null;
  if (cache && cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const shared = getSharedPlayer(serverId, userId);
  if (shared) {
    if (cache && cacheKey) cache.set(cacheKey, shared);
    return shared;
  }
  const row = prepareCached(db, "SELECT data_json, state_rev, schema_version FROM players WHERE server_id=? AND user_id=?")
    .get(serverId, userId);
  if (!row) return null;
  const player = { ...JSON.parse(row.data_json), user_id: userId, state_rev: row.state_rev, schema_version: row.schema_version };
  if (cache && cacheKey) {
    cache.set(cacheKey, player);
  }
  setSharedPlayer(serverId, userId, player);
  return player;
}

function buildPlayerLite(fullPlayer) {
  return {
    user_id: fullPlayer?.user_id,
    state_rev: fullPlayer?.state_rev,
    schema_version: fullPlayer?.schema_version,
    known_recipes: Array.isArray(fullPlayer?.known_recipes) ? fullPlayer.known_recipes : [],
    resilience: fullPlayer?.resilience?.temp_recipes ? { temp_recipes: fullPlayer.resilience.temp_recipes } : {},
    profile: fullPlayer?.profile?.badges ? { badges: fullPlayer.profile.badges } : {},
    shop_level: fullPlayer?.shop_level,
    kitchen: fullPlayer?.kitchen
  };
}

function getSharedPlayerLite(serverId, userId) {
  const key = makePlayerCacheKey(serverId, userId);
  const entry = sharedProjectionCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    sharedProjectionCache.delete(key);
    return null;
  }
  return entry.player;
}

function setSharedPlayerLite(serverId, userId, playerLite) {
  const key = makePlayerCacheKey(serverId, userId);
  const expiresAt = Date.now() + SHARED_PROJECTION_TTL_MS;
  sharedProjectionCache.delete(key);
  sharedProjectionCache.set(key, { player: playerLite, expiresAt });
  evictProjectionCacheIfNeeded();
}

export function getPlayerLite(db, serverId, userId) {
  const cache = getPlayerCache();
  const cacheKey = cache ? makePlayerCacheKey(serverId, userId) : null;
  if (cache && cache.has(cacheKey)) {
    return buildPlayerLite(cache.get(cacheKey));
  }

  const sharedLite = getSharedPlayerLite(serverId, userId);
  if (sharedLite) {
    return sharedLite;
  }

  const sharedFull = getSharedPlayer(serverId, userId);
  if (sharedFull) {
    const lite = buildPlayerLite(sharedFull);
    setSharedPlayerLite(serverId, userId, lite);
    return lite;
  }

  const row = db.prepare("SELECT data_json, state_rev, schema_version FROM players WHERE server_id=? AND user_id=?")
    .get(serverId, userId);
  if (!row) return null;
  const full = { ...JSON.parse(row.data_json), user_id: userId, state_rev: row.state_rev, schema_version: row.schema_version };
  const lite = buildPlayerLite(full);
  setSharedPlayerLite(serverId, userId, lite);
  return lite;
}

function prunePlayerBeforePersist(player) {
  const notifications = player?.notifications;
  if (notifications && Array.isArray(notifications.pending_pantry_messages)) {
    const MAX_PENDING_PANTRY = 50;
    const pending = notifications.pending_pantry_messages;
    if (pending.length > MAX_PENDING_PANTRY) {
      notifications.pending_pantry_messages = pending.slice(-MAX_PENDING_PANTRY);
    }
  }

  const orders = player?.orders;
  if (orders && Array.isArray(orders.order_board)) {
    delete orders.order_board; // legacy payload cleanup
  }
  if (orders && orders.accepted && typeof orders.accepted === "object") {
    const now = Date.now();
    for (const [id, entry] of Object.entries(orders.accepted)) {
      const expiresAt = entry?.expires_at;
      if (expiresAt && Number.isFinite(expiresAt) && expiresAt < now) {
        delete orders.accepted[id];
      }
    }

    // Safety cap: keep the most recent accepted orders (should normally stay under 5).
    const ACCEPTED_CAP = 10;
    const acceptedEntries = Object.entries(orders.accepted);
    if (acceptedEntries.length > ACCEPTED_CAP) {
      const sorted = acceptedEntries.sort((a, b) => {
        const aTs = a[1]?.accepted_at ?? 0;
        const bTs = b[1]?.accepted_at ?? 0;
        return bTs - aTs;
      });
      const trimmed = sorted.slice(0, ACCEPTED_CAP);
      orders.accepted = Object.fromEntries(trimmed);
    }
  }

  const lifetime = player?.lifetime;
  if (lifetime && lifetime.npc_seen && typeof lifetime.npc_seen === "object") {
    const NPC_SEEN_CAP = 200;
    const entries = Object.entries(lifetime.npc_seen);
    if (entries.length > NPC_SEEN_CAP) {
      const trimmed = entries.slice(0, NPC_SEEN_CAP);
      lifetime.npc_seen = Object.fromEntries(trimmed);
    }
  }

  const inv = player?.inv_ingredients;
  if (inv && typeof inv === "object") {
    for (const [id, qty] of Object.entries(inv)) {
      if (!Number.isFinite(Number(qty)) || Number(qty) <= 0) {
        delete inv[id];
      }
    }
  }

  // Drop undefined fields to shrink JSON; keeps nulls intact for semantics.
  const stripUndefined = (obj) => {
    if (!obj || typeof obj !== "object") return;
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val === undefined) {
        delete obj[key];
        continue;
      }
      if (val && typeof val === "object" && !Array.isArray(val)) {
        stripUndefined(val);
      }
    }
  };

  stripUndefined(player);
}

export function upsertPlayer(db, serverId, userId, playerData, expectedRev=null, schemaVersion=1) {
  prunePlayerBeforePersist(playerData);
  const tx = db.transaction(() => {
    const existing = prepareCached(db, "SELECT state_rev FROM players WHERE server_id=? AND user_id=?").get(serverId, userId);
    if (!existing) {
      prepareCached(db, "INSERT INTO players(server_id,user_id,schema_version,state_rev,created_at,last_active_at,data_json) VALUES (?,?,?,?,?,?,?)")
        .run(serverId, userId, schemaVersion, 1, nowTs(), nowTs(), JSON.stringify(playerData));
      return 1;
    }
    if (expectedRev !== null && existing.state_rev !== expectedRev) {
      const err = new Error("CONFLICT");
      err.code = "ERR_CONFLICT";
      throw err;
    }
    const newRev = existing.state_rev + 1;
    prepareCached(db, "UPDATE players SET state_rev=?, last_active_at=?, data_json=? WHERE server_id=? AND user_id=?")
      .run(newRev, nowTs(), JSON.stringify(playerData), serverId, userId);
    return newRev;
  });
  const rev = tx();
  invalidateSharedPlayer(serverId, userId);
  return rev;
}

export function getLastActiveAt(db, serverId, userId) {
  const row = prepareCached(db, "SELECT last_active_at FROM players WHERE server_id=? AND user_id=?").get(serverId, userId);
  return row?.last_active_at || null;
}

export function getLatestServerIdForUser(db, userId) {
  const row = prepareCached(db, "SELECT server_id FROM players WHERE user_id=? ORDER BY last_active_at DESC LIMIT 1")
    .get(userId);
  return row?.server_id || null;
}
