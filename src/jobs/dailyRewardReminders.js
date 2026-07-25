import cron from "node-cron";
import discordPkg from "discord.js";
import { openDb, getPlayer, getLatestServerIdForUser, upsertPlayer } from "../db/index.js";
import { dayKeyUTC, nowTs } from "../util/time.js";
import { hasDailyRewardAvailable } from "../game/daily.js";
import { hasUnlimitedMarketStock } from "../game/subscriptions.js";
import { getIcon } from "../ui/icons.js";
import { emitTelemetry } from "../infra/telemetry.js";
import { buildComponentsV2PayloadWithNoticeCards } from "../ui/componentsV2.js";
import { sendRawDm } from "../util/rawDm.js";

const {
  MessageActionRow,
  MessageButton,
  Constants
} = discordPkg;

const ActionRowBuilder = MessageActionRow;
const ButtonBuilder = MessageButton;
const ButtonStyle = {
  Primary: Constants?.MessageButtonStyles?.PRIMARY ?? 1,
  Secondary: Constants?.MessageButtonStyles?.SECONDARY ?? 2,
  Success: Constants?.MessageButtonStyles?.SUCCESS ?? 3,
  Danger: Constants?.MessageButtonStyles?.DANGER ?? 4,
  Link: Constants?.MessageButtonStyles?.LINK ?? 5
};

const DEFAULT_CRON = "15 * * * *";
const DEFAULT_MAX_INACTIVE_DAYS = 30;
const db = openDb();
let isRunning = false;

function isSnowflake(value) {
  return /^\d{17,20}$/.test(String(value || "").trim());
}

function buildDmReminderComponents({ userId, serverId, channelUrl, optOut }) {
  const row = new ActionRowBuilder();
  if (channelUrl) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel("Open Channel")
        .setStyle(ButtonStyle.Link)
        .setURL(channelUrl)
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:dm:reminders_toggle:${userId}:${serverId}`)
      .setLabel(optOut ? "Enable reminders" : "Disable reminders")
      .setStyle(optOut ? ButtonStyle.Success : ButtonStyle.Secondary)
  );
  return [row];
}

function normalizeComponents(rows = []) {
  if (!Array.isArray(rows)) return [];
  const normalized = [];
  for (const row of rows) {
    if (!row) continue;
    const baseRow = row.toJSON?.() ?? row;
    const rawComponents = baseRow.components ?? row.components ?? [];
    const mapped = (rawComponents || [])
      .map((comp) => comp?.toJSON?.() ?? comp)
      .filter(Boolean);
    if (!mapped.length) continue;
    normalized.push({ type: 1, components: mapped });
  }
  return normalized;
}

function buildReminderV2Payload({ channelLine, claimLine, userId, components = [], player = null, now = Date.now() }) {
  const hasHouse247Active = hasUnlimitedMarketStock(player, now);
  const openerLine = hasHouse247Active
    ? `Your ${getIcon("perk_house_247", getIcon("sparkle"))} 24/7 House is active. Vote again using \`/noodle quests_vote\` to extend it.`
    : `New orders are on the board today, come back to serve your regulars! ${getIcon("regulars")}`;
  const compactReminderBlock = [
    channelLine || null,
    "Your daily reward is also ready!",
    claimLine
  ].filter(Boolean).join("\n");
  const lines = ["Daily Noodle", openerLine, compactReminderBlock, "Disable reminders below."].filter(Boolean);

  return buildComponentsV2PayloadWithNoticeCards({
    mainComponents: [
      { type: 10, content: `## ${lines[0]}` },
      { type: 10, content: lines.slice(1).join("\n\n") },
      ...normalizeComponents(components)
    ],
    ownerId: userId,
    ephemeral: false
  });
}

