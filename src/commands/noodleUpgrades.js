import { SlashCommandBuilder } from "@discordjs/builders";
import discordPkg from "discord.js";
import { openDb, getPlayer, upsertPlayer } from "../db/index.js";
import { withLock } from "../infra/locks.js";
import { makeIdempotencyKey, getIdempotentResult, putIdempotentResult } from "../infra/idempotency.js";
import { newPlayerProfile } from "../game/player.js";
import { loadUpgradesContent, loadStaffContent } from "../content/index.js";
import { noodleMainMenuRow } from "./noodle.js";
import { buildStaffOverviewEmbed } from "./noodleStaff.js";
import {
  purchaseUpgrade,
  calculateUpgradeCost,
  getUpgradesByCategory,
  calculateUpgradeEffects
} from "../game/upgrades.js";
import { calculateStaffCost, levelUpStaff } from "../game/staff.js";
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
    if (key === "ingredient_save_chance") lines.push(`+${(value * 100).toFixed(1)}% ingredient save`);
    else if (key === "bowl_capacity_bonus") lines.push(`+${value} bowl capacity`);
    else if (key === "ingredient_capacity") lines.push(`+${value} ingredient storage`);
    else if (key === "spoilage_reduction") lines.push(`-${(value * 100).toFixed(1)}% spoilage`);
    else if (key === "bowl_storage_capacity") lines.push(`+${value} bowl storage`);
    else if (key === "rep_bonus_flat") lines.push(`+${value.toFixed(1)} rep`);
    else if (key === "rep_bonus_percent") lines.push(`+${(value * 100).toFixed(1)}% rep`);
    else if (key === "order_quality_bonus") lines.push(`+${(value * 100).toFixed(1)}% order quality`);
    else if (key === "npc_variety_bonus") lines.push(`+${(value * 100).toFixed(1)}% NPC variety`);
    else if (key === "staff_capacity") lines.push(`+${value.toFixed(1)} staff capacity`);
    else if (key === "staff_effect_multiplier") lines.push(`+${(value * 100).toFixed(1)}% staff effects`);
    else if (key === "prep_batch_bonus") {
      const divisor = value > 0 ? Math.round(1 / value) : 0;
      lines.push(`+1 bowl per ${divisor} prep levels`);
    }
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

