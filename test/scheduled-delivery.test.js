import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import {
  claimScheduledMessageDelivery,
  completeScheduledMessageDelivery,
  markScheduledMessageDeliveryUnknown,
  markStaleScheduledDeliveriesUnknown,
  reconcileScheduledDelivery
} from "../src/jobs/scheduledDelivery.js";
import {
  claimScheduledGameUpdateDelivery,
  completeScheduledGameUpdateDelivery
} from "../src/jobs/gameUpdates.js";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

test("scheduled message delivery claims are atomic and uncertain sends are not retried", () => {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8"));

  assert.equal(claimScheduledMessageDelivery(db, "work_ping", 1), true);
  assert.equal(claimScheduledMessageDelivery(db, "work_ping", 2), false);
  assert.equal(markScheduledMessageDeliveryUnknown(db, "work_ping", 3), true);
  assert.equal(claimScheduledMessageDelivery(db, "work_ping", 4), false);

  assert.equal(claimScheduledMessageDelivery(db, "work_ping", 5), false);
  db.prepare("UPDATE scheduled_message_delivery SET status = 'sent' WHERE job_id = 'work_ping'").run();
  assert.equal(claimScheduledMessageDelivery(db, "work_ping", 6), true);
  assert.equal(completeScheduledMessageDelivery(db, "work_ping", 7), true);
  assert.equal(db.prepare("SELECT status FROM scheduled_message_delivery WHERE job_id = 'work_ping'").get().status, "sent");
  db.close();
});

test("stale delivery attempts across schedulers become operator-reconcilable", () => {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8"));
  const now = 100_000_000;
  const oldAttempt = now - 11 * 60 * 1000;
  db.prepare("INSERT INTO scheduled_message_delivery(job_id, status, attempt_started_at, updated_at) VALUES ('work_ping', 'sending', ?, ?)")
    .run(oldAttempt, oldAttempt);
  db.prepare(`INSERT INTO scheduled_game_updates
    (schedule_id, guild_id, update_id, scheduled_at, payload_json, rollout_summary, status, created_by, created_at, updated_at)
    VALUES ('schedule-1', '12345678901234567', 'update', ?, '{}', 0, 'sending', 'admin', ?, ?)`)
    .run(now, oldAttempt, oldAttempt);
  db.prepare(`INSERT INTO game_update_season_state
    (guild_id, last_season, last_event_id, payload_json, status, updated_at)
    VALUES ('12345678901234567', 'spring', 'event', '{}', 'sending', ?)`)
    .run(oldAttempt);
  db.prepare(`INSERT INTO weekly_giveaways
    (giveaway_id, guild_id, channel_id, week_key, contest_number, prize_json, closes_at, status, award_status, created_at, posting_started_at, confirmation_status, confirmation_started_at, valor_confirmation_status, valor_confirmation_started_at)
    VALUES ('giveaway-1', '12345678901234567', '22345678901234567', 'week', 1, '{}', ?, 'posting', 'awaiting_manual', ?, ?, 'sending', ?, 'sending', ?)`)
    .run(now, oldAttempt, oldAttempt, oldAttempt, oldAttempt);

  assert.equal(markStaleScheduledDeliveriesUnknown(db, now), 6);
  assert.equal(db.prepare("SELECT status FROM scheduled_message_delivery WHERE job_id = 'work_ping'").get().status, "delivery_unknown");
  assert.equal(db.prepare("SELECT status FROM scheduled_game_updates WHERE schedule_id = 'schedule-1'").get().status, "delivery_unknown");
  assert.equal(db.prepare("SELECT status FROM game_update_season_state WHERE guild_id = '12345678901234567'").get().status, "delivery_unknown");
  const giveaway = db.prepare("SELECT status, confirmation_status, valor_confirmation_status FROM weekly_giveaways WHERE giveaway_id = 'giveaway-1'").get();
  assert.deepEqual(giveaway, {
    status: "delivery_unknown",
    confirmation_status: "delivery_unknown",
    valor_confirmation_status: "delivery_unknown"
  });
  db.close();
});

