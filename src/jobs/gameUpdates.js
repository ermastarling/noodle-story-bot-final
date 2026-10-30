import { randomUUID } from "node:crypto";
import cron from "node-cron";
import { openDb, getServer } from "../db/index.js";
import { loadEventsContent, loadGameUpdatesContent, loadSettingsCatalog } from "../content/index.js";
import { buildSettingsMap } from "../settings/resolve.js";
import { computeActiveSeason } from "../game/seasons.js";
import { getEventWindow, resolveActiveEventId } from "../game/events.js";
import {
  buildComponentsV2PayloadWithNoticeCards,
  isComponentsV2Payload,
  rawChannelSendMessage
} from "../ui/componentsV2.js";
import { emitTelemetry, runWithTelemetry } from "../infra/telemetry.js";
import { getSceneBannerUrl } from "../ui/icons.js";
import { markStaleScheduledDeliveriesUnknown } from "./scheduledDelivery.js";

const DISCORD_SNOWFLAKE = /^\d{17,20}$/;
let scheduler = null;

export function validateGameUpdatesContent(content) {
  if (!content || !Array.isArray(content.updates)) {
    throw new Error("Game update content must contain an updates array");
  }
  const ids = new Set();
  for (const update of content.updates) {
    const id = String(update?.id ?? "").trim();
    const title = String(update?.title ?? "").trim();
    const body = String(update?.body ?? "").trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id) || ids.has(id)) {
      throw new Error(`Game update has an invalid or duplicate ID: ${id || "(empty)"}`);
    }
    if (!title || title.length > 100 || !body || body.length > 3500) {
      throw new Error(`Game update ${id} must have a title of 1-100 characters and a body of 1-3500 characters`);
    }
    if (update.rollout_summary !== undefined && typeof update.rollout_summary !== "boolean") {
      throw new Error(`Game update ${id} has an invalid rollout_summary value`);
    }
    ids.add(id);
  }
  return true;
}

export function findGameUpdate(content, updateId) {
  validateGameUpdatesContent(content);
  return content.updates.find((update) => update.id === String(updateId ?? "").trim()) ?? null;
}

export function parseScheduledAt(value, now = Date.now()) {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) {
    return null;
  }
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) && timestamp > now ? timestamp : null;
}

export function resolveGameUpdateSettings(env = process.env) {
  if (String(env.NOODLE_GAME_UPDATES_ENABLED || "").trim() !== "1") {
    return { ok: false, reason: "disabled" };
  }
  if (String(env.NOODLE_GAME_UPDATES_COPY_APPROVED || "").trim() !== "1") {
    return { ok: false, reason: "copy_not_approved" };
  }
  const guildId = String(env.NOODLE_OFFICIAL_GUILD_ID || env.DISCORD_GUILD_ID || "").trim();
  if (!DISCORD_SNOWFLAKE.test(guildId)) return { ok: false, reason: "missing_official_guild" };

  const canary = String(env.NOODLE_OFFICIAL_FEATURE_CANARY ?? "1").trim() !== "0";
  if (canary) {
    if (String(env.NOODLE_OFFICIAL_FEATURE_CANARY_PRIVATE_VERIFIED || "").trim() !== "1") {
      return { ok: false, reason: "canary_privacy_not_verified" };
    }
    const channelId = String(env.NOODLE_DEV_ALERT_CHANNEL_ID || "").trim();
    if (!DISCORD_SNOWFLAKE.test(channelId)) return { ok: false, reason: "missing_canary_channel" };
    return { ok: true, canary, guildId, channelId };
  }

  if (String(env.NOODLE_GAME_UPDATES_PRODUCTION_ENABLED || "").trim() !== "1") {
    return { ok: false, reason: "production_not_approved" };
  }
  const channelId = String(env.NOODLE_GAME_UPDATES_CHANNEL_ID || "").trim();
  if (!DISCORD_SNOWFLAKE.test(channelId)) return { ok: false, reason: "missing_production_channel" };
  const announcementsRoleId = String(env.NOODLE_ROLLOUT_ANNOUNCEMENTS_ROLE_ID || "").trim();
  if (!DISCORD_SNOWFLAKE.test(announcementsRoleId)) {
    return { ok: false, reason: "missing_announcements_role" };
  }
  const eventsRoleId = String(env.NOODLE_GAME_UPDATES_EVENTS_ROLE_ID || "").trim();
  if (!DISCORD_SNOWFLAKE.test(eventsRoleId)) {
    return { ok: false, reason: "missing_events_role" };
  }
  return {
    ok: true,
    canary,
    guildId,
    channelId,
    announcementsRoleId,
    eventsRoleId: DISCORD_SNOWFLAKE.test(eventsRoleId) ? eventsRoleId : null
  };
}

