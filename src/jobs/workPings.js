import cron from "node-cron";
import { openDb } from "../db/index.js";
import { buildComponentsV2PayloadWithNoticeCards, rawChannelSendMessage } from "../ui/componentsV2.js";
import { ensureClientToken } from "../util/clientToken.js";
import { loadWorkPingContent } from "../content/index.js";
import { runWithTelemetry } from "../infra/telemetry.js";
import {
  claimScheduledMessageDelivery,
  completeScheduledMessageDelivery,
  markScheduledMessageDeliveryUnknown,
  markStaleScheduledDeliveriesUnknown
} from "./scheduledDelivery.js";

let scheduler = null;
export const WORK_PING_SCHEDULE = "0 0,2,4,6,8,10,12,14,16,18,20,22 * * *";
export const WORK_PING_TIMEZONE = "UTC";

function isDiscordSnowflake(value) {
  return /^\d{17,20}$/.test(String(value || "").trim());
}

export function resolveWorkPingSettings(env = process.env) {
  if (String(env.NOODLE_WORK_PING_ENABLED || "").trim() !== "1") {
    return { ok: false, reason: "disabled" };
  }
  if (String(env.NOODLE_WORK_PING_COPY_APPROVED || "").trim() !== "1") {
    return { ok: false, reason: "copy_not_approved" };
  }

  const canary = String(env.NOODLE_OFFICIAL_FEATURE_CANARY ?? "1").trim() !== "0";
  const officialGuildId = String(env.NOODLE_OFFICIAL_GUILD_ID || env.DISCORD_GUILD_ID || "").trim();
  const workChannelId = String(env.NOODLE_WORK_CHANNEL_ID || "").trim();
  if (!isDiscordSnowflake(officialGuildId)) return { ok: false, reason: "missing_official_guild" };
  if (!isDiscordSnowflake(workChannelId)) return { ok: false, reason: "missing_work_channel" };

  if (canary) {
    if (String(env.NOODLE_OFFICIAL_FEATURE_CANARY_PRIVATE_VERIFIED || "").trim() !== "1") {
      return { ok: false, reason: "canary_privacy_not_verified" };
    }
    const channelId = String(env.NOODLE_DEV_ALERT_CHANNEL_ID || "").trim();
    if (!isDiscordSnowflake(channelId)) return { ok: false, reason: "missing_canary_channel" };
    return { ok: true, canary, channelId, officialGuildId, workChannelId, roleId: null };
  }

  if (String(env.NOODLE_WORK_PING_PRODUCTION_ENABLED || "").trim() !== "1") {
    return { ok: false, reason: "production_not_approved" };
  }
  const channelId = String(env.NOODLE_WORK_PING_CHANNEL_ID || "").trim();
  const roleId = String(env.NOODLE_WORK_PING_ROLE_ID || "").trim();
  if (!isDiscordSnowflake(channelId)) return { ok: false, reason: "missing_production_channel" };
  if (!isDiscordSnowflake(roleId)) return { ok: false, reason: "missing_work_role" };
  return { ok: true, canary, channelId, officialGuildId, workChannelId, roleId };
}

export function buildWorkPingPayload({ settings, copy = loadWorkPingContent() } = {}) {
  if (!settings?.ok) throw new Error("Cannot build a work ping without validated settings");
  const roleMention = settings.canary ? "" : `<@&${settings.roleId}>\n`;
  const template = String(copy?.message ?? "").replaceAll("{{work_channel}}", `<#${settings.workChannelId}>`);
  const hasRolePlaceholder = template.includes("<@work ping>");
  const message = hasRolePlaceholder
    ? template.replaceAll("<@work ping>", settings.canary ? "" : `<@&${settings.roleId}>`)
    : `${roleMention}${template}`;
  const components = buildComponentsV2PayloadWithNoticeCards({
    mainComponents: [
      { type: 10, content: `## ${String(copy?.title ?? "Work Ping")}` },
      { type: 10, content: message }
    ],
    ephemeral: false,
    includeGreenButtonTip: false
  });
  components.allowed_mentions = {
    parse: [],
    roles: settings.roleId ? [settings.roleId] : []
  };
  return components;
}