test("uncertain delivery reconciliation requires evidence and supports safe resolution", () => {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8"));
  db.prepare("INSERT INTO scheduled_message_delivery(job_id, status, attempt_started_at, updated_at) VALUES ('work_ping', 'delivery_unknown', 1, 1)")
    .run();

  assert.deepEqual(reconcileScheduledDelivery(db, {
    type: "scheduled_message",
    recordId: "work_ping",
    resolution: "not_delivered"
  }), { ok: false, reason: "absence_not_verified" });
  assert.deepEqual(reconcileScheduledDelivery(db, {
    type: "scheduled_message",
    recordId: "work_ping",
    resolution: "delivered",
    messageId: "not-a-snowflake"
  }), { ok: false, reason: "invalid_message_id" });
  assert.deepEqual(reconcileScheduledDelivery(db, {
    type: "scheduled_message",
    recordId: "work_ping",
    resolution: "not_delivered",
    verifiedAbsent: true
  }), { ok: true, status: "cleared" });
  assert.equal(db.prepare("SELECT 1 FROM scheduled_message_delivery WHERE job_id = 'work_ping'").get(), undefined);
  db.close();
});

test("confirmed scheduled messages record the message pointer needed for replacement", () => {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8"));
  db.prepare("INSERT INTO scheduled_message_delivery(job_id, status, attempt_started_at, updated_at) VALUES ('work_ping', 'delivery_unknown', 1, 1)")
    .run();
  assert.deepEqual(reconcileScheduledDelivery(db, {
    type: "scheduled_message",
    recordId: "work_ping",
    resolution: "delivered",
    messageId: "62345678901234567",
    channelId: "22345678901234567",
    now: 10
  }), { ok: true, status: "sent" });
  assert.deepEqual(db.prepare("SELECT channel_id, message_id FROM scheduled_message_state WHERE job_id = 'work_ping'").get(), {
    channel_id: "22345678901234567",
    message_id: "62345678901234567"
  });
  db.close();
});