export function buildGameUpdatePayload({
  title,
  body: bodyValue
} = {}, {
  allowedRoleIds = [],
  announcementsRoleId = null,
  gameUpdatesRoleId = null,
  bannerKey = "news"
} = {}) {
  const safeTitle = String(title ?? "").trim();
  const baseBody = String(bodyValue ?? "").trim();
  if (!safeTitle || !baseBody) throw new Error("Cannot build a game update without a title and body");
  const roleIds = [...new Set([
    ...allowedRoleIds.map((id) => String(id ?? "").trim()),
    String(announcementsRoleId ?? "").trim(),
    String(gameUpdatesRoleId ?? "").trim()
  ].filter(Boolean))];
  if (roleIds.some((id) => !DISCORD_SNOWFLAKE.test(id))) {
    throw new Error("Game update role mentions must use valid Discord role IDs");
  }
  if (safeTitle.length > 100 || baseBody.length > 3500) throw new Error("Game update exceeds the supported title or body length");
  const bodyComponents = [{ type: 10, content: baseBody }];
  if (announcementsRoleId) bodyComponents.push({ type: 10, content: `<@&${announcementsRoleId}>` });
  const gameRoleMention = gameUpdatesRoleId ? `<@&${gameUpdatesRoleId}>` : "";
  const sameRole = String(gameUpdatesRoleId ?? "").trim() === String(announcementsRoleId ?? "").trim();
  if (gameRoleMention && !sameRole && !baseBody.includes(gameRoleMention)) {
    bodyComponents.push({ type: 10, content: gameRoleMention });
  }
  const payload = buildComponentsV2PayloadWithNoticeCards({
    mainComponents: [
      { type: 10, content: `## ${safeTitle}` },
      ...bodyComponents
    ],
    ephemeral: false,
    includeGreenButtonTip: false,
    imageUrl: getSceneBannerUrl(bannerKey)
  });
  payload.allowed_mentions = {
    parse: [],
    ...(roleIds.length ? { roles: roleIds } : {})
  };
  return payload;
}

function formatEventRewardLines(effects = {}) {
  const lines = [];
  const rewards = effects.rewards ?? {};
  for (const [key, label] of [["coins_mult", "coins"], ["sxp_mult", "SXP"], ["rep_mult", "REP"]]) {
    const multiplier = Number(rewards[key] ?? 1);
    if (Number.isFinite(multiplier) && multiplier > 1) {
      const increase = Number(((multiplier - 1) * 100).toFixed(2));
      lines.push(`• +${increase}% ${label}`);
    }
  }
  const repBonus = Number(rewards.rep_bonus ?? 0);
  if (Number.isFinite(repBonus) && repBonus > 0) lines.push(`• +${repBonus} REP`);

  const market = effects.market ?? {};
  const priceMultiplier = Number(market.price_mult ?? 1);
  if (Number.isFinite(priceMultiplier) && priceMultiplier > 0 && priceMultiplier < 1) {
    lines.push(`• ${Number(((1 - priceMultiplier) * 100).toFixed(2))}% off market prices`);
  }
  const stockMultiplier = Number(market.stock_mult ?? 1);
  if (Number.isFinite(stockMultiplier) && stockMultiplier > 1) {
    lines.push(`• +${Number(((stockMultiplier - 1) * 100).toFixed(2))}% market stock`);
  }
  return lines.length ? lines : ["• No additional bonuses"];
}

