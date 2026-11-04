import cron from "node-cron";
import { emitTelemetry, runWithTelemetry } from "../infra/telemetry.js";
import { randomInt } from "node:crypto";
import {
  getPlayer,
  openDb,
  upsertPlayer
} from "../db/index.js";
import { newPlayerProfile } from "../game/player.js";
import {
  applyMonthlySubscriptionCoinGrant,
  applySubscriptionEntitlementEvent,
  SUBSCRIPTION_MONTHLY_COIN_GRANT,
  SUBSCRIPTION_PERKS
} from "../game/subscriptions.js";
import { getStoreCoinPack, grantStoreCoinPack } from "../game/storeCoinPacks.js";
import { chooseWeeklyContestCount, chooseWeeklyPrizes, getGiveawayWeekStart, validateGiveawayContent } from "../game/giveaways.js";
import { withLock } from "../infra/locks.js";
import { loadGiveawaysContent } from "../content/index.js";
import { buildComponentsV2PayloadWithNoticeCards, rawChannelSendMessage } from "../ui/componentsV2.js";
import { ensureClientToken } from "../util/clientToken.js";
import { getButtonEmoji, getIcon } from "../ui/icons.js";
import {
  claimScheduledMessageDelivery,
  completeScheduledMessageDelivery,
  markScheduledMessageDeliveryUnknown,
  markStaleScheduledDeliveriesUnknown
} from "./scheduledDelivery.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
let scheduler = null;

export function resolveWeeklyGiveawaySettings(env = process.env) {
  const enabled = String(env.NOODLE_GIVEAWAYS_ENABLED || "").trim() === "1";
  const canary = String(env.NOODLE_OFFICIAL_FEATURE_CANARY ?? "1").trim() !== "0";
  if (!enabled) return { ok: false, reason: "disabled", canary };

  const guildId = String(env.NOODLE_OFFICIAL_GUILD_ID || env.DISCORD_GUILD_ID || "").trim();
  if (!/^\d{17,20}$/.test(guildId)) return { ok: false, reason: "missing_official_guild", canary };

  if (canary) {
    if (String(env.NOODLE_OFFICIAL_FEATURE_CANARY_PRIVATE_VERIFIED || "").trim() !== "1") {
      return { ok: false, reason: "canary_privacy_not_verified", canary };
    }
    if (String(env.NOODLE_GIVEAWAYS_CANARY_PREVIEW || "").trim() !== "1") {
      return { ok: false, reason: "canary_preview_not_enabled", canary };
    }
    const channelId = String(env.NOODLE_DEV_ALERT_CHANNEL_ID || "").trim();
    if (!/^\d{17,20}$/.test(channelId)) return { ok: false, reason: "missing_canary_channel", canary };
    return { ok: true, canary, guildId, channelId };
  }

  if (String(env.NOODLE_GIVEAWAYS_COPY_APPROVED || "").trim() !== "1") {
    return { ok: false, reason: "copy_not_approved", canary };
  }
  if (String(env.NOODLE_GIVEAWAYS_PRODUCTION_ENABLED || "").trim() !== "1") {
    return { ok: false, reason: "production_not_approved", canary };
  }
  const announcementsRoleId = String(env.NOODLE_ROLLOUT_ANNOUNCEMENTS_ROLE_ID || "").trim();
  if (!/^\d{17,20}$/.test(announcementsRoleId)) {
    return { ok: false, reason: "missing_announcements_role", canary };
  }
  const channelId = String(env.NOODLE_GIVEAWAY_CHANNEL_ID || "").trim();
  if (!/^\d{17,20}$/.test(channelId)) return { ok: false, reason: "missing_production_channel", canary };
  return { ok: true, canary, guildId, channelId, announcementsRoleId };
}