function isMissingMessageError(error) {
  return Number(error?.code ?? error?.rawError?.code) === 10008 || Number(error?.status) === 404;
}

export function startWorkPingScheduler({ client, env = process.env, logger = console } = {}) {
  if (scheduler) return scheduler;
  if (!client) throw new Error("startWorkPingScheduler requires a Discord client");

  const settings = resolveWorkPingSettings(env);
  if (!settings.ok) {
    if (settings.reason !== "disabled") {
      logger.warn(`Work pings are not starting (${settings.reason}).`);
    }
    return null;
  }

  const db = openDb();
  if (!db) {
    logger.error("Work pings are enabled but the database is unavailable.");
    return null;
  }
  let running = false;
  const runOnce = async (reason = "interval") => {
    if (running) return "skipped";
    running = true;
    try {
      markStaleScheduledDeliveriesUnknown(db);
      ensureClientToken(client, env);
      const [targetChannel, workChannel] = await Promise.all([
        client.channels.fetch(settings.channelId),
        client.channels.fetch(settings.workChannelId)
      ]);
      for (const [label, channel] of [["ping", targetChannel], ["work", workChannel]]) {
        if (!channel || String(channel.guildId || "") !== settings.officialGuildId) {
          throw new Error(`Configured ${label} channel is not in the official guild`);
        }
      }
      if (!claimScheduledMessageDelivery(db, "work_ping", Date.now(), settings.channelId)) {
        const delivery = db.prepare(
          "SELECT status FROM scheduled_message_delivery WHERE job_id = ?"
        ).get("work_ping");
        logger.error(`Work ping is not posting because its prior delivery state is ${delivery?.status ?? "unavailable"}; verify Discord before manually clearing the delivery state.`);
        return false;
      }
      const previous = db.prepare(
        "SELECT channel_id, message_id FROM scheduled_message_state WHERE job_id = ?"
      ).get("work_ping");
      if (previous?.message_id && previous?.channel_id) {
        try {
          const oldChannel = await client.channels.fetch(previous.channel_id);
          if (!oldChannel?.messages?.delete) {
            throw new Error("Previous work ping channel does not support message deletion");
          }
          await oldChannel.messages.delete(previous.message_id);
        } catch (error) {
          if (!isMissingMessageError(error)) throw error;
        }
      }

      const sent = await rawChannelSendMessage(
        client,
        settings.channelId,
        buildWorkPingPayload({ settings }),
        { botToken: env.DISCORD_TOKEN || "" }
      );
      const messageId = String(sent?.id ?? "").trim();
      if (!messageId) throw new Error("Discord did not return a message ID for the work ping");
      db.prepare(`
        INSERT INTO scheduled_message_state (job_id, channel_id, message_id, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(job_id) DO UPDATE SET
          channel_id = excluded.channel_id,
          message_id = excluded.message_id,
          updated_at = excluded.updated_at
      `).run("work_ping", settings.channelId, messageId, Date.now());
      completeScheduledMessageDelivery(db, "work_ping");
      logger.info(`Work ping posted (${reason}) to channel ${settings.channelId}.`);
      return true;
    } catch (error) {
      markScheduledMessageDeliveryUnknown(db, "work_ping");
      logger.error(`Work ping failed (${reason}).`, error);
      return false;
    } finally {
      running = false;
    }
  };

  const task = cron.schedule(WORK_PING_SCHEDULE, () => (
    runWithTelemetry("work_ping", "scheduled", () => runOnce("scheduled"))
  ), { timezone: WORK_PING_TIMEZONE });
  const recoveryTask = cron.schedule("*/5 * * * *", () => {
    try {
      markStaleScheduledDeliveriesUnknown(db);
    } catch (error) {
      logger.error("Work-ping delivery recovery check failed.", error);
    }
  }, { timezone: "UTC" });
  scheduler = {
    runOnce,
    stop() {
      task.stop();
      recoveryTask.stop();
      scheduler = null;
    }
  };
  return scheduler;
}
