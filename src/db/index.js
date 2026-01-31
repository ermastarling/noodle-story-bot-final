import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { nowTs } from "../util/time.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function openDb() {
  const dataDir = path.join(__dirname, "..", "..", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "noodlestory.sqlite");
  const db = new Database(dbPath);
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  db.exec(schema);
  return db;
}

export function getServer(db, serverId) {
  const row = db.prepare("SELECT data_json, state_rev FROM servers WHERE server_id=?").get(serverId);
  if (!row) return null;
  return { ...JSON.parse(row.data_json), state_rev: row.state_rev };
}

export function upsertServer(db, serverId, serverData, expectedRev=null) {
  const tx = db.transaction(() => {
    const existing = db.prepare("SELECT state_rev FROM servers WHERE server_id=?").get(serverId);
    if (!existing) {
      db.prepare("INSERT INTO servers(server_id, state_rev, created_at, data_json) VALUES (?,?,?,?)")
        .run(serverId, 1, nowTs(), JSON.stringify(serverData));
      return 1;
    }
    if (expectedRev !== null && existing.state_rev !== expectedRev) {
      const err = new Error("CONFLICT");
      err.code = "ERR_CONFLICT";
      throw err;
    }
    const newRev = existing.state_rev + 1;
    db.prepare("UPDATE servers SET state_rev=?, data_json=? WHERE server_id=?")
      .run(newRev, JSON.stringify(serverData), serverId);
    return newRev;
  });
  return tx();
}

export function getPlayer(db, serverId, userId) {
  const row = db.prepare("SELECT data_json, state_rev, schema_version FROM players WHERE server_id=? AND user_id=?")
    .get(serverId, userId);
  if (!row) return null;
  return { ...JSON.parse(row.data_json), user_id: userId, state_rev: row.state_rev, schema_version: row.schema_version };
}

export function upsertPlayer(db, serverId, userId, playerData, expectedRev=null, schemaVersion=1) {
  const tx = db.transaction(() => {
    const existing = db.prepare("SELECT state_rev FROM players WHERE server_id=? AND user_id=?").get(serverId, userId);
    if (!existing) {
      db.prepare("INSERT INTO players(server_id,user_id,schema_version,state_rev,created_at,last_active_at,data_json) VALUES (?,?,?,?,?,?,?)")
        .run(serverId, userId, schemaVersion, 1, nowTs(), nowTs(), JSON.stringify(playerData));
      return 1;
    }
    if (expectedRev !== null && existing.state_rev !== expectedRev) {
      const err = new Error("CONFLICT");
      err.code = "ERR_CONFLICT";
      throw err;
    }
    const newRev = existing.state_rev + 1;
    db.prepare("UPDATE players SET state_rev=?, last_active_at=?, data_json=? WHERE server_id=? AND user_id=?")
      .run(newRev, nowTs(), JSON.stringify(playerData), serverId, userId);
    return newRev;
  });
  return tx();
}

export function getLastActiveAt(db, serverId, userId) {
  const row = db.prepare("SELECT last_active_at FROM players WHERE server_id=? AND user_id=?").get(serverId, userId);
  return row?.last_active_at || null;
}