export function buildGiveawayMessage({ prize, closesAt, giveawayId, canary, announcementsRoleId = null }) {
  const roleId = String(announcementsRoleId ?? "").trim();
  if (!canary && roleId && !/^\d{17,20}$/.test(roleId)) {
    throw new Error("Giveaway role mentions must use a valid Discord role ID");
  }
  const coinPack = prize.type === "coin_pack" ? getStoreCoinPack(prize.pack_id) : null;
  let prizeText;
  if (prize.type === "coins") {
    prizeText = `${prize.amount.toLocaleString()} coins`;
  } else if (prize.type === "coin_pack") {
    prizeText = coinPack ? `${coinPack.name} (${coinPack.coins.toLocaleString()}c)` : prize.pack_id;
  } else if (prize.type === "perks") {
    prizeText = `${prize.perks.map((perk) => perk === "house_247" ? "24/7 House" : "Take-Out Counter Premium").join(" + ")} for 7 days`;
  } else {
    prizeText =     `${prize.amount} VALOR (server XP)`;
  }
  const lines = [
    `Prize: **${prizeText}**`,
    `Closes <t:${Math.floor(closesAt / 1000)}:F>.`,
    canary ? "Private preview only — entries and rewards are disabled." : "Enter below for a chance to win!"
  ];
  if (!canary && roleId) lines.push(`-# <@&${roleId}>`);
  const components = [
    { type: 10, content: "## Giveaway" },
    { type: 10, content: lines.join("\n") }
  ];
  if (!canary) {
    components.push({
      type: 1,
      components: [{
        type: 2,
        style: 3,
        label: "Enter Giveaway",
        custom_id: `noodle:giveaway:enter:${giveawayId}`,
        emoji: getButtonEmoji("sparkle")
      }]
    });
  }
  const payload = buildComponentsV2PayloadWithNoticeCards({
    mainComponents: components,
    ephemeral: false,
    includeGreenButtonTip: false
  });
  payload.allowed_mentions = {
    parse: [],
    roles: !canary && roleId ? [roleId] : []
  };
  return payload;
}

export function buildWinnerConfirmation({ giveaway, playerId, valorFulfillerId }) {
  const prize = JSON.parse(giveaway.prize_json);
  const perkDetails = prize.type === "perks"
    ? [
        ...prize.perks.map((perk) => `• ${perk === "house_247" ? "24/7 House" : "Take-Out Counter Premium"} for 7 days.`),
        ...(prize.perks.includes("takeout_counter")
          ? [`• Coins credited: **${SUBSCRIPTION_MONTHLY_COIN_GRANT.toLocaleString()}c**.`]
          : [])
      ].join("\n")
    : "";
  const details = prize.type === "coins"
    ? `• Coins credited: **${prize.amount.toLocaleString()}c**.`
    : prize.type === "coin_pack"
      ? `• Granted coin pack: ${getStoreCoinPack(prize.pack_id)?.priceLabel ?? prize.pack_id} (${getStoreCoinPack(prize.pack_id)?.coins.toLocaleString() ?? prize.pack_id}c).`
      : prize.type === "perks"
        ? perkDetails
        : `• <@${valorFulfillerId}> will send **${prize.amount} VALOR** within 48 hours.`;
  const winnerMessage = prize.type === "valor"
    ? `<@${playerId}> won the VALOR giveaway!\n• <@${valorFulfillerId}> will reward **${prize.amount} VALOR** within 48 hours.`
    : `${getIcon("coins")} Reward sent to <@${playerId}>!\n${details}`;
  const payload = buildComponentsV2PayloadWithNoticeCards({
    mainComponents: [
      { type: 10, content: "## Giveaway" },
      { type: 10, content: winnerMessage }
    ],
    ephemeral: false,
    includeGreenButtonTip: false
  });
  payload.allowed_mentions = {
    parse: [],
    users: [playerId, ...(prize.type === "valor" && valorFulfillerId ? [valorFulfillerId] : [])]
  };
  return payload;
}

export function buildValorFulfillmentConfirmation({ giveaway, playerId, valorFulfillerId }) {
  const prize = JSON.parse(giveaway.prize_json);
  if (prize.type !== "valor") throw new Error("VALOR fulfillment confirmation requires a VALOR prize");
  const payload = buildComponentsV2PayloadWithNoticeCards({
    mainComponents: [
      { type: 10, content: "## Giveaway" },
      {
        type: 10,
        content: `${getIcon("coins")} Reward sent to <@${playerId}>!\n• <@${valorFulfillerId}> has rewarded **${prize.amount} VALOR**.`
      }
    ],
    ephemeral: false,
    includeGreenButtonTip: false
  });
  payload.allowed_mentions = {
    parse: [],
    users: [playerId, valorFulfillerId]
  };
  return payload;
}

export function claimValorFulfillmentConfirmation(db, giveawayId, now = Date.now()) {
  return db.prepare(`
    UPDATE weekly_giveaways SET
      valor_confirmation_status = 'sending',
      valor_confirmation_started_at = ?
    WHERE giveaway_id = ? AND award_status = 'awaiting_manual' AND valor_confirmation_status = 'pending'
  `).run(now, String(giveawayId)).changes === 1;
}

