import cron from "node-cron";
import discordPkg from "discord.js";
import { openDb, getPlayer, getLatestServerIdForUser, upsertPlayer } from "../db/index.js";
import { dayKeyUTC, nowTs } from "../util/time.js";
import { hasDailyRewardAvailable } from "../game/daily.js";
import { theme } from "../ui/theme.js";
import { getIcon, getButtonEmoji } from "../ui/icons.js";

const {
  MessageActionRow,
  MessageButton,
  MessageEmbed,
  Constants
} = discordPkg;

const ActionRowBuilder = MessageActionRow;
const ButtonBuilder = MessageButton;
const EmbedBuilder = MessageEmbed;
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

function ownerFooterText(user) {
  const tag = user?.tag ?? user?.username ?? "Unknown";
  return `Owner: ${tag}`;
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

function buildReminderEmbed({ guildName, channelLine, claimLine, user }) {
  return new EmbedBuilder()
    .setTitle(`Daily Noodle Mail ${getIcon("mail")}`)
    .setDescription([
      `New orders are on the board today, come back to serve your regulars! ${getIcon("regulars")}`,
      `\nYour daily reward is also ready!`,
      channelLine ? `${channelLine}` : null,
      claimLine,
      "\nDisable reminders below."
    ].filter(Boolean).join("\n"))
    .setColor(theme.colors.primary)
    .setFooter({ text: ownerFooterText(user) });
}

function normalizeNotifications(player) {
  if (!player.notifications) {
    player.notifications = {
      pending_pantry_messages: [],
      dm_reminders_opt_out: false,
      last_daily_reminder_day: null,
      last_noodle_channel_id: null,
      last_noodle_guild_id: null
    };
  }
  if (!Array.isArray(player.notifications.pending_pantry_messages)) {
    player.notifications.pending_pantry_messages = [];
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
      const player = getPlayer(db, preferredServerId, userId);
      if (!player) continue;

      normalizeNotifications(player);

      if (player.notifications.dm_reminders_opt_out === true) continue;
      if (!hasDailyRewardAvailable(player, now)) continue;
      if (player.notifications.last_daily_reminder_day === todayKey) continue;

      const user = await client.users.fetch(userId).catch(() => null);
      if (!user) continue;

      const lastGuildId = player.notifications.last_noodle_guild_id ?? preferredServerId;
      const guildName = lastGuildId && lastGuildId !== "global"
        ? (client.guilds.cache.get(lastGuildId)?.name ?? "this server")
        : "your last server";
      const channelId = player.notifications.last_noodle_channel_id ?? null;
      const channelUrl = channelId && lastGuildId && lastGuildId !== "global"
        ? `https://discord.com/channels/${lastGuildId}/${channelId}`
        : null;
      const channelLine = channelId ? `<#${channelId}>` : null;
      const claimLine = `Use /noodle quests_daily to claim your daily reward.`;
      const embed = buildReminderEmbed({ guildName, channelLine, claimLine, user });
      const components = buildDmReminderComponents({
        userId,
        serverId: lastGuildId || preferredServerId,
        channelUrl,
        optOut: false
      });

      try {
        await user.send({ embeds: [embed], components });
        player.notifications.last_daily_reminder_day = todayKey;
        upsertPlayer(db, preferredServerId, userId, player, null, player.schema_version ?? 1);
      } catch {
        // ignore DM failures
      }
    }
  } finally {
    isRunning = false;
  }
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
