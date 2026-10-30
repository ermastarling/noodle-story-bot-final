import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { loadGameUpdatesContent, loadNewsContent, parseGameUpdatesMarkdown } from "../src/content/index.js";
import { resolveActiveEventId } from "../src/game/events.js";
import {
  buildGameUpdatePayload,
  buildSeasonUpdate,
  findGameUpdate,
  parseScheduledAt,
  resolveGameUpdateSettings,
  scheduleGameUpdate,
  validateGameUpdatesContent
} from "../src/jobs/gameUpdates.js";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const ids = {
  guild: "12345678901234567",
  canary: "22345678901234567",
  production: "32345678901234567"
};

test("game-update content is editable, validated, and missing IDs are handled explicitly", () => {
  const content = {
    updates: [{
      id: "launch-update",
      title: "Launch Update",
      body: "Reviewed player-facing update.",
      rollout_summary: true
    }]
  };
  assert.equal(validateGameUpdatesContent(content), true);
  assert.deepEqual(findGameUpdate(content, "launch-update"), content.updates[0]);
  assert.equal(findGameUpdate(content, "missing"), null);
  const shipped = loadGameUpdatesContent();
  assert.equal(validateGameUpdatesContent(shipped), true);
  const firstUpdate = findGameUpdate(shipped, "v0-6-0-first-update");
  assert.equal(firstUpdate.rollout_summary, true);
  for (const line of firstUpdate.body.split("\n").filter((entry) => entry.includes("• "))) {
    assert.match(line, /^>/);
  }
  assert.doesNotThrow(() => buildGameUpdatePayload(firstUpdate));
  const normalizedBody = firstUpdate.body.replace(/^> (?:• )?/gm, "").replace(/\s+/g, " ");
  const newsChanges = loadNewsContent().sections[0].entries[0].changes;
  for (const change of newsChanges) assert.ok(normalizedBody.includes(change));
  const parsed = parseGameUpdatesMarkdown("intro\n\n---\nid: a\ntitle: T\nrollout_summary: false\n---\nOne\n---\nTwo\n\n---\nid: b\ntitle: U\nrollout_summary: true\n---\nThree\n");
  assert.deepEqual(parsed.updates.map((u) => [u.id, u.rollout_summary, u.body]), [["a", false, "One\n---\nTwo"], ["b", true, "Three"]]);
  assert.throws(() => validateGameUpdatesContent({ updates: [{ id: "same", title: "A", body: "B" }, { id: "same", title: "C", body: "D" }] }), /duplicate ID/);
  assert.throws(() => validateGameUpdatesContent({ updates: [{ id: "bad", title: " ", body: "body" }] }), /must have a title/);
});

