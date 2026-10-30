import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  applyCountingSubmission,
  handleCountingMessage,
  parseCountingNumber,
  resolveCountingSettings
} from "../src/game/counting.js";
import { buildCountingNoticePayload } from "../src/ui/countingNotices.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function setupDb() {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(path.join(__dirname, "../src/db/schema.sql"), "utf8"));
  return db;
}

function message({ id, userId = "user1", content = "1", bot = false, webhookId = null } = {}) {
  const calls = { deleted: 0, reactions: [], sends: [] };
  return {
    id,
    guildId: "guild",
    channelId: "counting",
    content,
    author: { id: userId, bot },
    webhookId,
    calls,
    delete: async () => { calls.deleted++; },
    react: async (emoji) => { calls.reactions.push(emoji); },
    channel: { send: async (payload) => { calls.sends.push(payload); } }
  };
}

test("Counting parser accepts positive integers and rejects malformed or unsafe values", () => {
  assert.equal(parseCountingNumber("1"), 1);
  assert.equal(parseCountingNumber(" 42 "), 42);
  assert.equal(parseCountingNumber("0"), null);
  assert.equal(parseCountingNumber("1.5"), null);
  assert.equal(parseCountingNumber("-1"), null);
  assert.equal(parseCountingNumber("9007199254740991"), null);
  assert.equal(parseCountingNumber("9007199254740992"), null);
  assert.equal(parseCountingNumber("one"), null);
});

test("Counting stays disabled by default and requires safe channel and intent configuration", () => {
  assert.equal(resolveCountingSettings({}).ready, false);
  const canary = resolveCountingSettings({
    NOODLE_OFFICIAL_COUNTING_ENABLED: "1",
    NOODLE_OFFICIAL_ENABLE_MESSAGE_CONTENT_INTENT: "1",
    NOODLE_OFFICIAL_COUNTING_COPY_APPROVED: "1",
    NOODLE_OFFICIAL_GUILD_ID: "guild",
    NOODLE_DEV_ALERT_CHANNEL_ID: "private-alert"
  });
  assert.equal(canary.ready, false);
  assert.equal(canary.channelId, "");

  const approvedCanary = resolveCountingSettings({
    NOODLE_OFFICIAL_COUNTING_ENABLED: "1",
    NOODLE_OFFICIAL_ENABLE_MESSAGE_CONTENT_INTENT: "1",
    NOODLE_OFFICIAL_COUNTING_COPY_APPROVED: "1",
    NOODLE_OFFICIAL_GUILD_ID: "guild",
    NOODLE_DEV_ALERT_CHANNEL_ID: "private-alert",
    NOODLE_OFFICIAL_FEATURE_CANARY_PRIVATE_VERIFIED: "1"
  });
  assert.equal(approvedCanary.ready, true);
  assert.equal(approvedCanary.channelId, "private-alert");

  const production = resolveCountingSettings({
    NOODLE_OFFICIAL_COUNTING_ENABLED: "1",
    NOODLE_OFFICIAL_FEATURE_CANARY: "0",
    NOODLE_OFFICIAL_ENABLE_MESSAGE_CONTENT_INTENT: "1",
    NOODLE_OFFICIAL_COUNTING_COPY_APPROVED: "1",
    NOODLE_OFFICIAL_GUILD_ID: "guild",
    NOODLE_OFFICIAL_COUNTING_CHANNEL_ID: "counting"
  });
  assert.equal(production.ready, true);
  assert.equal(production.channelId, "counting");
});

test("Counting advances valid numbers, rejects same-user turns without reset, and resets on wrong integer", () => {
  const db = setupDb();
  try {
    assert.deepEqual(applyCountingSubmission(db, {
      guildId: "guild", channelId: "counting", userId: "user1", messageId: "100", number: 1
    }), { kind: "valid", countedNumber: 1, nextNumber: 2 });

    assert.deepEqual(applyCountingSubmission(db, {
      guildId: "guild", channelId: "counting", userId: "user1", messageId: "101", number: 2
    }), { kind: "repeat_user", nextNumber: 2 });

    assert.deepEqual(applyCountingSubmission(db, {
      guildId: "guild", channelId: "counting", userId: "user2", messageId: "102", number: 8
    }), { kind: "broken", nextNumber: 1 });

    assert.deepEqual(applyCountingSubmission(db, {
      guildId: "guild", channelId: "counting", userId: "user2", messageId: "103", number: 1
    }), { kind: "valid", countedNumber: 1, nextNumber: 2 });
  } finally {
    db.close();
  }
});

