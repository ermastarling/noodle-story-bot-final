import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { loadGiveawaysContent } from "../src/content/index.js";
import {
  chooseWeeklyContestCount,
  chooseWeeklyPrizes,
  getGiveawayWeekStart,
  recordGiveawayEntry,
  validateGiveawayContent
} from "../src/game/giveaways.js";
import {
  buildGiveawayMessage,
  buildWinnerConfirmation,
  buildValorFulfillmentConfirmation,
  claimValorFulfillmentConfirmation,
  completeValorFulfillmentConfirmation,
  markValorFulfillmentConfirmationUnknown,
  buildGiveawayCanaryPreview,
  resolveWeeklyGiveawaySettings
} from "../src/jobs/weeklyGiveaways.js";

const content = loadGiveawaysContent();
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

test("Giveaway windows begin on Wednesday at 21:00 UTC", () => {
  const before = Date.UTC(2026, 9, 21, 20, 59, 59);
  const after = Date.UTC(2026, 9, 21, 21, 0, 1);
  assert.equal(new Date(getGiveawayWeekStart(before)).toISOString(), "2026-10-14T21:00:00.000Z");
  assert.equal(new Date(getGiveawayWeekStart(after)).toISOString(), "2026-10-21T21:00:00.000Z");
});

test("Contest count is uniformly selected from one through three", () => {
  assert.equal(chooseWeeklyContestCount((...range) => range[0]), 1);
  assert.equal(chooseWeeklyContestCount((...range) => range[1] - 1), 3);
});

test("Editable giveaway prizes obey approved value ranges and contest tiers", () => {
  validateGiveawayContent(content);
  assert.equal(chooseWeeklyPrizes(1, content, () => 0)[0].amount, 50000);
  const twoPrizes = chooseWeeklyPrizes(2, content, () => 0);
  const threePrizes = chooseWeeklyPrizes(3, content, () => 0);
  assert.equal(twoPrizes.length, 2);
  assert.equal(new Set(twoPrizes.map((prize) => JSON.stringify(prize))).size, 2);
  assert.equal(threePrizes.length, 3);
  assert.equal(new Set(threePrizes.map((prize) => JSON.stringify(prize))).size, 3);
  assert.throws(() => validateGiveawayContent({
    prize_pools_by_contest_count: {
      "1": [{ type: "coins", amount: 51000 }],
      "2": content.prize_pools_by_contest_count["2"],
      "3": content.prize_pools_by_contest_count["3"]
    }
  }), /invalid reward/);
});

test("Giveaway content is a tracked, parseable player-facing prize configuration", () => {
  assert.equal(typeof JSON.parse(fs.readFileSync(new URL("../content/giveaways.json", import.meta.url))).version, "number");
});

test("Giveaway notices use the giveaway banner and confirm every granted in-game prize", () => {
  const winnerId = "62345678901234567";
  const cases = [
    [{ type: "coins", amount: 50000 }, /Coins credited: \*\*50,000c\*\*/],
    [{ type: "coin_pack", pack_id: "coin_pack_099" }, /Granted coin pack:/],
    [{ type: "perks", perks: ["house_247", "takeout_counter"] }, /Coins credited: \*\*50,000c\*\*/]
  ];
  for (const [prize, detailPattern] of cases) {
    const payload = buildWinnerConfirmation({
      giveaway: { prize_json: JSON.stringify(prize) },
      playerId: winnerId
    });
    const serialized = JSON.stringify(payload);
    assert.match(serialized, /Reward sent to <@62345678901234567>/);
    assert.match(serialized, detailPattern);
    if (prize.type === "perks") {
      assert.match(serialized, /24\/7 House for 7 days/);
      assert.match(serialized, /Take-Out Counter Premium for 7 days/);
    }
    assert.deepEqual(payload.allowed_mentions, { parse: [], users: [winnerId] });
    assert.equal(payload.components?.[0]?.components?.[0]?.type, 12);
  }
});