export function completeValorFulfillmentConfirmation(db, giveawayId, messageId) {
  return db.prepare(`
    UPDATE weekly_giveaways SET
      valor_confirmation_status = 'confirmed',
      valor_confirmation_message_id = ?
    WHERE giveaway_id = ? AND valor_confirmation_status = 'sending'
  `).run(String(messageId), String(giveawayId)).changes === 1;
}

export function markValorFulfillmentConfirmationUnknown(db, giveawayId) {
  return db.prepare(`
    UPDATE weekly_giveaways SET valor_confirmation_status = 'delivery_unknown'
    WHERE giveaway_id = ? AND valor_confirmation_status = 'sending'
  `).run(String(giveawayId)).changes === 1;
}

function sendMessage(client, channelId, payload, env) {
  return rawChannelSendMessage(client, channelId, payload, { botToken: env.DISCORD_TOKEN || "" });
}

async function postPendingGiveaways({ db, client, settings, env, logger, now, content }) {
  const currentWeek = getGiveawayWeekStart(now);
  if (currentWeek + WEEK_MS <= now) return;
  const weekKey = String(currentWeek);
  const owner = `giveaway-batch:${process.pid}:${now}`;
  return withLock(db, `lock:giveaway-batch:${settings.guildId}:${weekKey}`, owner, 120_000, async () => {
  let batch = db.prepare(
    "SELECT contest_count FROM weekly_giveaway_batches WHERE guild_id = ? AND week_key = ?"
  ).get(settings.guildId, weekKey);
  if (!batch) {
    const contestCount = chooseWeeklyContestCount();
    db.prepare(`
      INSERT OR IGNORE INTO weekly_giveaway_batches (guild_id, week_key, contest_count, created_at)
      VALUES (?, ?, ?, ?)
    `).run(settings.guildId, weekKey, contestCount, now);
    batch = db.prepare(
      "SELECT contest_count FROM weekly_giveaway_batches WHERE guild_id = ? AND week_key = ?"
    ).get(settings.guildId, weekKey);
  }

  const prizes = chooseWeeklyPrizes(Number(batch.contest_count), content);
  for (let contestNumber = 1; contestNumber <= Number(batch.contest_count); contestNumber += 1) {
    let row = db.prepare(
      "SELECT * FROM weekly_giveaways WHERE guild_id = ? AND week_key = ? AND contest_number = ?"
    ).get(settings.guildId, weekKey, contestNumber);
    if (!row) {
      const giveawayId = `${weekKey}-${contestNumber}`;
      const closesAt = currentWeek + WEEK_MS;
      db.prepare(`
        INSERT INTO weekly_giveaways
          (giveaway_id, guild_id, channel_id, week_key, contest_number, prize_json, closes_at, status, award_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'open', 'pending', ?)
      `).run(giveawayId, settings.guildId, settings.channelId, weekKey, contestNumber, JSON.stringify(prizes[contestNumber - 1]), closesAt, now);
      row = db.prepare("SELECT * FROM weekly_giveaways WHERE giveaway_id = ?").get(giveawayId);
    }
    if (!row || row.message_id || row.status !== "open") continue;
    const claimed = db.prepare(`
      UPDATE weekly_giveaways SET status = 'posting', posting_started_at = ?
      WHERE giveaway_id = ? AND status = 'open' AND message_id IS NULL
    `).run(now, row.giveaway_id);
    if (claimed.changes !== 1) continue;
    try {
      const sent = await sendMessage(client, settings.channelId, buildGiveawayMessage({
        prize: JSON.parse(row.prize_json),
        closesAt: row.closes_at,
        giveawayId: row.giveaway_id,
        canary: false,
        announcementsRoleId: settings.announcementsRoleId
      }), env);
      if (!sent?.id) throw new Error("Discord did not return a giveaway message ID");
      db.prepare("UPDATE weekly_giveaways SET message_id = ?, status = 'open', posting_started_at = NULL WHERE giveaway_id = ? AND status = 'posting'")
        .run(String(sent.id), row.giveaway_id);
      logger.info(`Giveaway ${row.giveaway_id} posted to channel ${settings.channelId}.`);
    } catch (error) {
      db.prepare("UPDATE weekly_giveaways SET status = 'delivery_unknown' WHERE giveaway_id = ? AND status = 'posting'")
        .run(row.giveaway_id);
      logger.error(`Giveaway ${row.giveaway_id} delivery is uncertain; automatic retry is suppressed to avoid duplicate posts.`, error);
      emitTelemetry("hard_failure_scheduled_job", {
        job: "weekly_giveaways",
        stage: "giveaway_delivery_unknown",
        errorCode: error?.code ?? null,
        errorName: error?.name ?? null
      });
    }
  }
  });
}

