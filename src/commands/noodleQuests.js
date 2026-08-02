import { SlashCommandBuilder } from "@discordjs/builders";
import { openDb, getPlayer, upsertPlayer, getServer, upsertServer } from "../db/index.js";
import { withLock } from "../infra/locks.js";
import { makeIdempotencyKey, getIdempotentResult, putIdempotentResult } from "../infra/idempotency.js";
import { newPlayerProfile, trackLastKitchen } from "../game/player.js";
import { newServerState } from "../game/server.js";
import { loadQuestsContent, loadDailyRewards } from "../content/index.js";
import { claimDailyReward } from "../game/daily.js";
import { claimCompletedQuests, getQuestSummary } from "../game/quests.js";
import { getIcon } from "../ui/icons.js";
import {
  buildComponentsV2PayloadWithNoticeCards,
  legacyEmbedsToV2TextComponents,
  isComponentsV2Payload,
  isInvalidComponentTypeError,
  rawWebhookEditOriginal
} from "../ui/componentsV2.js";

const MESSAGE_FLAG_EPHEMERAL = 1 << 6;

const db = openDb();
const questsContent = loadQuestsContent();
const dailyRewards = loadDailyRewards();

function buildMenuContainerReply({ title, description, ownerId, ephemeral = false } = {}) {
  const mainComponents = [];
  const safeTitle = String(title ?? "").trim();
  const safeDescription = String(description ?? "").trim();
  if (safeTitle) mainComponents.push({ type: 10, content: `## ${safeTitle}` });
  if (safeDescription) mainComponents.push({ type: 10, content: safeDescription });

  return buildComponentsV2PayloadWithNoticeCards({
    mainComponents,
    notices: [],
    ownerId: String(ownerId || "").trim() || undefined,
    ephemeral: Boolean(ephemeral)
  });
}

function normalizeLegacyComponentRows(rows = []) {
  if (!Array.isArray(rows)) return [];
  const normalized = [];
  for (const row of rows) {
    if (!row) continue;
    const baseRow = row?.toJSON?.() ?? row;
    const rawComponents = baseRow?.components ?? row?.components ?? [];
    const mapped = (rawComponents || [])
      .map((comp) => comp?.toJSON?.() ?? comp)
      .filter(Boolean);
    if (!mapped.length) continue;
    normalized.push({ type: 1, components: mapped });
  }
  return normalized;
}

function buildLegacyEmbedsV2Payload(embeds = [], options = {}) {
  const list = Array.isArray(embeds) ? embeds : [];
  const ownerId = String(options?.ownerId ?? "").trim() || undefined;
  const ephemeral = Boolean(options?.ephemeral === true || options?.ephemeral === 1 || options?.ephemeral === "true");
  const components = Array.isArray(options?.components) ? options.components : [];
  const primaryEmbed = list[0] ?? null;
  const notificationEmbeds = list.slice(1);
  const mainComponents = [
    ...legacyEmbedsToV2TextComponents(primaryEmbed ? [primaryEmbed] : []),
    ...normalizeLegacyComponentRows(components)
  ];
  const notices = notificationEmbeds
    .map((embed) => {
      const raw = embed?.toJSON?.() ?? embed ?? {};
      const title = String(raw?.title ?? "").trim() || "Notification";
      const details = legacyEmbedsToV2TextComponents([embed])
        .map((entry) => String(entry?.content ?? "").trim())
        .filter(Boolean);
      return details.length > 0 || title ? { title, details, tone: "info" } : null;
    })
    .filter(Boolean);

  return buildComponentsV2PayloadWithNoticeCards({
    mainComponents,
    notices,
    ownerId,
    ephemeral
  });
}

