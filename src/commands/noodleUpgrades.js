import { SlashCommandBuilder } from "@discordjs/builders";
import discordPkg from "discord.js";
import { openDb, getPlayer, upsertPlayer, getServer } from "../db/index.js";
import { withLock } from "../infra/locks.js";
import { makeIdempotencyKey, getIdempotentResult, putIdempotentResult } from "../infra/idempotency.js";
import { newPlayerProfile } from "../game/player.js";
import { newServerState } from "../game/server.js";
import { loadUpgradesContent } from "../content/index.js";
import {
  purchaseUpgrade,
  getUpgradesByCategory,
  calculateUpgradeEffects
} from "../game/upgrades.js";

const {
  MessageActionRow,
  MessageSelectMenu,
  MessageButton,
  MessageEmbed,
  Constants
} = discordPkg;

// Aliases for v14+ compatibility
const ActionRowBuilder = MessageActionRow;
const StringSelectMenuBuilder = MessageSelectMenu;
const ButtonBuilder = MessageButton;
const EmbedBuilder = MessageEmbed;

const ButtonStyle = {
  Primary: Constants?.MessageButtonStyles?.PRIMARY ?? 1,
  Secondary: Constants?.MessageButtonStyles?.SECONDARY ?? 2,
  Success: Constants?.MessageButtonStyles?.SUCCESS ?? 3,
  Danger: Constants?.MessageButtonStyles?.DANGER ?? 4,
  Link: Constants?.MessageButtonStyles?.LINK ?? 5
};

const db = openDb();
const upgradesContent = loadUpgradesContent();

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

function formatEffects(effects) {
  const lines = [];
  for (const [key, value] of Object.entries(effects)) {
    if (key === "cooking_speed_bonus") lines.push(`+${(value * 100).toFixed(1)}% cooking speed`);
    else if (key === "ingredient_save_chance") lines.push(`+${(value * 100).toFixed(1)}% ingredient save`);
    else if (key === "bowl_capacity_bonus") lines.push(`+${value} bowl capacity`);
    else if (key === "ingredient_capacity") lines.push(`+${value} ingredient storage`);
    else if (key === "spoilage_reduction") lines.push(`-${(value * 100).toFixed(1)}% spoilage`);
    else if (key === "bowl_storage_capacity") lines.push(`+${value} bowl storage`);
    else if (key === "rep_bonus_flat") lines.push(`+${value.toFixed(1)} rep`);
    else if (key === "rep_bonus_percent") lines.push(`+${(value * 100).toFixed(1)}% rep`);
    else if (key === "order_quality_bonus") lines.push(`+${(value * 100).toFixed(1)}% order quality`);
    else if (key === "npc_variety_bonus") lines.push(`+${(value * 100).toFixed(1)}% NPC variety`);
    else if (key === "staff_pool_quality") lines.push(`+${(value * 100).toFixed(1)}% staff pool quality`);
    else if (key === "staff_capacity") lines.push(`+${value.toFixed(1)} staff capacity`);
    else if (key === "staff_effect_multiplier") lines.push(`+${(value * 100).toFixed(1)}% staff effects`);
  }
  return lines.join(", ");
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
  
  const idempKey = makeIdempotencyKey(interaction);
  const existing = getIdempotentResult(idempKey);
  if (existing) {
    return existing;
  }

  const lockKey = `user:${userId}`;
  
  return withLock(lockKey, async () => {
    let p = getPlayer(db, userId, serverId);
    if (!p) {
      p = newPlayerProfile(userId);
      upsertPlayer(db, userId, serverId, p, null);
      p = getPlayer(db, userId, serverId);
    }

    const embed = buildUpgradesOverviewEmbed(p, interaction.user);
    const components = buildUpgradesComponents(userId, p);

    const response = {
      embeds: [embed],
      components,
      ephemeral: false
    };

    putIdempotentResult(idempKey, response);
    return response;
  });
}

