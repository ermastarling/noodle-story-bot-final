import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";
import zlib from "zlib";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "url";
import { REST } from "@discordjs/rest";
import { getIcon } from "./ui/icons.js";
import { theme } from "./ui/theme.js";

(async () => {
  // Import discord.js
  const Discord = await import("discord.js").then(m => m.default || m);
  
  const Client = Discord.Client;
  const Intents = Discord.Intents;
  const MessageFlags = Discord.MessageFlags;

  if (!Client || !Intents) {
    console.error("❌ Failed to load discord.js properly");
    console.error("Discord exports:", Object.keys(Discord).slice(0, 20));
    process.exit(1);
  }

  // Now import the rest
  const { commandMap, commands } = await import("./commands/index.js");
  const { startDailyResetScheduler } = await import("./jobs/dailyReset.js");
  const { startDailyRewardReminderScheduler } = await import("./jobs/dailyRewardReminders.js");
  const { startEventSyncScheduler } = await import("./jobs/eventSync.js");
  const { startDbBackupScheduler, runDbBackup } = await import("./jobs/backupDb.js");
  const { startDbMaintenanceScheduler } = await import("./jobs/dbMaintenance.js");
  const {
    loadContentBundle,
    loadSettingsCatalog,
    loadBadgesContent,
    loadSpecializationsContent,
    loadDecorSetsContent,
    loadEventsContent
  } = await import("./content/index.js");
  const {
    openDb,
    getPlayer,
    getPlayerLite,
    withPlayerCache,
    upsertPlayer,
    getLatestServerIdForUser,
    recordRecentSocialInteraction,
    recordStorePurchaseEvent,
    getAllTimeSpecializationPurchaseCount
  } = await import("./db/index.js");
  const { checkRateLimit } = await import("./infra/rateLimit.js");
  const { emitTelemetry } = await import("./infra/telemetry.js");
  const { withInteractionPerf, getInteractionPerfSnapshot } = await import("./infra/perfMetrics.js");
  const { getIdempotentResult, putIdempotentResult } = await import("./infra/idempotency.js");
  const { newPlayerProfile } = await import("./game/player.js");
  const { STARTER_PROFILE } = await import("./constants.js");
  const { FORAGE_ITEM_IDS } = await import("./game/forage.js");
  const { isFishingUnlocked, FISHING_ITEM_IDS, FISHING_RECIPE_IDS } = await import("./game/fishing.js");
  const { getKitchenUnlockState, KITCHEN_BROTH_RECIPES } = await import("./game/kitchen.js");
  const { getCustomEmojiEntries } = await import("./ui/icons.js");
  const { grantStoreBundle, resolveStoreBundleSpecId } = await import("./game/storeBundles.js");
  const { ensureSpecializationState, getSpecializationById } = await import("./game/specialization.js");
  const { getAvailableRecipes } = await import("./game/resilience.js");
  const {
    registerVoteFromSource,
    VOTE_SOURCES
  } = await import("./game/voteRewards.js");
  const { noodleCommand } = await import("./commands/noodle.js");
  const { noodleDevCommand } = await import("./commands/noodleDev.js");
  const { noodleSocialCommand } = await import("./commands/noodleSocial.js");
  const { noodleStaffCommand, noodleStaffHandler, noodleStaffInteractionHandler } = await import("./commands/noodleStaff.js");
  const { noodleUpgradesCommand, noodleUpgradesHandler, noodleUpgradesInteractionHandler } = await import("./commands/noodleUpgrades.js");

  const MAX_FIELD = 1024;
  const SAFE_SLICE = 900;
  const MAX_DESC = 4000;

  const chunkTextByLength = (text, maxLen = SAFE_SLICE) => {
    if (!text) return [];
    const lines = String(text).split("\n");
    const chunks = [];
    let buf = "";
    for (const line of lines) {
      const next = buf ? `${buf}\n${line}` : line;
      if (next.length > maxLen && buf) {
        chunks.push(buf);
        buf = line;
      } else if (next.length > maxLen) {
        chunks.push(next.slice(0, maxLen));
        buf = next.slice(maxLen);
      } else {
        buf = next;
      }
    }
    if (buf) chunks.push(buf);
    return chunks.filter(Boolean);
  };

  const sanitizeEmbedsForDiscord = (embeds) => {
    if (!Array.isArray(embeds)) return embeds;

    const chunkField = (field) => {
      const name = field?.name ?? " ";
      const inline = field?.inline ?? false;
      const value = field?.value ?? "";
      if (!value || String(value).length <= MAX_FIELD) return [{ name, value, inline }];
      const parts = chunkTextByLength(String(value), SAFE_SLICE);
      return parts.map((part, idx) => ({
        name: idx === 0 ? name : `${name} (cont.)`,
        value: part,
        inline
      }));
    };

    const EmbedCtor = Discord.EmbedBuilder || Discord.MessageEmbed || null;

    return embeds.map((embed) => {
      if (!embed) return embed;
      const safe = embed.toJSON && EmbedCtor ? new EmbedCtor(embed) : embed;
      const fields = safe?.data?.fields || safe?.fields || [];
      if (fields.length) {
        const newFields = fields.flatMap((f) => chunkField(f));
        if (safe.spliceFields) safe.spliceFields(0, safe.fields?.length ?? fields.length, ...newFields);
        else safe.fields = newFields;
      }

      const desc = safe?.data?.description ?? safe?.description ?? "";
      if (desc && desc.length > MAX_DESC && safe.setDescription) {
        const truncated = desc.slice(0, MAX_DESC);
        safe.setDescription(`${truncated}\n\n(Description truncated)`);
      }

      return safe;
    });
  };

  const sanitizeResultEmbeds = (payload) => {
    if (!payload) return payload;
    const next = { ...payload };
    if (next.embeds) {
      next.embeds = sanitizeEmbedsForDiscord(next.embeds);
    }
    return next;
  };

  /* ------------------------------------------------------------------ */
  /*  Boot + diagnostics                                                 */
  /* ------------------------------------------------------------------ */

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const CWD = process.cwd();
  const LOG_DIR = path.join(CWD, "noodle-logs");

  const resolveLogPath = (configuredPath, fallbackFileName) => {
    if (!configuredPath || !String(configuredPath).trim()) {
      return path.join(LOG_DIR, fallbackFileName);
    }
    const normalized = String(configuredPath).trim();
    if (path.isAbsolute(normalized)) return normalized;
    return path.join(LOG_DIR, normalized);
  };

  const LOG_PATH = path.join(LOG_DIR, "command-errors.log");
  const WEBHOOK_LOG_PATH = resolveLogPath(process.env.NOODLE_WEBHOOK_LOG_FILE, "webhooks.log");
  const WEBHOOK_LOG_TO_CONSOLE = process.env.NOODLE_WEBHOOK_LOG_TO_CONSOLE === "1";
  const BOOT_PATH = path.join(LOG_DIR, "boot-ok.log");
  const USER_ERROR_DIR = path.join(LOG_DIR, "user-error-logs");
  const USER_ERROR_RETENTION_DAYS = 14;
  const USER_ERROR_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
  let lastUserErrorCleanup = 0;
  let errorLog = null;
  let errorLogEnabled = false;
  let errorLogNeedsDrain = false;
  let errorLogFailureNotified = false;
  let webhookFileLoggingEnabled = false;
  let webhookLogNeedsDrain = false;
  let webhookWriteFailureNotified = false;
  const origError = console.error;

  fs.mkdirSync(LOG_DIR, { recursive: true });

  try {
    errorLog = fs.createWriteStream(LOG_PATH, { flags: "a" });
    errorLogEnabled = true;
    errorLog.on("drain", () => {
      errorLogNeedsDrain = false;
    });
    errorLog.on("error", (error) => {
      errorLogEnabled = false;
      errorLog = null;
      errorLogNeedsDrain = false;
      if (!errorLogFailureNotified) {
        errorLogFailureNotified = true;
        origError("Command error log stream disabled:", error?.message ?? error);
      }
    });
  } catch (error) {
    errorLogEnabled = false;
    errorLog = null;
    errorLogNeedsDrain = false;
  }
  let webhookLogStream = null;
  if (process.env.NOODLE_WEBHOOK_PORT) {
    try {
      fs.mkdirSync(path.dirname(WEBHOOK_LOG_PATH), { recursive: true });
      webhookLogStream = fs.createWriteStream(WEBHOOK_LOG_PATH, { flags: "a" });
      webhookFileLoggingEnabled = true;
      webhookLogStream.on("drain", () => {
        webhookLogNeedsDrain = false;
      });
      webhookLogStream.on("error", (error) => {
        webhookFileLoggingEnabled = false;
        webhookLogStream = null;
        webhookLogNeedsDrain = false;
        console.error("Webhook log stream error:", error?.message ?? error);
      });
    } catch (error) {
      webhookFileLoggingEnabled = false;
      webhookLogStream = null;
      webhookLogNeedsDrain = false;
      console.error("Failed to initialize webhook log file:", error?.message ?? error);
    }
  }

  const formatErrorLogPart = (arg) => {
    if (typeof arg === "string") return arg;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  };

  console.error = (...args) => {
    origError(...args);
    if (!errorLogEnabled || !errorLog) return;
    if (errorLogNeedsDrain) return;
    try {
      const line = args
        .map((arg) => formatErrorLogPart(arg))
        .join(" ");
      const accepted = errorLog.write(`[${new Date().toISOString()}] ${line}\n`);
      if (!accepted) errorLogNeedsDrain = true;
    } catch (error) {
      errorLogEnabled = false;
      errorLog = null;
      errorLogNeedsDrain = false;
      if (!errorLogFailureNotified) {
        errorLogFailureNotified = true;
        origError("Command error log stream disabled:", error?.message ?? error);
      }
    }
  };

  const formatLogPart = (arg) => {
    if (typeof arg === "string") return arg;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  };

  const writeWebhookConsole = (level, args) => {
    if (level === "error") {
      console.error(...args);
      return;
    }
    if (level === "warn") {
      console.warn(...args);
      return;
    }
    console.log(...args);
  };

  function writeWebhookLog(level, args) {
    const canWriteFile = webhookFileLoggingEnabled && webhookLogStream;
    if (!canWriteFile) {
      // If file logging is unavailable, keep webhook diagnostics visible in console.
      writeWebhookConsole(level, args);
      return;
    }

    try {
      if (!webhookLogNeedsDrain) {
        const line = args.map(formatLogPart).join(" ");
        const accepted = webhookLogStream.write(`[${new Date().toISOString()}] [${level.toUpperCase()}] ${line}\n`);
        if (!accepted) webhookLogNeedsDrain = true;
      } else if (level === "error") {
        // Keep webhook errors visible when file writes are temporarily dropped under backpressure.
        writeWebhookConsole(level, args);
      }
    } catch (error) {
      webhookFileLoggingEnabled = false;
      webhookLogStream = null;
      webhookLogNeedsDrain = false;
      if (!webhookWriteFailureNotified) {
        webhookWriteFailureNotified = true;
        console.error("Webhook log file disabled after write failure:", error?.message ?? error);
      }
      writeWebhookConsole(level, args);
      return;
    }

    if (WEBHOOK_LOG_TO_CONSOLE && level === "error") {
      writeWebhookConsole(level, args);
    }
  }

  const webhookInfo = (...args) => writeWebhookLog("info", args);
  const webhookWarn = (...args) => writeWebhookLog("warn", args);
  const webhookError = (...args) => writeWebhookLog("error", args);

  console.log("✅ BOOTING FILE:", __filename);
  console.log("✅ CWD:", CWD);

  function getDateKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
  }

  function cleanupUserErrorLogs(now = new Date()) {
    const nowMs = now.getTime();
    if (nowMs - lastUserErrorCleanup < USER_ERROR_CLEANUP_INTERVAL_MS) return;
    lastUserErrorCleanup = nowMs;

    try {
      fs.mkdirSync(USER_ERROR_DIR, { recursive: true });
      const cutoff = new Date(now);
      cutoff.setUTCDate(cutoff.getUTCDate() - USER_ERROR_RETENTION_DAYS);
      const entries = fs.readdirSync(USER_ERROR_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
        const dirDate = new Date(`${entry.name}T00:00:00Z`);
        if (Number.isNaN(dirDate.getTime())) continue;
        if (dirDate < cutoff) {
          fs.rmSync(path.join(USER_ERROR_DIR, entry.name), { recursive: true, force: true });
        }
      }
    } catch (err) {
      console.error("❌ Failed to cleanup user error logs:", err?.stack ?? err);
    }
  }

  function logUserError(interaction, label, detail) {
    const userId = interaction?.user?.id ?? interaction?.member?.user?.id ?? "unknown";
    const guildId = interaction?.guildId ?? "dm";
    const commandName = interaction?.commandName ?? interaction?.customId ?? "unknown";

    try {
      cleanupUserErrorLogs();
      const dateDir = path.join(USER_ERROR_DIR, getDateKey());
      fs.mkdirSync(dateDir, { recursive: true });
      const filePath = path.join(dateDir, `${userId}.log`);
      const line = `[${new Date().toISOString()}] ${label} guild=${guildId} cmd=${commandName}\n${detail}\n`;
      fs.appendFileSync(filePath, `${line}\n`);
    } catch (err) {
      console.error("❌ Failed to write user error log:", err?.stack ?? err);
    }
  }

  function friendlyErrorMessage(err) {
    const code = err?.code || err?.name || "";
    const message = String(err?.message || "").toLowerCase();

    if (code === 10062 || message.includes("unknown interaction")) {
      return "That action expired. Please press a button again.";
    }
    if (code === "LOCK_BUSY" || code === "ERR_LOCK_BUSY") {
      return "Your shop is already busy. Try again in a moment.";
    }
    if (message.includes("rate limit") || code === "RATE_LIMITED") {
      return "You're going too fast, please slow down and try again.";
    }
    if (message.includes("missing access") || message.includes("missing permissions")) {
      return "I don't have permission to reply in this channel. Try a different channel or update Discord permissions.";
    }
    if (message.includes("could not find the requested resource") || message.includes("unknown channel")) {
      return "I couldn't find that channel. Try again from a visible channel.";
    }
    if (code === "INTERACTION_ALREADY_REPLIED") {
      return "That interaction was already handled. Use the latest buttons or run the command again.";
    }

    return "Something went a little sideways. Please try again.";
  }

  function isMissingAccessError(err) {
    if (!err) return false;

    const codeCandidates = [
      err?.code,
      err?.status,
      err?.rawError?.code,
      err?.requestBody?.code
    ];
    const numericCode = codeCandidates
      .map((value) => Number(value))
      .find((value) => Number.isFinite(value));

    if (numericCode === 50001 || numericCode === 50013) {
      return true;
    }

    const text = [
      err?.message,
      err?.name,
      err?.rawError?.message,
      err?.data?.message
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return text.includes("missing access") || text.includes("missing permission");
  }

  async function sendMissingAccessDm(interaction) {
    const user = interaction?.user;
    if (!user?.send) return false;

    const guildName = interaction?.guild?.name || "this server";
    const channelRef = interaction?.channelId ? `<#${interaction.channelId}>` : "that channel";
    const commandLabel = interaction?.commandName ? `/${interaction.commandName}` : "that action";

    const EmbedCtor = Discord.EmbedBuilder || Discord.MessageEmbed || null;
    const description = [
      `I could not send a response for **${commandLabel}** in ${channelRef} on **${guildName}**.`,
      "",
      "I am missing channel access there.",
      "Please try another channel or ask a server admin to grant me **View Channel**, **Send Messages**, and **Embed Links** permissions.",
      ""
    ].join("\n");

    const embed = EmbedCtor
      ? new EmbedCtor()
        .setTitle(`Access Alert ${getIcon("warning")}`)
        .setDescription(description)
        .setColor(theme.colors.primary)
        .setFooter({ text: `Owner: ${user?.tag ?? user?.username ?? "Unknown"}` })
      : null;

    try {
      if (embed) {
        await user.send({ embeds: [embed] });
      } else {
        await user.send({ content: description.replace(/\*\*/g, "") });
      }
      return true;
    } catch (error) {
      console.error("Missing-access DM fallback failed:", error?.message ?? error);
      return false;
    }
  }

  async function sendInteractionErrorWithFallback(interaction, message, originalError) {
    try {
      if (interaction.replied || interaction.deferred) {
        try {
          await interaction.deleteReply();
        } catch (_) {
          // Ignore when there is no editable reply to clear.
        }
        await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral, ephemeral: true });
      } else {
        await interaction.reply({ content: message, flags: MessageFlags.Ephemeral, ephemeral: true });
      }
      return true;
    } catch (replyErr) {
      console.error("Failed to send interaction error reply:", replyErr?.message ?? replyErr);
      if (isMissingAccessError(originalError) || isMissingAccessError(replyErr)) {
        await sendMissingAccessDm(interaction);
      }
      return false;
    }
  }

  process.on("unhandledRejection", (reason) => {
    console.error("UNHANDLED REJECTION:", reason?.stack ?? reason);
  });

  process.on("uncaughtException", (err) => {
    console.error("UNCAUGHT EXCEPTION:", err?.stack ?? err);
  });

  /* ------------------------------------------------------------------ */
  /*  Client setup                                                       */
  /* ------------------------------------------------------------------ */

  const token = process.env.DISCORD_TOKEN;
  const officialGuildId = process.env.NOODLE_OFFICIAL_GUILD_ID || process.env.DISCORD_GUILD_ID || "";
  const parseCsvValues = (value) => String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const officialAutoReactEnabled = String(process.env.NOODLE_OFFICIAL_AUTOREACT_ENABLED || "1") !== "0";
  const officialAutoReactBotsOnly = String(process.env.NOODLE_OFFICIAL_AUTOREACT_BOTS_ONLY || "1") !== "0";
  const officialAutoReactKeywordMatchEnabled = String(process.env.NOODLE_OFFICIAL_AUTOREACT_MATCH_KEYWORDS || "0") === "1";
  const officialMessageContentIntentEnabled = String(process.env.NOODLE_OFFICIAL_ENABLE_MESSAGE_CONTENT_INTENT || "0") === "1";
  const officialWelcomeAutoReactEmojis = parseCsvValues(process.env.NOODLE_OFFICIAL_WELCOME_REACT_EMOJI || "👋");
  const officialLevelAutoReactEmojis = parseCsvValues(process.env.NOODLE_OFFICIAL_LEVEL_REACT_EMOJI || "🎉");
  const officialStatsChannelsEnabled = String(process.env.NOODLE_OFFICIAL_STATS_CHANNELS_ENABLED || "1") !== "0";
  let officialServerCountChannelId = String(process.env.NOODLE_OFFICIAL_SERVER_COUNT_CHANNEL_ID || "").trim();
  let officialShopCountChannelId = String(process.env.NOODLE_OFFICIAL_SHOP_COUNT_CHANNEL_ID || "").trim();
  let officialMemberCountChannelId = String(process.env.NOODLE_OFFICIAL_MEMBER_COUNT_CHANNEL_ID || "").trim();
  const officialServerCountLabel = String(process.env.NOODLE_OFFICIAL_SERVER_COUNT_LABEL || "Total Servers").trim() || "Total Servers";
  const officialShopCountLabel = String(process.env.NOODLE_OFFICIAL_SHOP_COUNT_LABEL || "Total Users").trim() || "Total Users";
  const officialMemberCountLabel = String(process.env.NOODLE_OFFICIAL_MEMBER_COUNT_LABEL || "Server Members").trim() || "Server Members";
  const officialStatsCategoryId = String(process.env.NOODLE_OFFICIAL_STATS_CATEGORY_ID || "").trim();
  const officialStatsChannelRefreshIntervalRaw = Number(process.env.NOODLE_OFFICIAL_STATS_CHANNEL_REFRESH_INTERVAL_MS || 10 * 60 * 1000);
  const officialStatsChannelRefreshIntervalMs = Number.isFinite(officialStatsChannelRefreshIntervalRaw)
    ? Math.max(60_000, Math.floor(officialStatsChannelRefreshIntervalRaw))
    : 10 * 60 * 1000;
  const officialStatsMinIntervalRaw = Number(process.env.NOODLE_OFFICIAL_STATS_MIN_INTERVAL_MS || officialStatsChannelRefreshIntervalMs);
  const officialStatsMinIntervalMs = Number.isFinite(officialStatsMinIntervalRaw) && officialStatsMinIntervalRaw >= 30_000
    ? Math.floor(officialStatsMinIntervalRaw)
    : officialStatsChannelRefreshIntervalMs;
  let officialStatsChannelRefreshHandle = null;
  const devAlertChannelId = process.env.NOODLE_DEV_ALERT_CHANNEL_ID || "";
  const devAlertUserId = process.env.NOODLE_DEV_ALERT_USER_ID || "";
  const sharedBotId = process.env.NOODLE_BOT_ID || process.env.TOPGG_BOT_ID || "1460058511802105976";
  const BOT_ID_FALLBACK = "1460058511802105976";
  const getVoteSourceToken = (...envNames) => {
    for (const name of envNames) {
      const value = process.env[name];
      if (value && String(value).trim()) return String(value).trim();
    }
    return "";
  };
  const voteWebhookConfigs = [
    {
      source: VOTE_SOURCES.TOPGG,
      label: "Top.gg",
      path: process.env.NOODLE_TOPGG_WEBHOOK_PATH || "/topgg/webhook",
      auth: getVoteSourceToken("NOODLE_TOPGG_WEBHOOK_AUTH", "TOPGG_WEBHOOK_AUTH")
    },
    {
      source: VOTE_SOURCES.RANKTOP,
      label: "Rank.top",
      path: process.env.NOODLE_RANKTOP_WEBHOOK_PATH || "/ranktop/webhook",
      auth: getVoteSourceToken("NOODLE_RANKTOP_WEBHOOK_AUTH")
    },
    {
      source: VOTE_SOURCES.DISCORDBOTLIST,
      label: "Discord Bot List",
      path: process.env.NOODLE_DISCORDBOTLIST_WEBHOOK_PATH || "/discordbotlist/webhook",
      auth: getVoteSourceToken("NOODLE_DISCORDBOTLIST_WEBHOOK_AUTH")
    },
    {
      source: VOTE_SOURCES.VOIDBOTS,
      label: "Void Bots",
      path: process.env.NOODLE_VOIDBOTS_WEBHOOK_PATH || "/voidbots/webhook",
      auth: getVoteSourceToken("NOODLE_VOIDBOTS_WEBHOOK_AUTH")
    },
    {
      source: VOTE_SOURCES.DISCORDS,
      label: "Discords.com",
      path: process.env.NOODLE_DISCORDS_WEBHOOK_PATH || "/discords/webhook",
      auth: getVoteSourceToken("NOODLE_DISCORDS_WEBHOOK_AUTH")
    },
    {
      source: VOTE_SOURCES.BOTLIST_ME,
      label: "BotList.me",
      path: process.env.NOODLE_BOTLISTME_WEBHOOK_PATH || "/botlistme/webhook",
      auth: getVoteSourceToken("NOODLE_BOTLISTME_WEBHOOK_AUTH")
    },
    {
      source: VOTE_SOURCES.STELLARBOTLIST,
      label: "Stellar Bot List",
      path: process.env.NOODLE_STELLARBOTLIST_WEBHOOK_PATH || "/stellarbotlist/webhook",
      auth: getVoteSourceToken("NOODLE_STELLARBOTLIST_WEBHOOK_AUTH")
    },
    {
      source: VOTE_SOURCES.DISCORDLIST_GG,
      label: "DiscordList.gg",
      path: process.env.NOODLE_DISCORDLISTGG_WEBHOOK_PATH || "/discordlistgg/webhook",
      auth: getVoteSourceToken("NOODLE_DISCORDLISTGG_WEBHOOK_AUTH")
    },
    {
      source: VOTE_SOURCES.RADAR_CPDV,
      label: "Radar.CPDV",
      path: process.env.NOODLE_RADARCPDV_WEBHOOK_PATH || "/radarcpdv/webhook",
      auth: getVoteSourceToken("NOODLE_RADARCPDV_WEBHOOK_AUTH")
    }
  ];
  const stableStatsEndpointDefaults = {
    [VOTE_SOURCES.TOPGG]: "https://top.gg/api/bots/{botId}/stats",
    [VOTE_SOURCES.RANKTOP]: "https://rank.top/api/bots/{botId}/post",
    [VOTE_SOURCES.DISCORDBOTLIST]: "https://discordbotlist.com/api/v1/bots/{botId}/stats",
    [VOTE_SOURCES.DISCORDBOTSGG]: "https://discord.bots.gg/api/v1/bots/{botId}/stats"
  };
  const stableCommandListEndpointDefaults = {
    [VOTE_SOURCES.DISCORDBOTLIST]: "https://discordbotlist.com/api/v1/bots/{botId}/commands",
    [VOTE_SOURCES.RADAR_CPDV]: "https://api.radarcord.net/bot/{botId}/commands",
    [VOTE_SOURCES.RANKTOP]: "https://rank.top/api/bots/{botId}/post"
  };
  const botListStatsConfigs = [
    {
      source: VOTE_SOURCES.TOPGG,
      label: "Top.gg",
      endpoint: process.env.NOODLE_TOPGG_STATS_URL || stableStatsEndpointDefaults[VOTE_SOURCES.TOPGG],
      token: getVoteSourceToken("NOODLE_TOPGG_TOKEN", "TOPGG_TOKEN", "TOPGG_API_TOKEN"),
      bodyFormat: "server_count"
    },
    {
      source: VOTE_SOURCES.RANKTOP,
      label: "Rank.top",
      endpoint: process.env.NOODLE_RANKTOP_STATS_URL || stableStatsEndpointDefaults[VOTE_SOURCES.RANKTOP],
      token: getVoteSourceToken("NOODLE_RANKTOP_TOKEN"),
      authScheme: "bearer"
    },
    {
      source: VOTE_SOURCES.DISCORDBOTLIST,
      label: "Discord Bot List",
      endpoint: process.env.NOODLE_DISCORDBOTLIST_STATS_URL || stableStatsEndpointDefaults[VOTE_SOURCES.DISCORDBOTLIST],
      token: getVoteSourceToken("NOODLE_DISCORDBOTLIST_TOKEN"),
      bodyFormat: "discordbotlist_stats"
    },
    {
      source: VOTE_SOURCES.VOIDBOTS,
      label: "Void Bots",
      endpoint: process.env.NOODLE_VOIDBOTS_STATS_URL || "",
      token: getVoteSourceToken("NOODLE_VOIDBOTS_TOKEN")
    },
    {
      source: VOTE_SOURCES.DISCORDS,
      label: "Discords.com",
      endpoint: process.env.NOODLE_DISCORDS_STATS_URL || "",
      token: getVoteSourceToken("NOODLE_DISCORDS_TOKEN")
    },
    {
      source: VOTE_SOURCES.BOTLIST_ME,
      label: "BotList.me",
      endpoint: process.env.NOODLE_BOTLISTME_STATS_URL || "",
      token: getVoteSourceToken("NOODLE_BOTLISTME_TOKEN"),
      enabled: String(process.env.NOODLE_BOTLISTME_SYNC_STATS || "1") !== "0"
    },
    {
      source: VOTE_SOURCES.DISCORDBOTSGG,
      label: "Discord.Bots.gg",
      endpoint: process.env.NOODLE_DISCORDBOTSGG_STATS_URL || stableStatsEndpointDefaults[VOTE_SOURCES.DISCORDBOTSGG],
      token: getVoteSourceToken("NOODLE_DISCORDBOTSGG_TOKEN"),
      bodyFormat: "discordbotsgg_stats"
    },
    {
      source: VOTE_SOURCES.DISCORDLIST_GG,
      label: "DiscordList.gg",
      endpoint: process.env.NOODLE_DISCORDLISTGG_STATS_URL || "",
      token: getVoteSourceToken("NOODLE_DISCORDLISTGG_TOKEN")
    },
    {
      source: VOTE_SOURCES.RADAR_CPDV,
      label: "Radar.CPDV",
      endpoint: process.env.NOODLE_RADARCPDV_STATS_URL || "",
      token: getVoteSourceToken("NOODLE_RADARCPDV_TOKEN"),
      enabled: String(process.env.NOODLE_RADARCPDV_SYNC_STATS || "1") !== "0"
    },
    {
      source: VOTE_SOURCES.DISCORDEXTREME_LIST,
      label: "Discord Extreme List",
      endpoint: process.env.NOODLE_DISCORDEXTREMELIST_STATS_URL || "",
      token: getVoteSourceToken("NOODLE_DISCORDEXTREMELIST_TOKEN"),
      bodyFormat: "discordextremelist_stats"
    }
  ];
  const DEFAULT_SHARD_GUILD_THRESHOLD = 2500;
  const shardThresholdRaw = Number(process.env.NOODLE_SHARD_GUILD_THRESHOLD || DEFAULT_SHARD_GUILD_THRESHOLD);
  const shardAlertRatioRaw = Number(process.env.NOODLE_SHARD_ALERT_RATIO || 0.8);
  const shardGuildThreshold = Number.isFinite(shardThresholdRaw) && shardThresholdRaw > 0
    ? Math.floor(shardThresholdRaw)
    : DEFAULT_SHARD_GUILD_THRESHOLD;
  const shardAlertRatio = Number.isFinite(shardAlertRatioRaw) && shardAlertRatioRaw > 0 && shardAlertRatioRaw <= 1
    ? shardAlertRatioRaw
    : 0.8;
  const shardAlertThreshold = Math.max(1, Math.floor(shardGuildThreshold * shardAlertRatio));
  const botListStatsSyncIntervalRaw = Number(process.env.NOODLE_BOTLIST_STATS_SYNC_INTERVAL_MS || 60 * 60 * 1000);
  const botListStatsSyncIntervalMs = Number.isFinite(botListStatsSyncIntervalRaw) && botListStatsSyncIntervalRaw >= 60_000
    ? Math.floor(botListStatsSyncIntervalRaw)
    : 60 * 60 * 1000;
  const botListStatsMinIntervalRaw = Number(process.env.NOODLE_BOTLIST_STATS_MIN_INTERVAL_MS || 60 * 60 * 1000);
  const botListStatsMinIntervalMs = Number.isFinite(botListStatsMinIntervalRaw) && botListStatsMinIntervalRaw >= 30_000
    ? Math.floor(botListStatsMinIntervalRaw)
    : 60 * 60 * 1000;
  const topggRequireSignature = String(process.env.NOODLE_TOPGG_REQUIRE_SIGNATURE || "0") === "1";
  const voteDuplicateWindowMode = String(process.env.NOODLE_VOTE_DUPLICATE_WINDOW_MODE || "sliding").trim().toLowerCase() === "fixed"
    ? "fixed"
    : "sliding";
  const rankTopAuthDebugEnabled = String(process.env.NOODLE_DEBUG_RANKTOP_AUTH || "0") === "1";

  function buildRedactedEnvDiagnostics(name) {
    const raw = process.env[name];
    const value = raw == null ? "" : String(raw);
    const trimmed = value.trim();
    const hasValue = Boolean(trimmed);
    return {
      env: name,
      present: raw != null,
      trimmedPresent: hasValue,
      rawLength: value.length,
      trimmedLength: trimmed.length,
      hasLeadingOrTrailingWhitespace: value.length !== trimmed.length,
      hasNewline: /[\r\n]/.test(value),
      hasTab: /\t/.test(value),
      startsWithBearer: /^bearer\s+/i.test(trimmed),
      sha256Prefix: hasValue ? crypto.createHash("sha256").update(trimmed).digest("hex").slice(0, 12) : null
    };
  }

  function logRankTopEnvDiagnostics({ clientUserId = "" } = {}) {
    if (!rankTopAuthDebugEnabled) return;
    const configuredBotId = String(process.env.NOODLE_BOT_ID || "").trim();
    const resolvedBotId = String(clientUserId || sharedBotId || BOT_ID_FALLBACK || "").trim();
    const payload = {
      token: buildRedactedEnvDiagnostics("NOODLE_RANKTOP_TOKEN"),
      webhookAuth: buildRedactedEnvDiagnostics("NOODLE_RANKTOP_WEBHOOK_AUTH"),
      statsUrl: String(process.env.NOODLE_RANKTOP_STATS_URL || stableStatsEndpointDefaults[VOTE_SOURCES.RANKTOP] || "").trim(),
      commandsUrl: String(process.env.NOODLE_RANKTOP_COMMANDS_URL || stableCommandListEndpointDefaults[VOTE_SOURCES.RANKTOP] || "").trim(),
      configuredBotId: configuredBotId || null,
      resolvedBotId: resolvedBotId || null,
      clientUserId: clientUserId || null
    };
    console.log("DEBUG Rank.top env diagnostics:", JSON.stringify(payload));
  }

  function logRankTopRequestDiagnostics(kind, tokenValue, targetUrl, authHeaderValue, apiKeyHeaderValue = "") {
    if (!rankTopAuthDebugEnabled) return;
    const trimmedToken = String(tokenValue || "").trim();
    const trimmedAuthHeader = String(authHeaderValue || "").trim();
    const trimmedApiKeyHeader = String(apiKeyHeaderValue || "").trim();
    console.log(
      `DEBUG Rank.top ${kind} auth diagnostics:`,
      JSON.stringify({
        targetUrl,
        tokenLength: trimmedToken.length,
        tokenHasNewline: /[\r\n]/.test(String(tokenValue || "")),
        tokenStartsWithBearer: /^bearer\s+/i.test(trimmedToken),
        authHeaderLength: trimmedAuthHeader.length,
        authHeaderStartsWithBearer: /^bearer\s+/i.test(trimmedAuthHeader),
        authHeaderSha256Prefix: trimmedAuthHeader
          ? crypto.createHash("sha256").update(trimmedAuthHeader).digest("hex").slice(0, 12)
          : null,
        apiKeyHeaderLength: trimmedApiKeyHeader.length,
        apiKeyHeaderSha256Prefix: trimmedApiKeyHeader
          ? crypto.createHash("sha256").update(trimmedApiKeyHeader).digest("hex").slice(0, 12)
          : null
      })
    );
  }
  const disabledStatsSyncLogged = new Set();
  const missingStatsChannelIdLoggedMarkers = new Set();
  const configuredStatsChannelLoggedMarkers = new Set();
  const invalidStatsChannelTypeLoggedMarkers = new Set();
  const unresolvedStatsChannelLoggedMarkers = new Set();
  const invalidStatsCategoryLogged = new Set();
  const lastBotListStatsPushBySource = new Map();
  const nextStatsSyncAllowedAtBySource = new Map();
  let lastOfficialStatsPush = null;
  const officialWelcomeAutoReactChannels = new Set(parseCsvValues(process.env.NOODLE_OFFICIAL_WELCOME_CHANNEL_IDS));
  const officialLevelAutoReactChannels = new Set(parseCsvValues(process.env.NOODLE_OFFICIAL_LEVEL_CHANNEL_IDS));
  const officialWelcomeKeywords = parseCsvValues(process.env.NOODLE_OFFICIAL_WELCOME_KEYWORDS || "welcome,joined the server")
    .map((value) => value.toLowerCase());
  const officialLevelKeywords = parseCsvValues(process.env.NOODLE_OFFICIAL_LEVEL_KEYWORDS || "level up,leveled up,reached level,is now level")
    .map((value) => value.toLowerCase());
  let shardNearThresholdAlertSent = false;
  let shardRecommendedAlertSent = false;
  let botListStatsHeartbeatHandle = null;
  let nextOfficialStatsSyncAllowedAt = 0;
  let officialStatsUpdateQueue = Promise.resolve(false);
  let officialStatsUpdateInFlight = false;
  if (!token) {
    console.error("❌ Missing DISCORD_TOKEN in .env");
    process.exit(1);
  }

  const clientIntents = [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.DIRECT_MESSAGES
  ];
  const messageContentIntentBit = Intents.FLAGS.MESSAGE_CONTENT ?? (1 << 15);
  const messageContentIntentRequested = Boolean(
    officialAutoReactEnabled
    && officialAutoReactKeywordMatchEnabled
    && officialMessageContentIntentEnabled
  );
  const messageContentIntentApplied = Boolean(
    messageContentIntentRequested
    && Number.isInteger(messageContentIntentBit)
    && messageContentIntentBit > 0
  );
  if (messageContentIntentApplied) {
    clientIntents.push(messageContentIntentBit);
  }

  const client = new Client({ intents: clientIntents });

  client.noodleShardHealth = {
    guildCount: 0,
    recommendedShardCount: null,
    threshold: shardGuildThreshold,
    alertThreshold: shardAlertThreshold,
    lastCheckedAt: null
  };

  const db = openDb();
  const { withEventRecipes } = await import("./game/events.js");
  const baseContent = loadContentBundle(1);
  const eventsContent = loadEventsContent();
  const content = withEventRecipes(baseContent, eventsContent);
  const settingsCatalog = loadSettingsCatalog();
  const badgesContent = loadBadgesContent();
  const specializationsContent = loadSpecializationsContent();
  const decorSetsContent = loadDecorSetsContent();

  function seedInitialStorePurchaseHistory() {
    if (!db) return;

    const baselineRows = [
      { source: "bootstrap", externalEventId: "baseline-astral-caravan-1", userId: "legacy-seed", serverId: null, specId: "astral_caravan" },
      { source: "bootstrap", externalEventId: "baseline-astral-caravan-2", userId: "legacy-seed", serverId: null, specId: "astral_caravan" },
      { source: "bootstrap", externalEventId: "baseline-sakura-sweetheart-1", userId: "legacy-seed", serverId: null, specId: "sakura_sweetheart_noodle_atelier" },
      { source: "bootstrap", externalEventId: "baseline-bloomwarden-garden-1", userId: "legacy-seed", serverId: null, specId: "bloomwarden_garden_hall" },
      { source: "bootstrap", externalEventId: "baseline-elderwood-hearth-1", userId: "legacy-seed", serverId: null, specId: "elderwood_hearth" }
    ];

    let inserted = 0;
    for (const row of baselineRows) {
      const didInsert = recordStorePurchaseEvent(db, {
        ...row,
        status: "granted",
        purchasedAt: Date.parse("2026-04-17T00:00:00Z")
      });
      if (didInsert) inserted += 1;
    }

    if (inserted > 0) {
      console.log(`INFO: Seeded ${inserted} baseline store purchase history rows.`);
    }
  }

  seedInitialStorePurchaseHistory();

  function getUnlockedIngredientIds(player, content) {
    const LEGACY_RECIPE_ID_ALIASES = {
      sweet_soy_broth: "sweet_soy_bowl",
      spring_blossoms_garden_broth: "spring_blossoms_garden_bowl"
    };

    const canonicalRecipeId = (recipeId) => {
      const id = String(recipeId ?? "").trim();
      if (!id) return null;
      if (content.recipes?.[id]) return id;

      const aliased = LEGACY_RECIPE_ID_ALIASES[id];
      if (aliased && content.recipes?.[aliased]) return aliased;

      if (id.endsWith("_broth")) {
        const bowlCandidate = `${id.slice(0, -6)}_bowl`;
        if (content.recipes?.[bowlCandidate]) return bowlCandidate;
      }

      return null;
    };

    const normalizeKnownRecipes = () => {
      const input = Array.isArray(player?.known_recipes) ? player.known_recipes : [];
      const outKnown = [];
      const seen = new Set();

      for (const rawId of input) {
        const canonical = canonicalRecipeId(rawId);
        if (!canonical || seen.has(canonical)) continue;
        seen.add(canonical);
        outKnown.push(canonical);
      }

      // Lightweight backfill only when known recipes are empty.
      if (!outKnown.length) {
        for (const starterId of STARTER_PROFILE.known_recipes ?? []) {
          const canonicalStarter = canonicalRecipeId(starterId);
          if (!canonicalStarter || seen.has(canonicalStarter)) continue;
          seen.add(canonicalStarter);
          outKnown.push(canonicalStarter);
        }
      }

      player.known_recipes = outKnown;
    };

    normalizeKnownRecipes();

    const out = new Set();
    const knownSet = new Set(getAvailableRecipes(player));
    const fishingUnlocked = isFishingUnlocked(player);

    const addRecipeIngredients = (recipeId) => {
      const r = content.recipes?.[recipeId];
      if (!r) return;
      for (const ing of (r.ingredients ?? [])) {
        if (!ing?.item_id) continue;
        if (!fishingUnlocked && FISHING_ITEM_IDS.includes(ing.item_id)) continue;
        out.add(ing.item_id);
      }
    };

    for (const recipeId of knownSet) addRecipeIngredients(recipeId);

    for (const recipeId of FISHING_RECIPE_IDS) {
      if (knownSet.has(recipeId)) addRecipeIngredients(recipeId);
    }

    // If the kitchen is unlocked, also expose forageables needed for unlocked broths
    const { unlocked: kitchenUnlocked } = getKitchenUnlockState(player);
    if (kitchenUnlocked) {
      const brothIds = Object.keys(KITCHEN_BROTH_RECIPES ?? {});
      for (const brothId of brothIds) {
        const recipe = KITCHEN_BROTH_RECIPES[brothId] ?? [];
        for (const ing of recipe) {
          if (!ing?.item_id) continue;
          if (!fishingUnlocked && FISHING_ITEM_IDS.includes(ing.item_id)) continue;
          out.add(ing.item_id);
        }
      }
    }

    return out;
  }

  function getPlayerLiteOrDefault(serverId, userId) {
    const lite = getPlayerLite(db, serverId, userId);
    if (lite) return lite;
    return {
      user_id: userId,
      known_recipes: [...(STARTER_PROFILE.known_recipes ?? [])],
      resilience: {},
      profile: { badges: [] },
      shop_level: STARTER_PROFILE.shop_level ?? 1
    };
  }

  async function getKnownServerIds() {
    return [...client.guilds.cache.keys()];
  }

  async function resolveAccessibleEmojiIds(client, token) {
    const ids = new Set();
    let applicationEmojiCount = 0;

    if (!token) return { ids, applicationEmojiCount };

    const applicationId = client.application?.id ?? client.user?.id;
    if (!applicationId) return { ids, applicationEmojiCount };

    if (client.application) {
      try {
        await client.application.fetch();
      } catch (error) {
        console.error("⚠️ Unable to refresh application metadata:", error?.message ?? error);
      }
    }

    try {
      const rest = new REST({ version: "10" }).setToken(token);
      const response = await rest.get(`/applications/${applicationId}/emojis`);
      const emojiItems = Array.isArray(response?.items)
        ? response.items
        : Array.isArray(response)
          ? response
          : [];
      applicationEmojiCount = emojiItems.length;
      for (const emoji of emojiItems) {
        if (emoji?.id) ids.add(emoji.id);
      }
    } catch (error) {
      console.error("⚠️ Unable to fetch application emojis:", error?.message ?? error);
    }

    return { ids, applicationEmojiCount };
  }

  function getWebhookRawBody(req, { limitBytes = 1_000_000 } = {}) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let total = 0;
      req.on("data", (chunk) => {
        total += chunk.length;
        if (total > limitBytes) {
          reject(new Error("Payload too large"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  async function decodeWebhookBody(rawBody, encoding) {
    if (!rawBody || !rawBody.length) return rawBody;
    const enc = String(encoding || "").toLowerCase();
    if (enc.includes("gzip")) {
      return await new Promise((resolve, reject) =>
        zlib.gunzip(rawBody, (err, out) => (err ? reject(err) : resolve(out)))
      );
    }
    if (enc.includes("deflate")) {
      return await new Promise((resolve, reject) =>
        zlib.inflate(rawBody, (err, out) => (err ? reject(err) : resolve(out)))
      );
    }
    if (enc.includes("br")) {
      return await new Promise((resolve, reject) =>
        zlib.brotliDecompress(rawBody, (err, out) => (err ? reject(err) : resolve(out)))
      );
    }
    return rawBody;
  }

  function parseWebhookPayload(decodedBody, contentType) {
    const bodyText = decodedBody?.toString("utf8") || "";
    const ct = String(contentType || "").toLowerCase();

    if (ct.includes("application/x-www-form-urlencoded") || ct.includes("text/plain")) {
      const params = new URLSearchParams(bodyText);
      const obj = {};
      for (const [key, value] of params.entries()) obj[key] = value;
      return { ok: true, value: obj };
    }

    try {
      return { ok: true, value: JSON.parse(bodyText || "{}") };
    } catch (error) {
      return { ok: false, error };
    }
  }

  function buildDiscordPublicKey(publicKeyHex) {
    const keyBytes = Buffer.from(publicKeyHex, "hex");
    const prefix = Buffer.from("302a300506032b6570032100", "hex");
    return crypto.createPublicKey({ key: Buffer.concat([prefix, keyBytes]), format: "der", type: "spki" });
  }

  function timingSafeEqual(a, b) {
    if (!a || !b) return false;
    const aBuf = Buffer.isBuffer(a) ? a : Buffer.from(String(a));
    const bBuf = Buffer.isBuffer(b) ? b : Buffer.from(String(b));
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  }

  function verifyDiscordSignature({ publicKeyHex, signature, timestamp, rawBody }) {
    if (!publicKeyHex || !signature || !timestamp || !rawBody) return false;
    try {
      const publicKey = buildDiscordPublicKey(publicKeyHex);
      const signatureBytes = Buffer.from(signature, "hex");
      const message = Buffer.concat([Buffer.from(String(timestamp)), rawBody]);
      return crypto.verify(null, message, publicKey, signatureBytes);
    } catch (error) {
      webhookError("⚠️ Discord webhook signature verify failed:", error?.message ?? error);
      return false;
    }
  }

  function verifyStripeSignature({ secret, signatureHeader, rawBody }) {
    if (!secret || !signatureHeader || !rawBody) return false;
    try {
      const parts = String(signatureHeader).split(",").map((p) => p.trim());
      const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
      const signatures = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
      if (!timestamp || !signatures.length) return false;
      const payload = Buffer.concat([Buffer.from(String(timestamp) + "."), rawBody]);
      const digest = crypto.createHmac("sha256", secret).update(payload).digest("hex");
      return signatures.some((sig) => timingSafeEqual(digest, sig));
    } catch (error) {
      webhookError("Stripe: Signature verify failed:", error?.message ?? error);
      return false;
    }
  }

  function toBase64Url(buffer) {
    return Buffer.from(buffer)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  function decodeBase64Url(input) {
    const value = String(input || "").trim();
    if (!value) return null;
    const normalized = value
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const padding = normalized.length % 4;
    const padded = padding ? normalized + "=".repeat(4 - padding) : normalized;
    try {
      return Buffer.from(padded, "base64");
    } catch {
      return null;
    }
  }

  function parseJsonBuffer(buffer) {
    if (!buffer) return null;
    try {
      return JSON.parse(buffer.toString("utf8"));
    } catch {
      return null;
    }
  }

  function verifyTopggWebhookSignature({ secret, signatureHeader, rawBody }) {
    if (!secret || !signatureHeader || !rawBody) return false;
    try {
      const parts = String(signatureHeader)
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
      const signature = parts.find((part) => part.startsWith("v1="))?.slice(3);
      if (!timestamp || !signature) return false;

      const expected = crypto
        .createHmac("sha256", secret)
        .update(`${timestamp}.`)
        .update(rawBody)
        .digest("hex");

      return timingSafeEqual(expected, signature);
    } catch (error) {
      webhookError("Top.gg: Signature verify failed:", error?.message ?? error);
      return false;
    }
  }

  function stripBearerPrefix(value) {
    const input = String(value || "").trim();
    if (!input) return "";
    return input.toLowerCase().startsWith("bearer ") ? input.slice(7).trim() : input;
  }

  function normalizeAuthToken(value) {
    const input = String(value || "").trim();
    if (!input) return "";
    const lower = input.toLowerCase();
    for (const scheme of ["bearer ", "token ", "webhook ", "jwt "]) {
      if (lower.startsWith(scheme)) {
        return input.slice(scheme.length).trim();
      }
    }
    return input;
  }

  function extractDiscordListJwtFromPayload(payload) {
    const candidates = [
      payload?.token,
      payload?.jwt,
      payload?.auth,
      payload?.authorization,
      payload?.data?.token,
      payload?.data?.jwt,
      payload?.data?.auth,
      payload?.data?.authorization,
      payload?.vote?.token,
      payload?.vote?.jwt,
      payload?.vote?.auth,
      payload?.vote?.authorization,
      payload?.event?.token,
      payload?.event?.jwt,
      payload?.event?.auth,
      payload?.event?.authorization
    ];
    const token = candidates.find((candidate) => String(candidate || "").trim());
    return stripBearerPrefix(token);
  }

  function verifyDiscordListWebhookJwt({ secret, payload, tokenCandidate }) {
    const token = normalizeAuthToken(tokenCandidate) || extractDiscordListJwtFromPayload(payload);
    const signingSecret = normalizeAuthToken(secret);
    if (!signingSecret || !token) return { ok: false, claims: null };

    try {
      const [headerSegment, payloadSegment, signatureSegment] = token.split(".");
      if (!headerSegment || !payloadSegment || !signatureSegment) {
        return { ok: false, claims: null };
      }

      const header = parseJsonBuffer(decodeBase64Url(headerSegment));
      if (!header || String(header.alg || "").toUpperCase() !== "HS256") {
        return { ok: false, claims: null };
      }

      const signedPayload = `${headerSegment}.${payloadSegment}`;
      const expectedSignature = toBase64Url(
        crypto.createHmac("sha256", signingSecret).update(signedPayload).digest()
      );

      if (!timingSafeEqual(expectedSignature, signatureSegment)) {
        return { ok: false, claims: null };
      }

      const claims = parseJsonBuffer(decodeBase64Url(payloadSegment));
      if (!claims || typeof claims !== "object") {
        return { ok: false, claims: null };
      }

      return { ok: true, claims };
    } catch (error) {
      webhookError("DiscordList.gg: JWT verify failed:", error?.message ?? error);
      return { ok: false, claims: null };
    }
  }

  function extractEntitlementPayload(payload) {
    const data = payload?.data ?? payload?.d ?? payload?.entitlement ?? payload?.event?.data ?? payload?.event ?? payload;
    const rawEventType = String(
      payload?.type ?? payload?.event_type ?? payload?.t ?? data?.type ?? payload?.event?.type ?? ""
    ).toUpperCase();
    const numericType = Number(rawEventType);
    const eventType = Number.isFinite(numericType)
      ? (numericType === 1 ? "ENTITLEMENT_CREATE" : numericType === 2 ? "ENTITLEMENT_UPDATE" : numericType === 3 ? "ENTITLEMENT_DELETE" : rawEventType)
      : rawEventType;
    return {
      eventType,
      skuId: data?.sku_id ?? data?.skuId ?? payload?.sku_id ?? payload?.skuId ?? null,
      userId: data?.user_id ?? data?.userId ?? payload?.user_id ?? payload?.userId ?? null,
      guildId: data?.guild_id ?? data?.guildId ?? payload?.guild_id ?? payload?.guildId ?? null,
      entitlementId: data?.id ?? data?.entitlement_id ?? payload?.entitlement_id ?? payload?.id ?? null
    };
  }

  async function sendDevAlert({ title, description, footerText = "", requireMention = true, color }) {
    if (!officialGuildId || !devAlertChannelId) return false;
    if (requireMention && !devAlertUserId) {
      console.error("⚠️ Dev alert skipped: NOODLE_DEV_ALERT_USER_ID is required for mention.");
      return false;
    }
    try {
      const officialGuild = client.guilds.cache.get(officialGuildId)
        || await client.guilds.fetch(officialGuildId).catch(() => null);
      if (!officialGuild) {
        console.error("⚠️ Dev alert skipped: official guild not found.");
        return false;
      }

      const alertChannel = officialGuild.channels.cache.get(devAlertChannelId)
        || await officialGuild.channels.fetch(devAlertChannelId).catch(() => null);
      if (!alertChannel || typeof alertChannel.send !== "function") {
        console.error("⚠️ Dev alert skipped: alert channel not sendable.");
        return false;
      }

      const ping = devAlertUserId ? ` <@${devAlertUserId}>` : "";
      const content = `${title}${ping}`.slice(0, 2000);
      await alertChannel.send({
        content,
        allowedMentions: devAlertUserId ? { users: [devAlertUserId] } : undefined,
        embeds: [
          {
            description: String(description || "").slice(0, 4096),
            ...(typeof color === "number" ? { color } : {}),
            ...(footerText ? { footer: { text: String(footerText).slice(0, 2048) } } : {})
          }
        ]
      });
      return true;
    } catch (error) {
      console.error("❌ Failed to send dev alert:", error?.stack ?? error);
      return false;
    }
  }

  function normalizeWebhookPath(value) {
    const raw = String(value || "").trim();
    if (!raw) return "/";
    const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
    const collapsed = withLeadingSlash.replace(/\/+/g, "/");
    if (collapsed.length > 1 && collapsed.endsWith("/")) {
      return collapsed.slice(0, -1);
    }
    return collapsed;
  }

  function getVoteWebhookConfigByPath(urlPath) {
    const normalizedPath = normalizeWebhookPath(urlPath);
    return voteWebhookConfigs.find((cfg) => normalizeWebhookPath(cfg.path) === normalizedPath) || null;
  }

  function extractVoteWebhookToken(req, requestUrl, payload = null) {
    const authHeader = String(req.headers["authorization"] || req.headers["x-authorization"] || "").trim();
    if (authHeader) {
      return normalizeAuthToken(authHeader);
    }
    const xAuth = String(
      req.headers["x-auth-token"]
      || req.headers["x-api-key"]
      || req.headers["x-webhook-auth"]
      || req.headers["x-access-token"]
      || req.headers["x-token"]
      || ""
    ).trim();
    if (xAuth) return normalizeAuthToken(xAuth);
    const queryToken = String(
      requestUrl.searchParams.get("auth")
      || requestUrl.searchParams.get("token")
      || requestUrl.searchParams.get("key")
      || ""
    ).trim();
    if (queryToken) return normalizeAuthToken(queryToken);

    const payloadTokenCandidates = [
      payload?.token,
      payload?.auth,
      payload?.authorization,
      payload?.api_key,
      payload?.apiKey,
      payload?.secret,
      payload?.data?.token,
      payload?.data?.auth,
      payload?.data?.authorization,
      payload?.vote?.token,
      payload?.vote?.auth,
      payload?.vote?.authorization,
      payload?.event?.token,
      payload?.event?.auth,
      payload?.event?.authorization
    ];
    const payloadToken = payloadTokenCandidates.find((candidate) => String(candidate || "").trim());
    if (payloadToken) return normalizeAuthToken(payloadToken);

    return normalizeAuthToken(queryToken);
  }

  function isVoteTestPayload(payload) {
    const type = String(payload?.type || payload?.event || payload?.action || "").toLowerCase();
    if (type === "test") return true;
    if (type === "webhook.test") return true;
    if (type.endsWith(".test")) return true;
    if (payload?.test === true || payload?.is_test === true) return true;
    return false;
  }

  function extractVoteUserId(payload) {
    const candidates = [
      payload?.user,
      payload?.voter,
      payload?.user?.id,
      payload?.voter?.id,
      payload?.user?.platform_id,
      payload?.user?.platformId,
      payload?.user_id,
      payload?.voter_id,
      payload?.userID,
      payload?.voterID,
      payload?.userId,
      payload?.voterId,
      payload?.userid,
      payload?.voterid,
      payload?.id,
      payload?.sub,
      payload?.data?.user,
      payload?.data?.voter,
      payload?.data?.user?.platform_id,
      payload?.data?.user?.platformId,
      payload?.data?.user?.id,
      payload?.data?.voter?.id,
      payload?.data?.user_id,
      payload?.data?.voter_id,
      payload?.data?.userID,
      payload?.data?.voterID,
      payload?.data?.userId,
      payload?.data?.voterId,
      payload?.data?.id,
      payload?.vote?.id,
      payload?.vote?.voter,
      payload?.vote?.voter_id,
      payload?.vote?.voterID,
      payload?.vote?.voterId,
      payload?.vote?.voter?.id,
      payload?.event?.id,
      payload?.data?.platform_id,
      payload?.data?.platformId,
      payload?.vote?.user_id,
      payload?.vote?.userID,
      payload?.vote?.userId,
      payload?.vote?.user?.id,
      payload?.vote?.user?.platform_id,
      payload?.vote?.user?.platformId,
      payload?.event?.user_id,
      payload?.event?.voter_id,
      payload?.event?.userID,
      payload?.event?.voterID,
      payload?.event?.userId,
      payload?.event?.voterId,
      payload?.event?.user?.id,
      payload?.event?.voter?.id,
      payload?.event?.user?.platform_id,
      payload?.event?.user?.platformId
    ];
    const match = candidates.find((candidate) => {
      const valueType = typeof candidate;
      if (valueType !== "string" && valueType !== "number") return false;
      return String(candidate).trim().length > 0;
    });
    return match == null ? "" : String(match).trim();
  }

  function hasAnyConfiguredBotListStatsSync() {
    return botListStatsConfigs.some((config) => {
      if (config?.enabled === false) return false;
      const endpoint = String(config?.endpoint || "").trim();
      const tokenValue = String(config?.token || "").trim();
      return Boolean(endpoint && tokenValue);
    });
  }

  function renderStatsEndpoint(endpoint, botId) {
    return String(endpoint || "")
      .replaceAll("{botId}", encodeURIComponent(botId))
      .replaceAll("{{BOT_ID}}", encodeURIComponent(botId));
  }

  function getCurrentBotListCounts() {
    const guilds = [...client.guilds.cache.values()];
    const serverCount = guilds.length;
    let userCount = guilds.reduce((sum, guild) => sum + Math.max(0, Number(guild?.memberCount || 0)), 0);

    // Match About embed user metric: global unique players from the DB.
    if (db) {
      try {
        const row = db.prepare("SELECT COUNT(DISTINCT user_id) AS count FROM players").get();
        userCount = Math.max(0, Number(row?.count || 0));
      } catch (error) {
        console.error("❌ Failed to query global unique user count:", error?.stack ?? error);
      }
    }

    return { serverCount, userCount };
  }

  function buildStatsBody(config, serverCount, userCount) {
    if (config?.source === VOTE_SOURCES.RANKTOP) {
      return buildRankTopPostPayload(serverCount, userCount);
    }
    if (config?.bodyFormat === "server_count") {
      return { server_count: Number(serverCount) || 0 };
    }
    if (config?.bodyFormat === "discordbotsgg_stats") {
      return { guildCount: Number(serverCount) || 0 };
    }
    if (config?.bodyFormat === "discordextremelist_stats") {
      const count = Number(serverCount) || 0;
      return {
        serverCount: count,
        guildCount: count
      };
    }
    if (config?.bodyFormat === "discordbotlist_stats") {
      const body = {
        guilds: Number(serverCount) || 0
      };
      if (Number.isFinite(userCount) && userCount >= 0) {
        body.users = Math.floor(userCount);
      }

      const voiceConnectionsRaw = Number(process.env.NOODLE_DISCORDBOTLIST_VOICE_CONNECTIONS || NaN);
      if (Number.isFinite(voiceConnectionsRaw) && voiceConnectionsRaw >= 0) {
        body.voice_connections = Math.floor(voiceConnectionsRaw);
      }
      return body;
    }
    return {
      server_count: Number(serverCount) || 0,
      guilds: Number(serverCount) || 0,
      guild_count: Number(serverCount) || 0
    };
  }

  function buildAuthorizationHeaderValue(tokenValue, authScheme = "raw") {
    const token = String(tokenValue || "").trim();
    if (!token) return "";
    if (String(authScheme || "raw").toLowerCase() === "bearer") {
      return /^bearer\s+/i.test(token) ? token : `Bearer ${token}`;
    }
    return token;
  }

  function isRedirectStatus(status) {
    const code = Number(status);
    return code === 301 || code === 302 || code === 303 || code === 307 || code === 308;
  }

  async function postJsonWithAuthPreservedOnRedirect(targetUrl, headers, bodyObject, {
    providerLabel,
    reason,
    tokenValue = ""
  } = {}) {
    const requestBody = JSON.stringify(bodyObject);
    const baseRequest = {
      method: "POST",
      headers,
      body: requestBody,
      redirect: "manual"
    };

    let response = await fetch(targetUrl, baseRequest);

    if (isRedirectStatus(response.status)) {
      const locationHeader = String(response.headers.get("location") || "").trim();
      if (locationHeader) {
        let redirectedUrl = "";
        try {
          redirectedUrl = new URL(locationHeader, targetUrl).toString();
        } catch {
          redirectedUrl = locationHeader;
        }

        console.warn(
          `WARN: ${providerLabel || "Provider"} endpoint redirected (${reason || "event"}): ${response.status} -> ${redirectedUrl}`
        );

        // Re-POST with identical auth headers so providers behind redirects still receive credentials.
        response = await fetch(redirectedUrl, {
          method: "POST",
          headers,
          body: requestBody,
          redirect: "manual"
        });
      }
    }

    const provider = String(providerLabel || "");
    const isRankTop = provider.toLowerCase() === "rank.top";
    if (!isRankTop || response.ok) {
      return response;
    }

    if (response.status !== 401) {
      return response;
    }

    const responseText = await response.clone().text().catch(() => "");
    if (!/missing authorization token/i.test(responseText)) {
      return response;
    }

    const trimmedToken = String(tokenValue || "").trim();
    if (!trimmedToken) {
      return response;
    }

    const retryHeaders = {
      ...headers,
      // Some gateway paths can strip Authorization on POST; provide redundant auth channels.
      "x-authorization": buildAuthorizationHeaderValue(trimmedToken, "bearer"),
      "x-api-key": normalizeAuthToken(trimmedToken)
    };
    const retryHeaderKeys = Object.keys(retryHeaders)
      .map((key) => String(key || "").toLowerCase())
      .sort()
      .join(",");

    console.warn(
      `WARN: ${provider} retrying POST with fallback auth headers (${reason || "event"}) after 401 Missing authorization token.`
    );
    if (rankTopAuthDebugEnabled) {
      console.log(`DEBUG ${provider} retry auth header keys: ${retryHeaderKeys}`);
    }

    return fetch(targetUrl, {
      method: "POST",
      headers: retryHeaders,
      body: requestBody,
      redirect: "manual"
    });
  }

  function buildProviderAuthHeaders(config, tokenValue, { authSchemeOverride } = {}) {
    const headers = {};
    const trimmedToken = String(tokenValue || "").trim();
    if (!trimmedToken) return headers;

    const authScheme = authSchemeOverride ?? config?.authScheme;
    const authHeaderName = String(config?.authHeaderName || "Authorization").trim() || "Authorization";
    const authHeaderValue = buildAuthorizationHeaderValue(trimmedToken, authScheme);

    if (config?.source === VOTE_SOURCES.RANKTOP) {
      const includeAuthorizationHeader = String(process.env.NOODLE_RANKTOP_INCLUDE_AUTHORIZATION_HEADER || "1") !== "0";
      const rankTopAuthScheme = String(process.env.NOODLE_RANKTOP_AUTH_SCHEME || authScheme || "bearer")
        .trim()
        .toLowerCase();
      if (includeAuthorizationHeader) {
        headers[authHeaderName] = buildAuthorizationHeaderValue(
          trimmedToken,
          rankTopAuthScheme === "raw" ? "raw" : "bearer"
        );
      }

      // Rank.top accepts API-key style auth; send both by default to avoid provider-side parser variance.
      const includeApiKeyHeader = String(process.env.NOODLE_RANKTOP_INCLUDE_API_KEY_HEADER || "1") !== "0";
      if (includeApiKeyHeader) {
        const apiKeyHeaderName = String(process.env.NOODLE_RANKTOP_API_KEY_HEADER || "x-api-key").trim() || "x-api-key";
        headers[apiKeyHeaderName] = normalizeAuthToken(trimmedToken);
      }
      return headers;
    }

    headers[authHeaderName] = authHeaderValue;

    return headers;
  }

  async function updateSingleBotListServerCount(config, serverCount, userCount, { reason = "event" } = {}) {
    if (config?.enabled === false) {
      if (!disabledStatsSyncLogged.has(config.source)) {
        disabledStatsSyncLogged.add(config.source);
        console.log(`INFO: ${config.label} server count sync disabled (paused by env).`);
      }
      return false;
    }

    const endpoint = String(config?.endpoint || "").trim();
    const tokenValue = String(config?.token || "").trim();

    if (!endpoint || !tokenValue) {
      if (!disabledStatsSyncLogged.has(config.source)) {
        disabledStatsSyncLogged.add(config.source);
        console.log(`INFO: ${config.label} server count sync disabled (missing URL or token).`);
      }
      return false;
    }

    const resolvedBotId = String(client.user?.id || sharedBotId || BOT_ID_FALLBACK || "").trim();
    if (!resolvedBotId) {
      console.error(`❌ Skipping ${config.label} server count sync: missing bot id.`);
      return false;
    }

    const targetUrl = renderStatsEndpoint(endpoint, resolvedBotId);
    const authHeaders = buildProviderAuthHeaders(config, tokenValue);
    if (config?.source === VOTE_SOURCES.RANKTOP) {
      const rankTopApiKeyHeaderName = String(process.env.NOODLE_RANKTOP_API_KEY_HEADER || "x-api-key").trim() || "x-api-key";
      logRankTopRequestDiagnostics(
        "stats",
        tokenValue,
        targetUrl,
        authHeaders.Authorization || authHeaders.authorization || "",
        authHeaders[rankTopApiKeyHeaderName] || ""
      );
    }
    const sourceKey = String(config?.source || "").trim();
    const nowMs = Date.now();
    const minIntervalMs = Number.isFinite(config?.minSyncIntervalMs)
      ? Math.max(30_000, Math.floor(config.minSyncIntervalMs))
      : botListStatsMinIntervalMs;
    const nextAllowedAt = Number(nextStatsSyncAllowedAtBySource.get(sourceKey) || 0);
    if (nextAllowedAt > nowMs) {
      return false;
    }

    const previous = lastBotListStatsPushBySource.get(sourceKey) || null;
    if (previous && previous.serverCount === Number(serverCount) && previous.userCount === Number(userCount)) {
      return false;
    }
    if (previous && nowMs - Number(previous.sentAt || 0) < minIntervalMs) {
      return false;
    }

    try {
      const requestHeaders = {
        ...authHeaders,
        "Content-Type": "application/json"
      };
      const statsBody = buildStatsBody(config, serverCount, userCount);
      const response = config?.source === VOTE_SOURCES.RANKTOP
        ? await postJsonWithAuthPreservedOnRedirect(targetUrl, requestHeaders, statsBody, {
          providerLabel: config.label,
          reason,
          tokenValue
        })
        : await fetch(targetUrl, {
          method: "POST",
          headers: requestHeaders,
          body: JSON.stringify(statsBody)
        });

      if (!response.ok) {
        if (response.status === 429) {
          const retryAfterSeconds = Number(response.headers.get("retry-after") || 0);
          const cooldownMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? Math.ceil(retryAfterSeconds * 1000)
            : minIntervalMs;
          nextStatsSyncAllowedAtBySource.set(sourceKey, nowMs + cooldownMs);
        }
        const responseBody = await response.text().catch(() => "");
        console.error(
          `❌ ${config.label} server count sync failed (${reason}): ${response.status} ${response.statusText}${responseBody ? ` - ${responseBody.slice(0, 300)}` : ""}`
        );
        return false;
      }

      lastBotListStatsPushBySource.set(sourceKey, {
        sentAt: nowMs,
        serverCount: Number(serverCount),
        userCount: Number(userCount)
      });
      nextStatsSyncAllowedAtBySource.delete(sourceKey);

      console.log(`✅ ${config.label} stats updated (${reason}): guilds=${Number(serverCount) || 0}${Number.isFinite(userCount) ? ` users=${Math.floor(userCount)}` : ""}`);
      return true;
    } catch (error) {
      console.error(`❌ ${config.label} server count sync threw (${reason}):`, error?.stack ?? error);
      return false;
    }
  }

  async function updateAllBotListServerCounts(serverCountOrCounts, { reason = "event" } = {}) {
    const counts = typeof serverCountOrCounts === "number"
      ? { serverCount: Number(serverCountOrCounts) || 0, userCount: NaN }
      : serverCountOrCounts;
    const serverCount = Number(counts?.serverCount) || 0;
    const userCount = Number(counts?.userCount);

    let anyUpdated = false;
    for (const config of botListStatsConfigs) {
      const updated = await updateSingleBotListServerCount(config, serverCount, userCount, { reason });
      anyUpdated = anyUpdated || updated;
    }
    return anyUpdated;
  }

  function buildStatChannelName(label, count) {
    const safeLabel = normalizeCounterLabel(label);
    const safeCount = Math.max(0, Number(count) || 0).toLocaleString("en-US");
    return `${safeLabel}: ${safeCount}`.slice(0, 100);
  }

  function normalizeCounterLabel(label) {
    return String(label || "Stats")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "Stats";
  }

  async function ensureOfficialReadonlyStatsChannel(officialGuild, channelId, { marker, label, count }) {
    const isSupportedStatsCounterChannel = (candidate) => (
      candidate?.type === "GUILD_VOICE"
      && typeof candidate?.setName === "function"
      && typeof candidate?.permissionOverwrites?.edit === "function"
    );

    let channel = null;
    let hadSyncError = false;
    const existingId = String(channelId || "").trim();
    const lockPermissionNames = [
      "CONNECT",
      "SPEAK",
      "STREAM",
      "USE_VAD",
      "REQUEST_TO_SPEAK",
      "SEND_MESSAGES",
      "ADD_REACTIONS",
      "CREATE_PUBLIC_THREADS",
      "CREATE_PRIVATE_THREADS",
      "SEND_MESSAGES_IN_THREADS"
    ].filter((perm) => Boolean(Discord.Permissions?.FLAGS?.[perm]));
    const viewPermissionName = Discord.Permissions?.FLAGS?.VIEW_CHANNEL ? "VIEW_CHANNEL" : null;
    const lockPermissionOptions = {
      ...Object.fromEntries(lockPermissionNames.map((perm) => [perm, false])),
      ...(viewPermissionName ? { [viewPermissionName]: true } : {})
    };

    if (existingId) {
      channel = officialGuild.channels.cache.get(existingId)
        || await officialGuild.channels.fetch(existingId).catch(() => null);
      if (channel && !isSupportedStatsCounterChannel(channel)) {
        if (!invalidStatsChannelTypeLoggedMarkers.has(marker)) {
          invalidStatsChannelTypeLoggedMarkers.add(marker);
          console.warn(`⚠️ Ignoring configured stats channel ${existingId} for ${marker}: not a voice counter channel.`);
        }
        return null;
      } else if (channel) {
        if (!configuredStatsChannelLoggedMarkers.has(marker)) {
          configuredStatsChannelLoggedMarkers.add(marker);
          console.log(`ℹ️ Using configured stats channel ${existingId} for ${marker}; applying expected counter settings.`);
        }
      }
    }

    if (!channel && !existingId) {
      if (!missingStatsChannelIdLoggedMarkers.has(marker)) {
        missingStatsChannelIdLoggedMarkers.add(marker);
        console.warn(`⚠️ Skipping stats channel update for ${marker}: explicit channel ID is required.`);
      }
      return null;
    }

    if (!isSupportedStatsCounterChannel(channel)) {
      if (!unresolvedStatsChannelLoggedMarkers.has(marker)) {
        unresolvedStatsChannelLoggedMarkers.add(marker);
        console.error(`❌ Failed to resolve configured voice counter channel for ${marker}.`);
      }
      return null;
    }

    unresolvedStatsChannelLoggedMarkers.delete(marker);
    invalidStatsChannelTypeLoggedMarkers.delete(marker);

    if (officialStatsCategoryId && typeof channel.setParent === "function") {
      const configuredCategory = officialGuild.channels.cache.get(officialStatsCategoryId)
        || await officialGuild.channels.fetch(officialStatsCategoryId).catch(() => null);

      if (!configuredCategory || configuredCategory.type !== "GUILD_CATEGORY") {
        if (!invalidStatsCategoryLogged.has(officialStatsCategoryId)) {
          invalidStatsCategoryLogged.add(officialStatsCategoryId);
          console.warn("⚠️ NOODLE_OFFICIAL_STATS_CATEGORY_ID is not a valid category in the official guild; skipping category moves.");
        }
      } else {
        invalidStatsCategoryLogged.delete(officialStatsCategoryId);
        const currentParentId = String(channel.parentId || channel.parent?.id || "");
        if (currentParentId !== configuredCategory.id) {
          await channel.setParent(configuredCategory.id, { lockPermissions: false }).catch((error) => {
            hadSyncError = true;
            console.error(`❌ Failed to move stats channel to configured category (${marker}):`, error?.message ?? error);
          });
        }
      }
    }

    if (Object.keys(lockPermissionOptions).length > 0) {
      const everyoneRoleId = officialGuild.roles.everyone.id;
      const overwrite = channel.permissionOverwrites?.cache?.get(everyoneRoleId) || null;
      const alreadyLocked = lockPermissionNames.every((perm) => {
        const permFlag = Discord.Permissions?.FLAGS?.[perm];
        return permFlag ? overwrite?.deny?.has?.(permFlag) : true;
      }) && (!viewPermissionName || overwrite?.allow?.has?.(Discord.Permissions.FLAGS[viewPermissionName]));

      if (!alreadyLocked) {
        await channel.permissionOverwrites.edit(everyoneRoleId, lockPermissionOptions).catch((error) => {
          hadSyncError = true;
          console.error(`❌ Failed to apply official stats lock permissions (${marker}):`, error?.message ?? error);
        });
      }
    }

    const nextName = buildStatChannelName(label, count);
    if (channel.name !== nextName) {
      await channel.setName(nextName).catch((error) => {
        hadSyncError = true;
        console.error(`❌ Failed to rename official stats channel (${marker}):`, error?.message ?? error);
      });
    }
    return { channel, synchronized: !hadSyncError };
  }

  async function updateOfficialStatsChannels(precomputedCounts = null, { reason = "event" } = {}) {
    if (!officialStatsChannelsEnabled || !officialGuildId) return false;
    const isIntervalReason = reason === "interval";

    if (isIntervalReason && officialStatsUpdateInFlight) {
      return false;
    }

    const runUpdate = async () => {
      const nowMs = Date.now();
      if (isIntervalReason && nextOfficialStatsSyncAllowedAt > nowMs) {
        return false;
      }
      if (isIntervalReason) {
        nextOfficialStatsSyncAllowedAt = nowMs + officialStatsMinIntervalMs;
      }

      try {
        const officialGuild = await client.guilds.fetch(officialGuildId, { force: true }).catch(() => null)
          || client.guilds.cache.get(officialGuildId);
        if (!officialGuild) return false;

        const counts = precomputedCounts && typeof precomputedCounts === "object"
          ? precomputedCounts
          : getCurrentBotListCounts();
        const serverCount = Math.max(0, Number(counts?.serverCount) || 0);
        const shopsCount = Math.max(0, Number(counts?.userCount) || 0);
        const officialMemberCount = Math.max(
          0,
          Number(officialGuild?.memberCount ?? 0)
        );

        if (
          isIntervalReason
          && lastOfficialStatsPush
          && lastOfficialStatsPush.fullySynchronized === true
          && lastOfficialStatsPush.serverCount === serverCount
          && lastOfficialStatsPush.shopsCount === shopsCount
          && lastOfficialStatsPush.officialMemberCount === officialMemberCount
        ) {
          return false;
        }

        const serverResult = await ensureOfficialReadonlyStatsChannel(
          officialGuild,
          officialServerCountChannelId,
          {
            marker: "noodle:stats:servers",
            label: officialServerCountLabel,
            count: serverCount
          }
        );
        const shopsResult = await ensureOfficialReadonlyStatsChannel(
          officialGuild,
          officialShopCountChannelId,
          {
            marker: "noodle:stats:shops",
            label: officialShopCountLabel,
            count: shopsCount
          }
        );
        const memberResult = await ensureOfficialReadonlyStatsChannel(
          officialGuild,
          officialMemberCountChannelId,
          {
            marker: "noodle:stats:official-members",
            label: officialMemberCountLabel,
            count: officialMemberCount
          }
        );

        const channelResults = [serverResult, shopsResult, memberResult];
        const resolvedChannels = channelResults
          .map((result) => result?.channel || null)
          .filter(Boolean);
        const resolvedChannelCount = resolvedChannels.length;
        const synchronizedResolvedChannelCount = channelResults.filter(
          (result) => Boolean(result?.channel) && result?.synchronized === true
        ).length;
        const expectedChannelCount = 3;

        if (serverResult?.channel?.id) officialServerCountChannelId = serverResult.channel.id;
        if (shopsResult?.channel?.id) officialShopCountChannelId = shopsResult.channel.id;
        if (memberResult?.channel?.id) officialMemberCountChannelId = memberResult.channel.id;

        if (resolvedChannelCount === 0) {
          lastOfficialStatsPush = {
            serverCount,
            shopsCount,
            officialMemberCount,
            sentAt: nowMs,
            fullySynchronized: false
          };
          console.warn("⚠️ Official stats channels skipped: configure explicit NOODLE_OFFICIAL_*_CHANNEL_ID values.");
          return false;
        }

        if (synchronizedResolvedChannelCount === 0) {
          lastOfficialStatsPush = {
            serverCount,
            shopsCount,
            officialMemberCount,
            sentAt: nowMs,
            fullySynchronized: false
          };
          console.error(
            `❌ Official stats channel sync had no fully successful channel synchronizations (${reason}): servers=${serverCount}, shops=${shopsCount}, members=${officialMemberCount}, resolved=${resolvedChannelCount}/3`
          );
          return false;
        }

        if (
          resolvedChannelCount === expectedChannelCount
          && synchronizedResolvedChannelCount === expectedChannelCount
        ) {
          lastOfficialStatsPush = {
            serverCount,
            shopsCount,
            officialMemberCount,
            sentAt: nowMs,
            fullySynchronized: true
          };
          nextOfficialStatsSyncAllowedAt = nowMs + officialStatsMinIntervalMs;
        } else {
          lastOfficialStatsPush = {
            serverCount,
            shopsCount,
            officialMemberCount,
            sentAt: nowMs,
            fullySynchronized: false
          };
        }

        console.log(`✅ Official stats channels updated (${reason}): servers=${serverCount}, shops=${shopsCount}, members=${officialMemberCount}, resolved=${resolvedChannelCount}/3, synchronized=${synchronizedResolvedChannelCount}/${resolvedChannelCount}`);
        return true;
      } catch (error) {
        console.error("❌ Failed to update official stats channels:", error?.stack ?? error);
        return false;
      }
    };

    const queuedRun = officialStatsUpdateQueue
      .catch(() => false)
      .then(async () => {
        officialStatsUpdateInFlight = true;
        try {
          return await runUpdate();
        } finally {
          officialStatsUpdateInFlight = false;
        }
      });
    officialStatsUpdateQueue = queuedRun.then(() => false, () => false);
    return queuedRun;
  }

  function getMessageSearchBlob(message) {
    const embedParts = (message?.embeds || []).flatMap((embed) => {
      const fieldParts = (embed?.fields || []).flatMap((field) => [field?.name, field?.value]);
      return [embed?.title, embed?.description, ...fieldParts];
    });
    return [message?.content || "", ...embedParts]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function parseReactionEmoji(emoji) {
    const value = String(emoji || "").trim();
    if (!value) return null;

    const bracketCustom = value.match(/^<a?:([a-zA-Z0-9_]+):(\d{15,25})>$/);
    if (bracketCustom) {
      const name = bracketCustom[1];
      const id = bracketCustom[2];
      return { raw: value, id, isCustom: true, reactValue: `${name}:${id}` };
    }

    const plainCustom = value.match(/^[a-zA-Z0-9_]+:(\d{15,25})$/);
    if (plainCustom) {
      return { raw: value, id: plainCustom[1], isCustom: true, reactValue: value };
    }

    const idOnlyCustom = value.match(/^(\d{15,25})$/);
    if (idOnlyCustom) {
      return { raw: value, id: idOnlyCustom[1], isCustom: true, reactValue: value };
    }

    return { raw: value, id: null, isCustom: false, reactValue: value };
  }

  function emojiMatchesReaction(parsed, reactionEmoji) {
    if (!parsed || !reactionEmoji) return false;
    if (parsed.isCustom && parsed.id) {
      return String(reactionEmoji.id || "") === parsed.id;
    }

    const rendered = typeof reactionEmoji.toString === "function" ? reactionEmoji.toString() : "";
    return reactionEmoji.name === parsed.raw || rendered === parsed.raw;
  }

  async function tryAutoReact(message, emoji) {
    const parsed = parseReactionEmoji(emoji);
    if (!parsed) return false;

    const alreadyReacted = message.reactions?.cache?.some((reaction) => {
      return reaction?.me && emojiMatchesReaction(parsed, reaction?.emoji);
    });
    if (alreadyReacted) return false;

    try {
      await message.react(parsed.reactValue);
      return true;
    } catch (error) {
      console.error(`❌ Failed to auto-react with ${parsed.raw}:`, error?.message ?? error);
      return false;
    }
  }

  function toProviderCommand(command) {
    const normalized = {
      name: String(command?.name || "").trim(),
      description: String(command?.description || "").trim()
    };
    if (Array.isArray(command?.options) && command.options.length > 0) {
      normalized.options = command.options;
    }
    return normalized;
  }

  function buildProviderCommandsPayload({ includeDevEnvVar, wrapInCommandsObject = false }) {
    const includeDevCommands = String(process.env[includeDevEnvVar] || "0") === "1";
    const payload = (commands || [])
      .map((command) => command?.data?.toJSON?.())
      .filter(Boolean)
      .filter((cmd) => includeDevCommands || String(cmd?.name || "").trim() !== "noodle-dev");
    const normalizedPayload = payload
      .map(toProviderCommand)
      .filter((cmd) => cmd.name && cmd.description);
    return wrapInCommandsObject ? { commands: normalizedPayload } : normalizedPayload;
  }

  function buildDiscordBotListCommandsPayload() {
    const wrapInCommandsObject = String(process.env.NOODLE_DISCORDBOTLIST_COMMANDS_WRAP || "0") === "1";
    return buildProviderCommandsPayload({
      includeDevEnvVar: "NOODLE_DISCORDBOTLIST_INCLUDE_DEV_COMMANDS",
      wrapInCommandsObject
    });
  }

  function buildRadarCpdvCommandsPayload() {
    const wrapInCommandsObject = String(process.env.NOODLE_RADARCPDV_COMMANDS_WRAP || "0") === "1";
    return buildProviderCommandsPayload({
      includeDevEnvVar: "NOODLE_RADARCPDV_INCLUDE_DEV_COMMANDS",
      wrapInCommandsObject
    });
  }

  function buildRankTopPostPayload(serverCount, userCount, { includeCommands = false, commandsPayload = null } = {}) {
    const includeCommandsFlag = Boolean(includeCommands);
    const postAuthorization = String(
      process.env.NOODLE_RANKTOP_POST_AUTHORIZATION
      || process.env.NOODLE_RANKTOP_WEBHOOK_AUTH
      || ""
    ).trim();

    const normalizedServerCount = Number(serverCount) || 0;
    const normalizedUserCount = Number.isFinite(userCount) && userCount >= 0 ? Math.floor(userCount) : 0;
    const payload = {
      // Rank.top SDK posts camelCase fields; keep snake_case too for backward compatibility.
      serverCount: normalizedServerCount,
      userCount: normalizedUserCount,
      server_count: normalizedServerCount,
      user_count: normalizedUserCount
    };

    if (postAuthorization) {
      payload.authorization = postAuthorization;
    }

    if (includeCommandsFlag) {
      const normalizedCommands = Array.isArray(commandsPayload)
        ? commandsPayload
        : [];
      payload.commands = normalizedCommands;
    }

    return payload;
  }

  async function buildRankTopCommandsPayload() {
    const includeDevCommands = String(process.env.NOODLE_RANKTOP_INCLUDE_DEV_COMMANDS || "0") === "1";

    try {
      const fetchedCommands = await client.application?.commands?.fetch?.();
      const commandItems = fetchedCommands?.map
        ? fetchedCommands.map((command) => command)
        : [];

      if (commandItems.length > 0) {
        return commandItems
          .filter((command) => includeDevCommands || String(command?.name || "").trim() !== "noodle-dev")
          .map((command) => ({
            id: String(command?.id || "").trim(),
            name: String(command?.name || "").trim(),
            description: String(command?.description || "").trim()
          }))
          .filter((command) => command.id && command.name && command.description);
      }
    } catch (error) {
      console.warn("WARN: Rank.top command payload falling back to local command definitions:", error?.message ?? error);
    }

    // Fallback: local definitions may not include deployed command IDs; provide stable synthetic IDs.
    const fallbackCommands = buildProviderCommandsPayload({
      includeDevEnvVar: "NOODLE_RANKTOP_INCLUDE_DEV_COMMANDS",
      wrapInCommandsObject: false
    });
    return fallbackCommands
      .map((command) => ({
        id: String(command?.name || "").trim(),
        name: String(command?.name || "").trim(),
        description: String(command?.description || "").trim()
      }))
      .filter((command) => command.id && command.name && command.description);
  }

  async function syncDiscordBotListCommands({ reason = "ready" } = {}) {
    const enabled = String(process.env.NOODLE_DISCORDBOTLIST_SYNC_COMMANDS || "1") !== "0";
    if (!enabled) return false;

    const tokenValue = getVoteSourceToken("NOODLE_DISCORDBOTLIST_TOKEN");
    if (!tokenValue) {
      console.log("INFO: Discord Bot List command sync skipped (missing token).");
      return false;
    }

    const endpointTemplate = process.env.NOODLE_DISCORDBOTLIST_COMMANDS_URL
      || stableCommandListEndpointDefaults[VOTE_SOURCES.DISCORDBOTLIST];
    const resolvedBotId = String(client.user?.id || sharedBotId || BOT_ID_FALLBACK || "").trim();
    if (!resolvedBotId) {
      console.log("INFO: Discord Bot List command sync skipped (missing bot id).");
      return false;
    }

    const targetUrl = renderStatsEndpoint(endpointTemplate, resolvedBotId);
    const commandsPayload = buildDiscordBotListCommandsPayload();

    try {
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          Authorization: tokenValue,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(commandsPayload)
      });

      if (!response.ok) {
        const responseBody = await response.text().catch(() => "");
        console.error(
          `❌ Discord Bot List command sync failed (${reason}): ${response.status} ${response.statusText}${responseBody ? ` - ${responseBody.slice(0, 300)}` : ""}`
        );
        return false;
      }

      console.log(`✅ Discord Bot List command list synced (${reason}): ${commandsPayload.length} command(s)`);
      return true;
    } catch (error) {
      console.error("❌ Discord Bot List command sync threw:", error?.stack ?? error);
      return false;
    }
  }

  async function syncRadarCpdvCommands({ reason = "ready" } = {}) {
    const enabled = String(process.env.NOODLE_RADARCPDV_SYNC_COMMANDS || "1") !== "0";
    if (!enabled) return false;

    const tokenValue = getVoteSourceToken("NOODLE_RADARCPDV_TOKEN");
    if (!tokenValue) {
      console.log("INFO: Radar.CPDV command sync skipped (missing token).");
      return false;
    }

    const endpointTemplate = process.env.NOODLE_RADARCPDV_COMMANDS_URL
      || stableCommandListEndpointDefaults[VOTE_SOURCES.RADAR_CPDV];
    const resolvedBotId = String(client.user?.id || sharedBotId || BOT_ID_FALLBACK || "").trim();
    if (!resolvedBotId) {
      console.log("INFO: Radar.CPDV command sync skipped (missing bot id).");
      return false;
    }

    const targetUrl = renderStatsEndpoint(endpointTemplate, resolvedBotId);
    const commandsPayload = buildRadarCpdvCommandsPayload();

    try {
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          Authorization: tokenValue,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(commandsPayload)
      });

      if (!response.ok) {
        const responseBody = await response.text().catch(() => "");
        console.error(
          `❌ Radar.CPDV command sync failed (${reason}): ${response.status} ${response.statusText}${responseBody ? ` - ${responseBody.slice(0, 300)}` : ""}`
        );
        return false;
      }

      console.log(`✅ Radar.CPDV command list synced (${reason}): ${commandsPayload.length} command(s)`);
      return true;
    } catch (error) {
      console.error("❌ Radar.CPDV command sync threw:", error?.stack ?? error);
      return false;
    }
  }

  async function syncRankTopCommands({ reason = "ready", precomputedCounts = null } = {}) {
    const enabled = String(process.env.NOODLE_RANKTOP_SYNC_COMMANDS || "1") !== "0";
    if (!enabled) return false;

    const tokenValue = getVoteSourceToken("NOODLE_RANKTOP_TOKEN");
    if (!tokenValue) {
      console.log("INFO: Rank.top command sync skipped (missing token).");
      return false;
    }

    const endpointTemplate = process.env.NOODLE_RANKTOP_COMMANDS_URL
      || stableCommandListEndpointDefaults[VOTE_SOURCES.RANKTOP];
    const resolvedBotId = String(client.user?.id || sharedBotId || BOT_ID_FALLBACK || "").trim();
    if (!resolvedBotId) {
      console.log("INFO: Rank.top command sync skipped (missing bot id).");
      return false;
    }

    const targetUrl = renderStatsEndpoint(endpointTemplate, resolvedBotId);
    const counts = precomputedCounts && typeof precomputedCounts === "object"
      ? precomputedCounts
      : getCurrentBotListCounts();
    const rankTopCommandsPayload = await buildRankTopCommandsPayload();
    const commandsPayload = buildRankTopPostPayload(counts.serverCount, counts.userCount, {
      includeCommands: true,
      commandsPayload: rankTopCommandsPayload
    });
    const authHeaders = buildProviderAuthHeaders(
      {
        source: VOTE_SOURCES.RANKTOP,
        authScheme: "bearer",
        authHeaderName: "Authorization"
      },
      tokenValue,
      { authSchemeOverride: "bearer" }
    );
    const rankTopApiKeyHeaderName = String(process.env.NOODLE_RANKTOP_API_KEY_HEADER || "x-api-key").trim() || "x-api-key";
    logRankTopRequestDiagnostics(
      "commands",
      tokenValue,
      targetUrl,
      authHeaders.Authorization || authHeaders.authorization || "",
      authHeaders[rankTopApiKeyHeaderName] || ""
    );

    try {
      const requestHeaders = {
        ...authHeaders,
        "Content-Type": "application/json"
      };
      const response = await postJsonWithAuthPreservedOnRedirect(targetUrl, requestHeaders, commandsPayload, {
        providerLabel: "Rank.top",
        reason,
        tokenValue
      });

      if (!response.ok) {
        const responseBody = await response.text().catch(() => "");
        console.error(
          `❌ Rank.top command sync failed (${reason}): ${response.status} ${response.statusText}${responseBody ? ` - ${responseBody.slice(0, 300)}` : ""}`
        );
        return false;
      }

      console.log(`✅ Rank.top command list synced (${reason}): ${commandsPayload.commands.length} command(s)`);
      return true;
    } catch (error) {
      console.error("❌ Rank.top command sync threw:", error?.stack ?? error);
      return false;
    }
  }

  async function runRankTopAuthPreflight({ reason = "ready" } = {}) {
    const enabled = String(process.env.NOODLE_RANKTOP_AUTH_PREFLIGHT || "0") === "1";
    if (!enabled) return false;

    const tokenValue = getVoteSourceToken("NOODLE_RANKTOP_TOKEN");
    if (!tokenValue) {
      console.log("INFO: Rank.top auth preflight skipped (missing token).");
      return false;
    }

    const endpointTemplate = String(
      process.env.NOODLE_RANKTOP_PREFLIGHT_URL || "https://rank.top/api/bots/{botId}/stats"
    ).trim();
    const resolvedBotId = String(client.user?.id || sharedBotId || BOT_ID_FALLBACK || "").trim();
    if (!resolvedBotId) {
      console.log("INFO: Rank.top auth preflight skipped (missing bot id).");
      return false;
    }

    const targetUrl = renderStatsEndpoint(endpointTemplate, resolvedBotId);
    if (/\/bots\/\{?botId\}?\/details/i.test(endpointTemplate) || /\/bots\/.+\/details/i.test(targetUrl)) {
      console.warn("WARN: Rank.top preflight is pointed at /details, which may be public and not validate API key auth for /post.");
    }
    const authHeaders = buildProviderAuthHeaders(
      {
        source: VOTE_SOURCES.RANKTOP,
        authScheme: "bearer",
        authHeaderName: "Authorization"
      },
      tokenValue,
      { authSchemeOverride: "bearer" }
    );
    const rankTopApiKeyHeaderName = String(process.env.NOODLE_RANKTOP_API_KEY_HEADER || "x-api-key").trim() || "x-api-key";
    logRankTopRequestDiagnostics(
      "preflight",
      tokenValue,
      targetUrl,
      authHeaders.Authorization || authHeaders.authorization || "",
      authHeaders[rankTopApiKeyHeaderName] || ""
    );

    try {
      const response = await fetch(targetUrl, {
        method: "GET",
        headers: {
          ...authHeaders
        }
      });
      const responseBody = await response.text().catch(() => "");
      const bodySnippet = responseBody ? responseBody.slice(0, 500) : "";

      if (!response.ok) {
        console.error(
          `❌ Rank.top auth preflight failed (${reason}): ${response.status} ${response.statusText}${bodySnippet ? ` - ${bodySnippet}` : ""}`
        );
        return false;
      }

      console.log(
        `✅ Rank.top auth preflight passed (${reason}): ${response.status}${bodySnippet ? ` - ${bodySnippet}` : ""}`
      );
      return true;
    } catch (error) {
      console.error("❌ Rank.top auth preflight threw:", error?.stack ?? error);
      return false;
    }
  }

  function startBotListStatsHeartbeat() {
    if (botListStatsHeartbeatHandle) return;
    if (!hasAnyConfiguredBotListStatsSync()) {
      console.log("INFO: Bot-list stats heartbeat disabled (no providers configured with both URL and token).");
      return;
    }

    botListStatsHeartbeatHandle = setInterval(async () => {
      const counts = getCurrentBotListCounts();
      await updateAllBotListServerCounts(counts, { reason: "heartbeat" });
    }, botListStatsSyncIntervalMs);

    if (typeof botListStatsHeartbeatHandle.unref === "function") {
      botListStatsHeartbeatHandle.unref();
    }

    console.log(`INFO: Bot-list stats heartbeat enabled every ${Math.round(botListStatsSyncIntervalMs / 1000)}s.`);
  }

  async function fetchRecommendedShardCount() {
    try {
      const response = await fetch("https://discord.com/api/v10/gateway/bot", {
        method: "GET",
        headers: {
          Authorization: `Bot ${token}`
        }
      });

      if (!response.ok) {
        const responseBody = await response.text().catch(() => "");
        console.error(
          `❌ Failed to fetch recommended shard count: ${response.status} ${response.statusText}${responseBody ? ` - ${responseBody.slice(0, 300)}` : ""}`
        );
        return null;
      }

      const data = await response.json().catch(() => ({}));
      const recommended = Number(data?.shards);
      if (!Number.isFinite(recommended) || recommended <= 0) return null;
      return Math.floor(recommended);
    } catch (error) {
      console.error("❌ Failed to fetch recommended shard count:", error?.stack ?? error);
      return null;
    }
  }

  async function refreshShardHealth({ reason = "event" } = {}) {
    const guildCount = Number(client.guilds.cache.size ?? 0);
    const recommendedShardCount = await fetchRecommendedShardCount();
    client.noodleShardHealth = {
      guildCount,
      recommendedShardCount,
      threshold: shardGuildThreshold,
      alertThreshold: shardAlertThreshold,
      lastCheckedAt: Date.now()
    };

    const nearThreshold = guildCount >= shardAlertThreshold;
    const multiShardRecommended = Number.isFinite(recommendedShardCount) && recommendedShardCount > 1;

    if (nearThreshold && !shardNearThresholdAlertSent) {
      shardNearThresholdAlertSent = true;
      await sendDevAlert({
        title: "Shard Threshold Nearing",
        description:
          `Guild count is **${guildCount.toLocaleString()}**.\n` +
          `Configured shard threshold: **${shardGuildThreshold.toLocaleString()}** guilds.\n` +
          `Near-threshold alert fires at **${Math.round(shardAlertRatio * 100)}%** (${shardAlertThreshold.toLocaleString()} guilds).\n` +
          `Discord recommended shards: **${Number.isFinite(recommendedShardCount) ? recommendedShardCount.toLocaleString() : "unknown"}**.`,
        footerText: `Reason: ${reason}`,
        color: theme.colors.warning,
        requireMention: true
      });
    } else if (!nearThreshold && shardNearThresholdAlertSent) {
      shardNearThresholdAlertSent = false;
    }

    if (multiShardRecommended && !shardRecommendedAlertSent) {
      shardRecommendedAlertSent = true;
      await sendDevAlert({
        title: "Discord Recommends Sharding",
        description:
          `Discord gateway now recommends **${recommendedShardCount.toLocaleString()}** shards.\n` +
          `Current guild count: **${guildCount.toLocaleString()}**.`,
        footerText: `Reason: ${reason}`,
        color: theme.colors.warning,
        requireMention: true
      });
    } else if (!multiShardRecommended && shardRecommendedAlertSent) {
      shardRecommendedAlertSent = false;
    }
  }

  function startEntitlementWebhookServer() {
    const port = Number(process.env.NOODLE_WEBHOOK_PORT || 0);
    const webhookPath = process.env.NOODLE_WEBHOOK_PATH || "/discord/entitlements";
    const stripeWebhookPath = process.env.NOODLE_STRIPE_WEBHOOK_PATH || "/store/stripe";
    const stripePrecheckPath = process.env.NOODLE_STRIPE_PRECHECK_PATH || "/store/stripe-precheck";
    const voteWebhookPaths = new Set(voteWebhookConfigs.map((cfg) => normalizeWebhookPath(cfg.path)));
    const enabledVoteConfigs = voteWebhookConfigs.filter((cfg) => cfg.auth);
    const publicKeyHex = process.env.DISCORD_PUBLIC_KEY || "";
    const stripeSecret = process.env.NOODLE_STRIPE_WEBHOOK_SECRET || "";
    const stripePrecheckSecret = process.env.NOODLE_STRIPE_PRECHECK_SECRET || "";

    if (!port) {
      webhookInfo("INFO: Discord store webhook disabled (NOODLE_WEBHOOK_PORT not set).");
      return;
    }
    if (!publicKeyHex) {
      webhookInfo("INFO: DISCORD_PUBLIC_KEY not set; Discord entitlement signature checks are disabled.");
    }
    if (!enabledVoteConfigs.length) {
      webhookInfo("INFO: Vote webhook auth token not set; vote webhook routes disabled.");
    }

    const server = http.createServer(async (req, res) => {
      const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const urlPath = requestUrl.pathname;
      if (req.method === "GET" && urlPath === stripePrecheckPath) {
        if (!stripePrecheckSecret) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "missing precheck secret" }));
          return;
        }

        const providedSecret = requestUrl.searchParams.get("secret") || req.headers["x-noodle-secret"];
        if (!timingSafeEqual(providedSecret, stripePrecheckSecret)) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "invalid secret" }));
          return;
        }

        if (!db) {
          res.writeHead(503, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "db unavailable" }));
          return;
        }

        const discordId = requestUrl.searchParams.get("discord_id") || "";
        const specId = requestUrl.searchParams.get("spec_id") || "";
        if (!discordId || !specId) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "missing discord_id or spec_id" }));
          return;
        }

        const serverId = getLatestServerIdForUser(db, discordId);
        const spec = getSpecializationById(specializationsContent, specId);
        const specName = spec?.name ?? null;

        if (!serverId) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, unlocked: false, spec_name: specName, reason: "missing server" }));
          return;
        }

        let player = getPlayer(db, serverId, discordId);
        if (!player) player = newPlayerProfile(discordId);
        const state = ensureSpecializationState(player);
        const unlocked = state.unlocked_spec_ids.includes(specId);

        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, unlocked, spec_name: specName }));
        return;
      }

      const normalizedUrlPath = normalizeWebhookPath(urlPath);
      const isVoteWebhookPath = voteWebhookPaths.has(normalizedUrlPath);
      if (req.method !== "POST" || (urlPath !== webhookPath && urlPath !== stripeWebhookPath && !isVoteWebhookPath)) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
        return;
      }

      let rawBody;
      try {
        rawBody = await getWebhookRawBody(req);
      } catch (error) {
        webhookError("Webhook: Failed to read body", error?.message ?? error);
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("bad request");
        return;
      }

      let decodedBody = rawBody;
      try {
        decodedBody = await decodeWebhookBody(rawBody, req.headers["content-encoding"]);
      } catch (error) {
        webhookError("Webhook: Failed to decode body", error?.message ?? error);
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("bad request");
        return;
      }

      const parsedPayload = parseWebhookPayload(decodedBody, req.headers["content-type"]);
      if (!parsedPayload.ok) {
        webhookError("Webhook: Failed to parse payload", parsedPayload.error?.message ?? parsedPayload.error);
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("invalid json");
        return;
      }
      const payload = parsedPayload.value;

      if (urlPath === stripeWebhookPath) {
        if (!stripeSecret) {
          res.writeHead(500, { "content-type": "text/plain" });
          res.end("missing stripe secret");
          return;
        }

        const signatureHeader = req.headers["stripe-signature"];
        const signatureOk = verifyStripeSignature({
          secret: stripeSecret,
          signatureHeader,
          rawBody
        });
        if (!signatureOk) {
          webhookWarn("Stripe: Invalid signature", {
            signature: signatureHeader ? String(signatureHeader).slice(0, 12) : null
          });
          res.writeHead(401, { "content-type": "text/plain" });
          res.end("invalid signature");
          return;
        }

        if (!db) {
          res.writeHead(503, { "content-type": "text/plain" });
          res.end("db unavailable");
          return;
        }

        const stripeEvent = payload;
        if (stripeEvent?.type !== "checkout.session.completed") {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("ignored");
          return;
        }

        const session = stripeEvent?.data?.object ?? {};
        const sessionId = session?.id ?? null;
        const metadata = session?.metadata ?? {};
        const discordId = metadata?.discord_id || session?.client_reference_id || null;
        const specId = metadata?.spec_id || null;

        webhookInfo(
          "Stripe: Checkout completed",
          JSON.stringify({ sessionId, discordId, specId })
        );

        if (!discordId || !specId) {
          res.writeHead(202, { "content-type": "text/plain" });
          res.end("missing discord id or spec id");
          return;
        }

        const idempotencyKey = sessionId ? `stripe_session:${sessionId}` : null;
        if (idempotencyKey) {
          const cached = getIdempotentResult(db, idempotencyKey);
          if (cached) {
            res.writeHead(200, { "content-type": "text/plain" });
            res.end("ok");
            return;
          }
        }

        const serverId = getLatestServerIdForUser(db, discordId);
        if (!serverId) {
          webhookWarn("Stripe: Missing server for user", discordId);
          res.writeHead(202, { "content-type": "text/plain" });
          res.end("missing server");
          return;
        }

        let player = getPlayer(db, serverId, discordId);
        if (!player) player = newPlayerProfile(discordId);

        const result = grantStoreBundle({
          player,
          specId,
          specializationsContent,
          decorSetsContent,
          coins: 10000
        });
        webhookInfo(
          "Stripe: Grant result",
          JSON.stringify({ ok: result.ok, reason: result.reason, specId, serverId, discordId })
        );

        if (result.ok) {
          upsertPlayer(db, serverId, discordId, player, null, player.schema_version);
          if (idempotencyKey) {
            putIdempotentResult(db, {
              key: idempotencyKey,
              userId: discordId,
              action: "stripe_checkout",
              ttlSeconds: 60 * 60 * 24 * 30,
              result: { ok: true, specId }
            });
          }

          const spec = getSpecializationById(specializationsContent, specId);
          const specName = spec?.name ?? specId;
          const stripeExternalEventId = sessionId
            ? `stripe:${sessionId}`
            : `stripe:raw:${crypto.createHash("sha256").update(rawBody).digest("hex")}`;
          recordStorePurchaseEvent(db, {
            source: "stripe_checkout",
            externalEventId: stripeExternalEventId,
            userId: discordId,
            serverId,
            specId,
            status: "granted",
            purchasedAt: Date.now()
          });
          const purchaseCount = getAllTimeSpecializationPurchaseCount(db, specId);
          await sendDevAlert({
            title: "Stripe Store Purchase Alert!",
            description:
              `User: <@${discordId}> (${discordId})\n` +
              `Specialization: ${specName} (${specId})\n` +
              `Server: ${serverId}\n` +
              `Session: ${sessionId ?? "unknown"}`,
            footerText: `Specialization Purchases: ${purchaseCount.toLocaleString()}`,
            color: theme.colors.success
          });
        }

        res.writeHead(200, { "content-type": "text/plain" });
        res.end(result.ok || result.reason === "Already unlocked." ? "ok" : "ignored");
        return;
      }

      if (isVoteWebhookPath) {
        const voteConfig = getVoteWebhookConfigByPath(urlPath);
        if (!voteConfig || !voteConfig.auth) {
          res.writeHead(503, { "content-type": "text/plain" });
          res.end("vote webhook not configured");
          return;
        }

        const providedToken = extractVoteWebhookToken(req, requestUrl, payload);
        const topggSignature = String(req.headers["x-topgg-signature"] || "").trim();

        let authValid = false;
        let effectiveVotePayload = payload;

        if (voteConfig.source === VOTE_SOURCES.TOPGG && topggSignature) {
          const signatureValid = verifyTopggWebhookSignature({
            secret: voteConfig.auth,
            signatureHeader: topggSignature,
            rawBody
          });
          authValid = signatureValid;
          if (!signatureValid && !topggRequireSignature) {
            authValid = timingSafeEqual(providedToken, voteConfig.auth);
          }
          if (!signatureValid && authValid && !topggRequireSignature) {
            webhookWarn("Top.gg: Invalid x-topgg-signature; accepted via webhook token fallback.");
          }
          if (!signatureValid && topggRequireSignature) {
            webhookWarn("Top.gg: Rejected webhook due to invalid signature with NOODLE_TOPGG_REQUIRE_SIGNATURE=1.");
          }
        } else if (voteConfig.source === VOTE_SOURCES.TOPGG) {
          authValid = !topggRequireSignature && timingSafeEqual(providedToken, voteConfig.auth);
          if (topggRequireSignature) {
            webhookWarn("Top.gg: Rejected webhook without x-topgg-signature because NOODLE_TOPGG_REQUIRE_SIGNATURE=1.");
          }
        } else if (voteConfig.source === VOTE_SOURCES.DISCORDLIST_GG) {
          const jwtResult = verifyDiscordListWebhookJwt({ secret: voteConfig.auth, payload, tokenCandidate: providedToken });
          if (jwtResult.ok) {
            authValid = true;
            effectiveVotePayload = jwtResult.claims;
          } else {
            authValid = timingSafeEqual(providedToken, normalizeAuthToken(voteConfig.auth));
          }
        } else {
          authValid = timingSafeEqual(providedToken, normalizeAuthToken(voteConfig.auth));
        }

        if (!authValid) {
          res.writeHead(401, { "content-type": "text/plain" });
          res.end("invalid authorization");
          return;
        }

        if (isVoteTestPayload(effectiveVotePayload)) {
          webhookInfo(`${voteConfig.label}: Test webhook acknowledged`);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, test: true }));
          return;
        }

        if (!db) {
          res.writeHead(503, { "content-type": "text/plain" });
          res.end("db unavailable");
          return;
        }

        const votedUserId = extractVoteUserId(effectiveVotePayload);

        if (!votedUserId) {
          res.writeHead(202, { "content-type": "text/plain" });
          res.end("missing user id");
          return;
        }

        const serverId = getLatestServerIdForUser(db, votedUserId);
        if (!serverId) {
          res.writeHead(202, { "content-type": "text/plain" });
          res.end("missing server");
          return;
        }

        let player = getPlayer(db, serverId, votedUserId);
        if (!player) player = newPlayerProfile(votedUserId);

        const voteResult = registerVoteFromSource(player, voteConfig.source, Date.now(), {
          duplicateWindowMode: voteDuplicateWindowMode
        });
        if (!voteResult.duplicate || voteResult.shouldPersistDuplicate) {
          upsertPlayer(db, serverId, votedUserId, player, null, player.schema_version);
        }

        webhookInfo(
          `${voteConfig.label}: Vote registered`,
          JSON.stringify({
            userId: votedUserId,
            source: voteResult.source,
            serverId,
            pendingClaims: voteResult.pendingClaims,
            duplicate: voteResult.duplicate
          })
        );

        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            source: voteResult.source,
            pending_claims: voteResult.pendingClaims,
            duplicate: voteResult.duplicate
          })
        );
        return;
      }

      const signature = req.headers["x-signature-ed25519"];
      const timestamp = req.headers["x-signature-timestamp"];
      if (!publicKeyHex) {
        res.writeHead(503, { "content-type": "text/plain" });
        res.end("discord webhook not configured");
        return;
      }
      const signatureOk = verifyDiscordSignature({
        publicKeyHex,
        signature,
        timestamp,
        rawBody
      });
      if (!signatureOk) {
        if (!signature || !timestamp) {
          const headerKeys = Object.keys(req.headers || {}).sort();
          webhookWarn("Discord: Missing signature headers", JSON.stringify({ headers: headerKeys }));
        }
        webhookWarn("Discord: Invalid signature", {
          signature: signature ? String(signature).slice(0, 8) : null
        });
        res.writeHead(401, { "content-type": "text/plain" });
        res.end("invalid signature");
        return;
      }

      if (!db) {
        res.writeHead(503, { "content-type": "text/plain" });
        res.end("db unavailable");
        return;
      }

      const { eventType, skuId, userId, guildId, entitlementId } = extractEntitlementPayload(payload);
      if (eventType !== "ENTITLEMENT_CREATE") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ignored");
        return;
      }

      const specId = resolveStoreBundleSpecId(skuId);
      if (!specId || !userId) {
        res.writeHead(202, { "content-type": "text/plain" });
        res.end("missing sku or user");
        return;
      }

      const idempotencyKey = entitlementId
        ? `discord_entitlement:${entitlementId}`
        : (userId && skuId ? `discord_entitlement:${userId}:${skuId}` : null);
      if (idempotencyKey) {
        const cached = getIdempotentResult(db, idempotencyKey);
        if (cached) {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("ok");
          return;
        }
      }

      const serverId = guildId || getLatestServerIdForUser(db, userId);
      if (!serverId) {
        webhookWarn("Discord: Missing server for user", userId);
        res.writeHead(202, { "content-type": "text/plain" });
        res.end("missing server");
        return;
      }

      let player = getPlayer(db, serverId, userId);
      if (!player) player = newPlayerProfile(userId);

      const result = grantStoreBundle({
        player,
        specId,
        specializationsContent,
        decorSetsContent,
        coins: 10000
      });
      webhookInfo(
        "Discord: Grant result",
        JSON.stringify({ ok: result.ok, reason: result.reason, specId, serverId, userId })
      );

      if (result.ok) {
        upsertPlayer(db, serverId, userId, player, null, player.schema_version);
        if (idempotencyKey) {
          putIdempotentResult(db, {
            key: idempotencyKey,
            userId,
            action: "discord_entitlement",
            ttlSeconds: 60 * 60 * 24 * 30,
            result: { ok: true, specId }
          });
        }

        const spec = getSpecializationById(specializationsContent, specId);
        const specName = spec?.name ?? specId;
        const discordExternalEventId = entitlementId
          ? `discord:${entitlementId}`
          : `discord:raw:${crypto.createHash("sha256").update(rawBody).digest("hex")}`;
        recordStorePurchaseEvent(db, {
          source: "discord_entitlement",
          externalEventId: discordExternalEventId,
          userId,
          serverId,
          specId,
          status: "granted",
          purchasedAt: Date.now()
        });
        const purchaseCount = getAllTimeSpecializationPurchaseCount(db, specId);
        await sendDevAlert({
          title: "Discord Store Purchase Alert!",
          description:
            `User: <@${userId}> (${userId})\n` +
            `Specialization: ${specName} (${specId})\n` +
            `Server: ${serverId}`,
          footerText: `Specialization Purchases: ${purchaseCount.toLocaleString()}`,
          color: theme.colors.success
        });
      }

      res.writeHead(200, { "content-type": "text/plain" });
      res.end(result.ok || result.reason === "Already unlocked." ? "ok" : "ignored");
    });

    server.listen(port, () => {
      webhookInfo(`OK: Discord store webhook listening on ${port}${webhookPath}`);
      webhookInfo(`OK: Stripe webhook listening on ${port}${stripeWebhookPath}`);
      for (const cfg of voteWebhookConfigs) {
        const enabledText = cfg.auth ? "enabled" : "disabled";
        webhookInfo(`OK: ${cfg.label} vote webhook ${enabledText} on ${port}${cfg.path}`);
      }
    });
  }


  client.once("ready", async (c) => {
    console.log(`✅ Logged in as ${c.user.tag}`);
    logRankTopEnvDiagnostics({ clientUserId: c.user?.id || "" });

    if (officialAutoReactEnabled && officialAutoReactKeywordMatchEnabled) {
      if (!officialMessageContentIntentEnabled) {
        console.warn("⚠️ Official auto-react keyword matching is enabled but NOODLE_OFFICIAL_ENABLE_MESSAGE_CONTENT_INTENT is not set to 1. Keyword matching may not work in production; channel-id matching will still work.");
      } else if (!messageContentIntentApplied) {
        console.warn("⚠️ Official auto-react keyword matching is enabled and intent is requested, but MESSAGE_CONTENT is unavailable in this discord.js/runtime environment. Keyword matching may not work; channel-id matching will still work.");
      }
    }

    try {
      await c.user.setPresence({
        status: "online",
        activities: [{
          name: "/noodle help | /noodle start",
          type: "PLAYING"
        }]
      });
    } catch (error) {
      console.error("⚠️ Failed to set bot presence:", error?.message ?? error);
    }

    const customEmojis = getCustomEmojiEntries();
    const { ids: accessibleEmojiIds, applicationEmojiCount } = await resolveAccessibleEmojiIds(client, token);
    await refreshShardHealth({ reason: "ready" });
    const missingEmojis = customEmojis.filter((emoji) => !accessibleEmojiIds.has(emoji.id));
    if (missingEmojis.length) {
      const missingList = missingEmojis
        .map((emoji) => `${emoji.key} -> ${emoji.name}:${emoji.id}`)
        .join(", ");
      console.error("❌ Missing custom emojis for this bot:");
      console.error(missingList);
      console.error("Ensure the bot is authorized for the emoji host application or update content/icons.json IDs.");
      console.error(`(Application emojis available: ${applicationEmojiCount})`);
    } else {
      console.log(
        `✅ Custom emoji check passed (${customEmojis.length} entries, application emojis available: ${applicationEmojiCount}).`
      );
    }

    try {
      fs.writeFileSync(
        BOOT_PATH,
        `Boot OK\nTime: ${new Date().toISOString()}\nFile: ${__filename}\nCWD: ${CWD}\n`
      );
      console.log("✅ Boot marker written:", BOOT_PATH);
    } catch (e) {
      console.error("❌ Failed to write boot marker:", e?.stack ?? e);
    }

    const startupCounts = getCurrentBotListCounts();
    if (hasAnyConfiguredBotListStatsSync()) {
      await updateAllBotListServerCounts(startupCounts, { reason: "ready" });
    } else {
      console.log("INFO: Skipping bot-list stats sync on ready (no providers configured with both URL and token).");
    }
    await updateOfficialStatsChannels(startupCounts, { reason: "ready" });
    await syncDiscordBotListCommands({ reason: "ready" });
    await syncRadarCpdvCommands({ reason: "ready" });
    await runRankTopAuthPreflight({ reason: "ready" });
    await syncRankTopCommands({ reason: "ready", precomputedCounts: startupCounts });
    startBotListStatsHeartbeat();

    if (officialStatsChannelsEnabled && officialGuildId && !officialStatsChannelRefreshHandle) {
      officialStatsChannelRefreshHandle = setInterval(() => {
        updateOfficialStatsChannels(null, { reason: "interval" });
      }, officialStatsChannelRefreshIntervalMs);
      officialStatsChannelRefreshHandle.unref?.();
    }

    startDailyResetScheduler(getKnownServerIds);
    startDailyRewardReminderScheduler(client, getKnownServerIds);
    startEventSyncScheduler(getKnownServerIds);
    startDbBackupScheduler(db);
    startDbMaintenanceScheduler(db);

    const backupOnStart = process.env.NOODLE_BACKUP_ON_START !== "0";
    if (backupOnStart) {
      setTimeout(() => {
        runDbBackup(db, "startup");
      }, 60_000);
    }
  });

  client.on("guildCreate", async (guild) => {
    try {
      const currentCounts = getCurrentBotListCounts();
      await updateAllBotListServerCounts(currentCounts, { reason: "guildCreate" });
      await updateOfficialStatsChannels(currentCounts, { reason: "guildCreate" });
      await refreshShardHealth({ reason: "guildCreate" });

      if (guild?.id === officialGuildId) return;
      const memberCount = Number(guild?.memberCount ?? 0);
      await sendDevAlert({
        title: "New Server Alert!",
        description:
          `New Server: ${String(guild?.name || "Unknown Server")}\n` +
          `Members: ${memberCount.toLocaleString()}`,
        footerText: `Current Server Count: ${currentCounts.serverCount.toLocaleString()}`,
        color: theme.colors.success,
        requireMention: true
      });
    } catch (error) {
      console.error("❌ Failed to send guild join alert:", error?.stack ?? error);
    }
  });

  client.on("guildDelete", async (guild) => {
    try {
      const currentCounts = getCurrentBotListCounts();
      await updateAllBotListServerCounts(currentCounts, { reason: "guildDelete" });
      await updateOfficialStatsChannels(currentCounts, { reason: "guildDelete" });
      await refreshShardHealth({ reason: "guildDelete" });

      if (guild?.id === officialGuildId) return;
      await sendDevAlert({
        title: "Server Left Alert!",
        description: `Left Server: ${String(guild?.name || "Unknown Server")}`,
        footerText: `Current Server Count: ${currentCounts.serverCount.toLocaleString()}`,
        color: theme.colors.warning,
        requireMention: true
      });
    } catch (error) {
      console.error("❌ Failed to send guild leave alert:", error?.stack ?? error);
    }
  });

  client.on("messageCreate", async (message) => {
    try {
      if (!officialAutoReactEnabled || !officialGuildId) return;
      if (!message?.guildId || message.guildId !== officialGuildId) return;
      if (message.author?.id === client.user?.id) return;
      if (officialAutoReactBotsOnly && !message.author?.bot) return;

      const channelId = String(message.channelId || "");
      const searchBlob = officialAutoReactKeywordMatchEnabled ? getMessageSearchBlob(message) : "";

      const isWelcomeMatch = officialWelcomeAutoReactChannels.has(channelId)
        || (officialAutoReactKeywordMatchEnabled && officialWelcomeKeywords.some((keyword) => searchBlob.includes(keyword)));
      const isLevelMatch = officialLevelAutoReactChannels.has(channelId)
        || (officialAutoReactKeywordMatchEnabled && officialLevelKeywords.some((keyword) => searchBlob.includes(keyword)));

      if (!isWelcomeMatch && !isLevelMatch) return;

      if (isWelcomeMatch) {
        for (const emoji of officialWelcomeAutoReactEmojis) {
          await tryAutoReact(message, emoji);
        }
      }
      if (isLevelMatch) {
        for (const emoji of officialLevelAutoReactEmojis) {
          await tryAutoReact(message, emoji);
        }
      }
    } catch (error) {
      console.error("❌ Official auto-react handler failed:", error?.stack ?? error);
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Interaction handling                                               */
  /* ------------------------------------------------------------------ */

  function getCustomIdPrefix(customId, maxSegments = 3) {
    const id = String(customId || "").trim();
    if (!id) return null;
    const parts = id.split(":").filter(Boolean);
    if (!parts.length) return null;
    return parts.slice(0, maxSegments).join(":");
  }

  function getNoodleSubroute(customId) {
    const id = String(customId || "").trim();
    if (!id.startsWith("noodle:")) return null;
    const parts = id.split(":");
    const kind = parts[1] || "unknown";
    const action = parts[2] || "unknown";
    return `${kind}:${action}`;
  }

  function getSlashSubroute(interaction) {
    if (!interaction?.isChatInputCommand?.() && !interaction?.isCommand?.()) return null;
    if (interaction?.commandName !== "noodle") return null;
    try {
      const sub = interaction.options?.getSubcommand?.(false);
      return sub ? `subcommand:${sub}` : null;
    } catch {
      return null;
    }
  }

  client.on("interactionCreate", async (interaction) => {
    return withInteractionPerf(() => withPlayerCache(async () => {
    const startWallMs = Date.now();
    const startPerfMs = performance.now();
    const slowThresholdMs = 3000;
    const createdAt = Number(interaction.createdTimestamp ?? startWallMs);
    const age = startWallMs - createdAt;
    let telemetryRoute = "unknown";
    let telemetrySubroute = null;
    let telemetryCustomIdPrefix = null;
    let deferMs = null;
    let telemetryError = null;

    try {
      // Check interaction age - Discord invalidates after 3 seconds
      if (age > 2800) {
        telemetryRoute = "skip_stale";
        console.error(`Interaction is ${age}ms old, likely to expire. Skipping.`);
        return;
      }
    
    // IMMEDIATELY defer buttons/selects/modals FIRST, before ANY other logic
    // Note: Discord.js v13 uses isSelectMenu(), not isStringSelectMenu()
    const isBtn = interaction.isButton?.();
    const isSelect = interaction.isSelectMenu?.();
    const isModal = interaction.isModalSubmit?.();
    const cid = interaction.customId;
    telemetryCustomIdPrefix = getCustomIdPrefix(cid);
    const isNoodle = cid?.startsWith("noodle:");
    const isNoodleDev = cid?.startsWith("noodle-dev:");
    const isNoodleSocial = cid?.startsWith("noodle-social:");
    const isNoodleStaff = cid?.startsWith("noodle-staff:");
    const isNoodleUpgrades = cid?.startsWith("noodle-upgrades:");

    if (isNoodle) {
      telemetrySubroute = getNoodleSubroute(cid);
    }
    
    const alreadyAck = interaction.deferred || interaction.replied;

    // Defer buttons/selects with deferUpdate (updates original message)
    // BUT: Don't defer buttons/selects that will show modals
    if (!alreadyAck && (isBtn || isSelect)) {
      if (isNoodle || isNoodleDev || isNoodleSocial || isNoodleStaff || isNoodleUpgrades) {
        // Check if this button/select will show a modal
          const willShowModal = cid?.includes("pick:cook_select:") ||
              cid?.includes("pick:forage_item_select:") ||
              cid?.includes("pick:fishing_item_select:") ||
              cid?.includes("action:party_create") ||
              cid?.includes("action:party_join") ||
              cid?.includes("action:party_invite") ||
                cid?.includes("action:tip") ||
                cid?.includes("action:bless") ||
              (cid?.startsWith("noodle-social:select:recent_target:") && cid?.includes(":tip:")) ||
            cid?.includes("profile:edit_shop_name") ||
            cid?.includes("profile:edit_tagline") ||
              cid?.includes("action:shared_order_contribute") ||
              cid?.includes("select:shared_order_ingredient");
        
        // Buttons that update message immediately without database operations
        const skipDeferButtons = cid?.includes("action:shared_order_confirm_complete") ||
                cid?.includes("action:shared_order_abort_cancel") ||
                cid?.includes("action:shared_order_cancel_complete");
        
        if (!willShowModal && !skipDeferButtons && !isNoodleStaff) {
          const deferStart = performance.now();
          try {
            await interaction.deferUpdate();
            deferMs = performance.now() - deferStart;
          } catch (e) {
            deferMs = performance.now() - deferStart;
            console.error(`Button/select defer failed (age was ${age}ms):`, e?.message);
            // If defer failed due to unknown interaction, skip processing
            if (e?.message?.includes("Unknown interaction") || e?.code === 10062) {
              console.error("Skipping handler - interaction expired");
              return;
            }
            // Continue processing - handler may be able to respond directly
          }
        }
      }
    }

    /* ---------- AUTOCOMPLETE ---------- */
    if (interaction.isAutocomplete()) {
      telemetryRoute = "autocomplete";
      try {
        if (interaction.commandName !== "noodle") return;

        const sub = interaction.options.getSubcommand(false);
        const focused = interaction.options.getFocused(true);
        const q = String(focused?.value ?? "").toLowerCase();

        // ✅ Cook autocomplete (known recipes only)
        if (sub === "cook" && focused.name === "recipe") {
          telemetryRoute = "autocomplete:cook";
          const serverId = interaction.guildId;
          const userId = interaction.user.id;
          if (!serverId) return interaction.respond([]);

          const p = getPlayerLiteOrDefault(serverId, userId);
          // Include temporary recipes from resilience
          const permanent = p.known_recipes || [];
          const temporary = p.resilience?.temp_recipes || [];
          const known = [...new Set([...permanent, ...temporary])];

          const results = known
            .map((id) => {
              const r = content.recipes?.[id];
              const name = r?.name ?? id;
              return { id, name };
            })
            .filter(x =>
              x.id.toLowerCase().includes(q) ||
              x.name.toLowerCase().includes(q)
            )
            .slice(0, 25)
            .map(x => ({
              name: String(x.name).slice(0, 100),
              value: String(x.id).slice(0, 100)
            }));

          return interaction.respond(results);
        }

        // ✅ Badge autocomplete (owned badges)
        if (sub === "badge_set" && focused.name === "badge_id") {
          telemetryRoute = "autocomplete:badge_set";
          const serverId = interaction.guildId;
          const userId = interaction.user.id;
          if (!serverId) return interaction.respond([]);

          const p = getPlayerLiteOrDefault(serverId, userId);
          const owned = Array.isArray(p.profile?.badges) ? p.profile.badges : [];
          const results = owned
            .map((id) => {
              const badge = badgesContent?.badges?.find((b) => b.badge_id === id);
              const name = badge?.name ?? id;
              return { id, name };
            })
            .filter((x) =>
              x.id.toLowerCase().includes(q) || x.name.toLowerCase().includes(q)
            )
            .slice(0, 25)
            .map((x) => ({
              name: String(x.name).slice(0, 100),
              value: String(x.id).slice(0, 100)
            }));

          return interaction.respond(results);
        }

        // ✅ Specialization autocomplete
        if (sub === "specialize" && focused.name === "spec") {
          telemetryRoute = "autocomplete:specialize";
          const results = (specializationsContent?.specializations ?? [])
            .map((spec) => ({ id: spec.spec_id, name: spec.name }))
            .filter((x) =>
              x.id.toLowerCase().includes(q) || x.name.toLowerCase().includes(q)
            )
            .slice(0, 25)
            .map((x) => ({
              name: String(x.name).slice(0, 100),
              value: String(x.id).slice(0, 100)
            }));

          return interaction.respond(results);
        }

        // ✅ Market autocomplete (buy/sell) — only ingredients used by unlocked recipes
        if ((sub === "buy" || sub === "sell") && focused.name === "item") {
          telemetryRoute = `autocomplete:${sub}`;
          const serverId = interaction.guildId;
          const userId = interaction.user.id;
          if (!serverId) return interaction.respond([]);

          const p = getPlayerLiteOrDefault(serverId, userId);
          const allowed = getUnlockedIngredientIds(p, content);

          const results = Object.values(content.items ?? {})
            .filter(it => it && it.item_id && (it.acquisition === "market" || it.base_price))
            .filter(it => allowed.has(it.item_id))
            .filter(it => it.name?.toLowerCase().includes(q) || it.item_id.toLowerCase().includes(q))
            .slice(0, 25)
            .map(it => ({
              name: String(it.name ?? it.item_id).slice(0, 100),
              value: String(it.item_id).slice(0, 100)
            }));

          return interaction.respond(results);
        }

        // ✅ Forage autocomplete (unlocked forage items only)
        if (sub === "forage" && focused.name === "item") {
          telemetryRoute = "autocomplete:forage";
          const serverId = interaction.guildId;
          const userId = interaction.user.id;
          if (!serverId) return interaction.respond([]);

          const p = getPlayerLiteOrDefault(serverId, userId);
          const allowed = getUnlockedIngredientIds(p, content);
          const allowedForage = (FORAGE_ITEM_IDS ?? []).filter(id => allowed.has(id));

          const results = allowedForage
            .map(id => ({ id, name: content.items?.[id]?.name ?? id }))
            .filter(x =>
              x.id.toLowerCase().includes(q) ||
              x.name.toLowerCase().includes(q)
            )
            .slice(0, 25)
            .map(x => ({
              name: String(x.name).slice(0, 100),
              value: String(x.id).slice(0, 100)
            }));

          return interaction.respond(results);
        }

        // ✅ Fishing autocomplete (fishing table items)
        if (sub === "fishing" && focused.name === "item") {
          telemetryRoute = "autocomplete:fishing";
          const results = (FISHING_ITEM_IDS ?? [])
            .map(id => ({ id, name: content.items?.[id]?.name ?? id }))
            .filter(x =>
              x.id.toLowerCase().includes(q) ||
              x.name.toLowerCase().includes(q)
            )
            .slice(0, 25)
            .map(x => ({
              name: String(x.name).slice(0, 100),
              value: String(x.id).slice(0, 100)
            }));

          return interaction.respond(results);
        }

        return interaction.respond([]);
      } catch (e) {
        telemetryError = e?.code ?? e?.name ?? "autocomplete_error";
        console.error("AUTOCOMPLETE ERROR:", e?.stack ?? e);
        try { return interaction.respond([]); } catch { return; }
      }
    }

    const userId = interaction.user?.id ?? null;
    const serverId = interaction.guildId ?? null;
    const rateLimit = checkRateLimit({
      userId,
      serverId,
      userLimit: 50,
      serverLimit: 400
    });

    if (!rateLimit.allowed) {
      telemetryRoute = "rate_limited";
      emitTelemetry("rate_limited", {
        scope: rateLimit.scope,
        userId,
        serverId,
        count: rateLimit.count,
        limit: rateLimit.limit
      });

      const slowDownMsg = "Please don't spam interactions! Try again in a bit.";
      try {
        if (interaction.replied || interaction.deferred) {
          return interaction.followUp({ content: slowDownMsg, ephemeral: true });
        }
        return interaction.reply({ content: slowDownMsg, ephemeral: true });
      } catch (e) {
        console.error("RATE LIMIT REPLY ERROR:", e?.message ?? e);
        if (isMissingAccessError(e)) {
          await sendMissingAccessDm(interaction);
        }
        return;
      }
    }

    const isAnyComponent = interaction.isButton?.() || interaction.isSelectMenu?.() || interaction.isModalSubmit?.();
    const isAnySlash = interaction.isChatInputCommand?.() || interaction.isCommand?.();
    if (db && serverId && userId && (isAnyComponent || isAnySlash)) {
      try {
        recordRecentSocialInteraction(db, serverId, userId);
      } catch (e) {
        console.error("Failed to record recent interaction user:", e?.message ?? e);
      }
    }

    /* ---------- NOODLE UI COMPONENTS ---------- */
    if (interaction.isButton?.() || interaction.isSelectMenu?.() || interaction.isModalSubmit?.()) {
      telemetryRoute = "component";
      try {
        const id = interaction.customId || "";
        if (id.startsWith("noodle:")) {
          telemetryRoute = "component:noodle";
          telemetrySubroute = getNoodleSubroute(id);
          telemetryCustomIdPrefix = getCustomIdPrefix(id);
          // Already deferred at the top of interactionCreate handler
          return await noodleCommand.handleComponent(interaction);
        }
        if (id.startsWith("noodle-dev:")) {
          telemetryRoute = "component:noodle-dev";
          // Already deferred at the top of interactionCreate handler
          return await noodleDevCommand.handleComponent(interaction);
        }
        if (id.startsWith("noodle-social:")) {
          telemetryRoute = "component:noodle-social";
          // Already deferred at the top of interactionCreate handler
          return await noodleSocialCommand.handleComponent(interaction);
        }
        if (id.startsWith("noodle-staff:")) {
          telemetryRoute = "component:noodle-staff";
          const result = sanitizeResultEmbeds(await noodleStaffInteractionHandler(interaction));
          if (result) {
            if (result.ephemeral) {
              if (interaction.replied || interaction.deferred) {
                return await interaction.followUp({ ...result, ephemeral: true });
              }
              return await interaction.reply({ ...result, ephemeral: true });
            }
            if (interaction.replied || interaction.deferred) {
              return await interaction.editReply(result);
            }
            return await interaction.update(result);
          }
        }
        if (id.startsWith("noodle-upgrades:")) {
          telemetryRoute = "component:noodle-upgrades";
          const result = sanitizeResultEmbeds(await noodleUpgradesInteractionHandler(interaction));
          if (result) {
            if (result.ephemeral) {
              if (interaction.replied || interaction.deferred) {
                return await interaction.followUp({ ...result, ephemeral: true });
              }
              return await interaction.reply({ ...result, ephemeral: true });
            }
            if (interaction.replied || interaction.deferred) {
              return await interaction.editReply(result);
            }
            return await interaction.update(result);
          }
        }
      } catch (e) {
        telemetryError = e?.code ?? e?.name ?? "component_error";
        const detail = e?.stack ?? String(e);
        console.error("NOODLE COMPONENT ERROR:", detail);
        logUserError(interaction, "component_error", detail);
        // Don't try to respond if interaction is already acknowledged or unknown
        if (e?.code === 10062 || e?.message?.includes("Unknown interaction") || 
            e?.message?.includes("already been acknowledged")) {
          console.log(`⏭️  Skipping error reply - interaction invalid or already handled`);
          return;
        }
        try {
          const msg = friendlyErrorMessage(e);
          await sendInteractionErrorWithFallback(interaction, msg, e);
          return;
        } catch {}
        return;
      }
    }

    /* ---------- SLASH COMMANDS ---------- */
    const isChatInput = interaction.isChatInputCommand?.() || interaction.isCommand?.();
    if (!isChatInput) {
      telemetryRoute = "ignored_non_chat_input";
      return;
    }

    const cmd = commandMap.get(interaction.commandName);
    if (!cmd) {
      telemetryRoute = `unknown_command:${interaction.commandName ?? "none"}`;
      return;
    }
    telemetryRoute = `slash:${interaction.commandName}`;
    telemetrySubroute = getSlashSubroute(interaction);

    try {
      await cmd.execute(interaction);
    } catch (e) {
      telemetryError = e?.code ?? e?.name ?? "command_error";
      const detail = e?.stack ?? String(e);
      console.error("COMMAND ERROR:", detail);
      logUserError(interaction, "command_error", detail);

      try {
        fs.appendFileSync(LOG_PATH, `\n[${new Date().toISOString()}]\n${detail}\n`);
        console.log(`📋 Error written to:`, LOG_PATH);
      } catch (err) {
        console.error("❌ Failed to write error log:", err?.stack ?? err);
      }

      try {
        const msg = friendlyErrorMessage(e);
        await sendInteractionErrorWithFallback(interaction, msg, e);
      } catch (replyErr) {
        console.error("❌ Failed to send error reply:", replyErr?.message ?? replyErr);
      }
    }
    } finally {
      const perf = getInteractionPerfSnapshot();
      const totalMs = performance.now() - startPerfMs;
      emitTelemetry("interaction_latency", {
        route: telemetryRoute,
        subroute: telemetrySubroute,
        customIdPrefix: telemetryCustomIdPrefix,
        commandName: interaction.commandName ?? null,
        interactionType: interaction.type,
        isAutocomplete: interaction.isAutocomplete?.() ?? false,
        isButton: interaction.isButton?.() ?? false,
        isSelectMenu: interaction.isSelectMenu?.() ?? false,
        isModalSubmit: interaction.isModalSubmit?.() ?? false,
        ageMs: age,
        deferMs,
        totalMs,
        deferred: interaction.deferred ?? false,
        replied: interaction.replied ?? false,
        error: telemetryError,
        dbReadMs: perf?.dbReadMs ?? 0,
        dbReadCount: perf?.dbReadCount ?? 0,
        dbWriteMs: perf?.dbWriteMs ?? 0,
        dbWriteCount: perf?.dbWriteCount ?? 0,
        lockAcquireMs: perf?.lockAcquireMs ?? 0,
        lockAcquireCount: perf?.lockAcquireCount ?? 0,
        lockReleaseMs: perf?.lockReleaseMs ?? 0,
        lockReleaseCount: perf?.lockReleaseCount ?? 0,
        lockBusyCount: perf?.lockBusyCount ?? 0
      });

      if (totalMs > slowThresholdMs) {
        emitTelemetry("interaction_slow_event", {
          route: telemetryRoute,
          subroute: telemetrySubroute,
          customIdPrefix: telemetryCustomIdPrefix,
          commandName: interaction.commandName ?? null,
          totalMs,
          deferMs,
          error: telemetryError,
          dbReadCount: perf?.dbReadCount ?? 0,
          dbWriteCount: perf?.dbWriteCount ?? 0,
          lockAcquireCount: perf?.lockAcquireCount ?? 0,
          lockReleaseCount: perf?.lockReleaseCount ?? 0,
          lockBusyCount: perf?.lockBusyCount ?? 0
        });
      }
    }
    }));
  });

  startEntitlementWebhookServer();

  client.login(token);
})();