function convertPayloadToComponentsV2(interaction, payload = {}, player = null) {
  if (isComponentsV2Payload(payload)) {
    return payload;
  }

  const hasSourceNativeComponents = Array.isArray(payload?.mainComponents) || Array.isArray(payload?.notices);
  if (hasSourceNativeComponents) {
    const explicitMainComponents = Array.isArray(payload?.mainComponents) ? payload.mainComponents : [];
    const normalizedRows = normalizeLegacyComponentRows(payload?.components);
    const isEphemeral = payload?.ephemeral === true || ((Number(payload?.flags) & (1 << 6)) !== 0);
    return buildComponentsV2PayloadWithNoticeCards({
      mainComponents: [...explicitMainComponents, ...normalizedRows],
      notices: Array.isArray(payload?.notices) ? payload.notices : [],
      ownerId: interaction?.user?.id ?? payload?.ownerId,
      ephemeral: isEphemeral
    });
  }

  if (payload && typeof payload === "object" && Array.isArray(payload.embeds) && payload.embeds.length > 0) {
    return buildLegacyEmbedsV2Payload(payload.embeds, {
      components: payload.components,
      ownerId: interaction?.user?.id ?? payload.ownerId,
      ephemeral: payload.ephemeral === true || ((Number(payload.flags) & (1 << 6)) !== 0)
    });
  }
  return buildComponentsV2PayloadWithNoticeCards({
    mainComponents: Array.isArray(payload?.components) ? payload.components : [],
    notices: [],
    ownerId: interaction?.user?.id ?? payload.ownerId,
    ephemeral: payload.ephemeral === true || ((Number(payload.flags) & (1 << 6)) !== 0)
  });
}

export function normalizePayloadForReply(interaction, payload = {}, player = null) {
  return convertPayloadToComponentsV2(interaction, payload, player);
}

async function sendQuestsPayload(interaction, payload = {}) {
  const finalPayload = payload ?? {};
  const isV2 = isComponentsV2Payload(finalPayload);

  if (!isV2) {
    if (interaction.replied || interaction.deferred) {
      return interaction.editReply(finalPayload);
    }
    return interaction.reply(finalPayload);
  }

  if (interaction.replied || interaction.deferred) {
    try {
      return await rawWebhookEditOriginal(interaction, finalPayload);
    } catch {
      try {
        return await interaction.editReply(finalPayload);
      } catch (e) {
        if (isInvalidComponentTypeError(e)) {
          return rawWebhookEditOriginal(interaction, finalPayload);
        }
        throw e;
      }
    }
  }

  const isEphemeral = finalPayload.ephemeral === true
    || ((Number(finalPayload.flags) & MESSAGE_FLAG_EPHEMERAL) !== 0);
  try {
    await interaction.deferReply({ ephemeral: isEphemeral });
    return await rawWebhookEditOriginal(interaction, finalPayload);
  } catch {
    const canEditReply = interaction.deferred || interaction.replied;
    try {
      return canEditReply
        ? await interaction.editReply(finalPayload)
        : await interaction.reply(finalPayload);
    } catch (e) {
      if (isInvalidComponentTypeError(e)) {
        if (!canEditReply) {
          await interaction.deferReply({ ephemeral: isEphemeral });
        }
        return rawWebhookEditOriginal(interaction, finalPayload);
      }
      throw e;
    }
  }
}

export const noodleQuestsCommand = {
  data: new SlashCommandBuilder()
    .setName("noodle-quests")
    .setDescription("View quests and claim daily rewards")
    .addSubcommand((sub) =>
      sub
        .setName("daily")
        .setDescription("Claim your daily reward")
    )
    .addSubcommand((sub) =>
      sub
        .setName("claim")
        .setDescription("Claim completed quest rewards")
    ),
  execute: noodleQuestsHandler
};