async function trySendReminderForUser(client, userId, {
  preferredServerId,
  now,
  todayKey,
  force = false
} = {}) {
  if (!isSnowflake(userId)) {
    return { ok: false, reason: "invalid_user_id", serverId: preferredServerId || "global" };
  }

  const user = await client.users.fetch(String(userId)).catch(() => null);
  if (!user) {
    return { ok: false, reason: "user_not_found", serverId: preferredServerId || "global" };
  }

  const resolvedServerId = preferredServerId || getLatestServerIdForUser(db, userId) || "global";
  const player = getPlayer(db, resolvedServerId, userId);
  if (!player) return { ok: false, reason: "player_missing", serverId: resolvedServerId };

  normalizeNotifications(player);

  if (player.notifications.dm_reminders_opt_out === true && !force) {
    return { ok: false, reason: "opted_out", serverId: resolvedServerId };
  }
  if (!hasDailyRewardAvailable(player, now) && !force) {
    return { ok: false, reason: "daily_unavailable", serverId: resolvedServerId };
  }
  if (player.notifications.last_daily_reminder_day === todayKey && !force) {
    return { ok: false, reason: "already_sent_today", serverId: resolvedServerId };
  }

  const lastGuildId = player.notifications.last_noodle_guild_id ?? resolvedServerId;
  const channelId = player.notifications.last_noodle_channel_id ?? null;
  const channelUrl = channelId && lastGuildId && lastGuildId !== "global"
    ? `https://discord.com/channels/${lastGuildId}/${channelId}`
    : null;
  const channelLine = channelId ? `<#${channelId}>` : null;
  const claimLine = force
    ? "*Use `/noodle quests_daily` to claim it.*"
    : "*Use `/noodle quests_daily` to claim it.*";
  const components = buildDmReminderComponents({
    userId,
    serverId: lastGuildId || resolvedServerId,
    channelUrl,
    optOut: false
  });
  const payload = buildReminderV2Payload({ channelLine, claimLine, userId, components, player, now });

  try {
    await sendRawDm(client, user.id, payload);
    player.notifications.last_daily_reminder_day = todayKey;
    upsertPlayer(db, resolvedServerId, userId, player, null, player.schema_version ?? 1);
    return { ok: true, reason: "sent", serverId: resolvedServerId };
  } catch (error) {
    emitTelemetry("hard_failure_dm_send", {
      route: "jobs:daily_reward_reminder",
      userId,
      guildId: lastGuildId || resolvedServerId,
      errorCode: error?.code ?? null,
      errorName: error?.name ?? null,
      errorMessage: String(error?.message ?? error ?? "unknown_error")
    });
    console.error("Daily reminder DM send failed", {
      userId,
      guildId: lastGuildId || resolvedServerId,
      errorCode: error?.code ?? null,
      errorMessage: error?.message ?? String(error)
    });
    return { ok: false, reason: "send_failed", serverId: resolvedServerId };
  }
}

function normalizeNotifications(player) {
  if (!player.notifications) {
    player.notifications = {
      pending_pantry_messages: [],
      pending_v2_notice_cards: [],
      active_v2_notice_cards: [],
      active_v2_notice_menu_key: null,
      dm_reminders_opt_out: false,
      last_daily_reminder_day: null,
      last_noodle_channel_id: null,
      last_noodle_guild_id: null
    };
  }
  if (!Array.isArray(player.notifications.pending_pantry_messages)) {
    player.notifications.pending_pantry_messages = [];
  }
  if (!Array.isArray(player.notifications.pending_v2_notice_cards)) {
    player.notifications.pending_v2_notice_cards = [];
  }
  if (!Array.isArray(player.notifications.active_v2_notice_cards)) {
    player.notifications.active_v2_notice_cards = [];
  }
  if (
    player.notifications.active_v2_notice_menu_key !== null
    && typeof player.notifications.active_v2_notice_menu_key !== "string"
  ) {
    player.notifications.active_v2_notice_menu_key = null;
  }
  if (!Object.prototype.hasOwnProperty.call(player.notifications, "last_daily_reminder_day")) {
    player.notifications.last_daily_reminder_day = null;
  }
}

async function sendDailyRewardReminders(client, getKnownServerIds) {
  if (!db) return;
  if (isRunning) return;
  isRunning = true;

  const now = nowTs();
  const todayKey = dayKeyUTC(now);
  const maxInactiveDays = Number.parseInt(process.env.NOODLE_DAILY_REMINDER_MAX_INACTIVE_DAYS || "", 10);
  const maxInactive = Number.isFinite(maxInactiveDays) && maxInactiveDays > 0
    ? maxInactiveDays
    : DEFAULT_MAX_INACTIVE_DAYS;
  const inactiveCutoff = now - (maxInactive * 24 * 60 * 60 * 1000);

  try {
    await getKnownServerIds();

    const userRows = db.prepare(`
      SELECT user_id, MAX(last_active_at) AS last_active_at
      FROM players
      GROUP BY user_id
    `).all();

    const processedUsers = new Set();

    for (const row of userRows) {
      const userId = row.user_id;
      if (!userId || processedUsers.has(userId)) continue;
      processedUsers.add(userId);

      if (row.last_active_at && row.last_active_at < inactiveCutoff) continue;

      const preferredServerId = getLatestServerIdForUser(db, userId) ?? "global";
      await trySendReminderForUser(client, userId, {
        preferredServerId,
        now,
        todayKey,
        force: false
      });
    }
  } finally {
    isRunning = false;
  }
}

export async function triggerDailyRewardReminderTest(client, userId, { force = true } = {}) {
  if (!db) return { ok: false, reason: "db_unavailable" };
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return { ok: false, reason: "missing_user_id" };

  const now = nowTs();
  const todayKey = dayKeyUTC(now);
  const preferredServerId = getLatestServerIdForUser(db, normalizedUserId) ?? "global";
  const result = await trySendReminderForUser(client, normalizedUserId, {
    preferredServerId,
    now,
    todayKey,
    force
  });

  return {
    ...result,
    userId: normalizedUserId,
    force,
    todayKey
  };
}

export function startDailyRewardReminderScheduler(client, getKnownServerIds) {
  if (!db) return;
  const cronExpr = process.env.NOODLE_DAILY_REMINDER_CRON || DEFAULT_CRON;

  setTimeout(() => {
    sendDailyRewardReminders(client, getKnownServerIds).catch(() => {});
  }, 20_000);

  cron.schedule(cronExpr, async () => {
    await sendDailyRewardReminders(client, getKnownServerIds);
  }, { timezone: "UTC" });
}