test("Giveaway posts and VALOR notices use the configured Giveaway scene banner", () => {
  const post = buildGiveawayMessage({
    prize: { type: "valor", amount: 250 },
    closesAt: Date.now() + 86_400_000,
    giveawayId: "giveaway-preview",
    canary: true
  });
  const winner = buildWinnerConfirmation({
    giveaway: { prize_json: JSON.stringify({ type: "valor", amount: 250 }) },
    playerId: "62345678901234567",
    valorFulfillerId: "72345678901234567"
  });
  assert.equal(post.components?.[0]?.components?.[0]?.type, 12);
  assert.equal(winner.components?.[0]?.components?.[0]?.type, 12);
  assert.match(JSON.stringify(winner), /will reward \*\*250 VALOR\*\* within 48 hours/);
});

test("Giveaway entries are bound to the post, deduplicated, and blocked after a weekly win", () => {
  const db = new Database(":memory:");
  const schema = fs.readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8");
  db.exec(schema);
  const future = Date.now() + 60_000;
  db.prepare(`
    INSERT INTO weekly_giveaways
      (giveaway_id, guild_id, channel_id, week_key, contest_number, prize_json, closes_at, status, award_status, message_id, created_at)
    VALUES ('giveaway-test', 'guild-test', 'channel-test', 'week-test', 1, '{}', ?, 'open', 'pending', 'message-test', ?)
  `).run(future, Date.now());

  const entry = {
    giveawayId: "giveaway-test",
    guildId: "guild-test",
    channelId: "channel-test",
    messageId: "message-test",
    userId: "user-test"
  };
  assert.deepEqual(recordGiveawayEntry(db, entry), { ok: true, alreadyEntered: false });
  assert.deepEqual(recordGiveawayEntry(db, entry), { ok: true, alreadyEntered: true });
  assert.equal(recordGiveawayEntry(db, { ...entry, messageId: "wrong-message" }).reason, "giveaway_not_found");
  db.prepare(`
    INSERT INTO weekly_giveaway_wins (guild_id, week_key, user_id, giveaway_id, won_at)
    VALUES ('guild-test', 'week-test', 'user-test', 'previous-giveaway', ?)
  `).run(Date.now());
  assert.equal(recordGiveawayEntry(db, { ...entry, userId: "user-test-2" }).ok, true);
  assert.equal(recordGiveawayEntry(db, entry).reason, "already_won_this_week");
  assert.equal(recordGiveawayEntry(db, { ...entry, now: future }).reason, "giveaway_closed");
  db.close();
});

test("Giveaway canary preview has no entry action; production requires separate approvals", () => {
  const canarySettings = resolveWeeklyGiveawaySettings({
    NOODLE_GIVEAWAYS_ENABLED: "1",
    NOODLE_OFFICIAL_FEATURE_CANARY_PRIVATE_VERIFIED: "1",
    NOODLE_GIVEAWAYS_CANARY_PREVIEW: "1",
    NOODLE_OFFICIAL_GUILD_ID: "12345678901234567",
    NOODLE_DEV_ALERT_CHANNEL_ID: "22345678901234567"
  });
  assert.equal(canarySettings.ok, true);
  const preview = buildGiveawayCanaryPreview({ content, now: Date.now() });
  assert.match(JSON.stringify(preview), /Private preview only/);
  assert.doesNotMatch(JSON.stringify(preview), /Enter Giveaway/);

  const production = resolveWeeklyGiveawaySettings({
    NOODLE_GIVEAWAYS_ENABLED: "1",
    NOODLE_OFFICIAL_FEATURE_CANARY: "0",
    NOODLE_GIVEAWAYS_COPY_APPROVED: "1",
    NOODLE_GIVEAWAYS_PRODUCTION_ENABLED: "1",
    NOODLE_OFFICIAL_GUILD_ID: "12345678901234567",
    NOODLE_GIVEAWAY_CHANNEL_ID: "32345678901234567"
  });
  assert.equal(production.reason, "missing_announcements_role");

  const roleId = "42345678901234567";
  const liveSettings = resolveWeeklyGiveawaySettings({
    NOODLE_GIVEAWAYS_ENABLED: "1",
    NOODLE_OFFICIAL_FEATURE_CANARY: "0",
    NOODLE_GIVEAWAYS_COPY_APPROVED: "1",
    NOODLE_GIVEAWAYS_PRODUCTION_ENABLED: "1",
    NOODLE_OFFICIAL_GUILD_ID: "12345678901234567",
    NOODLE_GIVEAWAY_CHANNEL_ID: "32345678901234567",
    NOODLE_ROLLOUT_ANNOUNCEMENTS_ROLE_ID: roleId
  });
  assert.equal(liveSettings.ok, true);
  const liveMessage = buildGiveawayMessage({
    prize: { type: "coins", amount: 50000 },
    closesAt: Date.UTC(2026, 9, 25, 12, 0, 0),
    giveawayId: "live-test",
    canary: false,
    announcementsRoleId: liveSettings.announcementsRoleId
  });
  const serialized = JSON.stringify(liveMessage);
  assert.match(serialized, new RegExp(`-# <@&${roleId}>`));
  assert.match(serialized, /Closes <t:1792929600:F>\./);
  assert.equal((serialized.match(/<t:/g) ?? []).length, 1);
  assert.doesNotMatch(serialized, /:R>/);
  const entryButton = liveMessage.components?.[0]?.components
    ?.flatMap((component) => component.components ?? [])
    .find((component) => component.type === 2 && component.label === "Enter Giveaway");
  assert.equal(entryButton?.emoji?.name, "sparkle");
  assert.equal(entryButton?.emoji?.id, "1470315971456667659");
  assert.deepEqual(liveMessage.allowed_mentions, { parse: [], roles: [roleId] });
});