test("delivery reconciliation resolves scheduled update, season, and giveaway states", () => {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8"));
  const guildId = "12345678901234567";
  const messageId = "62345678901234567";
  db.prepare(`INSERT INTO scheduled_game_updates
    (schedule_id, guild_id, update_id, scheduled_at, payload_json, rollout_summary, status, created_by, created_at, updated_at)
    VALUES ('update-1', ?, 'update', 1, '{}', 0, 'delivery_unknown', 'admin', 1, 1)`).run(guildId);
  db.prepare(`INSERT INTO game_update_season_state
    (guild_id, last_season, last_event_id, payload_json, status, updated_at)
    VALUES (?, 'spring', 'event', '{}', 'delivery_unknown', 1)`).run(guildId);
  db.prepare(`INSERT INTO game_update_season_state
    (guild_id, last_season, last_event_id, payload_json, status, updated_at)
    VALUES ('72345678901234567', 'summer', 'event', '{}', 'delivery_unknown', 1)`).run();
  const insertGiveaway = db.prepare(`INSERT INTO weekly_giveaways
    (giveaway_id, guild_id, channel_id, week_key, contest_number, prize_json, closes_at, status, award_status, created_at, posting_started_at, confirmation_status, confirmation_started_at, valor_confirmation_status, valor_confirmation_started_at)
    VALUES (?, ?, '22345678901234567', ?, 1, '{}', 9999999999999, ?, ?, 1, 1, ?, 1, ?, 1)`);
  insertGiveaway.run("post-1", guildId, "week-post", "delivery_unknown", "pending", "pending", "pending");
  insertGiveaway.run("winner-1", guildId, "week-winner", "awarding", "granted", "delivery_unknown", "pending");
  insertGiveaway.run("valor-1", guildId, "week-valor", "awarding", "awaiting_manual", "pending", "delivery_unknown");

  assert.deepEqual(reconcileScheduledDelivery(db, {
    type: "game_update",
    recordId: "update-1",
    resolution: "not_delivered",
    verifiedAbsent: true
  }), { ok: true, status: "pending" });
  assert.equal(db.prepare("SELECT status FROM scheduled_game_updates WHERE schedule_id = 'update-1'").get().status, "pending");
  assert.deepEqual(reconcileScheduledDelivery(db, {
    type: "season_update",
    recordId: guildId,
    resolution: "delivered",
    messageId,
    now: 10
  }), { ok: true, status: "sent" });
  assert.equal(db.prepare("SELECT message_id FROM game_update_season_state WHERE guild_id = ?").get(guildId).message_id, messageId);
  assert.deepEqual(reconcileScheduledDelivery(db, {
    type: "season_update",
    recordId: "72345678901234567",
    resolution: "delivered",
    messageId,
    canary: true,
    now: 11
  }), { ok: true, status: "canary_previewed" });
  assert.equal(db.prepare("SELECT status FROM game_update_season_state WHERE guild_id = '72345678901234567'").get().status, "canary_previewed");
  assert.deepEqual(reconcileScheduledDelivery(db, {
    type: "giveaway_post",
    recordId: "post-1",
    resolution: "not_delivered",
    verifiedAbsent: true
  }), { ok: true, status: "open" });
  assert.deepEqual(reconcileScheduledDelivery(db, {
    type: "giveaway_winner",
    recordId: "winner-1",
    resolution: "delivered",
    messageId
  }), { ok: true, status: "sent" });
  assert.deepEqual(reconcileScheduledDelivery(db, {
    type: "valor_confirmation",
    recordId: "valor-1",
    resolution: "not_delivered",
    verifiedAbsent: true
  }), { ok: true, status: "pending" });

  assert.equal(db.prepare("SELECT status FROM weekly_giveaways WHERE giveaway_id = 'post-1'").get().status, "open");
  assert.equal(db.prepare("SELECT status FROM weekly_giveaways WHERE giveaway_id = 'winner-1'").get().status, "closed");
  assert.equal(db.prepare("SELECT confirmation_message_id FROM weekly_giveaways WHERE giveaway_id = 'winner-1'").get().confirmation_message_id, messageId);
  assert.equal(db.prepare("SELECT valor_confirmation_status FROM weekly_giveaways WHERE giveaway_id = 'valor-1'").get().valor_confirmation_status, "pending");
  db.close();
});

test("canary rollout summary remains queued for production and production completion opens the release gate atomically", () => {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8"));
  const scheduledUpdate = (scheduleId) => db.prepare(`INSERT INTO scheduled_game_updates
    (schedule_id, guild_id, update_id, scheduled_at, payload_json, rollout_summary, status, created_by, created_at, updated_at)
    VALUES (?, '12345678901234567', 'rollout', 1, '{}', 1, 'pending', 'admin', 1, 1)`).run(scheduleId);

  scheduledUpdate("canary-preview");
  assert.equal(claimScheduledGameUpdateDelivery(db, {
    scheduleId: "canary-preview",
    expectedStatus: "pending",
    channelId: "22345678901234567",
    canary: true,
    now: 5
  }), true);
  assert.equal(completeScheduledGameUpdateDelivery(db, {
    scheduleId: "canary-preview",
    messageId: "32345678901234567",
    now: 10
  }), true);
  assert.equal(db.prepare("SELECT status FROM scheduled_game_updates WHERE schedule_id = 'canary-preview'").get().status, "canary_previewed");
  assert.equal(db.prepare("SELECT 1 FROM game_update_release_state").get(), undefined);

  assert.equal(claimScheduledGameUpdateDelivery(db, {
    scheduleId: "canary-preview",
    expectedStatus: "canary_previewed",
    channelId: "32345678901234567",
    canary: false,
    now: 15
  }), true);
  assert.equal(completeScheduledGameUpdateDelivery(db, {
    scheduleId: "canary-preview",
    messageId: "42345678901234567",
    now: 20
  }), true);
  assert.deepEqual(db.prepare("SELECT first_update_sent_at, first_update_id FROM game_update_release_state WHERE guild_id = '12345678901234567'").get(), {
    first_update_sent_at: 20,
    first_update_id: "canary-preview"
  });
  db.close();
});

