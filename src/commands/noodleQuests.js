import { SlashCommandBuilder } from "@discordjs/builders";
import discordPkg from "discord.js";
import { openDb, getPlayer, upsertPlayer, getServer, upsertServer } from "../db/index.js";
import { withLock } from "../infra/locks.js";
import { makeIdempotencyKey, getIdempotentResult, putIdempotentResult } from "../infra/idempotency.js";
import { newPlayerProfile, trackLastKitchen } from "../game/player.js";
import { newServerState } from "../game/server.js";
import { loadQuestsContent, loadDailyRewards } from "../content/index.js";
import { claimDailyReward } from "../game/daily.js";
import { claimCompletedQuests, getQuestSummary } from "../game/quests.js";
import { theme } from "../ui/theme.js";
import { getIcon, getButtonEmoji } from "../ui/icons.js";
import {
  buildComponentsV2PayloadWithNoticeCards,
  isComponentsV2Enabled,
  MESSAGE_FLAG_IS_COMPONENTS_V2
} from "../ui/componentsV2.js";

const {
  MessageEmbed
} = discordPkg;

const EmbedBuilder = MessageEmbed;
const MESSAGE_FLAG_EPHEMERAL = 1 << 6;

const db = openDb();
const questsContent = loadQuestsContent();
const dailyRewards = loadDailyRewards();

function ownerFooterText(userOrMember) {
  const member = userOrMember?.user ? userOrMember : null;
  const fallbackUser = member?.user ?? userOrMember;
  const displayName = member?.displayName ?? userOrMember?.displayName ?? userOrMember?.nickname ?? null;
  const tag = fallbackUser?.tag ?? fallbackUser?.username ?? "Unknown";
  const name = displayName ?? fallbackUser?.globalName ?? tag;
  return `Owner: ${name}`;
}

function applyOwnerFooter(embed, user) {
  if (embed && user) {
    embed.setFooter({ text: ownerFooterText(user) });
  }
  return embed;
}

function buildMenuEmbed({ title, description, user, color = theme.colors.primary } = {}) {
  const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);
  return applyOwnerFooter(embed, user);
}

function hasGreenButton(components) {
  const rows = Array.isArray(components) ? components : (components ? [components] : []);
  for (const row of rows) {
    const rowJson = row?.toJSON ? row.toJSON() : row;
    const comps = row?.components ?? rowJson?.components ?? [];
    for (const comp of comps) {
      const style = comp?.style ?? comp?.data?.style;
      if (style === 3) return true;
    }
  }
  return false;
}

function applyGreenButtonFooter(embeds, components) {
  if (!Array.isArray(embeds) || embeds.length === 0) return embeds;
  if (!hasGreenButton(components)) return embeds;

  const note = "Tip: Tap the green button(s) to continue.";
  return embeds.map((embed) => {
    const footerText = embed?.footer?.text ?? embed?.data?.footer?.text ?? "";
    if (footerText.includes("green button")) return embed;
    const nextText = footerText ? `${footerText} • ${note}` : note;
    if (typeof embed?.setFooter === "function") {
      embed.setFooter({ text: nextText });
    } else if (embed?.data) {
      embed.data.footer = { ...(embed.data.footer ?? {}), text: nextText };
    } else if (embed) {
      embed.footer = { ...(embed.footer ?? {}), text: nextText };
    }
    return embed;
  });
}

function isComponentsV2Payload(payload = {}) {
  if (!payload || typeof payload !== "object") return false;
  if ((Number(payload.flags) & MESSAGE_FLAG_IS_COMPONENTS_V2) !== 0) return true;
  const stack = Array.isArray(payload.components) ? [...payload.components] : [];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    const type = Number(node.type);
    if (type === 9 || type === 10 || type === 12 || type === 17) return true;
    if (Array.isArray(node.components)) stack.push(...node.components);
  }
  return false;
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