export async function noodleQuestsHandler(interaction) {
  const userId = interaction.user.id;
  const serverId = interaction.guild?.id ?? "DM";

  const commit = async (payload, player = null) => {
    const normalized = normalizePayloadForReply(interaction, payload ?? {}, player);
    return sendQuestsPayload(interaction, normalized);
  };

  const idempKey = makeIdempotencyKey({
    serverId,
    userId,
    action: "noodle-quests",
    interactionId: interaction.id
  });
  const cached = getIdempotentResult(db, idempKey);
  if (cached) return commit(cached);

  const lockedReply = await withLock(db, `user:${userId}`, `discord:${interaction.id}`, 8000, async () => {
    let player = getPlayer(db, serverId, userId);
    let server = getServer(db, serverId);
    if (!player) player = newPlayerProfile(userId);
    if (!server) server = newServerState(serverId);

    trackLastKitchen(player, serverId, interaction.channelId);

    const sub = interaction.options.getSubcommand();
    let reply;

    if (sub === "daily") {
      const result = claimDailyReward(player, dailyRewards);
      if (!result.ok) {
        reply = buildMenuContainerReply({
          title: `${getIcon("daily_reward")} Daily Reward`,
          description: result.message,
          ownerId: userId,
          ephemeral: true
        });
      } else {
        const rewardLines = [];
        if (result.reward.coins) rewardLines.push(`${getIcon("coins")} **${result.reward.coins}c**`);
        if (result.reward.sxp) rewardLines.push(`${getIcon("sxp")} **${result.reward.sxp} SXP**`);
        if (result.reward.rep) rewardLines.push(`${getIcon("rep")} **${result.reward.rep} REP**`);

        const levelLine = result.leveledUp > 0 ? `
${getIcon("level_up")} Level up! **+${result.leveledUp}**` : "";
        reply = buildMenuContainerReply({
          title: `${getIcon("daily_reward")} Daily Reward`,
          description: `Streak: **${result.streak}** day(s)\nRewards: ${rewardLines.join(" · ")}${levelLine}`,
          ownerId: userId
        });
      }
    }

    if (sub === "quests") {
      const summary = getQuestSummary(player, questsContent, userId);
      const active = summary.active;
      if (!active.length) {
        reply = buildMenuContainerReply({
          title: `${getIcon("quests")} Quests`,
          description: "_No quests available right now._",
          ownerId: userId,
          ephemeral: true
        });
      } else {
        const lines = active.map((q) => {
          const status = q.completed_at ? getIcon("status_complete") : getIcon("status_pending");
          const rewardParts = [];
          if (q.reward?.coins) rewardParts.push(`${q.reward.coins}c`);
          if (q.reward?.sxp) rewardParts.push(`${q.reward.sxp} SXP`);
          if (q.reward?.rep) rewardParts.push(`${q.reward.rep} REP`);
          const rewardText = rewardParts.length ? ` — ${rewardParts.join(" · ")}` : "";
          return `${status} **${q.name}** (${q.progress}/${q.target})${rewardText}`;
        });

        reply = buildMenuContainerReply({
          title: `${getIcon("quests")} Quests`,
          description: lines.join("\n"),
          ownerId: userId
        });
      }
    }

    if (sub === "claim") {
      const result = claimCompletedQuests(player);
      if (!result.claimed.length) {
        reply = buildMenuContainerReply({
          title: `${getIcon("quest_rewards")} Quest Rewards`,
          description: "_No completed quests to claim._",
          ownerId: userId,
          ephemeral: true
        });
      } else {
        const lines = result.claimed.map((entry) => {
          const rewardParts = [];
          if (entry.reward?.coins) rewardParts.push(`${entry.reward.coins}c`);
          if (entry.reward?.sxp) rewardParts.push(`${entry.reward.sxp} SXP`);
          if (entry.reward?.rep) rewardParts.push(`${entry.reward.rep} REP`);
          return `${getIcon("status_complete")} **${entry.quest.name}** — ${rewardParts.join(" · ")}`;
        });

        const levelLine = result.leveledUp > 0 ? `
${getIcon("level_up")} Level up! **+${result.leveledUp}**` : "";
        reply = buildMenuContainerReply({
          title: `${getIcon("quest_rewards")} Quest Rewards`,
          description: `${lines.join("\n")}${levelLine}`,
          ownerId: userId
        });
      }
    }

    upsertPlayer(db, serverId, userId, player, null, player.schema_version);
    upsertServer(db, serverId, server, null);

    putIdempotentResult(db, { key: idempKey, userId, action: "noodle-quests", ttlSeconds: 900, result: reply });
    return reply;
  });

  const finalPlayer = getPlayer(db, serverId, userId) || null;
  return commit(lockedReply, finalPlayer);
}