function buildCategoryButtonsRow(userId, activeCategory = null, source = null) {
  const categories = [
    { id: "staff", label: `${getIcon("staff_management")} Staff` },
    { id: "kitchen", label: `${getIcon("category_kitchen")} Kitchen` },
    { id: "storage", label: `${getIcon("category_storage")} Storage` },
    { id: "service", label: `${getIcon("category_service")} Service` },
    { id: "ambience", label: `${getIcon("category_ambience")} Ambiance` }
  ];

  const buttons = categories.map((cat) =>
    new ButtonBuilder()
      .setCustomId(
        source
          ? `noodle-upgrades:category:${userId}:${cat.id}:${source}`
          : `noodle-upgrades:category:${userId}:${cat.id}`
      )
      .setLabel(cat.label)
      .setStyle(cat.id === activeCategory ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  return new ActionRowBuilder().addComponents(buttons);
}

function buildStaffRarityRow(userId, activeRarity = "common", source = null) {
  const rarities = [
    { id: "overview", label: `${getIcon("staff_management")} Staff` },
    { id: "common", label: `${getIcon("rarity_common")} Common` },
    { id: "rare", label: `${getIcon("rarity_rare")} Rare` },
    { id: "epic", label: `${getIcon("rarity_epic")} Epic` },
    { id: "upgrades", label: `${getIcon("staff_upgrades")} Upgrades` }
  ];

  const buttons = rarities.map((rar) =>
    new ButtonBuilder()
      .setCustomId(
        source
          ? `noodle-upgrades:staffpage:${userId}:${rar.id}:${source}`
          : `noodle-upgrades:staffpage:${userId}:${rar.id}`
      )
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

    const embed = buildUpgradesManagementEmbed(p, interaction.member ?? interaction.user);
    const components = buildUpgradesComponents(userId, p, { source: "profile" });

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
    .setTitle(`${getIcon("upgrades")} Shop Upgrades`)
    .setDescription(`${getIcon("coins")} Coins: **${player.coins}**\n\nUpgrade your shop to unlock powerful bonuses!`)
    .setColor(theme.colors.accent);

  // Display upgrades by category
  for (const [categoryId, categoryData] of Object.entries(upgradesByCategory)) {
    if (!categoryData.upgrades || categoryData.upgrades.length === 0) continue;

    const lines = categoryData.upgrades.map(u => {
      const status = u.isMaxed ? `${getIcon("status_complete")} MAX` : `${u.nextCost}c`;
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
  if (effects.ingredient_save_chance > 0) effectLines.push(`${getIcon("ingredient_save")} ${(effects.ingredient_save_chance * 100).toFixed(1)}% ingredient save`);
  if (effects.bowl_capacity_bonus > 0) effectLines.push(`${getIcon("bowl_capacity")} +${effects.bowl_capacity_bonus} bowl capacity`);
  if (effects.ingredient_capacity > 0) effectLines.push(`${getIcon("ingredient_capacity")} +${effects.ingredient_capacity} ingredient capacity`);
  if (effects.bowl_storage_capacity > 0) effectLines.push(`${getIcon("bowl_storage")} +${effects.bowl_storage_capacity} bowl storage`);
  if (effects.rep_bonus_flat > 0) effectLines.push(`${getIcon("rep")} +${effects.rep_bonus_flat.toFixed(1)} rep per serve`);
  if (effects.rep_bonus_percent > 0) effectLines.push(`${getIcon("rep")} +${(effects.rep_bonus_percent * 100).toFixed(1)}% rep`);
  if (effects.staff_effect_multiplier > 0) effectLines.push(`${getIcon("staff_management")} +${(effects.staff_effect_multiplier * 100).toFixed(0)}% staff effects`);

  if (effectLines.length > 0) {
    embed.addFields({
      name: `${getIcon("stats")} Total Upgrade Bonuses`,
      value: effectLines.join("\n"),
      inline: false
    });
  }

  applyOwnerFooter(embed, user);
  return embed;
}

function buildUpgradesManagementEmbed(player, user) {
  const embed = new EmbedBuilder()
    .setTitle(`${getIcon("upgrades")} Upgrades Management`)
    .setColor(theme.colors.accent);

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

  embed.setDescription(`${getIcon("coins")} Coins: **${player.coins}**\n${getIcon("upgrades")} Upgrades: **${leveledEntries.length}/${totalUpgrades}**`);

  if (leveledEntries.length > 0) {
    const upgradeLines = leveledEntries.map(({ upgrade, level }) => {
      const category = upgradesContent.upgrade_categories?.[upgrade.category] ?? {};
      const iconKey = category?.icon_key ?? null;
      const icon = iconKey ? `${getIcon(iconKey)} ` : (category.icon ? `${category.icon} ` : "");
      return `${icon}**${upgrade.name}** — Lv${level}/${upgrade.max_level}`;
    });
    embed.addFields({
      name: "Your Upgrades",
      value: upgradeLines.join("\n"),
      inline: false
    });
  } else {
    embed.addFields({
      name: "Your Upgrades",
      value: "_No upgrades purchased yet._",
      inline: false
    });
  }

  const formatUpgradeEffectValue = (upgrade, level, effectKey, perLevel) => {
    const total = perLevel * level;
    if (effectKey === "ingredient_save_chance") return `+${(total * 100).toFixed(1)}% ingredient save`;
    if (effectKey === "bowl_capacity_bonus") return `+${total} bowl capacity`;
    if (effectKey === "ingredient_capacity") return `+${total} ingredient storage`;
    if (effectKey === "spoilage_reduction") return `-${(total * 100).toFixed(1)}% spoilage`;
    if (effectKey === "bowl_storage_capacity") return `+${total} bowl storage`;
    if (effectKey === "rep_bonus_flat") return `+${total.toFixed(1)} rep per serve`;
    if (effectKey === "rep_bonus_percent") return `+${(total * 100).toFixed(1)}% rep`;
    if (effectKey === "order_quality_bonus") return `+${(total * 100).toFixed(1)}% order quality`;
    if (effectKey === "npc_variety_bonus") return `+${(total * 100).toFixed(1)}% NPC variety`;
    if (effectKey === "staff_capacity") return `+${total.toFixed(1)} staff capacity`;
    if (effectKey === "staff_effect_multiplier") return `+${(total * 100).toFixed(1)}% staff effects`;
    if (effectKey === "prep_batch_bonus") {
      const divisor = perLevel > 0 ? Math.round(1 / perLevel) : 0;
      const bonus = divisor > 0 ? Math.floor(level / divisor) : 0;
      return bonus > 0 ? `+${bonus} bowls per batch` : `+1 bowl per ${divisor} prep levels`;
    }
    return null;
  };

  const effectLines = [];
  for (const { upgrade, level } of leveledEntries) {
    const effectsPerLevel = upgrade.effects_per_level ?? {};
    for (const [effectKey, perLevel] of Object.entries(effectsPerLevel)) {
      const formatted = formatUpgradeEffectValue(upgrade, level, effectKey, perLevel);
      if (!formatted) continue;
      effectLines.push(`**${upgrade.name}** — ${formatted}`);
    }
  }

  if (effectLines.length > 0) {
    embed.addFields({
      name: "Active Bonuses",
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
    if (staffRarity === "overview") {
      const embed = buildStaffOverviewEmbed(player, null, user);
      embed.setTitle(`${getIcon("staff_management")} Staff Management`);
      return embed;
    }
    if (staffRarity === "upgrades") {
      const embed = new EmbedBuilder()
        .setTitle(`${getIcon("staff_upgrades")} Staff Upgrades`)
        .setDescription(`${getIcon("coins")} Coins: **${player.coins}**\n\nUpgrades that improve staff capacity and performance.`)
        .setColor(theme.colors.accent);

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

      embed.addFields({
        name: "Staff Upgrades",
        value: staffUpgrades.length ? staffUpgrades.join("\n") : "_No staff upgrades found._",
        inline: false
      });

      applyOwnerFooter(embed, user);
      return embed;
    }

    const embed = new EmbedBuilder()
      .setTitle(`${getIcon("staff_upgrades")} Staff Upgrades`)
      .setDescription(`${getIcon("coins")} Coins: **${player.coins}**\n\nHire and empower your staff.`)
      .setColor(theme.colors.accent);

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
        const status = currentLevel >= staff.max_level ? `${getIcon("status_complete")} MAX` : `${cost}c`;
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

  const title = `${categoryData?.icon || getIcon("upgrades")} ${categoryData?.display_name || categoryId}`;
  const descLines = [
    `${getIcon("coins")} Coins: **${player.coins}**`,
    categoryData?.description ? `\n${categoryData.description}` : ""
  ].join("\n");

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(descLines.trim())
    .setColor(theme.colors.accent);

  const upgrades = upgradesByCategory[categoryId]?.upgrades ?? [];
  const lines = upgrades.map((u) => {
    const status = u.isMaxed ? `${getIcon("status_complete")} MAX` : `${u.nextCost}c`;
    const desc = u.description ? `\n  _${u.description}_` : "";
    return `• **${u.name}** (${u.currentLevel}/${u.maxLevel}) — ${status}${desc}`;
  });

  embed.addFields({
    name: "Upgrades",
    value: lines.length ? lines.join("\n") : "_No upgrades found._",
    inline: false
  });

  applyOwnerFooter(embed, user);
  return embed;
}

function buildUpgradesComponents(userId, player, { categoryId = null, staffRarity = "common", source = null } = {}) {
  const rows = [];
  if (categoryId !== "staff") {
    rows.push(buildCategoryButtonsRow(userId, categoryId, source));
  }
  const upgradesByCategory = getUpgradesByCategory(player, upgradesContent);

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
          const cost = calculateStaffCost(staff, currentLevel);
          return {
            label: `${staff.name} — ${cost}c`,
            description: `Lv${currentLevel}->${currentLevel + 1}`.slice(0, 100),
            value: staff.staff_id,
            emoji: rarityEmoji(staff.rarity)
          };
        })
        .filter(Boolean);

      if (staffOptions.length > 0) {
        const staffMenu = new StringSelectMenuBuilder()
          .setCustomId(
            source
              ? `noodle-upgrades:staff:${userId}:${source}`
              : `noodle-upgrades:staff:${userId}`
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
    if (!categoryData?.upgrades) continue;
    for (const upgrade of categoryData.upgrades || []) {
      if (upgrade.isMaxed) continue;

      const effectStr = formatEffects(upgrade.effects);
      const description = `Lv${upgrade.currentLevel}->${upgrade.currentLevel + 1}: ${effectStr}`.substring(0, 100);
      
      allOptions.push({
        label: `${upgrade.name} — ${upgrade.nextCost}c`,
        description,
        value: upgrade.upgradeId,
        emoji: categoryData.icon || getIcon("upgrades")
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
        .setCustomId(
          source
            ? `noodle-upgrades:buy:${userId}:${categoryId || "all"}:${idx}:${source}`
            : `noodle-upgrades:buy:${userId}:${categoryId || "all"}:${idx}`
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
      if (action === "category" && parts[3] === "staff") {
        const candidate = parts[4];
        const allowed = new Set(["overview", "common", "rare", "epic", "upgrades"]);
        return allowed.has(candidate) ? candidate : "overview";
      }
      return "common";
    };

    const resolveSource = () => {
      if (action === "category") return parts[4] ?? null;
      if (action === "staffpage") return parts[4] ?? null;
      if (action === "buy") return parts[5] ?? null;
      if (action === "staff") return parts[3] ?? null;
      return null;
    };

    const categoryId = resolveCategory();
    const staffRarity = resolveStaffRarity();
    const source = resolveSource();
    const refreshed = getPlayer(db, serverId, userId) ?? p;
    const embed = categoryId && categoryId !== "all"
      ? buildUpgradesCategoryEmbed(refreshed, interaction.member ?? interaction.user, categoryId, { staffRarity })
      : (source === "profile"
        ? buildUpgradesManagementEmbed(refreshed, interaction.member ?? interaction.user)
        : buildUpgradesOverviewEmbed(refreshed, interaction.member ?? interaction.user));
    const components = buildUpgradesComponents(userId, refreshed, {
      categoryId: categoryId && categoryId !== "all" ? categoryId : null,
      staffRarity,
      source
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
        : (source === "profile"
          ? buildUpgradesManagementEmbed(updatedPlayer, interaction.member ?? interaction.user)
          : buildUpgradesOverviewEmbed(updatedPlayer, interaction.member ?? interaction.user));
      const updatedComponents = buildUpgradesComponents(userId, updatedPlayer, {
        categoryId: categoryId && categoryId !== "all" ? categoryId : null,
        staffRarity,
        source
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
      const updatedComponents = buildUpgradesComponents(userId, updatedPlayer, { categoryId: "staff", staffRarity, source });

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