test("game-update routes default disabled and require copy, private-canary, and production approvals", () => {
  assert.equal(resolveGameUpdateSettings({}).reason, "disabled");
  const base = {
    NOODLE_GAME_UPDATES_ENABLED: "1",
    NOODLE_OFFICIAL_GUILD_ID: ids.guild,
    NOODLE_DEV_ALERT_CHANNEL_ID: ids.canary
  };
  assert.equal(resolveGameUpdateSettings(base).reason, "copy_not_approved");
  const approved = { ...base, NOODLE_GAME_UPDATES_COPY_APPROVED: "1" };
  assert.equal(resolveGameUpdateSettings(approved).reason, "canary_privacy_not_verified");
  const canary = resolveGameUpdateSettings({
    ...approved,
    NOODLE_OFFICIAL_FEATURE_CANARY_PRIVATE_VERIFIED: "1"
  });
  assert.equal(canary.ok, true);
  assert.equal(canary.channelId, ids.canary);
  assert.equal(canary.canary, true);

  const production = resolveGameUpdateSettings({
    ...approved,
    NOODLE_OFFICIAL_FEATURE_CANARY: "0",
    NOODLE_GAME_UPDATES_CHANNEL_ID: ids.production
  });
  assert.equal(production.reason, "production_not_approved");
  const productionSettings = resolveGameUpdateSettings({
    ...approved,
    NOODLE_OFFICIAL_FEATURE_CANARY: "0",
    NOODLE_GAME_UPDATES_PRODUCTION_ENABLED: "1",
    NOODLE_GAME_UPDATES_CHANNEL_ID: ids.production,
    NOODLE_ROLLOUT_ANNOUNCEMENTS_ROLE_ID: "42345678901234567",
    NOODLE_GAME_UPDATES_EVENTS_ROLE_ID: "52345678901234567"
  });
  assert.equal(productionSettings.ok, true);
  assert.equal(productionSettings.channelId, ids.production);
  assert.equal(productionSettings.announcementsRoleId, "42345678901234567");
  assert.equal(productionSettings.eventsRoleId, "52345678901234567");
  assert.equal(resolveGameUpdateSettings({
    ...approved,
    NOODLE_OFFICIAL_FEATURE_CANARY: "0",
    NOODLE_GAME_UPDATES_PRODUCTION_ENABLED: "1",
    NOODLE_GAME_UPDATES_CHANNEL_ID: ids.production
  }).reason, "missing_announcements_role");
  assert.equal(resolveGameUpdateSettings({
    ...approved,
    NOODLE_OFFICIAL_FEATURE_CANARY: "0",
    NOODLE_GAME_UPDATES_PRODUCTION_ENABLED: "1",
    NOODLE_GAME_UPDATES_CHANNEL_ID: ids.production,
    NOODLE_ROLLOUT_ANNOUNCEMENTS_ROLE_ID: "42345678901234567"
  }).reason, "missing_events_role");
});

test("schedule times must be future ISO-8601 values with an explicit timezone", () => {
  const now = Date.UTC(2026, 9, 21, 21, 0, 0);
  assert.equal(parseScheduledAt("2026-10-22T12:00:00Z", now), Date.UTC(2026, 9, 22, 12, 0, 0));
  assert.equal(parseScheduledAt("2026-10-22T12:00:00-04:00", now), Date.UTC(2026, 9, 22, 16, 0, 0));
  assert.equal(parseScheduledAt("2026-10-22 12:00", now), null);
  assert.equal(parseScheduledAt("2026-10-20T12:00:00Z", now), null);
});