function selectWinner(db, giveaway) {
  const eligible = db.prepare(`
    SELECT e.user_id
    FROM weekly_giveaway_entries e
    WHERE e.giveaway_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM weekly_giveaway_wins w
        WHERE w.guild_id = ? AND w.week_key = ? AND w.user_id = e.user_id
      )
    ORDER BY e.entered_at, e.user_id
  `).all(giveaway.giveaway_id, giveaway.guild_id, giveaway.week_key);
  if (!eligible.length) {
    db.prepare("UPDATE weekly_giveaways SET status = 'closed', award_status = 'no_winner' WHERE giveaway_id = ?")
      .run(giveaway.giveaway_id);
    return null;
  }
  const winner = eligible[randomInt(eligible.length)].user_id;
  db.prepare(`
    INSERT INTO weekly_giveaway_wins (guild_id, week_key, user_id, giveaway_id, won_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(giveaway.guild_id, giveaway.week_key, winner, giveaway.giveaway_id, Date.now());
  db.prepare(`
    UPDATE weekly_giveaways SET status = 'awarding', winner_user_id = ?
    WHERE giveaway_id = ? AND status = 'open'
  `).run(winner, giveaway.giveaway_id);
  return winner;
}

async function grantInGamePrize(db, giveaway) {
  const prize = JSON.parse(giveaway.prize_json);
  if (prize.type === "valor") {
    db.prepare("UPDATE weekly_giveaways SET award_status = 'awaiting_manual' WHERE giveaway_id = ? AND award_status = 'pending'")
      .run(giveaway.giveaway_id);
    return;
  }
  const grant = db.transaction(() => {
    const current = db.prepare("SELECT award_status FROM weekly_giveaways WHERE giveaway_id = ?").get(giveaway.giveaway_id);
    if (current?.award_status !== "pending") return;
    const player = getPlayer(db, giveaway.guild_id, giveaway.winner_user_id) || newPlayerProfile(giveaway.winner_user_id);
    const now = Date.now();
    if (prize.type === "coins") {
      player.coins = (Number(player.coins) || 0) + prize.amount;
      player.lifetime ??= {};
      player.lifetime.coins_earned = (Number(player.lifetime.coins_earned) || 0) + prize.amount;
    } else if (prize.type === "coin_pack") {
      const result = grantStoreCoinPack({ player, coinPackId: prize.pack_id });
      if (!result?.ok) throw new Error(`Giveaway coin pack could not be granted: ${result?.reason ?? "unknown"}`);
    } else if (prize.type === "perks") {
      const periodEndAt = now + WEEK_MS;
      for (const perk of prize.perks) {
        const perkId = perk === "house_247" ? SUBSCRIPTION_PERKS.HOUSE_247 : SUBSCRIPTION_PERKS.TAKEOUT_COUNTER;
        applySubscriptionEntitlementEvent(player, {
          perkId,
          eventType: "ENTITLEMENT_UPDATE",
          entitlementId: `giveaway:${giveaway.giveaway_id}:${giveaway.winner_user_id}:${perkId}`,
          periodStartAt: now,
          periodEndAt,
          now
        });
        applyMonthlySubscriptionCoinGrant(player, { perkId, periodStartAt: now, periodEndAt, now });
      }
    }
    upsertPlayer(db, giveaway.guild_id, giveaway.winner_user_id, player, null, player.schema_version);
    db.prepare("UPDATE weekly_giveaways SET award_status = 'granted' WHERE giveaway_id = ? AND award_status = 'pending'")
      .run(giveaway.giveaway_id);
  });
  const owner = `giveaway:${giveaway.giveaway_id}`;
  await withLock(db, `lock:user:${giveaway.winner_user_id}`, owner, 8000, grant);
}

async function settleExpiredGiveaways({ db, client, env, logger, now }) {
  const expired = db.prepare(`
    SELECT * FROM weekly_giveaways
    WHERE status IN ('open', 'awarding') AND closes_at <= ?
    ORDER BY closes_at, giveaway_id
  `).all(now);
  for (const expiredGiveaway of expired) {
    const owner = `giveaway-settle:${process.pid}:${now}:${expiredGiveaway.giveaway_id}`;
    await withLock(db, `lock:giveaway:${expiredGiveaway.giveaway_id}`, owner, 60_000, async () => {
    let giveaway = db.prepare("SELECT * FROM weekly_giveaways WHERE giveaway_id = ?").get(expiredGiveaway.giveaway_id);
    if (!giveaway || !["open", "awarding"].includes(giveaway.status) || giveaway.closes_at > now) return;
    if (giveaway.status === "open") db.transaction(() => selectWinner(db, giveaway))();
    giveaway = db.prepare("SELECT * FROM weekly_giveaways WHERE giveaway_id = ?").get(giveaway.giveaway_id);
    if (giveaway.winner_user_id && giveaway.award_status === "pending") {
      await grantInGamePrize(db, giveaway);
      giveaway = db.prepare("SELECT * FROM weekly_giveaways WHERE giveaway_id = ?").get(giveaway.giveaway_id);
    }
    if (!giveaway.winner_user_id || giveaway.confirmation_message_id || giveaway.confirmation_status !== "pending" || !["granted", "awaiting_manual"].includes(giveaway.award_status)) return;
    const valorFulfillerId = String(env.NOODLE_GIVEAWAY_VALOR_FULFILLER_ID || "").trim();
    if (giveaway.award_status === "awaiting_manual" && !/^\d{17,20}$/.test(valorFulfillerId)) {
      logger.error(`Giveaway ${giveaway.giveaway_id} awaits manual VALOR fulfillment but NOODLE_GIVEAWAY_VALOR_FULFILLER_ID is missing.`);
      emitTelemetry("hard_failure_scheduled_job", {
        job: "weekly_giveaways",
        stage: "missing_valor_fulfiller"
      });
      return;
    }
    const claimed = db.prepare(`
      UPDATE weekly_giveaways SET confirmation_status = 'sending', confirmation_started_at = ?
      WHERE giveaway_id = ? AND confirmation_status = 'pending' AND confirmation_message_id IS NULL
    `).run(now, giveaway.giveaway_id);
    if (claimed.changes !== 1) return;
    try {
      const sent = await sendMessage(client, giveaway.channel_id, buildWinnerConfirmation({
        giveaway,
        playerId: giveaway.winner_user_id,
        valorFulfillerId
      }), env);
      if (!sent?.id) throw new Error(`Discord did not return a winner confirmation ID for ${giveaway.giveaway_id}`);
      db.prepare("UPDATE weekly_giveaways SET confirmation_message_id = ?, confirmation_status = 'sent', status = 'closed' WHERE giveaway_id = ? AND confirmation_status = 'sending'")
        .run(String(sent.id), giveaway.giveaway_id);
      logger.info(`Giveaway ${giveaway.giveaway_id} winner confirmed.`);
    } catch (error) {
      db.prepare("UPDATE weekly_giveaways SET confirmation_status = 'delivery_unknown' WHERE giveaway_id = ? AND confirmation_status = 'sending'")
        .run(giveaway.giveaway_id);
      logger.error(`Giveaway ${giveaway.giveaway_id} winner-confirmation delivery is uncertain; automatic retry is suppressed to avoid duplicate posts.`, error);
      emitTelemetry("hard_failure_scheduled_job", {
        job: "weekly_giveaways",
        stage: "winner_confirmation_unknown",
        errorCode: error?.code ?? null,
        errorName: error?.name ?? null
      });
    }
    });
  }
}

export function startWeeklyGiveawayScheduler({ client, env = process.env, logger = console } = {}) {
  if (scheduler) return scheduler;
  if (!client) throw new Error("startWeeklyGiveawayScheduler requires a Discord client");
  const settings = resolveWeeklyGiveawaySettings(env);
  if (!settings.ok) {
    if (settings.reason !== "disabled") logger.warn(`Weekly giveaways are not starting (${settings.reason}).`);
    return null;
  }
  const giveawayContent = loadGiveawaysContent();
  validateGiveawayContent(giveawayContent);
  const db = openDb();
  if (!db) {
    logger.error("Weekly giveaways are enabled but the database is unavailable.");
    return null;
  }
  const recoveryTask = cron.schedule("*/5 * * * *", () => {
    try {
      markStaleScheduledDeliveriesUnknown(db);
    } catch (error) {
      logger.error("Giveaway delivery recovery check failed.", error);
    }
  }, { timezone: "UTC" });
  if (settings.canary) {
    const preview = {
      stop() {
        recoveryTask.stop();
        scheduler = null;
      }
    };
    scheduler = preview;
    void runWithTelemetry("giveaway_preview", "startup", async () => {
      try {
        if (!claimScheduledMessageDelivery(db, "giveaway_preview", Date.now(), settings.channelId)) {
          const delivery = db.prepare(
            "SELECT status FROM scheduled_message_delivery WHERE job_id = ?"
          ).get("giveaway_preview");
          logger.error(`Giveaway preview is not posting because its delivery state is ${delivery?.status ?? "unavailable"}; verify Discord before manually clearing it.`);
          emitTelemetry("hard_failure_scheduled_job", {
            job: "giveaway_preview",
            stage: "prior_delivery_not_resolved"
          });
          return false;
        }
        ensureClientToken(client, env);
        const channel = await client.channels.fetch(settings.channelId);
        if (!channel || String(channel.guildId || "") !== settings.guildId) {
          throw new Error("Configured giveaway canary channel is not in the official guild");
        }
        const previous = db.prepare(
          "SELECT channel_id, message_id FROM scheduled_message_state WHERE job_id = ?"
        ).get("giveaway_preview");
        if (previous?.message_id && previous?.channel_id) {
          try {
            const oldChannel = await client.channels.fetch(previous.channel_id);
            await oldChannel.messages.delete(previous.message_id);
          } catch (error) {
            if (Number(error?.code ?? error?.rawError?.code) !== 10008 && Number(error?.status) !== 404) throw error;
          }
        }
        const sent = await sendMessage(client, settings.channelId, buildGiveawayCanaryPreview({ content: giveawayContent }), env);
        if (!sent?.id) throw new Error("Discord did not return a giveaway preview message ID");
        db.prepare(`
          INSERT INTO scheduled_message_state (job_id, channel_id, message_id, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(job_id) DO UPDATE SET
            channel_id = excluded.channel_id,
            message_id = excluded.message_id,
            updated_at = excluded.updated_at
        `).run("giveaway_preview", settings.channelId, String(sent.id), Date.now());
        completeScheduledMessageDelivery(db, "giveaway_preview");
        logger.info(`Private giveaway preview posted to channel ${settings.channelId}.`);
        return true;
      } catch (error) {
        markScheduledMessageDeliveryUnknown(db, "giveaway_preview");
        logger.error("Private giveaway preview failed.", error);
        emitTelemetry("hard_failure_scheduled_job", {
          job: "giveaway_preview",
          stage: "preview_delivery_unknown",
          errorCode: error?.code ?? null,
          errorName: error?.name ?? null
        });
        return false;
      }
    });
    return preview;
  }
  let running = false;
  const runOnce = async (reason = "interval") => {
    if (running) return "skipped";
    running = true;
    try {
      markStaleScheduledDeliveriesUnknown(db);
      ensureClientToken(client, env);
      const channel = await client.channels.fetch(settings.channelId);
      if (!channel || String(channel.guildId || "") !== settings.guildId) {
        throw new Error("Configured giveaway channel is not in the official guild");
      }
      const now = Date.now();
      await settleExpiredGiveaways({ db, client, env, logger, now });
      await postPendingGiveaways({ db, client, settings, env, logger, now, content: giveawayContent });
      logger.info(`Weekly giveaway lifecycle checked (${reason}).`);
      return true;
    } catch (error) {
      logger.error(`Weekly giveaway lifecycle failed (${reason}).`, error);
      return false;
    } finally {
      running = false;
    }
  };
  const task = cron.schedule("*/5 * * * *", () => (
    runWithTelemetry("weekly_giveaways", "interval", () => runOnce("interval"))
  ), { timezone: "UTC" });
  scheduler = {
    runOnce,
    stop() {
      task.stop();
      recoveryTask.stop();
      scheduler = null;
    }
  };
  void runWithTelemetry("weekly_giveaways", "startup", () => runOnce("startup"));
  return scheduler;
}

export function buildGiveawayCanaryPreview({ content = loadGiveawaysContent(), now = Date.now() } = {}) {
  const prizes = chooseWeeklyPrizes(1, content);
  return buildGiveawayMessage({
    prize: prizes[0],
    closesAt: now + WEEK_MS,
    giveawayId: "private-preview",
    canary: true
  });
}
