import { SlashCommandBuilder } from "@discordjs/builders";
import discordPkg from "discord.js";
import { openDb, getPlayer, upsertPlayer, getServer, upsertServer } from "../db/index.js";
import { withLock } from "../infra/locks.js";
import { makeIdempotencyKey, getIdempotentResult, putIdempotentResult } from "../infra/idempotency.js";
import { newPlayerProfile, trackLastKitchen } from "../game/player.js";
import { newServerState } from "../game/server.js";
import { loadStaffContent, loadUpgradesContent } from "../content/index.js";
import {
  levelUpStaff,
  getStaffLevels,
  getMaxStaffCapacity,
  getStaffSlotsUsed,
  calculateStaffCost,
  getStaffUnlockStatus
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

function formatTwoDecimals(value) {
  return Number(Number(value ?? 0).toFixed(2));
}

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
    else if (key === "rep_bonus_flat") lines.push(`+${formatTwoDecimals(value)} rep`);
    else if (key === "rep_bonus_percent") lines.push(`+${(value * 100).toFixed(0)}% rep`);
    else if (key === "order_quality_bonus") lines.push(`+${(value * 100).toFixed(1)}% order quality`);
    else if (key === "cooldown_reduction") lines.push(`-${(value * 100).toFixed(0)}% cooldowns`);
    else if (key === "bowl_capacity_bonus") lines.push(`+${formatTwoDecimals(value)} bowl capacity`);
    else if (key === "forage_bonus_items") lines.push(`+${Number(value).toFixed(2)} forage items`);
    else if (key === "fishing_bonus_items") lines.push(`+${Number(value).toFixed(2)} bonus catches per trip`);
    else if (key === "forage_seed_chance") lines.push(`+${(value * 100).toFixed(2)}% seed find chance`);
    else if (key === "garden_autoharvest") lines.push(`Auto-harvest garden plots`);
    else if (key === "garden_harvest_seed_chance") lines.push(`+${(value * 100).toFixed(0)}% harvest seed chance`);
    else if (key === "market_discount") lines.push(`${(value * 100).toFixed(0)}% market discount`);
    else if (key === "sxp_bonus_percent") lines.push(`+${(value * 100).toFixed(0)}% SXP`);
    else if (key === "rare_epic_rep_bonus") lines.push(`+${formatTwoDecimals(value)} rep on rare/epic`);
    else if (key === "rare_epic_quality_bonus") lines.push(`+${(value * 100).toFixed(0)}% rare/epic cook quality`);
    else if (key === "rare_epic_fail_reduction") lines.push(`-${(value * 100).toFixed(0)}% rare/epic cook fail`);
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
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply(existing);
    }
    return interaction.reply(existing);
  }

  const lockKey = `user:${userId}`;
  
  const lockedResult = await withLock(db, lockKey, `discord:${interaction.id}`, 8000, async () => {
    let p = getPlayer(db, serverId, userId);
    if (!p) {
      p = newPlayerProfile(userId);
      const rev = upsertPlayer(db, serverId, userId, p, null);
      p.state_rev = rev;
    }

    let s = getServer(db, serverId);
    if (!s) {
      s = newServerState(serverId);
      const rev = upsertServer(db, serverId, s, null);
      s.state_rev = rev;
    }

    const touched = trackLastKitchen(p, serverId, interaction.channelId);
    if (touched && db) {
      const rev = upsertPlayer(db, serverId, userId, p, null, p.schema_version);
      p.state_rev = rev;
    }

    const embed = buildStaffOverviewEmbed(p, s, interaction.user);
    const components = buildStaffComponents(userId, p, s);

    const response = {
      embeds: [embed],
      components,
      ephemeral: false
    };
    response.embeds = applyGreenButtonFooter(response.embeds, response.components);

    putIdempotentResult(db, { key: idempKey, userId, action: "noodle-staff", ttlSeconds: 900, result: response });
    return response;
  });

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(lockedResult);
  }
  return interaction.reply(lockedResult);
}

