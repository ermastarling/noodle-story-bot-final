import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { getPlayer, getPlayerStorageServerId, upsertPlayer } from "../src/db/index.js";
import { newPlayerProfile } from "../src/game/player.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("Player persistence never downgrades a newer profile schema version", () => {
  const db = new Database(":memory:");
  try {
    db.exec(fs.readFileSync(path.join(__dirname, "../src/db/schema.sql"), "utf8"));
    const userId = "schema-version-user";
    const newerProfile = newPlayerProfile(userId);
    upsertPlayer(db, "guild", userId, newerProfile, null, 5);

    const staleProfile = newPlayerProfile(userId);
    staleProfile.coins = 250;
    upsertPlayer(db, "guild", userId, staleProfile, null, 1);

    const storageServerId = getPlayerStorageServerId("guild");
    const storedRow = db.prepare(
      "SELECT schema_version, data_json FROM players WHERE server_id = ? AND user_id = ?"
    ).get(storageServerId, userId);
    assert.equal(storedRow.schema_version, 5);
    assert.equal(JSON.parse(storedRow.data_json).schema_version, 5);
    assert.equal(getPlayer(db, "guild", userId).schema_version, 5);
  } finally {
    db.close();
  }
});

test("Player loading fails closed for malformed or missing stored JSON instead of allowing profile replacement", () => {
  const db = new Database(":memory:");
  try {
    db.exec(fs.readFileSync(path.join(__dirname, "../src/db/schema.sql"), "utf8"));
    const storageServerId = getPlayerStorageServerId("guild");
    db.exec(`
      DROP INDEX idx_players_server_coins_desc;
      DROP INDEX idx_players_server_rep_desc;
      DROP INDEX idx_players_server_bowls_desc;
      DROP INDEX idx_players_server_last_guild;
    `);
    const insert = db.prepare(`
      INSERT INTO players(server_id, user_id, schema_version, state_rev, created_at, last_active_at, data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const [userId, dataJson] of [["corrupt-profile-user", "{invalid-json"], ["empty-profile-user", ""]]) {
      insert.run(storageServerId, userId, 1, 4, Date.now(), Date.now(), dataJson);
      assert.throws(
        () => getPlayer(db, "guild", userId),
        (error) => error.code === "ERR_PLAYER_PROFILE_CORRUPT"
      );
      const stored = db.prepare("SELECT state_rev, data_json FROM players WHERE server_id = ? AND user_id = ?")
        .get(storageServerId, userId);
      assert.equal(stored.state_rev, 4);
      assert.equal(stored.data_json, dataJson);
    }
  } finally {
    db.close();
  }
});
