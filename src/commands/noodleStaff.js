import { SlashCommandBuilder } from "@discordjs/builders";
import discordPkg from "discord.js";
import { openDb, getPlayer, upsertPlayer, getServer, upsertServer } from "../db/index.js";
import { withLock } from "../infra/locks.js";
import { makeIdempotencyKey, getIdempotentResult, putIdempotentResult } from "../infra/idempotency.js";
import { newPlayerProfile } from "../game/player.js";
import { newServerState } from "../game/server.js";
import { loadStaffContent } from "../content/index.js";
import {
  levelUpStaff,
  getStaffLevels,
  calculateStaffEffects,
  calculateStaffCost
} from "../game/staff.js";

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

function rarityEmoji(rarity) {
  return "";
}

function categoryEmoji(category) {
  if (category === "kitchen") return "🍳";
  if (category === "service") return "🍜";
  if (category === "support") return "🛠️";
  return "📋";
}

function staffSortKey(player, staff) {
  const currentLevel = player.staff_levels?.[staff.staff_id] || 0;
  const isMaxed = currentLevel >= staff.max_level;
  const cost = isMaxed ? Number.POSITIVE_INFINITY : calculateStaffCost(staff, currentLevel);
  return { cost, isMaxed };
}

function formatEffects(effects) {
  const lines = [];
  for (const [key, value] of Object.entries(effects)) {
    if (key === "ingredient_save_chance") lines.push(`${(value * 100).toFixed(0)}% ingredient save`);
    else if (key === "double_craft_chance") lines.push(`${(value * 100).toFixed(0)}% double craft`);
    else if (key === "rep_bonus_flat") lines.push(`+${value} rep`);
    else if (key === "rep_bonus_percent") lines.push(`+${(value * 100).toFixed(0)}% rep`);
    else if (key === "order_quality_bonus") lines.push(`+${(value * 100).toFixed(1)}% order quality`);
    else if (key === "cooldown_reduction") lines.push(`-${(value * 100).toFixed(0)}% cooldowns`);
    else if (key === "bowl_capacity_bonus") lines.push(`+${value} bowl capacity`);
    else if (key === "forage_bonus_items") lines.push(`+${value} forage items`);
    else if (key === "market_discount") lines.push(`${(value * 100).toFixed(0)}% market discount`);
    else if (key === "sxp_bonus_percent") lines.push(`+${(value * 100).toFixed(0)}% SXP`);
    else if (key === "rare_epic_rep_bonus") lines.push(`+${value} rep on rare/epic`);
  }
  return lines.join(", ");
}

export const noodleStaffCommand = {
  data: new SlashCommandBuilder()
    .setName("noodle-staff")
    .setDescription("Manage your noodle shop staff levels"),
  execute: noodleStaffHandler,
  handleComponent: noodleStaffInteractionHandler
};

export async function noodleStaffHandler(interaction) {
  const userId = interaction.user.id;
  const serverId = interaction.guild?.id ?? "DM";

  const idempKey = makeIdempotencyKey({
    serverId,
    userId,
    action: "noodle-staff",
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

    let s = getServer(db, serverId);
    if (!s) {
      s = newServerState(serverId);
      upsertServer(db, serverId, s, null);
      s = getServer(db, serverId);
    }

    const embed = buildStaffOverviewEmbed(p, s, interaction.user);
    const components = buildStaffComponents(userId, p, s);

    const response = {
      embeds: [embed],
      components,
      ephemeral: false
    };

    putIdempotentResult(db, { key: idempKey, userId, action: "noodle-staff", ttlSeconds: 900, result: response });
    return response;
  });
}