function sanitizeLegacyFooterForV2(footerText = "") {
  const raw = String(footerText ?? "").trim();
  if (!raw) return "";
  return raw
    .split("\n")
    .map((line) => String(line ?? "").trim())
    .map((line) => line
      .split("•")
      .map((segment) => String(segment ?? "").trim())
      .filter((segment) => segment && !/^owner\s*:/i.test(segment))
      .join(" • ")
      .trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function legacyEmbedsToV2TextComponents(embeds = []) {
  const out = [];
  for (const embed of embeds || []) {
    const raw = embed?.toJSON?.() ?? embed ?? {};
    const title = String(raw?.title ?? "").trim();
    const description = String(raw?.description ?? "").trim();
    const fields = Array.isArray(raw?.fields) ? raw.fields : [];
    const footerText = sanitizeLegacyFooterForV2(raw?.footer?.text ?? "");

    const blocks = [];
    if (title) blocks.push(`## ${title}`);
    if (description) blocks.push(description);

    for (const field of fields) {
      const name = String(field?.name ?? "").trim();
      const value = String(field?.value ?? "").trim();
      if (!name && !value) continue;
      blocks.push([name ? `**${name}**` : "", value || "-"].filter(Boolean).join("\n"));
    }

    if (footerText) {
      const compactFooter = footerText
        .split("\n")
        .map((line) => String(line ?? "").trim())
        .filter(Boolean)
        .join(" • ");
      if (compactFooter) blocks.push(`-# ${compactFooter}`);
    }

    const compact = blocks.join("\n\n").trim();
    if (compact) out.push({ type: 10, content: compact });
  }
  return out;
}

function convertPayloadToComponentsV2(interaction, payload = {}, player = null) {
  if (!payload || typeof payload !== "object") return payload;
  if (isComponentsV2Payload(payload)) return payload;
  if (!Array.isArray(payload.embeds) || payload.embeds.length === 0) return payload;

  const guildId = interaction?.guildId;
  const userId = interaction?.user?.id;
  if (!guildId || !userId) return payload;
  const effectivePlayer = player || getPlayer(db, guildId, userId) || null;
  if (!isComponentsV2Enabled({ guildId, userId, player: effectivePlayer })) return payload;

  const normalizedRows = normalizeComponents(payload.components);
  const isEphemeral = payload.ephemeral === true || ((Number(payload.flags) & MESSAGE_FLAG_EPHEMERAL) !== 0);

  const v2Payload = buildComponentsV2PayloadWithNoticeCards({
    mainComponents: [...legacyEmbedsToV2TextComponents(payload.embeds.slice(0, 1)), ...normalizedRows],
    notices: payload.embeds.slice(1).map((embed) => ({
      title: String((embed?.toJSON?.() ?? embed ?? {})?.title ?? "Notice").trim() || "Notice",
      details: legacyEmbedsToV2TextComponents([embed]).map((entry) => String(entry?.content ?? "").trim()).filter(Boolean),
      tone: "info"
    })),
    ownerId: userId,
    ephemeral: isEphemeral
  });

  const { embeds, components, flags, ephemeral, ...rest } = payload;
  return { ...rest, ...v2Payload };
}

function normalizePayloadForReply(interaction, payload = {}, player = null) {
  const converted = convertPayloadToComponentsV2(interaction, payload, player);
  if (converted?.embeds) {
    converted.embeds = applyGreenButtonFooter(converted.embeds, converted.components);
  }
  return converted;
}

function isInvalidComponentTypeError(error) {
  const message = String(error?.message ?? "");
  return String(error?.code ?? "") === "INVALID_TYPE"
    || message.includes("valid MessageComponentType");
}

function toRawWebhookPayload(payload = {}) {
  const out = { ...payload };
  const hasEphemeralFlag = (Number(out.flags) & MESSAGE_FLAG_EPHEMERAL) !== 0;
  if (out.ephemeral === true && !hasEphemeralFlag) {
    out.flags = Number(out.flags || 0) | MESSAGE_FLAG_EPHEMERAL;
  }
  delete out.ephemeral;
  return out;
}

async function rawWebhookEditOriginal(interaction, payload) {
  const applicationId = interaction?.applicationId || interaction?.client?.user?.id;
  const token = interaction?.token;
  if (!interaction?.client?.api || !applicationId || !token) {
    throw new Error("Raw webhook edit unavailable: missing client api/applicationId/token");
  }
  return interaction.client.api
    .webhooks(applicationId, token)
    .messages("@original")
    .patch({ data: toRawWebhookPayload(payload) });
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
    try {
      return await interaction.reply(finalPayload);
    } catch (e) {
      if (isInvalidComponentTypeError(e)) {
        if (!interaction.deferred && !interaction.replied) {
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
        const embed = buildMenuEmbed({
          title: `${getIcon("daily_reward")} Daily Reward`,
          description: result.message,
          user: interaction.member ?? interaction.user
        });
        reply = { content: " ", embeds: [embed], ephemeral: true };
      } else {
        const rewardLines = [];
        if (result.reward.coins) rewardLines.push(`${getIcon("coins")} **${result.reward.coins}c**`);
        if (result.reward.sxp) rewardLines.push(`${getIcon("sxp")} **${result.reward.sxp} SXP**`);
        if (result.reward.rep) rewardLines.push(`${getIcon("rep")} **${result.reward.rep} REP**`);

        const levelLine = result.leveledUp > 0 ? `
${getIcon("level_up")} Level up! **+${result.leveledUp}**` : "";
        const embed = buildMenuEmbed({
          title: `${getIcon("daily_reward")} Daily Reward`,
          description: `Streak: **${result.streak}** day(s)\nRewards: ${rewardLines.join(" · ")}${levelLine}`,
          user: interaction.member ?? interaction.user
        });
        reply = { content: " ", embeds: [embed] };
      }
    }

    if (sub === "quests") {
      const summary = getQuestSummary(player, questsContent, userId);
      const active = summary.active;
      if (!active.length) {
        const embed = buildMenuEmbed({
          title: `${getIcon("quests")} Quests`,
          description: "_No quests available right now._",
          user: interaction.member ?? interaction.user
        });
        reply = { content: " ", embeds: [embed], ephemeral: true };
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

        const embed = buildMenuEmbed({
          title: `${getIcon("quests")} Quests`,
          description: lines.join("\n"),
          user: interaction.member ?? interaction.user
        });
        reply = { content: " ", embeds: [embed] };
      }
    }

    if (sub === "claim") {
      const result = claimCompletedQuests(player);
      if (!result.claimed.length) {
        const embed = buildMenuEmbed({
          title: `${getIcon("quest_rewards")} Quest Rewards`,
          description: "_No completed quests to claim._",
          user: interaction.member ?? interaction.user
        });
        reply = { content: " ", embeds: [embed], ephemeral: true };
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
        const embed = buildMenuEmbed({
          title: `${getIcon("quest_rewards")} Quest Rewards`,
          description: `${lines.join("\n")}${levelLine}`,
          user: interaction.member ?? interaction.user
        });
        reply = { content: " ", embeds: [embed] };
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