test("game-update and season payloads use banner containers and scoped role mentions", () => {
  const payload = buildGameUpdatePayload({ title: "Update", body: "A reviewed draft." });
  assert.equal((payload.flags & (1 << 15)) !== 0, true);
  assert.equal(payload.components?.[0]?.type, 17);
  assert.match(JSON.stringify(payload), /News\.png/);
  assert.equal(payload.content, undefined);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.match(JSON.stringify(payload), /A reviewed draft/);
  const announcementsRoleId = "42345678901234567";
  const gameUpdatesRoleId = "52345678901234567";
  const tagged = buildGameUpdatePayload(
    { title: "Update", body: "A reviewed draft." },
    { announcementsRoleId, gameUpdatesRoleId }
  );
  assert.match(JSON.stringify(tagged), new RegExp(`<@&${announcementsRoleId}>`));
  assert.match(JSON.stringify(tagged), new RegExp(`<@&${gameUpdatesRoleId}>`));
  assert.deepEqual(tagged.allowed_mentions, { parse: [], roles: [announcementsRoleId, gameUpdatesRoleId] });
  const roleInBody = buildGameUpdatePayload(
    { title: "Update", body: `A reviewed draft. <@&${gameUpdatesRoleId}>` },
    { gameUpdatesRoleId }
  );
  assert.equal(JSON.stringify(roleInBody).match(new RegExp(`<@&${gameUpdatesRoleId}>`, "g")).length, 1);
  const sameRole = buildGameUpdatePayload(
    { title: "Update", body: "A reviewed draft." },
    { announcementsRoleId, gameUpdatesRoleId: announcementsRoleId }
  );
  assert.equal(JSON.stringify(sameRole).match(new RegExp(`<@&${announcementsRoleId}>`, "g")).length, 1);
  assert.deepEqual(sameRole.allowed_mentions, { parse: [], roles: [announcementsRoleId] });
  assert.throws(() => buildGameUpdatePayload({ title: "", body: "" }), /without a title and body/);

  const season = buildSeasonUpdate({
    season: "spring",
    now: Date.UTC(2026, 3, 1),
    event: {
      event_id: "spring_event",
      name: "Spring Festival",
      tagline: "A market-wide celebration of spring.",
      description: "A special event description.",
      start_at: "2026-03-01T00:00:00Z",
      end_at: "2026-05-31T23:59:59Z",
      effects: { rewards: { sxp_mult: 1.1 } },
      event_recipes: [{ recipe_id: "one", name: "Garden Bowl" }]
    }
  });
  assert.equal(season.title, "spring Seasonal Update");
  assert.match(season.body, /transitioned to \*\*spring\*\*/);
  assert.match(season.body, /Spring Festival/);
  assert.match(season.body, /A market-wide celebration of spring/);
  assert.match(season.body, /A special event description/);
  assert.match(season.body, /<t:1772323200:F> - <t:1780271999:F>/);
  assert.match(season.body, /\+10% SXP/);
  assert.match(season.body, /Garden Bowl/);
  const roleId = "42345678901234567";
  const productionSeason = buildGameUpdatePayload({
    ...season,
    body: season.body.replaceAll("{{events_role}}", `<@&${roleId}>`)
  }, { allowedRoleIds: [roleId] });
  assert.equal(productionSeason.components?.[0]?.type, 17);
  assert.equal(productionSeason.content, undefined);
  assert.equal(productionSeason.components?.[0]?.components?.[0]?.type, 12);
  assert.match(JSON.stringify(productionSeason), /Season\.png/);
  assert.deepEqual(productionSeason.allowed_mentions, { parse: [], roles: [roleId] });
  assert.match(JSON.stringify(productionSeason), new RegExp(`<@&${roleId}>`));
  const canarySeason = buildGameUpdatePayload({
    ...season,
    body: season.body.replaceAll("{{events_role}}", "")
  });
  assert.equal(canarySeason.components?.[0]?.type, 17);
  assert.equal(canarySeason.content, undefined);
  assert.equal(canarySeason.components?.[0]?.components?.[0]?.type, 12);
  assert.deepEqual(canarySeason.allowed_mentions, { parse: [] });
  assert.doesNotMatch(JSON.stringify(canarySeason), /<@&\d{17,20}>/);
  assert.equal(buildSeasonUpdate({ season: "winter", event: null }).body.includes("no special event"), true);
});

test("scheduled season event selection can include new event recipes at the boundary", () => {
  const events = {
    events: [
      { event_id: "spring", season: "spring", start_at: "2026-03-01T00:00:00Z", end_at: "2026-05-31T23:59:59Z" },
      { event_id: "summer", season: "summer", start_at: "2026-06-01T00:00:00Z", end_at: "2026-08-31T23:59:59Z" }
    ]
  };
  assert.equal(resolveActiveEventId(events, Date.UTC(2026, 5, 1, 0, 0), "summer"), "summer");
  assert.equal(resolveActiveEventId(events, Date.UTC(2026, 5, 1, 0, 0), "spring"), null);
});

test("scheduled game updates persist an immutable content snapshot for a future send", () => {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8"));
  const scheduledAt = Date.now() + 60_000;
  const update = { id: "rollout", title: "Player Update", body: "Approved body.", rollout_summary: true };
  const result = scheduleGameUpdate(db, {
    guildId: ids.guild,
    update,
    scheduledAt,
    createdBy: "admin",
    now: Date.now()
  });
  update.body = "Edited after scheduling.";
  const stored = db.prepare("SELECT * FROM scheduled_game_updates WHERE schedule_id = ?").get(result.scheduleId);
  assert.equal(stored.status, "pending");
  assert.equal(stored.rollout_summary, 1);
  assert.deepEqual(JSON.parse(stored.payload_json), { title: "Player Update", body: "Approved body." });
  assert.throws(() => scheduleGameUpdate(db, {
    guildId: ids.guild,
    update,
    scheduledAt: Date.now(),
    createdBy: "admin"
  }), /future timestamp/);
  db.close();
});
