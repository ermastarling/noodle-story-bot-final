import cron from "node-cron";
import discordPkg from "discord.js";
import { openDb, upsertPlayer } from "../db/index.js";
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

function buildReminderEmbed({ guildName, channelLine }) {
  return new EmbedBuilder()
    .setTitle(`${getIcon("mail")} Daily Reward Ready`)
    .setDescription([
      `Your daily reward is ready in **${guildName}**!`,
      "",
      channelLine,
      "\nDisable reminders below."
    ].filter(Boolean).join("\n"))
    .setColor(theme.colors.primary);
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
    const serverIds = await getKnownServerIds();
    for (const serverId of serverIds) {
      const rows = db.prepare(`
        SELECT user_id, data_json, schema_version, last_active_at
        FROM players
        WHERE server_id = ?
      `).all(serverId);

      for (const row of rows) {
        if (row.last_active_at && row.last_active_at < inactiveCutoff) continue;

        const player = { ...JSON.parse(row.data_json), user_id: row.user_id };
        normalizeNotifications(player);

        if (player.notifications.dm_reminders_opt_out === true) continue;
        if (!hasDailyRewardAvailable(player, now)) continue;
        if (player.notifications.last_daily_reminder_day === todayKey) continue;

        const user = await client.users.fetch(row.user_id).catch(() => null);
        if (!user) continue;

        const lastGuildId = player.notifications.last_noodle_guild_id ?? serverId;
        const lastGuildName = client.guilds.cache.get(lastGuildId)?.name ?? "this server";
        const channelId = player.notifications.last_noodle_channel_id ?? null;
        const channel = channelId ? client.channels.cache.get(channelId) : null;
        const isChannelAccessible = Boolean(channel && channel.guild?.id === lastGuildId);
        const channelUrl = isChannelAccessible
          ? `https://discord.com/channels/${lastGuildId}/${channelId}`
          : null;
        const channelLine = channelId
          ? (isChannelAccessible
            ? `Last kitchen: <#${channelId}>.`
            : "Last kitchen: unavailable. Use `/noodle orders` to continue.")
          : null;
        const embed = buildReminderEmbed({ guildName: lastGuildName, channelLine });
        const components = buildDmReminderComponents({
          userId: row.user_id,
          serverId,
          channelUrl,
          optOut: false
        });

        try {
          await user.send({ embeds: [embed], components });
          player.notifications.last_daily_reminder_day = todayKey;
          upsertPlayer(db, serverId, row.user_id, player, null, row.schema_version ?? 1);
        } catch {
          // ignore DM failures
        }
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