test("Counting ignores duplicate message events after persisted progress", () => {
  const db = setupDb();
  try {
    const input = { guildId: "guild", channelId: "counting", userId: "user1", messageId: "200", number: 1 };
    assert.equal(applyCountingSubmission(db, input).kind, "valid");
    assert.equal(applyCountingSubmission(db, input).kind, "duplicate");
    assert.equal(db.prepare("SELECT next_number FROM counting_state WHERE guild_id = ? AND channel_id = ?")
      .get("guild", "counting").next_number, 2);
  } finally {
    db.close();
  }
});

test("Counting deletes malformed human and other bot/webhook posts but preserves its own output", async () => {
  const db = setupDb();
  try {
    const malformed = message({ id: "300", content: "not a number" });
    assert.equal((await handleCountingMessage(db, malformed, {})).kind, "deleted_invalid");
    assert.equal(malformed.calls.deleted, 1);

    const otherBot = message({ id: "301", bot: true });
    assert.equal((await handleCountingMessage(db, otherBot, {})).kind, "deleted_bot");
    assert.equal(otherBot.calls.deleted, 1);

    const webhook = message({ id: "302", webhookId: "webhook" });
    assert.equal((await handleCountingMessage(db, webhook, {})).kind, "deleted_bot");
    assert.equal(webhook.calls.deleted, 1);

    const ownMessage = message({ id: "303", userId: "bot" });
    assert.equal((await handleCountingMessage(db, ownMessage, { botUserId: "bot" })).kind, "ignored_self");
    assert.equal(ownMessage.calls.deleted, 0);
    assert.deepEqual(ownMessage.calls.reactions, []);
  } finally {
    db.close();
  }
});

test("Counting only invokes the milestone callback for configured milestones", async () => {
  const db = setupDb();
  const milestones = [];
  const settings = {
    botUserId: "bot",
    successEmoji: "ok",
    milestoneRewards: [{ count: 2, reward: { coins: 1 } }],
    onMilestone: async ({ milestone }) => { milestones.push(milestone); return { granted: true }; }
  };
  try {
    await handleCountingMessage(db, message({ id: "500", userId: "u1", content: "1" }), settings);
    assert.deepEqual(milestones, []);
    await handleCountingMessage(db, message({ id: "501", userId: "u2", content: "2" }), settings);
    assert.deepEqual(milestones, [2]);
  } finally {
    db.close();
  }
});

test("Counting reacts distinctly to valid, repeated-user, and broken numbers", async () => {
  const db = setupDb();
  const settings = {
    botUserId: "bot",
    successEmoji: "<:status_complete:1>",
    repeatEmoji: "<:refresh:2>",
    brokenEmoji: "<:cancel:3>",
    resetMessage: "reset"
  };
  try {
    const first = message({ id: "400", userId: "user1", content: "1" });
    assert.equal((await handleCountingMessage(db, first, settings)).kind, "valid");
    assert.deepEqual(first.calls.reactions, [settings.successEmoji]);

    const repeat = message({ id: "401", userId: "user1", content: "2" });
    assert.equal((await handleCountingMessage(db, repeat, settings)).kind, "repeat_user");
    assert.deepEqual(repeat.calls.reactions, [settings.repeatEmoji]);

    const broken = message({ id: "402", userId: "user2", content: "9" });
    assert.equal((await handleCountingMessage(db, broken, settings)).kind, "broken");
    assert.deepEqual(broken.calls.reactions, [settings.brokenEmoji]);
    assert.deepEqual(broken.calls.sends, [{ content: settings.resetMessage }]);
  } finally {
    db.close();
  }
});

test("Bot-authored counting notices are Components V2 containers with controlled mentions", () => {
  const reset = buildCountingNoticePayload("This count got a little tangled.");
  const reward = buildCountingNoticePayload("<@12345678901234567> earned coins!", ["12345678901234567"]);

  assert.equal((reset.flags & (1 << 15)) !== 0, true);
  assert.equal(reset.components?.[0]?.type, 17);
  assert.equal(reset.content, undefined);
  assert.deepEqual(reset.allowed_mentions, { parse: [], users: [] });
  assert.equal(reward.components?.[0]?.type, 17);
  assert.deepEqual(reward.allowed_mentions, { parse: [], users: ["12345678901234567"] });
});

test("Counting broken-sequence delivery uses the configured notice sender", async () => {
  const db = setupDb();
  const broken = message({ id: "500", userId: "user2", content: "9" });
  let noticeChannel = null;
  try {
    await handleCountingMessage(db, broken, {
      brokenEmoji: "<:cancel:3>",
      sendResetNotice: async (channel) => {
        noticeChannel = channel;
      }
    });
    assert.equal(noticeChannel, broken.channel);
    assert.deepEqual(broken.calls.sends, []);
  } finally {
    db.close();
  }
});
