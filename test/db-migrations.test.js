import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { ensureRuntimeSchemaColumns } from "../src/db/migrations.js";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

test("runtime schema migration adds giveaway delivery fields idempotently", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE weekly_giveaways (
      giveaway_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  ensureRuntimeSchemaColumns(db);
  ensureRuntimeSchemaColumns(db);
  const columns = db.prepare("PRAGMA table_info(weekly_giveaways)").all();
  assert.equal(columns.some((column) => column.name === "confirmation_status"), true);
  assert.equal(columns.some((column) => column.name === "confirmation_started_at"), true);
  assert.equal(columns.some((column) => column.name === "valor_confirmation_status"), true);
  assert.equal(columns.some((column) => column.name === "valor_confirmation_started_at"), true);
  assert.equal(columns.some((column) => column.name === "valor_confirmation_message_id"), true);
  assert.equal(columns.some((column) => column.name === "posting_started_at"), true);
  db.prepare("INSERT INTO weekly_giveaways (giveaway_id, status, created_at) VALUES ('legacy', 'open', 1)").run();
  assert.equal(db.prepare("SELECT confirmation_status FROM weekly_giveaways WHERE giveaway_id='legacy'").get().confirmation_status, "pending");
  db.close();
});
