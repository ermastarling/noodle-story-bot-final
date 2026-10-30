import { nowTs } from "../util/time.js";

export const COUNTING_RESET_NOTICE = "This count got a little tangled, so we're starting over at 1. Let's try again!";

export function resolveCountingSettings(env = process.env) {
  const enabled = String(env?.NOODLE_OFFICIAL_COUNTING_ENABLED ?? "0") === "1";
  const canaryEnabled = String(env?.NOODLE_OFFICIAL_FEATURE_CANARY ?? "1") !== "0";
  const canaryPrivateVerified = String(env?.NOODLE_OFFICIAL_FEATURE_CANARY_PRIVATE_VERIFIED ?? "0") === "1";
  const messageContentIntentEnabled = String(env?.NOODLE_OFFICIAL_ENABLE_MESSAGE_CONTENT_INTENT ?? "0") === "1";
  const copyApproved = String(env?.NOODLE_OFFICIAL_COUNTING_COPY_APPROVED ?? "0") === "1";
  const officialGuildId = String(env?.NOODLE_OFFICIAL_GUILD_ID ?? env?.DISCORD_GUILD_ID ?? "").trim();
  const devAlertChannelId = String(env?.NOODLE_DEV_ALERT_CHANNEL_ID ?? "").trim();
  const productionChannelId = String(env?.NOODLE_OFFICIAL_COUNTING_CHANNEL_ID ?? "").trim();
  const canaryReady = canaryEnabled && canaryPrivateVerified && Boolean(devAlertChannelId);
  const productionReady = !canaryEnabled && Boolean(productionChannelId);
  const channelId = canaryReady ? devAlertChannelId : productionReady ? productionChannelId : "";

  return {
    enabled,
    configured: enabled,
    canaryEnabled,
    canaryPrivateVerified,
    messageContentIntentEnabled,
    copyApproved,
    officialGuildId,
    channelId,
    ready: enabled && messageContentIntentEnabled && copyApproved && Boolean(officialGuildId) && Boolean(channelId)
  };
}

export function parseCountingNumber(content) {
  const value = String(content ?? "").trim();
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed < Number.MAX_SAFE_INTEGER ? parsed : null;
}

export function applyCountingSubmission(db, { guildId, channelId, userId, messageId, number, milestoneRewards = [] }) {
  if (!guildId || !channelId || !userId || !messageId || !Number.isSafeInteger(number) || number < 1) {
    throw new Error("Invalid counting submission context");
  }

  return db.transaction(() => {
    const current = db.prepare(
      "SELECT next_number, last_user_id, last_message_id FROM counting_state WHERE guild_id = ? AND channel_id = ?"
    ).get(guildId, channelId) ?? { next_number: 1, last_user_id: null, last_message_id: null };

    if (current.last_message_id && BigInt(messageId) <= BigInt(current.last_message_id)) {
      return { kind: "duplicate" };
    }

    const upsert = db.prepare(`
      INSERT INTO counting_state(guild_id, channel_id, next_number, last_user_id, last_message_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, channel_id) DO UPDATE SET
        next_number = excluded.next_number,
        last_user_id = excluded.last_user_id,
        last_message_id = excluded.last_message_id,
        updated_at = excluded.updated_at
    `);

    if (current.last_user_id === userId) {
      upsert.run(guildId, channelId, current.next_number, current.last_user_id, messageId, nowTs());
      return { kind: "repeat_user", nextNumber: current.next_number };
    }

    if (number !== current.next_number) {
      upsert.run(guildId, channelId, 1, null, messageId, nowTs());
      return { kind: "broken", nextNumber: 1 };
    }

    upsert.run(guildId, channelId, number + 1, userId, messageId, nowTs());
    const milestoneReward = milestoneRewards.find((entry) => entry?.count === number);
    if (milestoneReward) {
      db.prepare(`
        INSERT OR IGNORE INTO counting_milestone_rewards(guild_id, channel_id, milestone, user_id, reward_json, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?)
      `).run(guildId, channelId, number, userId, JSON.stringify(milestoneReward.reward), nowTs());
    }
    const result = { kind: "valid", countedNumber: number, nextNumber: number + 1 };
    if (milestoneReward) result.milestone = number;
    return result;
  })();
}

export async function handleCountingMessage(
  db,
  message,
  {
    botUserId,
    successEmoji,
    repeatEmoji,
    brokenEmoji,
    resetMessage,
    sendResetNotice,
    milestoneRewards = [],
    onMilestone
  }
) {
  if (!db || !message?.guildId || !message?.channelId || !message?.author?.id) {
    throw new Error("Counting handler requires a database and guild message");
  }
  if (message.author.id === botUserId) return { kind: "ignored_self" };

  if (message.author.bot || message.webhookId) {
    await message.delete();
    return { kind: "deleted_bot" };
  }

  const number = parseCountingNumber(message.content);
  if (number === null) {
    await message.delete();
    return { kind: "deleted_invalid" };
  }

  const result = applyCountingSubmission(db, {
    guildId: message.guildId,
    channelId: message.channelId,
    userId: message.author.id,
    messageId: message.id,
    number,
    milestoneRewards
  });

  if (result.kind === "duplicate") return result;
  if (result.kind === "valid") {
    await message.react(successEmoji);
    if (result.milestone !== null && typeof onMilestone === "function") {
      const reward = await onMilestone({
        guildId: message.guildId,
        channelId: message.channelId,
        userId: message.author.id,
        milestone: result.milestone,
        channel: message.channel
      });
      result.milestoneReward = reward;
    }
  } else if (result.kind === "repeat_user") {
    await message.react(repeatEmoji);
  } else if (result.kind === "broken") {
    await message.react(brokenEmoji);
    if (typeof sendResetNotice === "function") {
      await sendResetNotice(message.channel);
    } else {
      await message.channel.send(
        typeof resetMessage === "string" ? { content: resetMessage } : resetMessage
      );
    }
  }
  return result;
}