test("VALOR fulfillment confirmation tags the winner and Erma after manual send", () => {
  const payload = buildValorFulfillmentConfirmation({
    giveaway: {
      prize_json: JSON.stringify({ type: "valor", amount: 250 })
    },
    playerId: "62345678901234567",
    valorFulfillerId: "72345678901234567"
  });
  assert.deepEqual(payload.allowed_mentions, {
    parse: [],
    users: ["62345678901234567", "72345678901234567"]
  });
  assert.match(JSON.stringify(payload), /Reward sent to <@62345678901234567>/);
  assert.match(JSON.stringify(payload), /<@72345678901234567> has rewarded \*\*250 VALOR\*\*/);
  assert.match(JSON.stringify(payload), /Reward sent to <@62345678901234567>/);
  assert.throws(() => buildValorFulfillmentConfirmation({
    giveaway: { prize_json: JSON.stringify({ type: "coins", amount: 1000 }) },
    playerId: "62345678901234567",
    valorFulfillerId: "72345678901234567"
  }), /requires a VALOR prize/);
});

test("manual VALOR confirmation is claim-once and uncertain sends are not retried", () => {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8"));
  const insert = db.prepare(`
    INSERT INTO weekly_giveaways
      (giveaway_id, guild_id, channel_id, week_key, contest_number, prize_json, closes_at, status, award_status, winner_user_id, created_at)
    VALUES (?, 'guild-test', 'channel-test', 'week-test', ?, ?, ?, 'closed', 'awaiting_manual', 'winner-test', ?)
  `);
  insert.run("valor-unknown", 1, JSON.stringify({ type: "valor", amount: 250 }), Date.now(), Date.now());
  insert.run("valor-confirmed", 2, JSON.stringify({ type: "valor", amount: 300 }), Date.now(), Date.now());

  assert.equal(claimValorFulfillmentConfirmation(db, "valor-unknown", 1), true);
  assert.equal(claimValorFulfillmentConfirmation(db, "valor-unknown", 2), false);
  assert.equal(markValorFulfillmentConfirmationUnknown(db, "valor-unknown"), true);
  assert.equal(claimValorFulfillmentConfirmation(db, "valor-unknown", 3), false);

  assert.equal(claimValorFulfillmentConfirmation(db, "valor-confirmed", 4), true);
  assert.equal(completeValorFulfillmentConfirmation(db, "valor-confirmed", "message-confirmed"), true);
  assert.equal(claimValorFulfillmentConfirmation(db, "valor-confirmed", 5), false);
  db.close();
});
