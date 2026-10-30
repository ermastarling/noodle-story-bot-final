import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

test("SQLite backup can be reopened and passes integrity_check", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noodle-db-backup-"));
  const backupPath = path.join(dir, "snapshot.sqlite");
  const source = new Database(":memory:");
  let restored;
  try {
    source.exec("CREATE TABLE player_data (user_id TEXT PRIMARY KEY, coins INTEGER NOT NULL)");
    source.prepare("INSERT INTO player_data (user_id, coins) VALUES (?, ?)").run("player-1", 125);
    await source.backup(backupPath);
    source.close();

    restored = new Database(backupPath);
    assert.equal(restored.pragma("integrity_check", { simple: true }), "ok");
    assert.deepEqual(restored.prepare("SELECT user_id, coins FROM player_data").get(), {
      user_id: "player-1",
      coins: 125
    });
  } finally {
    if (source.open) source.close();
    if (restored?.open) restored.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