function buildUpgradesOverviewEmbed(player, user) {
  const effects = calculateUpgradeEffects(player, upgradesContent);
  const upgradesByCategory = getUpgradesByCategory(player, upgradesContent);
  
  const embed = new EmbedBuilder()
    .setTitle("🔧 Shop Upgrades")
    .setDescription(`💰 Coins: **${player.coins}**\n\nUpgrade your shop to unlock powerful bonuses!`)
    .setColor(0xFF8C00);

  // Display upgrades by category
  for (const [categoryId, categoryData] of Object.entries(upgradesByCategory)) {
    if (!categoryData.upgrades || categoryData.upgrades.length === 0) continue;

    const lines = categoryData.upgrades.map(u => {
      const status = u.isMaxed ? "✅ MAX" : `${u.nextCost} coins`;
      return `• **${u.name}** (${u.currentLevel}/${u.maxLevel}) — ${status}`;
    });

    embed.addField(
      `${categoryData.icon || ""} ${categoryData.display_name || categoryId}`,
      lines.join("\n"),
      true
    );
  }

  // Active effects summary
  const effectLines = [];
  if (effects.cooking_speed_bonus > 0) effectLines.push(`🍳 +${(effects.cooking_speed_bonus * 100).toFixed(0)}% cooking speed`);
  if (effects.ingredient_save_chance > 0) effectLines.push(`🧺 ${(effects.ingredient_save_chance * 100).toFixed(1)}% ingredient save`);
  if (effects.bowl_capacity_bonus > 0) effectLines.push(`🍜 +${effects.bowl_capacity_bonus} bowl capacity`);
  if (effects.ingredient_capacity > 0) effectLines.push(`📦 +${effects.ingredient_capacity} ingredient capacity`);
  if (effects.bowl_storage_capacity > 0) effectLines.push(`🗄️ +${effects.bowl_storage_capacity} bowl storage`);
  if (effects.rep_bonus_flat > 0) effectLines.push(`⭐ +${effects.rep_bonus_flat.toFixed(1)} rep per serve`);
  if (effects.rep_bonus_percent > 0) effectLines.push(`⭐ +${(effects.rep_bonus_percent * 100).toFixed(1)}% rep`);
  if (effects.staff_effect_multiplier > 0) effectLines.push(`👥 +${(effects.staff_effect_multiplier * 100).toFixed(0)}% staff effects`);

  if (effectLines.length > 0) {
    embed.addField("📊 Total Upgrade Bonuses", effectLines.join("\n"), false);
  }

  applyOwnerFooter(embed, user);
  return embed;
}

function buildUpgradesComponents(userId, player) {
  const rows = [];
  const upgradesByCategory = getUpgradesByCategory(player, upgradesContent);

  // Build options for each category
  const allOptions = [];
  for (const [categoryId, categoryData] of Object.entries(upgradesByCategory)) {
    for (const upgrade of categoryData.upgrades || []) {
      if (upgrade.isMaxed) continue;

      const effectStr = formatEffects(upgrade.effects);
      const description = `Lv${upgrade.currentLevel}→${upgrade.currentLevel + 1}: ${effectStr}`.substring(0, 100);
      
      allOptions.push({
        label: `${upgrade.name} — ${upgrade.nextCost} coins`,
        description,
        value: upgrade.upgradeId,
        emoji: categoryData.icon || "🔧"
      });
    }
  }

  if (allOptions.length > 0) {
    // Split into multiple menus if more than 25 options
    const chunks = [];
    for (let i = 0; i < allOptions.length; i += 25) {
      chunks.push(allOptions.slice(i, i + 25));
    }

    chunks.forEach((chunk, idx) => {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`noodle-upgrades:buy:${userId}:${idx}`)
        .setPlaceholder(`Purchase upgrade (${idx + 1}/${chunks.length})`)
        .addOptions(chunk);
      rows.push(new ActionRowBuilder().addComponents(menu));
    });
  }

  // Refresh button
  const refreshButton = new ButtonBuilder()
    .setCustomId(`noodle-upgrades:refresh:${userId}`)
    .setLabel("🔄 Refresh")
    .setStyle(ButtonStyle.Secondary);
  rows.push(new ActionRowBuilder().addComponents(refreshButton));

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
      content: "❌ This is not your upgrades menu.",
      ephemeral: true
    };
  }

  const serverId = interaction.guild?.id ?? "DM";
  const lockKey = `user:${userId}`;

  return withLock(lockKey, async () => {
    let p = getPlayer(db, userId, serverId);
    if (!p) {
      p = newPlayerProfile(userId);
      upsertPlayer(db, userId, serverId, p, null);
      p = getPlayer(db, userId, serverId);
    }

    // Handle purchase
    if (action === "buy") {
      if (!interaction.isSelectMenu()) return null;
      
      const upgradeId = interaction.values[0];
      
      const result = purchaseUpgrade(p, upgradeId, upgradesContent);
      upsertPlayer(db, userId, serverId, p, null);

      const embed = buildUpgradesOverviewEmbed(p, interaction.user);
      const components = buildUpgradesComponents(userId, p);

      return {
        content: result.message,
        embeds: [embed],
        components
      };
    }

    // Handle refresh
    if (action === "refresh") {
      const embed = buildUpgradesOverviewEmbed(p, interaction.user);
      const components = buildUpgradesComponents(userId, p);

      return {
        content: " ",
        embeds: [embed],
        components
      };
    }

    return null;
  });
}
