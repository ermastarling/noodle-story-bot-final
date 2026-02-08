import { SlashCommandBuilder } from "@discordjs/builders";
import discordPkg from "discord.js";
import { openDb, getPlayer, upsertPlayer, getServer, upsertServer } from "../db/index.js";
import { withLock } from "../infra/locks.js";
import { makeIdempotencyKey, getIdempotentResult, putIdempotentResult } from "../infra/idempotency.js";
import { newPlayerProfile } from "../game/player.js";
import { newServerState } from "../game/server.js";
import { loadStaffContent, loadUpgradesContent } from "../content/index.js";
import {
  levelUpStaff,
  getStaffLevels,
  getMaxStaffCapacity,
  calculateStaffCost
} from "../game/staff.js";
import { calculateUpgradeEffects } from "../game/upgrades.js";
import { theme } from "../ui/theme.js";
import { getIcon, getButtonEmoji } from "../ui/icons.js";

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

function rarityEmoji(rarity) {
  return "";
}

function categoryEmoji(category) {
  if (category === "kitchen") return getIcon("category_kitchen");
  if (category === "service") return getIcon("category_service");
  if (category === "support") return getIcon("category_support");
  return getIcon("category_default");
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

export function buildStaffOverviewEmbed(player, server, user) {
  const leveledStaff = getStaffLevels(player, staffContent);
  const staffCap = getMaxStaffCapacity(player, staffContent);
  const hiredCount = Object.values(player.staff_levels || {}).filter((lvl) => Number(lvl) > 0).length;
  
  const embed = new EmbedBuilder()
    .setTitle(`${getIcon("staff_management")} Staff Management`)
    .setColor(theme.colors.info);

  // Current staff levels
  if (leveledStaff.length > 0) {
    const staffLines = leveledStaff.map(s => {
      const maxed = s.level >= s.maxLevel;
      const status = maxed ? "MAX" : `Lv${s.level}/${s.maxLevel}`;
      const emojiPrefix = [rarityEmoji(s.rarity), categoryEmoji(s.category)].filter(Boolean).join(" ");
      const prefix = emojiPrefix ? `${emojiPrefix} ` : "";
      return `${prefix}**${s.name}** — ${status}`;
    });
    embed.addFields({
      name: `Your Staff (${hiredCount}/${staffCap} slots)`,
      value: staffLines.join("\n"),
      inline: false
    });
  } else {
    embed.addFields({
      name: `Your Staff (${hiredCount}/${staffCap} slots)`,
      value: "_No staff leveled yet._",
      inline: false
    });
  }

  // Effects summary
  const effectLines = [];
  const upgradeEffects = calculateUpgradeEffects(player, upgradesContent);
  const staffMultiplier = 1 + (upgradeEffects.staff_effect_multiplier || 0);

  const formatStaffEffectValue = (key, value) => {
    if (key === "ingredient_save_chance") return `${(value * 100).toFixed(0)}% ingredient save`;
    if (key === "double_craft_chance") return `${(value * 100).toFixed(0)}% double craft`;
    if (key === "rep_bonus_flat") return `+${value.toFixed(1)} rep per serve`;
    if (key === "rep_bonus_percent") return `+${(value * 100).toFixed(0)}% rep`;
    if (key === "bowl_capacity_bonus") return `+${value} bowl capacity`;
    if (key === "cooldown_reduction") return `-${(value * 100).toFixed(0)}% cooldowns`;
    if (key === "forage_bonus_items") return `+${value} forage items`;
    if (key === "market_discount") return `${(value * 100).toFixed(0)}% market discount`;
    if (key === "sxp_bonus_percent") return `+${(value * 100).toFixed(0)}% SXP`;
    if (key === "rare_epic_rep_bonus") return `+${value} rep on rare/epic`;
    if (key === "order_quality_bonus") return `+${(value * 100).toFixed(1)}% order quality`;
    return null;
  };

  const staffLevels = Object.entries(player.staff_levels || {})
    .filter(([, level]) => Number(level) > 0);

  for (const [staffId, levelRaw] of staffLevels) {
    const staff = staffContent.staff_members?.[staffId];
    if (!staff) continue;
    const level = Math.max(0, Number(levelRaw || 0));
    if (level <= 0) continue;

    if (staffId === "prep_chef") {
      effectLines.push(`**${staff.name}** — auto-buys missing non-forage ingredients for up to ${level} orders per accept action`);
      continue;
    }

    const effectsPerLevel = staff.effects_per_level ?? {};
    for (const [effectKey, perLevel] of Object.entries(effectsPerLevel)) {
      const total = perLevel * level * staffMultiplier;
      const formatted = formatStaffEffectValue(effectKey, total);
      if (!formatted) continue;
      effectLines.push(`**${staff.name}** — ${formatted}`);
    }
  }

  if (effectLines.length > 0) {
    embed.addFields({
      name: "Active Bonuses",
      value: effectLines.join("\n"),
      inline: false
    });
  }

  embed.setDescription(`${getIcon("coins")} Coins: **${player.coins}**\n${getIcon("staff_slots")} Staff Slots: **${hiredCount}/${staffCap}**`);
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
        label: `${staff.name} — ${cost}c`,
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
    .setLabel("Refresh").setEmoji(getButtonEmoji("refresh"))
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
      content: `${getIcon("error")} This is not your staff menu.`,
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