export function buildSeasonUpdate({ season, event = null, now = Date.now() } = {}) {
  const seasonLabel = String(season ?? "").trim();
  if (!seasonLabel) throw new Error("Cannot build a season update without a season");
  const recipes = Array.isArray(event?.event_recipes) ? event.event_recipes : [];
  let details;
  if (event) {
    const window = getEventWindow(event, now);
    if (!window.start || !window.end) {
      throw new Error(`Season event has no valid start/end timestamps: ${event.event_id ?? event.name ?? "unknown"}`);
    }
    details = [
      `The world of Noodle Story has transitioned to **${seasonLabel}**!`,
      `**${String(event.name ?? event.event_id)}**`,
      event.tagline ? `_${String(event.tagline)}_` : "",
      `<t:${Math.floor(window.start / 1000)}:F> - <t:${Math.floor(window.end / 1000)}:F>`,
      event.description ? `_${String(event.description)}_` : "",
      "**Rewards**",
      ...formatEventRewardLines(event.effects),
      recipes.length
        ? `Special event recipes:\n${recipes.map((recipe) => `• **${String(recipe.name ?? recipe.recipe_id)}**`).join("\n")}`
        : "There are no special event recipes for this season.",
      "-# Rewards apply to any order served during the event & unlocking an event scroll grants a badge!",
      "{{events_role}}"
    ].filter(Boolean);
  } else {
    details = [
      `The world of Noodle Story has transitioned to **${seasonLabel}**!`,
      "There is no special event active right now.",
      "**Rewards**",
      "• No additional bonuses",
      "There are no special event recipes for this season."
    ];
  }
  return {
    id: `season-${seasonLabel}-${String(event?.event_id ?? "no-event")}`,
    title: `${seasonLabel} Seasonal Update`,
    body: details.join("\n\n")
  };
}

