import { SlashCommandBuilder } from "@discordjs/builders";
import discordPkg from "discord.js";
import { openDb, getPlayer, upsertPlayer } from "../db/index.js";
import { withLock } from "../infra/locks.js";
import { makeIdempotencyKey, getIdempotentResult, putIdempotentResult } from "../infra/idempotency.js";
import { newPlayerProfile, trackLastKitchen } from "../game/player.js";
import { loadUpgradesContent, loadStaffContent } from "../content/index.js";
import { noodleMainMenuRow, runNoodle } from "./noodle.js";
import { shouldForceTutorialCommand } from "../game/tutorialRouting.js";
import { buildStaffOverviewComponents } from "./noodleStaff.js";
import { getKitchenUnlockState, KITCHEN_UNLOCK_LEVEL } from "../game/kitchen.js";
import { isGardenUnlocked, GARDEN_UNLOCK_LEVEL } from "../game/garden.js";
import { isFishingUnlocked, FISHING_UNLOCK_LEVEL } from "../game/fishing.js";
import {
  purchaseUpgrade,
  calculateUpgradeCost,
  getUpgradesByCategory,
  calculateUpgradeEffects
} from "../game/upgrades.js";
import { calculateStaffCost, levelUpStaff, getStaffUnlockStatus, filterUnlockedStaffEffects } from "../game/staff.js";
import { getIcon, getButtonEmoji, resolveIcon } from "../ui/icons.js";
import { normalizeRawContainerPayload } from "../util/rawPayload.js";
import {
  buildComponentsV2PayloadWithNoticeCards,
  legacyEmbedsToV2TextComponents,
  MESSAGE_FLAG_IS_COMPONENTS_V2
} from "../ui/componentsV2.js";

const {
  MessageActionRow,
  MessageSelectMenu,
  MessageButton,
  Constants
} = discordPkg;

// Aliases for v14+ compatibility
const ActionRowBuilder = MessageActionRow;
const StringSelectMenuBuilder = MessageSelectMenu;
const ButtonBuilder = MessageButton;

const ButtonStyle = {
  Primary: Constants?.MessageButtonStyles?.PRIMARY ?? 1,
  Secondary: Constants?.MessageButtonStyles?.SECONDARY ?? 2,
  Success: Constants?.MessageButtonStyles?.SUCCESS ?? 3,
  Danger: Constants?.MessageButtonStyles?.DANGER ?? 4,
  Link: Constants?.MessageButtonStyles?.LINK ?? 5
};
const MESSAGE_FLAG_EPHEMERAL = Constants?.MessageFlags?.EPHEMERAL ?? (1 << 6);

const db = openDb();
const upgradesContent = loadUpgradesContent();
const staffContent = loadStaffContent();
const KITCHEN_BROTH_UPGRADE_IDS = new Set(["u_kitchen_simmer", "u_kitchen_simmer_speed"]);
const FISHING_EFFECT_PREFIX = "fishing_";

function isFishingUpgradeEntry(upgradeInfo = {}, categoryId = "") {
  if (categoryId === "fishing") return true;
  const effects = upgradeInfo.effects || upgradeInfo.effects_per_level || {};
  return Object.keys(effects).some((k) => typeof k === "string" && k.startsWith(FISHING_EFFECT_PREFIX));
}

function formatTwoDecimals(value) {
  return Number(Number(value ?? 0).toFixed(2));
}