function buildStaffOverviewEmbed(player, server, user) {
  const leveledStaff = getStaffLevels(player, staffContent);
  const effects = calculateStaffEffects(player, staffContent);
  
  const embed = new EmbedBuilder()
    .setTitle("👥 Staff Management")
    .setColor(0x4169E1);

  // Current staff levels
  if (leveledStaff.length > 0) {
    const staffLines = leveledStaff.map(s => {
      const maxed = s.level >= s.maxLevel;
      const status = maxed ? "MAX" : `Lv${s.level}/${s.maxLevel}`;
      return `${rarityEmoji(s.rarity)} **${s.name}** ${categoryEmoji(s.category)} — ${status}`;
    });
    embed.addFields({
      name: `Your Staff (${leveledStaff.length} leveled)`,
      value: staffLines.join("\n"),
      inline: false
    });
  } else {
    embed.addFields({
      name: "Your Staff",
      value: "_No staff leveled yet._",
      inline: false
    });
  }

  // Effects summary
  const effectLines = [];
  if (effects.ingredient_save_chance > 0) effectLines.push(`🧺 ${(effects.ingredient_save_chance * 100).toFixed(0)}% ingredient save`);
  if (effects.double_craft_chance > 0) effectLines.push(`✨ ${(effects.double_craft_chance * 100).toFixed(0)}% double craft`);
  if (effects.rep_bonus_flat > 0) effectLines.push(`⭐ +${effects.rep_bonus_flat.toFixed(1)} rep per serve`);
  if (effects.rep_bonus_percent > 0) effectLines.push(`⭐ +${(effects.rep_bonus_percent * 100).toFixed(0)}% rep`);
  if (effects.bowl_capacity_bonus > 0) effectLines.push(`🍜 +${effects.bowl_capacity_bonus} bowl capacity`);
  if (effects.cooldown_reduction > 0) effectLines.push(`⏱️ -${(effects.cooldown_reduction * 100).toFixed(0)}% cooldowns`);
  if (effects.forage_bonus_items > 0) effectLines.push(`🌿 +${effects.forage_bonus_items} forage items`);
  if (effects.market_discount > 0) effectLines.push(`💰 ${(effects.market_discount * 100).toFixed(0)}% market discount`);
  if (effects.sxp_bonus_percent > 0) effectLines.push(`📈 +${(effects.sxp_bonus_percent * 100).toFixed(0)}% SXP`);
  if (effects.rare_epic_rep_bonus > 0) effectLines.push(`🌟 +${effects.rare_epic_rep_bonus} rep on rare/epic`);
  if (effects.order_quality_bonus > 0) effectLines.push(`✨ +${(effects.order_quality_bonus * 100).toFixed(1)}% order quality`);

  if (effectLines.length > 0) {
    embed.addFields({
      name: "Active Bonuses",
      value: effectLines.join("\n"),
      inline: false
    });
  }

  // All available staff
  const poolLines = Object.values(staffContent.staff_members ?? {})
    .filter(Boolean)
    .sort((a, b) => {
      const aKey = staffSortKey(player, a);
      const bKey = staffSortKey(player, b);
      if (aKey.cost !== bKey.cost) return aKey.cost - bKey.cost;
      return a.name.localeCompare(b.name);
    })
    .map(staff => {
    const currentLevel = player.staff_levels?.[staff.staff_id] || 0;
    const cost = calculateStaffCost(staff, currentLevel);
    const status = currentLevel >= staff.max_level ? "✅ MAX" : `Lv${currentLevel}`;
    return `${rarityEmoji(staff.rarity)} **${staff.name}** ${categoryEmoji(staff.category)} — ${status} (${cost} coins)`;
  }).filter(Boolean);

  if (poolLines.length > 0) {
    embed.addFields({
      name: "Available Staff",
      value: poolLines.join("\n"),
      inline: false
    });
  } else {
    embed.addFields({
      name: "Available Staff",
      value: "_No staff available._",
      inline: false
    });
  }

  embed.setDescription(`💰 Coins: **${player.coins}**`);
  applyOwnerFooter(embed, user);

  return embed;
}

function buildStaffComponents(userId, player, server) {
  const rows = [];

  // Level up menu
  const levelUpOptions = Object.values(staffContent.staff_members ?? {})
    .sort((a, b) => {
      const aKey = staffSortKey(player, a);
      const bKey = staffSortKey(player, b);
      if (aKey.cost !== bKey.cost) return aKey.cost - bKey.cost;
      return a.name.localeCompare(b.name);
    })
    .map(staff => {
      const currentLevel = player.staff_levels?.[staff.staff_id] || 0;
      if (currentLevel >= staff.max_level) return null; // Already maxed

      const cost = calculateStaffCost(staff, currentLevel);
      const effectStr = formatEffects(staff.effects_per_level);
      const description = `Lv${currentLevel}→${currentLevel + 1}: ${effectStr}`.substring(0, 100);

      return {
        label: `${staff.name} — ${cost} coins`,
        description,
        value: staff.staff_id,
        emoji: rarityEmoji(staff.rarity)
      };
    })
    .filter(Boolean);

  if (levelUpOptions.length > 0) {
    const levelUpMenu = new StringSelectMenuBuilder()
      .setCustomId(`noodle-staff:levelup:${userId}`)
      .setPlaceholder("Level up staff member")
      .addOptions(levelUpOptions);
    rows.push(new ActionRowBuilder().addComponents(levelUpMenu));
  }

  // Refresh button
  const refreshButton = new ButtonBuilder()
    .setCustomId(`noodle-staff:refresh:${userId}`)
    .setLabel("🔄 Refresh")
    .setStyle(ButtonStyle.Secondary);
  rows.push(new ActionRowBuilder().addComponents(refreshButton));

  return rows;
}

export async function noodleStaffInteractionHandler(interaction) {
  const customId = interaction.customId;
  const parts = customId.split(":");
  
  if (parts[0] !== "noodle-staff") return null;

  const action = parts[1];
  const targetUserId = parts[2];
  const userId = interaction.user.id;

  // Ownership check
  if (targetUserId !== userId) {
    return {
      content: "❌ This is not your staff menu.",
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

    let s = getServer(db, serverId);
    if (!s) {
      s = newServerState(serverId);
      upsertServer(db, serverId, s, null);
      s = getServer(db, serverId);
    }

    // Handle level up
    if (action === "levelup") {
      if (!interaction.isSelectMenu()) return null;
      
      const staffId = interaction.values[0];
      
      const result = levelUpStaff(p, staffId, staffContent);
      upsertPlayer(db, userId, serverId, p, null);

      const embed = buildStaffOverviewEmbed(p, s, interaction.user);
      const components = buildStaffComponents(userId, p, s);

      return {
        content: result.message,
        embeds: [embed],
        components,
        ephemeral: !result.success
      };
    }

    // Handle refresh
    if (action === "refresh") {
      const embed = buildStaffOverviewEmbed(p, s, interaction.user);
      const components = buildStaffComponents(userId, p, s);

      return {
        content: " ",
        embeds: [embed],
        components
      };
    }

    return null;
  });
}