export function scheduleGameUpdate(db, {
  guildId,
  update,
  scheduledAt,
  createdBy,
  now = Date.now()
} = {}) {
  if (!db) throw new Error("Database is unavailable");
  if (!DISCORD_SNOWFLAKE.test(String(guildId ?? ""))) throw new Error("A valid official guild ID is required");
  if (!update || !String(update.id ?? "").trim()) throw new Error("A configured game update is required");
  const dueAt = Number(scheduledAt);
  if (!Number.isFinite(dueAt) || dueAt <= now) throw new Error("Schedule time must be a future timestamp");
  const scheduleId = randomUUID();
  db.prepare(`
    INSERT INTO scheduled_game_updates
      (schedule_id, guild_id, update_id, scheduled_at, payload_json, rollout_summary, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(
    scheduleId,
    guildId,
    String(update.id),
    dueAt,
    JSON.stringify({ title: String(update.title), body: String(update.body) }),
    update.rollout_summary === true ? 1 : 0,
    String(createdBy ?? ""),
    now,
    now
  );
  return { scheduleId, scheduledAt: dueAt };
}

export function claimScheduledGameUpdateDelivery(db, {
  scheduleId,
  expectedStatus,
  channelId,
  canary,
  now = Date.now()
} = {}) {
  if (!db) throw new Error("Database is required");
  if (!DISCORD_SNOWFLAKE.test(String(channelId ?? ""))) {
    throw new Error("A valid delivery channel ID is required");
  }
  if (typeof canary !== "boolean") throw new Error("Delivery mode must be explicit");
  if (!["pending", "canary_previewed"].includes(expectedStatus)) {
    throw new Error("Invalid scheduled update status for delivery");
  }
  return db.prepare(`
    UPDATE scheduled_game_updates
    SET status = 'sending', attempt_channel_id = ?, attempt_canary = ?, updated_at = ?
    WHERE schedule_id = ? AND status = ?
  `).run(String(channelId), canary ? 1 : 0, now, String(scheduleId ?? ""), expectedStatus).changes === 1;
}

export function completeScheduledGameUpdateDelivery(db, {
  scheduleId,
  messageId,
  now = Date.now()
} = {}) {
  const row = db.prepare(`
    SELECT guild_id, rollout_summary, attempt_channel_id, attempt_canary
    FROM scheduled_game_updates
    WHERE schedule_id = ? AND status = 'sending'
  `).get(String(scheduleId ?? ""));
  if (
    !row
    || !DISCORD_SNOWFLAKE.test(String(row.attempt_channel_id ?? ""))
    || ![0, 1].includes(row.attempt_canary)
  ) return false;
  const canary = row.attempt_canary === 1;
  const nextStatus = row.rollout_summary && canary ? "canary_previewed" : "sent";
  return db.transaction(() => {
    const result = db.prepare(`
      UPDATE scheduled_game_updates SET status = ?, message_id = ?, updated_at = ?
      WHERE schedule_id = ? AND status = 'sending' AND attempt_channel_id = ? AND attempt_canary = ?
    `).run(
      nextStatus,
      String(messageId),
      now,
      String(scheduleId),
      row.attempt_channel_id,
      row.attempt_canary
    );
    if (result.changes !== 1) return false;
    if (row.rollout_summary && !canary) {
      db.prepare(`
        INSERT INTO game_update_release_state (guild_id, first_update_sent_at, first_update_id)
        VALUES (?, ?, ?)
        ON CONFLICT(guild_id) DO NOTHING
      `).run(row.guild_id, now, String(scheduleId));
    }
    return true;
  })();
}

function getEventForServer(eventsContent, eventId) {
  const id = String(eventId ?? "");
  return (eventsContent?.events ?? []).find((entry) => entry?.event_id === id) ?? null;
}

async function ensureOfficialChannel(client, channelId, guildId) {
  const channel = await client.channels.fetch(channelId);
  if (!channel || String(channel.guildId ?? "") !== guildId) {
    throw new Error("Configured announcement channel is not in the official guild");
  }
  return channel;
}

async function sendPayload(client, settings, payload, env) {
  if (!isComponentsV2Payload(payload)) {
    throw new Error("Game and season updates must be sent as Components V2 containers");
  }
  const sent = await rawChannelSendMessage(client, settings.channelId, payload, {
    botToken: env.DISCORD_TOKEN || ""
  });
  if (!sent?.id) throw new Error("Discord did not return an announcement message ID");
  return String(sent.id);
}

function hasPublicRolloutUpdate(db, guildId) {
  return Boolean(db.prepare(
    "SELECT 1 FROM game_update_release_state WHERE guild_id = ? AND first_update_sent_at IS NOT NULL"
  ).get(guildId));
}

async function postScheduledUpdates({ db, client, settings, env, logger, now }) {
  const due = db.prepare(`
    SELECT * FROM scheduled_game_updates
    WHERE guild_id = ? AND scheduled_at <= ?
      AND (status = 'pending' OR (status = 'canary_previewed' AND ? = 0))
    ORDER BY scheduled_at, created_at
  `).all(settings.guildId, now, settings.canary ? 1 : 0);
  for (const row of due) {
    const firstUpdateSent = hasPublicRolloutUpdate(db, settings.guildId);
    if (row.rollout_summary && firstUpdateSent) {
      db.prepare(`
        UPDATE scheduled_game_updates SET status = 'blocked_duplicate', updated_at = ?
        WHERE schedule_id = ? AND status = ?
      `).run(now, row.schedule_id, row.status);
      logger.warn(`Game update ${row.update_id} was blocked because a comprehensive first update has already been sent.`);
      continue;
    }
    if (!row.rollout_summary && !firstUpdateSent) continue;
    let payload;
    try {
      payload = buildGameUpdatePayload(JSON.parse(row.payload_json), {
        allowedRoleIds: settings.canary ? [] : [settings.eventsRoleId],
        announcementsRoleId: settings.canary ? null : settings.announcementsRoleId,
        gameUpdatesRoleId: settings.canary ? null : settings.eventsRoleId
      });
    } catch (error) {
      db.prepare(`
        UPDATE scheduled_game_updates SET status = 'failed_invalid', updated_at = ?
        WHERE schedule_id = ? AND status = ?
      `).run(now, row.schedule_id, row.status);
      logger.error(`Game update ${row.update_id} has invalid persisted content and was not sent.`, error);
      emitTelemetry("hard_failure_scheduled_job", {
        job: "game_updates",
        stage: "invalid_update_content",
        errorCode: error?.code ?? null,
        errorName: error?.name ?? null
      });
      continue;
    }
    if (!claimScheduledGameUpdateDelivery(db, {
      scheduleId: row.schedule_id,
      expectedStatus: row.status,
      channelId: settings.channelId,
      canary: settings.canary,
      now
    })) continue;
    try {
      const messageId = await sendPayload(client, settings, payload, env);
      if (!completeScheduledGameUpdateDelivery(db, {
        scheduleId: row.schedule_id,
        messageId,
        now
      })) throw new Error("Scheduled update delivery state changed before completion");
      logger.info(`Game update ${row.update_id} sent to channel ${settings.channelId}.`);
    } catch (error) {
      db.prepare(`
        UPDATE scheduled_game_updates SET status = 'delivery_unknown', updated_at = ?
        WHERE schedule_id = ? AND status = 'sending'
      `).run(now, row.schedule_id);
      logger.error(`Game update ${row.update_id} delivery is uncertain; automatic retry is suppressed to avoid duplicate posts.`, error);
      emitTelemetry("hard_failure_scheduled_job", {
        job: "game_updates",
        stage: "update_delivery_unknown",
        errorCode: error?.code ?? null,
        errorName: error?.name ?? null
      });
    }
  }
}

async function postPendingSeasonUpdate({ db, client, settings, env, logger, now }) {
  if (!hasPublicRolloutUpdate(db, settings.guildId)) return;
  const row = db.prepare(`
    SELECT * FROM game_update_season_state
    WHERE guild_id = ? AND (status = 'pending' OR (status = 'canary_previewed' AND ? = 0))
  `).get(settings.guildId, settings.canary ? 1 : 0);
  if (!row) return;
  let payload;
  try {
    const update = JSON.parse(row.payload_json);
    const allowedRoleIds = settings.canary ? [] : [settings.eventsRoleId];
    if (String(update.body ?? "").includes("{{events_role}}")) {
      const roleMention = settings.canary ? "" : `<@&${settings.eventsRoleId}>`;
      update.body = String(update.body).replaceAll("{{events_role}}", roleMention);
    }
    payload = buildGameUpdatePayload(update, {
      allowedRoleIds,
      announcementsRoleId: settings.canary ? null : settings.announcementsRoleId,
      gameUpdatesRoleId: settings.canary ? null : settings.eventsRoleId,
      bannerKey: "season"
    });
  } catch (error) {
    db.prepare(`
      UPDATE game_update_season_state SET status = 'failed_invalid', updated_at = ?
      WHERE guild_id = ? AND status = ?
    `).run(now, settings.guildId, row.status);
    logger.error("Season/event update has invalid persisted content and was not sent.", error);
    emitTelemetry("hard_failure_scheduled_job", {
      job: "game_updates",
      stage: "invalid_season_content",
      errorCode: error?.code ?? null,
      errorName: error?.name ?? null
    });
    return;
  }
  const claimed = db.prepare(`
    UPDATE game_update_season_state SET status = 'sending', updated_at = ?
    WHERE guild_id = ? AND status = ?
  `).run(now, settings.guildId, row.status);
  if (claimed.changes !== 1) return;
  try {
    const messageId = await sendPayload(client, settings, payload, env);
    db.prepare(`
      UPDATE game_update_season_state SET status = ?, message_id = ?, updated_at = ?
      WHERE guild_id = ? AND status = 'sending'
    `).run(settings.canary ? "canary_previewed" : "sent", messageId, now, settings.guildId);
    logger.info(`Season/event update sent to channel ${settings.channelId}.`);
  } catch (error) {
    db.prepare(`
      UPDATE game_update_season_state SET status = 'delivery_unknown', updated_at = ?
      WHERE guild_id = ? AND status = 'sending'
    `).run(now, settings.guildId);
    logger.error("Season/event update delivery is uncertain; automatic retry is suppressed to avoid duplicate posts.", error);
    emitTelemetry("hard_failure_scheduled_job", {
      job: "game_updates",
      stage: "season_delivery_unknown",
      errorCode: error?.code ?? null,
      errorName: error?.name ?? null
    });
  }
}

function recordSeasonChange({ db, settings, eventsContent, settingsCatalog, now }) {
  const server = getServer(db, settings.guildId);
  if (!server) return;
  const settingsMap = buildSettingsMap(settingsCatalog, server.settings);
  const season = String(server.season || computeActiveSeason(settingsMap));
  const state = db.prepare(
    "SELECT last_season, last_event_id FROM game_update_season_state WHERE guild_id = ?"
  ).get(settings.guildId);
  let eventId = String(server.active_event_id ?? "");
  if (state && state.last_season !== season) {
    const scheduledEventId = resolveActiveEventId(eventsContent, now, season);
    const scheduledEvent = getEventForServer(eventsContent, scheduledEventId);
    const storedEvent = getEventForServer(eventsContent, eventId);
    if (scheduledEvent || !storedEvent || storedEvent.season !== season) {
      eventId = scheduledEventId ?? "";
    }
  }
  const event = getEventForServer(eventsContent, eventId);
  eventId = String(event?.event_id ?? "");
  if (!state) {
    db.prepare(`
      INSERT INTO game_update_season_state (guild_id, last_season, last_event_id, status, updated_at)
      VALUES (?, ?, ?, 'idle', ?)
    `).run(settings.guildId, season, eventId, now);
    return;
  }
  if (state.last_season === season && state.last_event_id === eventId) return;
  const update = buildSeasonUpdate({ season, event, now });
  db.prepare(`
    UPDATE game_update_season_state SET
      last_season = ?, last_event_id = ?, payload_json = ?, status = 'pending',
      message_id = NULL, updated_at = ?
    WHERE guild_id = ?
  `).run(season, eventId, JSON.stringify(update), now, settings.guildId);
}

export function startGameUpdateScheduler({ client, env = process.env, logger = console } = {}) {
  if (scheduler) return scheduler;
  if (!client) throw new Error("startGameUpdateScheduler requires a Discord client");
  const settings = resolveGameUpdateSettings(env);
  const guildId = String(settings.guildId || env.NOODLE_OFFICIAL_GUILD_ID || env.DISCORD_GUILD_ID || "").trim();
  if (!DISCORD_SNOWFLAKE.test(guildId)) {
    logger.warn("Game-update scheduler is not tracking season changes (official guild ID is not configured).");
    return null;
  }
  const db = openDb();
  if (!db) {
    logger.error("Game updates are enabled but the database is unavailable.");
    return null;
  }
  const content = loadGameUpdatesContent();
  validateGameUpdatesContent(content);
  const eventsContent = loadEventsContent();
  const settingsCatalog = loadSettingsCatalog();
  const runSettings = { ...settings, guildId };
  if (!settings.ok && settings.reason !== "disabled") {
    logger.warn(`Game-update posting is gated (${settings.reason}); season changes will be recorded without delivery.`);
  }
  let running = false;
  const runOnce = async (reason = "interval") => {
    if (running) return "skipped";
    running = true;
    try {
      const now = Date.now();
      markStaleScheduledDeliveriesUnknown(db, now);
      recordSeasonChange({ db, settings: runSettings, eventsContent, settingsCatalog, now });
      if (settings.ok) {
        await ensureOfficialChannel(client, settings.channelId, settings.guildId);
        await postScheduledUpdates({ db, client, settings, env, logger, now });
        await postPendingSeasonUpdate({ db, client, settings, env, logger, now });
      }
      return true;
    } catch (error) {
      logger.error(`Game-update scheduler failed (${reason}).`, error);
      return false;
    } finally {
      running = false;
    }
  };
  const task = cron.schedule("* * * * *", () => (
    runWithTelemetry("game_updates", "interval", () => runOnce("interval"))
  ), { timezone: "UTC" });
  scheduler = {
    runOnce,
    stop() {
      task.stop();
      scheduler = null;
    }
  };
  void runWithTelemetry("game_updates", "startup", () => runOnce("startup"));
  return scheduler;
}