function hasGreenButton(components) {
  const rows = Array.isArray(components) ? components : (components ? [components] : []);
  for (const row of rows) {
    const rowJson = row?.toJSON ? row.toJSON() : row;
    const comps = row?.components ?? rowJson?.components ?? [];
    for (const comp of comps) {
      const style = comp?.style ?? comp?.data?.style;
      if (style === ButtonStyle.Success) return true;
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

function isInvalidComponentTypeError(error) {
  const message = String(error?.message ?? "");
  return String(error?.code ?? "") === "INVALID_TYPE"
    || message.includes("valid MessageComponentType");
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
    .patch({ data: normalizeRawContainerPayload(payload, { ephemeralFlag: MESSAGE_FLAG_EPHEMERAL }) });
}

async function sendUpgradesPayload(interaction, payload = {}) {
  const finalPayload = payload ?? {};
  const isV2 = isComponentsV2Payload(finalPayload);

  if (!isV2) {
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply(finalPayload);
    }
    return interaction.reply(finalPayload);
  }

  if (interaction.deferred || interaction.replied) {
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

function formatEffects(effects) {
  const lines = [];
  for (const [key, value] of Object.entries(effects)) {
    if (key === "ingredient_save_chance") lines.push(`+${(value * 100).toFixed(2)}% ingredient save`);
    else if (key === "bowl_capacity_bonus") lines.push(`+${formatTwoDecimals(value)} bowl capacity`);
    else if (key === "ingredient_capacity") lines.push(`+${formatTwoDecimals(value)} ingredient storage`);
    else if (key === "protein_capacity_bonus") lines.push(`+${formatTwoDecimals(value)} protein storage`);
    else if (key === "spoilage_reduction") lines.push(`-${(value * 100).toFixed(2)}% spoilage`);
    else if (key === "bowl_storage_capacity") lines.push(`+${formatTwoDecimals(value)} bowl storage`);
    else if (key === "rep_bonus_flat") lines.push(`+${value.toFixed(1)} rep`);
    else if (key === "rep_bonus_percent") lines.push(`+${(value * 100).toFixed(2)}% rep`);
    else if (key === "order_quality_bonus") lines.push(`+${(value * 100).toFixed(2)}% order quality`);
    else if (key === "npc_variety_bonus") lines.push(`+${(value * 100).toFixed(2)}% bonus regulars variety`);
    else if (key === "order_board_bonus") lines.push(`+${formatTwoDecimals(value)} daily orders`);
    else if (key === "staff_capacity") lines.push(`+${value.toFixed(1)} staff capacity`);
    else if (key === "staff_effect_multiplier") lines.push(`+${(value * 100).toFixed(2)}% staff effects`);
    else if (key === "prep_batch_bonus") {
      const divisor = value > 0 ? Math.round(1 / value) : 0;
      lines.push(`+1 bowl per ${divisor} prep levels`);
    }
    else if (key === "garden_plot_bonus") lines.push(`+${formatTwoDecimals(value)} garden plots`);
    else if (key === "garden_seed_chance") lines.push(`+${(value * 100).toFixed(2)}% seed find chance`);
    else if (key === "kitchen_simmer_capacity") lines.push(`+${formatTwoDecimals(value)} kitchen slots`);
    else if (key === "kitchen_simmer_time_reduction") lines.push(`-${(value * 100).toFixed(2)}% simmer time`);
    else if (key === "cooldown_reduction") lines.push(`-${(value * 100).toFixed(2)}% cooldowns`);
    else if (key === "fishing_cooldown_reduction") lines.push(`-${(value * 100).toFixed(2)}% fishing cooldown`);
    else if (key === "fishing_rare_weight_bonus") lines.push(`+${(value * 100).toFixed(2)}% rare catch weight`);
    else if (key === "fishing_bonus_items") lines.push(`+${formatTwoDecimals(value)} bonus catch per trip`);
    else if (key === "harvest_cooldown_reduction") lines.push(`-${(value * 100).toFixed(2)}% harvest cooldown`);
  }
  return lines.join(", ");
}

function composeUpgradesViewComponents({ title = "", description = "", sections = [] } = {}) {
  const components = [];
  const safeTitle = String(title || "").trim();
  const safeDescription = String(description || "").trim();
  if (safeTitle) components.push({ type: 10, content: `## ${safeTitle}` });
  if (safeDescription) components.push({ type: 10, content: safeDescription });

  for (const section of sections) {
    const name = String(section?.name || "").trim();
    const value = String(section?.value || "").trim();
    if (!name && !value) continue;
    const block = [name ? `**${name}**` : "", value || "-"].filter(Boolean).join("\n");
    components.push({ type: 10, content: block });
  }

  return components;
}

function buildUpgradesPayload({ content = " ", ownerId, bodyComponents = [], actionRows = [], ephemeral = false } = {}) {
  const mainComponents = [
    ...(Array.isArray(bodyComponents) ? bodyComponents : []),
    ...normalizeComponents(actionRows)
  ];

  return buildComponentsV2PayloadWithNoticeCards({
    content,
    mainComponents,
    notices: [],
    ownerId: String(ownerId || "").trim() || undefined,
    ephemeral: Boolean(ephemeral)
  });
}

function formatStaffPickerEffectValue(effectKey, perLevel) {
  if (effectKey === "ingredient_save_chance") return `+${(perLevel * 100).toFixed(0)}% ingredient save`;
  if (effectKey === "double_craft_chance") return `+${(perLevel * 100).toFixed(0)}% double craft`;
  if (effectKey === "rep_bonus_flat") return `+${perLevel.toFixed(1)} rep per serve`;
  if (effectKey === "rep_bonus_percent") return `+${(perLevel * 100).toFixed(0)}% rep`;
  if (effectKey === "bowl_capacity_bonus") return `+${formatTwoDecimals(perLevel)} bowl capacity`;
  if (effectKey === "cooldown_reduction") return `-${(perLevel * 100).toFixed(2)}% cooldowns`;
  if (effectKey === "forage_bonus_items") return `+${formatTwoDecimals(perLevel)} forage items`;
  if (effectKey === "fishing_bonus_items") return `+${formatTwoDecimals(perLevel)} bonus catches per trip`;
  if (effectKey === "forage_seed_chance") return `+${(perLevel * 100).toFixed(2)}% seed find chance`;
  if (effectKey === "garden_autoharvest") return "Auto-harvest garden plots";
  if (effectKey === "garden_harvest_seed_chance") return `+${(perLevel * 100).toFixed(0)}% seed chance on harvest`;
  if (effectKey === "harvest_cooldown_reduction") return `-${(perLevel * 100).toFixed(2)}% harvest cooldown`;
  if (effectKey === "market_discount") return `-${(perLevel * 100).toFixed(0)}% market prices`;
  if (effectKey === "sxp_bonus_percent") return `+${(perLevel * 100).toFixed(0)}% SXP`;
  if (effectKey === "rare_epic_quality_bonus") return `+${(perLevel * 100).toFixed(0)}% rare/epic quality`;
  if (effectKey === "rare_epic_fail_reduction") return `-${(perLevel * 100).toFixed(0)}% rare/epic fail`;
  if (effectKey === "order_quality_bonus") return `+${(perLevel * 100).toFixed(1)}% order quality`;
  return null;
}

function buildStaffPickerEffectSummary(player, staff) {
  const visibleEffects = filterUnlockedStaffEffects(player, staff.effects_per_level ?? {});
  const priority = {
    cooldown_reduction: 1,
    harvest_cooldown_reduction: 2
  };

  const parts = Object.entries(visibleEffects)
    .sort(([a], [b]) => (priority[a] ?? 100) - (priority[b] ?? 100) || a.localeCompare(b))
    .map(([effectKey, perLevel]) => formatStaffPickerEffectValue(effectKey, Number(perLevel) || 0))
    .filter(Boolean);

  if (!parts.length && staff.staff_id === "prep_chef") {
    return "auto-buy missing ingredients (+1 order per level)";
  }

  return parts.join(", ");
}

function rarityEmoji(rarity) {
  return "";
}

function shouldHideRarityEmoji(staff) {
  return staff?.staff_id === "forager" || staff?.staff_id === "merchant";
}

function staffSortKey(player, staff) {
  const currentLevel = player.staff_levels?.[staff.staff_id] || 0;
  const isMaxed = currentLevel >= staff.max_level;
  const cost = isMaxed ? Number.POSITIVE_INFINITY : calculateStaffCost(staff, currentLevel);
  return { cost, isMaxed };
}

function staffCategoryIconId(category) {
  if (category === "kitchen") return "category_kitchen";
  if (category === "service") return "category_service";
  if (category === "support") return "category_support";
  return "category_default";
}

function buildCategoryButtonsRows(userId, activeCategory = null, source = null, { disabled = new Set() } = {}) {
  const categories = [
    { id: "staff", label: "Staff", icon: "staff_management" },
    { id: "kitchen", label: "Kitchen", icon: "category_kitchen" },
    { id: "storage", label: "Storage", icon: "category_storage" },
    { id: "ambience", label: "Ambiance", icon: "category_ambience" },
    { id: "service", label: "Service", icon: "category_service" },
    { id: "garden", label: "Garden", icon: "garden" },
    { id: "fishing", label: "Fishing", icon: "fishing" }
  ];

  const buttons = categories.map((cat) =>
    new ButtonBuilder()
      .setCustomId(
        source
          ? `noodle-upgrades:category:${userId}:${cat.id}:${source}`
          : `noodle-upgrades:category:${userId}:${cat.id}`
        )
        .setLabel(cat.label)
        .setEmoji(getButtonEmoji(cat.icon))
      .setStyle(cat.id === activeCategory ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(disabled.has(cat.id))
  );

  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    const chunk = buttons.slice(i, i + 5);
    if (chunk.length) rows.push(new ActionRowBuilder().addComponents(chunk));
  }
  return rows;
}

function buildStaffRarityRow(userId, activeRarity = "common", source = null) {
  const rarities = [
    { id: "overview", label: "Staff", icon: "staff_management" },
    { id: "common", label: "Common", icon: "staff_rarity_common" },
    { id: "rare", label: "Rare", icon: "staff_rarity_rare" },
    { id: "epic", label: "Epic", icon: "staff_rarity_epic" },
    { id: "upgrades", label: "Upgrades", icon: "staff_upgrades" }
  ];

  const buttons = rarities.map((rar) =>
    new ButtonBuilder()
      .setCustomId(
        source
          ? `noodle-upgrades:staffpage:${userId}:${rar.id}:${source}`
          : `noodle-upgrades:staffpage:${userId}:${rar.id}`
        )
        .setLabel(rar.label)
        .setEmoji(getButtonEmoji(rar.icon))
      .setStyle(rar.id === activeRarity ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  return new ActionRowBuilder().addComponents(buttons);
}

export const noodleUpgradesCommand = {
  data: new SlashCommandBuilder()
    .setName("noodle-upgrades")
    .setDescription("Purchase upgrades for your noodle shop"),
  execute: noodleUpgradesHandler,
  handleComponent: noodleUpgradesInteractionHandler
};

export async function noodleUpgradesHandler(interaction) {
  const userId = interaction.user.id;
  const serverId = interaction.guild?.id ?? "DM";
  const isSlashLikeInvocation = !(
    interaction.isButton?.()
    || interaction.isSelectMenu?.()
    || interaction.isModalSubmit?.()
    || interaction.isAutocomplete?.()
  );

  if (interaction.guildId) {
    let tutorialPlayer = getPlayer(db, serverId, userId);
    if (!tutorialPlayer) {
      tutorialPlayer = newPlayerProfile(userId);
      const rev = upsertPlayer(db, serverId, userId, tutorialPlayer, null);
      tutorialPlayer.state_rev = rev;
    }

    if (shouldForceTutorialCommand({
      player: tutorialPlayer,
      sub: "profile",
      isChatInput: isSlashLikeInvocation,
      inDevPath: false
    })) {
      return runNoodle(interaction, { sub: "profile" });
    }
  }

  const idempKey = makeIdempotencyKey({
    serverId,
    userId,
    action: "noodle-upgrades",
    interactionId: interaction.id
  });
  const existing = getIdempotentResult(db, idempKey);
  if (existing) {
    const normalizedExisting = normalizePayloadForReply(interaction, existing);
    return sendUpgradesPayload(interaction, normalizedExisting);
  }

  const lockKey = `user:${userId}`;

  const lockedResult = await withLock(db, lockKey, `discord:${interaction.id}`, 8000, async () => {
    let p = getPlayer(db, serverId, userId);
    if (!p) {
      p = newPlayerProfile(userId);
      const rev = upsertPlayer(db, serverId, userId, p, null);
      p.state_rev = rev;
    }

    const touched = trackLastKitchen(p, serverId, interaction.channelId);
    if (touched && db) {
      const rev = upsertPlayer(db, serverId, userId, p, null, p.schema_version);
      p.state_rev = rev;
    }

    const actionRows = buildUpgradesComponents(userId, p, { source: "profile" });
    const normalizedResponse = buildUpgradesPayload({
      content: " ",
      ownerId: userId,
      bodyComponents: buildUpgradesManagementComponents(p),
      actionRows,
      ephemeral: false
    });

    putIdempotentResult(db, { key: idempKey, userId, action: "noodle-upgrades", ttlSeconds: 900, result: normalizedResponse });
    return normalizedResponse;
  });

  return sendUpgradesPayload(interaction, lockedResult);
}

function buildUpgradesOverviewComponents(player) {
  const effects = calculateUpgradeEffects(player, upgradesContent);
  const upgradesByCategory = getUpgradesByCategory(player, upgradesContent);
  const { unlocked: kitchenUnlocked } = getKitchenUnlockState(player);
  const gardenUnlocked = isGardenUnlocked(player);
  const fishingUnlocked = isFishingUnlocked(player);

  const sections = [];

  // Display upgrades by category
  for (const [categoryId, categoryData] of Object.entries(upgradesByCategory)) {
    if (!categoryData.upgrades || categoryData.upgrades.length === 0) continue;

    const lines = categoryData.upgrades.map(u => {
      const isBrothUpgrade = KITCHEN_BROTH_UPGRADE_IDS.has(u.upgradeId);
      const isFishingUpgrade = isFishingUpgradeEntry(u, categoryId);
      const lockedStatus = !fishingUnlocked && isFishingUpgrade
        ? `${getIcon("lock")} Unlocks at shop level ${FISHING_UNLOCK_LEVEL}`
        : (!kitchenUnlocked && isBrothUpgrade
          ? `${getIcon("lock")} Unlocks at shop level ${KITCHEN_UNLOCK_LEVEL}`
          : null);
      const status = lockedStatus
        ? lockedStatus
        : (u.isMaxed
          ? `${getIcon("status_complete")} MAX`
          : (u.requirementLabel ?? `${u.nextCost}c`));
      return `• **${u.name}** (${u.currentLevel}/${u.maxLevel}) — ${status}`;
    });

    sections.push({
      name: `${resolveIcon(categoryData.icon, "")} ${categoryData.display_name || categoryId}`.trim(),
      value: lines.join("\n")
    });
  }

  // Active effects summary
  const effectLines = [];
  if (effects.ingredient_save_chance > 0) effectLines.push(`${getIcon("ingredient_save")} ${(effects.ingredient_save_chance * 100).toFixed(2)}% ingredient save`);
  if (effects.bowl_capacity_bonus > 0) effectLines.push(`${getIcon("bowl_capacity")} +${formatTwoDecimals(effects.bowl_capacity_bonus)} bowl capacity`);
  if (effects.ingredient_capacity > 0) effectLines.push(`${getIcon("ingredient_capacity")} +${formatTwoDecimals(effects.ingredient_capacity)} ingredient capacity`);
  if (effects.protein_capacity_bonus > 0) effectLines.push(`${getIcon("ingredient_capacity")} +${formatTwoDecimals(effects.protein_capacity_bonus)} protein capacity`);
  if (effects.bowl_storage_capacity > 0) effectLines.push(`${getIcon("bowl_storage")} +${formatTwoDecimals(effects.bowl_storage_capacity)} bowl storage`);
  if (effects.rep_bonus_flat > 0) effectLines.push(`${getIcon("rep")} +${effects.rep_bonus_flat.toFixed(1)} rep per serve`);
  if (effects.rep_bonus_percent > 0) effectLines.push(`${getIcon("rep")} +${(effects.rep_bonus_percent * 100).toFixed(2)}% rep`);
  if (effects.staff_effect_multiplier > 0) effectLines.push(`${getIcon("staff_management")} +${(effects.staff_effect_multiplier * 100).toFixed(2)}% staff effects`);
  if (effects.order_board_bonus > 0) effectLines.push(`${getIcon("orders")} +${effects.order_board_bonus} daily orders`);
  if (effects.kitchen_simmer_capacity > 0) effectLines.push(`${getIcon("kitchen")} +${formatTwoDecimals(effects.kitchen_simmer_capacity)} kitchen slots`);
  if (effects.kitchen_simmer_time_reduction > 0) effectLines.push(`${getIcon("hourglass")} -${(effects.kitchen_simmer_time_reduction * 100).toFixed(2)}% simmer time`);

  if (effectLines.length > 0) {
    sections.push({
      name: `${getIcon("stats")} Total Upgrade Bonuses`,
      value: effectLines.join("\n")
    });
  }

  return composeUpgradesViewComponents({
    title: `${getIcon("upgrades")} Shop Upgrades`,
    description: `${getIcon("coins")} Coins: **${player.coins}**\n\nUpgrade your shop to unlock powerful bonuses!`,
    sections
  });
}

function buildUpgradesManagementComponents(player) {
  const upgrades = Object.values(upgradesContent.upgrades ?? {});
  const totalUpgrades = upgrades.length;
  const leveledEntries = Object.entries(player.upgrades ?? {})
    .filter(([, level]) => Number(level) > 0)
    .map(([upgradeId, levelRaw]) => {
      const upgrade = upgradesContent.upgrades?.[upgradeId];
      if (!upgrade) return null;
      const level = Math.max(0, Number(levelRaw) || 0);
      return { upgrade, level };
    })
    .filter(Boolean);
  const description = `${getIcon("coins")} Coins: **${player.coins}**\n${getIcon("upgrades")} Upgrades: **${leveledEntries.length}/${totalUpgrades}**`;

  const formatUpgradeEffectValue = (upgrade, level, effectKey, perLevel) => {
    const total = perLevel * level;
    if (effectKey === "ingredient_save_chance") return `+${(total * 100).toFixed(2)}% ingredient save`;
    if (effectKey === "bowl_capacity_bonus") return `+${formatTwoDecimals(total)} bowl capacity`;
    if (effectKey === "ingredient_capacity") return `+${formatTwoDecimals(total)} ingredient storage`;
    if (effectKey === "protein_capacity_bonus") return `+${formatTwoDecimals(total)} protein storage`;
    if (effectKey === "spoilage_reduction") return `-${(total * 100).toFixed(2)}% spoilage`;
    if (effectKey === "bowl_storage_capacity") return `+${formatTwoDecimals(total)} bowl storage`;
    if (effectKey === "rep_bonus_flat") return `+${total.toFixed(1)} rep per serve`;
    if (effectKey === "rep_bonus_percent") return `+${(total * 100).toFixed(2)}% rep`;
    if (effectKey === "order_quality_bonus") return `+${(total * 100).toFixed(2)}% order quality`;
    if (effectKey === "npc_variety_bonus") return `+${(total * 100).toFixed(2)}% bonus regulars variety`;
    if (effectKey === "order_board_bonus") return `+${formatTwoDecimals(total)} daily orders`;
    if (effectKey === "staff_capacity") return `+${total.toFixed(1)} staff capacity`;
    if (effectKey === "staff_effect_multiplier") return `+${(total * 100).toFixed(2)}% staff effects`;
    if (effectKey === "prep_batch_bonus") {
      const divisor = perLevel > 0 ? Math.round(1 / perLevel) : 0;
      const bonus = divisor > 0 ? Math.floor(level / divisor) : 0;
      return bonus > 0 ? `+${bonus} bowls per batch` : `+1 bowl per ${divisor} prep levels`;
    }
    if (effectKey === "garden_plot_bonus") return `+${formatTwoDecimals(total)} garden plots`;
    if (effectKey === "garden_seed_chance") return `+${(total * 100).toFixed(2)}% seed find chance`;
    if (effectKey === "kitchen_simmer_capacity") return `+${formatTwoDecimals(total)} kitchen slots`;
    if (effectKey === "kitchen_simmer_time_reduction") return `-${(total * 100).toFixed(2)}% simmer time`;
    if (effectKey === "fishing_cooldown_reduction") return `-${(total * 100).toFixed(2)}% fishing cooldown`;
    if (effectKey === "fishing_rare_weight_bonus") return `+${(total * 100).toFixed(2)}% rare catch weight`;
    if (effectKey === "fishing_bonus_items") return `+${formatTwoDecimals(total)} bonus catch per trip`;
    return null;
  };

  const upgradeLines = leveledEntries.map(({ upgrade, level }) => {
    const category = upgradesContent.upgrade_categories?.[upgrade.category] ?? {};
    const icon = resolveIcon(category.icon, "");
    const iconPrefix = icon ? `${icon} ` : "";
    const effectsPerLevel = upgrade.effects_per_level ?? {};
    const perUpgradeEffects = Object.entries(effectsPerLevel)
      .map(([effectKey, perLevel]) => formatUpgradeEffectValue(upgrade, level, effectKey, perLevel))
      .filter(Boolean);
    const bonusText = perUpgradeEffects.length ? ` — ${perUpgradeEffects.join(", ")}` : "";
    return `${iconPrefix}**${upgrade.name}** — Lv${level}/${upgrade.max_level}${bonusText}`;
  });

  const sections = [{
    name: "Your Upgrades",
    value: upgradeLines.length ? upgradeLines.join("\n") : "_No upgrades purchased yet._"
  }];

  return composeUpgradesViewComponents({
    title: `${getIcon("upgrades")} Upgrades Management`,
    description,
    sections
  });
}

function buildUpgradesCategoryComponents(player, categoryId, { staffRarity = "common" } = {}) {
  const upgradesByCategory = getUpgradesByCategory(player, upgradesContent);
  const categoryData = upgradesContent.upgrade_categories?.[categoryId];
  const { unlocked: kitchenUnlocked } = getKitchenUnlockState(player);
  const fishingUnlocked = isFishingUnlocked(player);

  if (categoryId === "staff") {
    if (staffRarity === "overview") {
      return buildStaffOverviewComponents(player, null, null);
    }
    if (staffRarity === "upgrades") {
      const staffUpgrades = ["u_staff_quarters", "u_manuals"]
        .map((id) => upgradesContent.upgrades?.[id])
        .filter(Boolean)
        .map((upgrade) => {
          const currentLevel = player.upgrades?.[upgrade.upgrade_id] || 0;
          const nextCost = calculateUpgradeCost(upgrade, currentLevel);
          const isMaxed = currentLevel >= upgrade.max_level;
          const status = isMaxed ? `${getIcon("status_complete")} MAX` : `${nextCost}c`;
          return `• **${upgrade.name}** (${currentLevel}/${upgrade.max_level}) — ${status}\n  _${upgrade.description}_`;
        });

      return composeUpgradesViewComponents({
        title: `${getIcon("staff_upgrades")} Staff Upgrades`,
        description: `${getIcon("coins")} Coins: **${player.coins}**\n\nUpgrades that improve staff capacity and performance.`,
        sections: [{
          name: "Staff Upgrades",
          value: staffUpgrades.length ? staffUpgrades.join("\n") : "_No staff upgrades found._"
        }]
      });
    }

    const allStaff = Object.values(staffContent.staff_members ?? {});
    const staffLines = allStaff
      .slice()
      .filter((staff) => staff?.rarity === staffRarity)
      .sort((a, b) => {
        if (staffRarity === "common") {
          const aPinned = a.staff_id === "forager" ? 1 : 0;
          const bPinned = b.staff_id === "forager" ? 1 : 0;
          if (aPinned !== bPinned) return bPinned - aPinned;
        }
        const aKey = staffSortKey(player, a);
        const bKey = staffSortKey(player, b);
        if (aKey.cost !== bKey.cost) return aKey.cost - bKey.cost;
        return a.name.localeCompare(b.name);
      })
      .map((staff) => {
        const currentLevel = player.staff_levels?.[staff.staff_id] || 0;
        const unlockStatus = getStaffUnlockStatus(player, staff);
        const isLocked = !unlockStatus.unlocked;
        const cost = calculateStaffCost(staff, currentLevel);
        const status = isLocked
          ? `${getIcon("lock")} ${unlockStatus.requirementLabel}`
          : (currentLevel >= staff.max_level ? `${getIcon("status_complete")} MAX` : `${cost}c`);
        const emoji = shouldHideRarityEmoji(staff) ? "" : `${rarityEmoji(staff.rarity)} `;
        const effectSummary = staff.description || "";
        const description = effectSummary ? `\n  _${effectSummary}_` : "";
        return `• ${emoji}**${staff.name}** (${currentLevel}/${staff.max_level}) — ${status}${description}`.trim();
      })
      .filter(Boolean);

    return composeUpgradesViewComponents({
      title: `${getIcon("staff_upgrades")} Staff Upgrades`,
      description: `${getIcon("coins")} Coins: **${player.coins}**\n\nHire and empower your staff.`,
      sections: [{
        name: `${rarityEmoji(staffRarity)} ${staffRarity[0].toUpperCase()}${staffRarity.slice(1)} Staff`,
        value: staffLines.length ? staffLines.join("\n") : "_No staff found._"
      }]
    });
  }

  const categoryIcon = resolveIcon(categoryData?.icon, getIcon("upgrades"));
  const title = `${categoryIcon} ${categoryData?.display_name || categoryId}`.trim();
  const descLines = [
    `${getIcon("coins")} Coins: **${player.coins}**`,
    categoryData?.description ? `\n${categoryData.description}` : ""
  ].join("\n");

  const upgrades = upgradesByCategory[categoryId]?.upgrades ?? [];
  const lines = upgrades.map((u) => {
    const isBrothUpgrade = KITCHEN_BROTH_UPGRADE_IDS.has(u.upgradeId);
    const isFishingUpgrade = isFishingUpgradeEntry(u, categoryId);
    const lockedStatus = !fishingUnlocked && isFishingUpgrade
      ? `${getIcon("lock")} Unlocks at shop level ${FISHING_UNLOCK_LEVEL}`
      : (!kitchenUnlocked && isBrothUpgrade
        ? `${getIcon("lock")} Unlocks at shop level ${KITCHEN_UNLOCK_LEVEL}`
        : null);
    const status = lockedStatus
      ? lockedStatus
      : (u.isMaxed
        ? `${getIcon("status_complete")} MAX`
        : (u.requirementLabel ?? `${u.nextCost}c`));
    const desc = u.description ? `\n  _${u.description}_` : "";
    return `• **${u.name}** (${u.currentLevel}/${u.maxLevel}) — ${status}${desc}`;
  });

  return composeUpgradesViewComponents({
    title,
    description: descLines.trim(),
    sections: [{
      name: "Upgrades",
      value: lines.length ? lines.join("\n") : "_No upgrades found._"
    }]
  });
}

function buildUpgradesComponents(userId, player, { categoryId = null, staffRarity = "common", source = null } = {}) {
  const rows = [];
  const gardenUnlocked = isGardenUnlocked(player);
  const fishingUnlocked = isFishingUnlocked(player);
  const disabledCats = new Set();
  if (!gardenUnlocked) disabledCats.add("garden");
  if (!fishingUnlocked) disabledCats.add("fishing");

  if (categoryId !== "staff") {
    rows.push(...buildCategoryButtonsRows(userId, categoryId, source, { disabled: disabledCats }));
  }
  const upgradesByCategory = getUpgradesByCategory(player, upgradesContent);
  const { unlocked: kitchenUnlocked } = getKitchenUnlockState(player);

  if (categoryId === "staff") {
    rows.push(buildStaffRarityRow(userId, staffRarity, source));
    if (staffRarity !== "upgrades") {
      const staffOptions = Object.values(staffContent.staff_members ?? {})
        .slice()
        .sort((a, b) => {
          if (a.rarity === "common" || b.rarity === "common") {
            const aPinned = a.staff_id === "forager" ? 1 : 0;
            const bPinned = b.staff_id === "forager" ? 1 : 0;
            if (aPinned !== bPinned) return bPinned - aPinned;
          }
          const aKey = staffSortKey(player, a);
          const bKey = staffSortKey(player, b);
          if (aKey.cost !== bKey.cost) return aKey.cost - bKey.cost;
          return a.name.localeCompare(b.name);
        })
        .map((staff) => {
          const currentLevel = player.staff_levels?.[staff.staff_id] || 0;
          if (currentLevel >= staff.max_level) return null;
          const unlockStatus = getStaffUnlockStatus(player, staff);
          if (!unlockStatus.unlocked) return null;
          const cost = calculateStaffCost(staff, currentLevel);
          let effectStr = buildStaffPickerEffectSummary(player, staff);
          if (!effectStr) effectStr = staff.description || "No effect listed";
          const description = `Lv${currentLevel}->${currentLevel + 1}: ${effectStr}`.slice(0, 100);
          return {
            label: `${staff.name} — ${cost}c`,
            description,
            value: staff.staff_id,
            emoji: getButtonEmoji(staffCategoryIconId(staff.category))
          };
        })
        .filter(Boolean);

      if (staffOptions.length > 0) {
        const staffMenu = new StringSelectMenuBuilder()
          .setCustomId(
            source
              ? `noodle-upgrades:staff:${userId}:${staffRarity}:${source}`
              : `noodle-upgrades:staff:${userId}:${staffRarity}`
          )
          .setPlaceholder("Level up staff member")
          .addOptions(staffOptions);
        rows.push(new ActionRowBuilder().addComponents(staffMenu));
      }
    }
  }

  // Build options for each category
  const allOptions = [];
  const categoryEntries = categoryId
    ? [[categoryId, upgradesByCategory[categoryId]]]
    : Object.entries(upgradesByCategory);

  for (const [catId, categoryData] of categoryEntries) {
    if (catId === "garden" && !gardenUnlocked) continue;
    if (catId === "fishing" && !fishingUnlocked) continue;
    if (!categoryData?.upgrades) continue;
    for (const upgrade of categoryData.upgrades || []) {
      const isBrothUpgrade = KITCHEN_BROTH_UPGRADE_IDS.has(upgrade.upgradeId);
      const isFishingUpgrade = isFishingUpgradeEntry(upgrade, catId);
      if (!kitchenUnlocked && isBrothUpgrade) continue;
      if (!fishingUnlocked && isFishingUpgrade) continue;
      if (upgrade.isMaxed) continue;

      const effectStr = formatEffects(upgrade.effects);
      const description = `Lv${upgrade.currentLevel}->${upgrade.currentLevel + 1}: ${effectStr}`.substring(0, 100);
      
      const optionEmoji = getButtonEmoji(categoryData?.icon);
      const costLabel = upgrade.requirementLabel ?? `${upgrade.nextCost}c`;
      const option = {
        label: `${upgrade.name} — ${costLabel}`,
        description,
        value: upgrade.upgradeId
      };
      if (optionEmoji) option.emoji = optionEmoji;
      allOptions.push(option);
    }
  }

  if (allOptions.length > 0) {
    // Split into multiple menus if more than 25 options
    const chunks = [];
    for (let i = 0; i < allOptions.length; i += 25) {
      chunks.push(allOptions.slice(i, i + 25));
    }

    chunks.forEach((chunk, idx) => {
      const placeholder = categoryId === "staff"
        ? "Purchase Staff Upgrades"
        : "Purchase Shop Upgrades";
      const staffRaritySuffix = categoryId === "staff" ? `:${staffRarity}` : "";
      const menu = new StringSelectMenuBuilder()
        .setCustomId(
          source
            ? `noodle-upgrades:buy:${userId}:${categoryId || "all"}:${idx}${staffRaritySuffix}:${source}`
            : `noodle-upgrades:buy:${userId}:${categoryId || "all"}:${idx}${staffRaritySuffix}`
        )
        .setPlaceholder(placeholder)
        .addOptions(chunk);
      rows.push(new ActionRowBuilder().addComponents(menu));
    });
  }

  if (!categoryId) {
    if (source === "profile") {
      const backButton = new ButtonBuilder()
        .setCustomId(`noodle:nav:profile:${userId}`)
        .setLabel("Back").setEmoji(getButtonEmoji("back"))
        .setStyle(ButtonStyle.Secondary);
      rows.push(new ActionRowBuilder().addComponents(backButton));
    } else {
      rows.push(noodleMainMenuRow(userId));
    }
  }

  if (categoryId) {
    const backButton = new ButtonBuilder()
      .setCustomId(
        source
          ? `noodle-upgrades:category:${userId}:all:${source}`
          : `noodle-upgrades:category:${userId}:all`
      )
      .setLabel("Back").setEmoji(getButtonEmoji("back"))
      .setStyle(ButtonStyle.Secondary);
    rows.push(new ActionRowBuilder().addComponents(backButton));
  }

  return rows;
}

export async function noodleUpgradesInteractionHandler(interaction) {
  const customId = interaction.customId;
  const parts = customId.split(":");
  
  if (parts[0] !== "noodle-upgrades") return null;

  const action = parts[1];
  const targetUserId = parts[2];
  const userId = interaction.user.id;

  // Ownership check
  if (targetUserId !== userId) {
    return {
      content: `${getIcon("error")} This is not your upgrades menu.`,
      ephemeral: true
    };
  }

  const serverId = interaction.guild?.id ?? "DM";
  const lockKey = `user:${userId}`;

  try {
    return await withLock(db, lockKey, `discord:${interaction.id}`, 8000, async () => {
      let p = getPlayer(db, serverId, userId);
      if (!p) {
        p = newPlayerProfile(userId);
        const rev = upsertPlayer(db, serverId, userId, p, null);
        p.state_rev = rev;
      }

      const touched = trackLastKitchen(p, serverId, interaction.channelId);
      if (touched && db) {
        const rev = upsertPlayer(db, serverId, userId, p, null, p.schema_version);
        p.state_rev = rev;
      }

    const resolveCategory = () => {
      if (action === "category") return parts[3] ?? null;
      if (action === "refresh") return "all";
      if (action === "buy") {
        const maybeCategory = parts[3];
        if (!maybeCategory) return null;
        const asNumber = Number(maybeCategory);
        return Number.isFinite(asNumber) ? null : maybeCategory;
      }
      if (action === "staffpage") return "staff";
      return null;
    };

    const resolveStaffRarity = () => {
      if (action === "staffpage") return parts[3] ?? "common";
      if (action === "category" && parts[3] === "staff") {
        const candidate = parts[4];
        const allowed = new Set(["overview", "common", "rare", "epic", "upgrades"]);
        return allowed.has(candidate) ? candidate : "overview";
      }
      if (action === "buy" && parts[3] === "staff") {
        const candidate = parts[5];
        const allowed = new Set(["overview", "common", "rare", "epic", "upgrades"]);
        return allowed.has(candidate) ? candidate : "overview";
      }
      if (action === "staff") {
        const candidate = parts[3];
        const allowed = new Set(["overview", "common", "rare", "epic", "upgrades"]);
        return allowed.has(candidate) ? candidate : "common";
      }
      return "common";
    };

    const resolveSource = () => {
      if (action === "category") return parts[4] ?? null;
      if (action === "staffpage") return parts[4] ?? null;
      if (action === "buy") {
        // buy customIds: noodle-upgrades:buy:<userId>:<category|all>:<idx>[:<staffRarity>][:<source>]
        const isStaff = parts[3] === "staff";
        return isStaff ? parts[6] ?? null : parts[5] ?? null;
      }
      if (action === "staff") return parts[4] ?? null;
      return null;
    };

    const categoryId = resolveCategory();
    const staffRarity = resolveStaffRarity();
    const source = resolveSource();
    const bodyComponents = categoryId && categoryId !== "all"
      ? buildUpgradesCategoryComponents(p, categoryId, { staffRarity })
      : (source === "profile"
        ? buildUpgradesManagementComponents(p)
        : buildUpgradesOverviewComponents(p));
    const actionRows = buildUpgradesComponents(userId, p, {
      categoryId: categoryId && categoryId !== "all" ? categoryId : null,
      staffRarity,
      source
    });

    // Handle purchase
    if (action === "buy") {
      if (!interaction.isSelectMenu()) return null;
      
      const upgradeId = interaction.values[0];
      
      const result = purchaseUpgrade(p, upgradeId, upgradesContent);
      if (result.success) {
        const rev = upsertPlayer(db, serverId, userId, p, null, p.schema_version);
        p.state_rev = rev;
      }

      const updatedBodyComponents = categoryId && categoryId !== "all"
        ? buildUpgradesCategoryComponents(p, categoryId, { staffRarity })
        : (source === "profile"
          ? buildUpgradesManagementComponents(p)
          : buildUpgradesOverviewComponents(p));
      const updatedActionRows = buildUpgradesComponents(userId, p, {
        categoryId: categoryId && categoryId !== "all" ? categoryId : null,
        staffRarity,
        source
      });

      if (!result.success) {
        return buildUpgradesPayload({
          content: result.message,
          ownerId: userId,
          bodyComponents: [],
          actionRows: [],
          ephemeral: true
        });
      }

      return buildUpgradesPayload({
        content: " ",
        ownerId: userId,
        bodyComponents: updatedBodyComponents,
        actionRows: updatedActionRows,
        ephemeral: false
      });
    }

    if (action === "staff") {
      if (!interaction.isSelectMenu()) return null;

      const staffId = interaction.values[0];
      const result = levelUpStaff(p, staffId, staffContent);
      if (result.success) {
        const rev = upsertPlayer(db, serverId, userId, p, null, p.schema_version);
        p.state_rev = rev;
      }

      return buildUpgradesPayload({
        content: result.success ? " " : result.message,
        ownerId: userId,
        bodyComponents: buildUpgradesCategoryComponents(p, "staff", { staffRarity }),
        actionRows: buildUpgradesComponents(userId, p, { categoryId: "staff", staffRarity, source }),
        ephemeral: !result.success
      });
    }

    if (action === "category" || action === "refresh" || action === "staffpage") {
      return buildUpgradesPayload({
        content: " ",
        ownerId: userId,
        bodyComponents,
        actionRows,
        ephemeral: false
      });
    }

      return null;
    });
  } catch (e) {
    const code = e?.code ?? e?.message;
    if (code === "LOCK_BUSY" || code === "ERR_LOCK_BUSY") {
      return {
        content: "Your shop is already busy. Try again in a moment.",
        ephemeral: true
      };
    }
    throw e;
  }
}
