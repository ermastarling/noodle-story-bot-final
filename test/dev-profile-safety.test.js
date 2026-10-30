import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

import {
  deletePlayerProfiles,
  getPlayer,
  repairGlobalPlayerProfileFromLegacy,
  upsertPlayer
} from "../src/db/index.js";
import { newPlayerProfile } from "../src/game/player.js";
import { setPlayerShopLevel } from "../src/game/serve.js";
import { resetTutorialProgress } from "../src/game/tutorial.js";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

function openMemoryDb() {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf-8"));
  return db;
}

function strongProfile(userId, ordersServed) {
  const player = newPlayerProfile(userId);
  player.lifetime = { ...(player.lifetime || {}), orders_served: ordersServed };
  player.coins = 5000;
  player.shop_level = 6;
  player.known_recipes = [...(player.known_recipes || []), "extra_a", "extra_b", "extra_c"];
  player.state_rev = 20;
  return player;
}

test("dev stat edit keeps the profile and does not lower schema_version", () => {
  const db = openMemoryDb();
  const userId = "dev-stat-user";
  const player = strongProfile(userId, 120);
  player.schema_version = 3;
  upsertPlayer(db, "guild-a", userId, player, null, 3);

  const loaded = getPlayer(db, "guild-b", userId);
  loaded.rep = 77;
  setPlayerShopLevel(loaded, 8);
  upsertPlayer(db, "guild-b", userId, loaded, null, 1);

  const after = getPlayer(db, "guild-c", userId);
  assert.equal(after.rep, 77);
  assert.equal(after.coins, 5000);
  assert.equal(after.lifetime.orders_served, 120);
  assert.equal(after.schema_version, 3);
  db.close();
});

test("dev repair_profile restores stronger legacy progress and never overwrites a stronger global profile", () => {
  const db = openMemoryDb();
  const userId = "dev-repair-user";
  const legacy = strongProfile(userId, 400);
  db.prepare("INSERT INTO players (server_id, user_id, schema_version, state_rev, created_at, last_active_at, data_json) VALUES (?,?,?,?,?,?,?)")
    .run("legacy-guild", userId, 1, 30, 1, 100, JSON.stringify(legacy));

  const result = repairGlobalPlayerProfileFromLegacy(db, userId);
  assert.equal(result.ok, true);
  assert.equal(result.repaired, true);
  assert.equal(getPlayer(db, "any-guild", userId).lifetime.orders_served, 400);

  const again = repairGlobalPlayerProfileFromLegacy(db, userId);
  assert.equal(again.repaired, false);
  assert.equal(getPlayer(db, "any-guild", userId).lifetime.orders_served, 400);
  db.close();
});

test("dev wipe_user (all servers) removes the global row and legacy per-server rows only for the target", () => {
  const db = openMemoryDb();
  upsertPlayer(db, "guild-a", "wipe-me", strongProfile("wipe-me", 10), null, 1);
  db.prepare("INSERT INTO players (server_id, user_id, schema_version, state_rev, created_at, last_active_at, data_json) VALUES (?,?,?,?,?,?,?)")
    .run("legacy-guild", "wipe-me", 1, 5, 1, 1, JSON.stringify(strongProfile("wipe-me", 99)));
  upsertPlayer(db, "guild-a", "keep-me", strongProfile("keep-me", 10), null, 1);

  assert.ok(deletePlayerProfiles(db, "wipe-me", { allServers: true }) >= 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM players WHERE user_id='wipe-me'").get().n, 0);
  assert.equal(getPlayer(db, "guild-a", "wipe-me"), null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM players WHERE user_id='keep-me'").get().n, 1);
  db.close();
});

test("dev reset_tutorial preserves non-tutorial profile data", () => {
  const player = strongProfile("tut-user", 33);
  player.profile = { displayed_badges: { badges: ["a"], achievements: [], collections: [] } };
  resetTutorialProgress(player);
  assert.equal(player.coins, 5000);
  assert.equal(player.lifetime.orders_served, 33);
  assert.deepEqual(player.profile.displayed_badges.badges, ["a"]);
});