test("scheduled game update claims require an explicit route and delivery mode", () => {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8"));
  db.prepare(`INSERT INTO scheduled_game_updates
    (schedule_id, guild_id, update_id, scheduled_at, payload_json, rollout_summary, status, created_by, created_at, updated_at)
    VALUES ('explicit-route', '12345678901234567', 'rollout', 1, '{}', 1, 'pending', 'admin', 1, 1)`).run();

  assert.throws(() => claimScheduledGameUpdateDelivery(db, {
    scheduleId: "explicit-route",
    expectedStatus: "pending",
    channelId: "22345678901234567"
  }), /mode must be explicit/);
  assert.equal(db.prepare("SELECT status FROM scheduled_game_updates WHERE schedule_id = 'explicit-route'").get().status, "pending");
  db.close();
});

test("reconciliation uses persisted attempt mode instead of the current rollout mode", () => {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8"));
  db.prepare(`INSERT INTO scheduled_game_updates
    (schedule_id, guild_id, update_id, scheduled_at, payload_json, rollout_summary, status, attempt_channel_id, attempt_canary, created_by, created_at, updated_at)
    VALUES ('uncertain-canary', '12345678901234567', 'rollout', 1, '{}', 1, 'delivery_unknown', '22345678901234567', 1, 'admin', 1, 1)`).run();

  assert.deepEqual(reconcileScheduledDelivery(db, {
    type: "game_update",
    recordId: "uncertain-canary",
    resolution: "delivered",
    messageId: "52345678901234567",
    canary: false,
    now: 25
  }), { ok: true, status: "canary_previewed" });
  assert.equal(db.prepare("SELECT status FROM scheduled_game_updates WHERE schedule_id = 'uncertain-canary'").get().status, "canary_previewed");
  assert.equal(db.prepare("SELECT 1 FROM game_update_release_state WHERE guild_id = '12345678901234567'").get(), undefined);

  db.prepare(`INSERT INTO scheduled_game_updates
    (schedule_id, guild_id, update_id, scheduled_at, payload_json, rollout_summary, status, attempt_channel_id, attempt_canary, created_by, created_at, updated_at)
    VALUES ('uncertain-production', '12345678901234567', 'rollout', 1, '{}', 1, 'delivery_unknown', '32345678901234567', 0, 'admin', 1, 1)`).run();
  assert.deepEqual(reconcileScheduledDelivery(db, {
    type: "game_update",
    recordId: "uncertain-production",
    resolution: "delivered",
    messageId: "62345678901234567",
    canary: true,
    now: 30
  }), { ok: true, status: "sent" });
  assert.equal(db.prepare("SELECT first_update_id FROM game_update_release_state WHERE guild_id = '12345678901234567'").get().first_update_id, "uncertain-production");
  db.close();
});

test("legacy uncertain game updates without attempt provenance cannot open the rollout gate", () => {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8"));
  db.prepare(`INSERT INTO scheduled_game_updates
    (schedule_id, guild_id, update_id, scheduled_at, payload_json, rollout_summary, status, created_by, created_at, updated_at)
    VALUES ('legacy-uncertain', '12345678901234567', 'rollout', 1, '{}', 1, 'delivery_unknown', 'admin', 1, 1)`).run();

  assert.deepEqual(reconcileScheduledDelivery(db, {
    type: "game_update",
    recordId: "legacy-uncertain",
    resolution: "delivered",
    messageId: "52345678901234567",
    canary: false,
    now: 25
  }), { ok: false, reason: "missing_attempt_provenance" });
  assert.equal(db.prepare("SELECT status FROM scheduled_game_updates WHERE schedule_id = 'legacy-uncertain'").get().status, "delivery_unknown");
  assert.equal(db.prepare("SELECT 1 FROM game_update_release_state").get(), undefined);
  db.close();
});
