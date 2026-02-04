import { SlashCommandBuilder } from "@discordjs/builders";
import discordPkg from "discord.js";
import { openDb, getPlayer, upsertPlayer } from "../db/index.js";
import { withLock } from "../infra/locks.js";
import { makeIdempotencyKey, getIdempotentResult, putIdempotentResult } from "../infra/idempotency.js";
import { newPlayerProfile } from "../game/player.js";
import { loadUpgradesContent, loadStaffContent } from "../content/index.js";
import { noodleMainMenuRow } from "./noodle.js";
import {
  purchaseUpgrade,
  getUpgradesByCategory,
  calculateUpgradeEffects
} from "../game/upgrades.js";
import { calculateStaffCost, levelUpStaff } from "../game/staff.js";

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
const staffContent = loadStaffContent();

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

function buildCategoryButtonsRow(userId, activeCategory = null) {
  const categories = [
    { id: "staff", label: "👥 Staff" },
    { id: "kitchen", label: "🍳 Kitchen" },
    { id: "storage", label: "📦 Storage" },
    { id: "service", label: "🍜 Service" },
    { id: "ambience", label: "✨ Ambiance" }
  ];

  const buttons = categories.map((cat) =>
    new ButtonBuilder()
      .setCustomId(`noodle-upgrades:category:${userId}:${cat.id}`)
      .setLabel(cat.label)
      .setStyle(cat.id === activeCategory ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  return new ActionRowBuilder().addComponents(buttons);
}

function buildStaffRarityRow(userId, activeRarity = "common") {
  const rarities = [
    { id: "common", label: "⚪ Common" },
    { id: "rare", label: "⭐ Rare" },
    { id: "epic", label: "🌟 Epic" }
  ];

  const buttons = rarities.map((rar) =>
    new ButtonBuilder()
      .setCustomId(`noodle-upgrades:staffpage:${userId}:${rar.id}`)
      .setLabel(rar.label)
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

  const idempKey = makeIdempotencyKey({
    serverId,
    userId,
    action: "noodle-upgrades",
    interactionId: interaction.id
  });
  const existing = getIdempotentResult(db, idempKey);
  if (existing) {
    return existing;
  }

  const lockKey = `user:${userId}`;

  return withLock(db, lockKey, `discord:${interaction.id}`, 8000, async () => {
    let p = getPlayer(db, serverId, userId);
    if (!p) {
      p = newPlayerProfile(userId);
      upsertPlayer(db, serverId, userId, p, null);
      p = getPlayer(db, serverId, userId);
    }

    const embed = buildUpgradesOverviewEmbed(p, interaction.member ?? interaction.user);
    const components = buildUpgradesComponents(userId, p);

    const response = {
      embeds: [embed],
      components,
      ephemeral: false
    };

    putIdempotentResult(db, { key: idempKey, userId, action: "noodle-upgrades", ttlSeconds: 900, result: response });
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

    embed.addFields({
      name: `${categoryData.icon || ""} ${categoryData.display_name || categoryId}`,
      value: lines.join("\n"),
      inline: true
    });
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
    embed.addFields({
      name: "📊 Total Upgrade Bonuses",
      value: effectLines.join("\n"),
      inline: false
    });
  }

  applyOwnerFooter(embed, user);
  return embed;
}

function buildUpgradesCategoryEmbed(player, user, categoryId, { staffRarity = "common" } = {}) {
  const upgradesByCategory = getUpgradesByCategory(player, upgradesContent);
  const categoryData = upgradesContent.upgrade_categories?.[categoryId];

  if (categoryId === "staff") {
    const embed = new EmbedBuilder()
      .setTitle("👥 Staff Upgrades")
      .setDescription(`💰 Coins: **${player.coins}**\n\nHire and empower your staff.`)
      .setColor(0xFF8C00);

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
        const cost = calculateStaffCost(staff, currentLevel);
        const status = currentLevel >= staff.max_level ? "✅ MAX" : `${cost} coins`;
        const emoji = shouldHideRarityEmoji(staff) ? "" : `${rarityEmoji(staff.rarity)} `;
        const description = staff.description ? `\n  _${staff.description}_` : "";
        return `• ${emoji}**${staff.name}** (${currentLevel}/${staff.max_level}) — ${status}${description}`.trim();
      })
      .filter(Boolean);

    embed.addFields({
      name: `${rarityEmoji(staffRarity)} ${staffRarity[0].toUpperCase()}${staffRarity.slice(1)} Staff`,
      value: staffLines.length ? staffLines.join("\n") : "_No staff found._",
      inline: false
    });

    applyOwnerFooter(embed, user);
    return embed;
  }

  const title = `${categoryData?.icon || "🔧"} ${categoryData?.display_name || categoryId}`;
  const descLines = [
    `💰 Coins: **${player.coins}**`,
    categoryData?.description ? `\n${categoryData.description}` : ""
  ].join("\n");

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(descLines.trim())
    .setColor(0xFF8C00);

  const upgrades = upgradesByCategory[categoryId]?.upgrades ?? [];
  const lines = upgrades.map((u) => {
    const status = u.isMaxed ? "✅ MAX" : `${u.nextCost} coins`;
    return `• **${u.name}** (${u.currentLevel}/${u.maxLevel}) — ${status}`;
  });

  embed.addFields({
    name: "Upgrades",
    value: lines.length ? lines.join("\n") : "_No upgrades found._",
    inline: false
  });

  applyOwnerFooter(embed, user);
  return embed;
}

function buildUpgradesComponents(userId, player, { categoryId = null, staffRarity = "common" } = {}) {
  const rows = [];
  if (categoryId !== "staff") {
    rows.push(buildCategoryButtonsRow(userId, categoryId));
  }
  const upgradesByCategory = getUpgradesByCategory(player, upgradesContent);

  if (categoryId === "staff") {
    rows.push(buildStaffRarityRow(userId, staffRarity));
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
        const cost = calculateStaffCost(staff, currentLevel);
        return {
          label: `${staff.name} — ${cost} coins`,
          description: `Lv${currentLevel}→${currentLevel + 1}`.slice(0, 100),
          value: staff.staff_id,
          emoji: rarityEmoji(staff.rarity)
        };
      })
      .filter(Boolean);

    if (staffOptions.length > 0) {
      const staffMenu = new StringSelectMenuBuilder()
        .setCustomId(`noodle-upgrades:staff:${userId}`)
        .setPlaceholder("Level up staff member")
        .addOptions(staffOptions);
      rows.push(new ActionRowBuilder().addComponents(staffMenu));
    }
  }

  // Build options for each category
  const allOptions = [];
  const categoryEntries = categoryId
    ? [[categoryId, upgradesByCategory[categoryId]]]
    : Object.entries(upgradesByCategory);

  for (const [catId, categoryData] of categoryEntries) {
    if (!categoryData?.upgrades) continue;
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
      const placeholder = categoryId === "staff"
        ? "Purchase Staff Upgrades"
        : "Purchase Shop Upgrades";
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`noodle-upgrades:buy:${userId}:${categoryId || "all"}:${idx}`)
        .setPlaceholder(placeholder)
        .addOptions(chunk);
      rows.push(new ActionRowBuilder().addComponents(menu));
    });
  }

  if (!categoryId) {
    rows.push(noodleMainMenuRow(userId));
  }

  if (categoryId) {
    const backButton = new ButtonBuilder()
      .setCustomId(`noodle-upgrades:category:${userId}:all`)
      .setLabel("⬅️ Back")
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
      content: "❌ This is not your upgrades menu.",
      ephemeral: true
    };
  }

  const serverId = interaction.guild?.id ?? "DM";
  const lockKey = `user:${userId}`;

  return withLock(db, lockKey, `discord:${interaction.id}`, 8000, async () => {
    let p = getPlayer(db, serverId, userId);
    if (!p) {
      p = newPlayerProfile(userId);
      upsertPlayer(db, serverId, userId, p, null);
      p = getPlayer(db, serverId, userId);
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
      if (action === "category" && parts[3] === "staff") return parts[4] ?? "common";
      return "common";
    };

    const categoryId = resolveCategory();
    const staffRarity = resolveStaffRarity();
    const refreshed = getPlayer(db, serverId, userId) ?? p;
    const embed = categoryId && categoryId !== "all"
      ? buildUpgradesCategoryEmbed(refreshed, interaction.member ?? interaction.user, categoryId, { staffRarity })
      : buildUpgradesOverviewEmbed(refreshed, interaction.member ?? interaction.user);
    const components = buildUpgradesComponents(userId, refreshed, {
      categoryId: categoryId && categoryId !== "all" ? categoryId : null,
      staffRarity
    });

    // Handle purchase
    if (action === "buy") {
      if (!interaction.isSelectMenu()) return null;
      
      const upgradeId = interaction.values[0];
      
      const result = purchaseUpgrade(p, upgradeId, upgradesContent);
      upsertPlayer(db, serverId, userId, p, null);

      const updatedPlayer = getPlayer(db, serverId, userId) ?? p;
      const updatedEmbed = categoryId && categoryId !== "all"
        ? buildUpgradesCategoryEmbed(updatedPlayer, interaction.member ?? interaction.user, categoryId, { staffRarity })
        : buildUpgradesOverviewEmbed(updatedPlayer, interaction.member ?? interaction.user);
      const updatedComponents = buildUpgradesComponents(userId, updatedPlayer, {
        categoryId: categoryId && categoryId !== "all" ? categoryId : null,
        staffRarity
      });

      return {
        content: result.message,
        embeds: [updatedEmbed],
        components: updatedComponents,
        ephemeral: !result.success
      };
    }

    if (action === "staff") {
      if (!interaction.isSelectMenu()) return null;

      const staffId = interaction.values[0];
      const result = levelUpStaff(p, staffId, staffContent);
      upsertPlayer(db, serverId, userId, p, null);

      const updatedPlayer = getPlayer(db, serverId, userId) ?? p;
      const updatedEmbed = buildUpgradesCategoryEmbed(updatedPlayer, interaction.member ?? interaction.user, "staff", { staffRarity });
      const updatedComponents = buildUpgradesComponents(userId, updatedPlayer, { categoryId: "staff", staffRarity });

      return {
        content: result.message,
        embeds: [updatedEmbed],
        components: updatedComponents,
        ephemeral: !result.success
      };
    }

    if (action === "category" || action === "refresh" || action === "staffpage") {
      return {
        content: " ",
        embeds: [embed],
        components
      };
    }

    return null;
  });
}