export function buildStaffOverviewEmbed(player, server, user) {
  const staffCap = getMaxStaffCapacity(player, staffContent);
  const usedSlots = getStaffSlotsUsed(player);
  
  const embed = new EmbedBuilder()
    .setTitle(`${getIcon("staff_management")} Staff Management`)
    .setColor(theme.colors.info);

  const upgradeEffects = calculateUpgradeEffects(player, upgradesContent);
  const staffMultiplier = 1 + (upgradeEffects.staff_effect_multiplier || 0);

  const formatStaffEffectValue = (key, value) => {
    if (key === "ingredient_save_chance") return `${(value * 100).toFixed(0)}% ingredient save`;
    if (key === "double_craft_chance") return `${(value * 100).toFixed(0)}% double craft`;
    if (key === "rep_bonus_flat") return `+${value.toFixed(1)} rep per serve`;
    if (key === "rep_bonus_percent") return `+${(value * 100).toFixed(0)}% rep`;
    if (key === "bowl_capacity_bonus") return `+${formatTwoDecimals(value)} bowl capacity`;
    if (key === "cooldown_reduction") return `-${(value * 100).toFixed(0)}% cooldowns`;
    if (key === "forage_bonus_items") return `+${Number(value).toFixed(2)} forage items`;
    if (key === "fishing_bonus_items") return `+${Number(value).toFixed(2)} bonus catches per trip`;
    if (key === "forage_seed_chance") return `+${(value * 100).toFixed(2)}% seed find chance`;
    if (key === "garden_autoharvest") return `Auto-harvests garden plots`;
    if (key === "garden_harvest_seed_chance") return `+${(value * 100).toFixed(0)}% seed chance on harvest`;
    if (key === "market_discount") return `${(value * 100).toFixed(0)}% market discount`;
    if (key === "sxp_bonus_percent") return `+${(value * 100).toFixed(0)}% SXP`;
    if (key === "rare_epic_rep_bonus") return `+${formatTwoDecimals(value)} rep on rare/epic`;
    if (key === "order_quality_bonus") return `+${(value * 100).toFixed(1)}% order quality`;
    if (key === "rare_epic_quality_bonus") return `+${(value * 100).toFixed(0)}% rare/epic cook quality`;
    if (key === "rare_epic_fail_reduction") return `-${(value * 100).toFixed(0)}% rare/epic cook fail`;
    return null;
  };

  const staffLevels = Object.entries(player.staff_levels || {})
    .filter(([, level]) => Number(level) > 0);

  const staffLines = [];
  for (const [staffId, levelRaw] of staffLevels) {
    const staff = staffContent.staff_members?.[staffId];
    if (!staff) continue;
    const level = Math.max(0, Number(levelRaw || 0));
    if (level <= 0) continue;

    const maxed = level >= staff.max_level;
    const status = maxed ? "MAX" : `Lv${level}/${staff.max_level}`;
    const effectsPerLevel = staff.effects_per_level ?? {};
    let effectSummary = "";

    if (staffId === "prep_chef") {
      effectSummary = `auto-buys missing non-forage ingredients for up to ${level} orders per accept action`;
    } else if (staffId === "sommelier") {
      const failPerLevel = Number(effectsPerLevel.rare_epic_fail_reduction ?? 0);
      const qualityPerLevel = Number(effectsPerLevel.rare_epic_quality_bonus ?? 0);
      const failTotal = failPerLevel * level * staffMultiplier;
      const qualityTotal = qualityPerLevel * level * staffMultiplier;
      effectSummary = `-${(failTotal * 100).toFixed(0)}% rare/epic cook fail, +${(qualityTotal * 100).toFixed(0)}% rare/epic cook quality`;
    } else if (staffId === "forager") {
      const bonusPerLevel = Number(effectsPerLevel.forage_bonus_items ?? 0);
      const seedPerLevel = Number(effectsPerLevel.forage_seed_chance ?? 0);
      const bonusTotal = bonusPerLevel * level * staffMultiplier;
      const seedTotal = seedPerLevel * level * staffMultiplier;
      effectSummary = `+${bonusTotal.toFixed(2)} forage items, +${(seedTotal * 100).toFixed(2)}% seed find chance`;
    } else {
      const effectPieces = Object.entries(effectsPerLevel)
        .map(([effectKey, perLevel]) => {
          const total = perLevel * level * staffMultiplier;
          return formatStaffEffectValue(effectKey, total);
        })
        .filter(Boolean);
      effectSummary = effectPieces.join(", ");
    }

    const emojiPrefix = [rarityEmoji(staff.rarity), categoryEmoji(staff.category)].filter(Boolean).join(" ");
    const prefix = emojiPrefix ? `${emojiPrefix} ` : "";
    const bonusPart = effectSummary ? ` — ${effectSummary}` : "";
    staffLines.push(`${prefix}**${staff.name}** — ${status}${bonusPart}`);
  }

  embed.addFields({
    name: `Your Staff`,
    value: staffLines.length ? staffLines.join("\n") : "_No staff leveled yet._",
    inline: false
  });

  embed.setDescription(`${getIcon("coins")} Coins: **${player.coins}**\n${getIcon("staff_slots")} Staff Slots: **${usedSlots}/${staffCap}**`);
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
      const unlockStatus = getStaffUnlockStatus(player, staff);
      if (!unlockStatus.unlocked) return null;

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
      const rev = upsertPlayer(db, serverId, userId, p, null);
      p.state_rev = rev;
    }

    let s = getServer(db, serverId);
    if (!s) {
      s = newServerState(serverId);
      const rev = upsertServer(db, serverId, s, null);
      s.state_rev = rev;
    }

    const touched = trackLastKitchen(p, serverId, interaction.channelId);
    if (touched && db) {
      const rev = upsertPlayer(db, serverId, userId, p, null, p.schema_version);
      p.state_rev = rev;
    }

    // Handle level up
    if (action === "levelup") {
      if (!interaction.isSelectMenu()) return null;
      
      const staffId = interaction.values[0];
      
      const result = levelUpStaff(p, staffId, staffContent);
      if (result.success) {
        upsertPlayer(db, serverId, userId, p, null, p.schema_version);
      }

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
