import {
canForage,
rollForageDrops,
applyDropsToInventory,
setForageCooldown,
FORAGE_ITEM_IDS
} from "../game/forage.js";
import {
advanceTutorial,
ensureTutorial,
getCurrentTutorialStep,
formatTutorialMessage,
formatTutorialCompletionMessage
} from "../game/tutorial.js";
import { loadContentBundle, loadSettingsCatalog } from "../content/index.js";
import { buildSettingsMap } from "../settings/resolve.js";
import { openDb, getPlayer, upsertPlayer, getServer, upsertServer, getLastActiveAt } from "../db/index.js";
import { withLock } from "../infra/locks.js";
import { makeIdempotencyKey, getIdempotentResult, putIdempotentResult } from "../infra/idempotency.js";
import { newPlayerProfile } from "../game/player.js";
import { newServerState } from "../game/server.js";
import { computeActiveSeason } from "../game/seasons.js";
import { rollMarket, rollPlayerMarketStock, sellPrice, MARKET_ITEM_IDS } from "../game/market.js";
import { ensureDailyOrders, ensureDailyOrdersForPlayer } from "../game/orders.js";
import { computeServeRewards, applySxpLevelUp } from "../game/serve.js";
import { STARTER_PROFILE } from "../constants.js";
import { nowTs } from "../util/time.js";
import { socialMainMenuRow, socialMainMenuRowNoProfile } from "./noodleSocial.js";
import { getUserActiveParty, getActiveBlessing, BLESSING_EFFECTS } from "../game/social.js";
import {
  applyResilienceMechanics,
  getAvailableRecipes,
  clearTemporaryRecipes,
  getPityDiscount,
  consumeFailStreakRelief,
  checkRepFloorBonus,
  updateFailStreak
} from "../game/resilience.js";
import { applyTimeCatchup } from "../game/timeCatchup.js";
import { rollRecipeDiscovery, applyDiscovery, applyNpcDiscoveryBuff } from "../game/discovery.js";
import { makeStreamRng } from "../util/rng.js";
import { dayKeyUTC } from "../util/time.js";
import discordPkg from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";

const {
MessageActionRow,
MessageSelectMenu,
MessageButton,
MessageEmbed,
MessageFlags,
Modal,
TextInputComponent,
Constants
} = discordPkg;

// Temporary cache for multibuy selections to avoid custom ID length limits
const multibuyCacheV2 = new Map();

// Aliases for v14+ compatibility in code
const ActionRowBuilder = MessageActionRow;
const StringSelectMenuBuilder = MessageSelectMenu;
const ModalBuilder = Modal;
const TextInputBuilder = TextInputComponent;
const ButtonBuilder = MessageButton;
const EmbedBuilder = MessageEmbed;
const ButtonStyle = {
  Primary: Constants?.MessageButtonStyles?.PRIMARY ?? 1,
  Secondary: Constants?.MessageButtonStyles?.SECONDARY ?? 2,
  Success: Constants?.MessageButtonStyles?.SUCCESS ?? 3,
  Danger: Constants?.MessageButtonStyles?.DANGER ?? 4,
  Link: Constants?.MessageButtonStyles?.LINK ?? 5
};
const TextInputStyle = {
  Short: Constants?.TextInputStyles?.SHORT ?? 1,
  Paragraph: Constants?.TextInputStyles?.PARAGRAPH ?? 2
};

const content = loadContentBundle(1);
const settingsCatalog = loadSettingsCatalog();
const db = openDb();

/* ------------------------------------------------------------------ */
/*  UI helpers                                                         */
/* ------------------------------------------------------------------ */

function ownerFooterText(user) {
  const tag = user?.tag ?? user?.username ?? "Unknown";
  return `Owner: ${tag}`;
}

function applyOwnerFooter(embed, user) {
  if (embed && user) {
    embed.setFooter({ text: ownerFooterText(user) });
  }
  return embed;
}

function buildMenuEmbed({ title, description, user, color = 0x2f3136 } = {}) {
  const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);
  return applyOwnerFooter(embed, user);
}

function noodleMainMenuRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:orders:${userId}`).setLabel("📋 Orders").setStyle(ButtonStyle.Primary),
new ButtonBuilder().setCustomId(`noodle:nav:buy:${userId}`).setLabel("🛒 Buy").setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:forage:${userId}`).setLabel("🌿 Forage").setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:pantry:${userId}`).setLabel("🧺 Pantry").setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:profile:${userId}`).setLabel("🍜 Profile").setStyle(ButtonStyle.Secondary)
);
}

function noodleMainMenuRowNoProfile(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:orders:${userId}`).setLabel("📋 Orders").setStyle(ButtonStyle.Primary),
new ButtonBuilder().setCustomId(`noodle:nav:buy:${userId}`).setLabel("🛒 Buy").setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:forage:${userId}`).setLabel("🌿 Forage").setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:pantry:${userId}`).setLabel("🧺 Pantry").setStyle(ButtonStyle.Secondary)
);
}

function noodleSecondaryMenuRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:season:${userId}`).setLabel("🍂 Season").setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:event:${userId}`).setLabel("🎪 Event").setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:help:${userId}`).setLabel("❓ Help").setStyle(ButtonStyle.Secondary)
);
}

function noodleMainMenuRowNoPantry(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:orders:${userId}`).setLabel("📋 Orders").setStyle(ButtonStyle.Primary),
new ButtonBuilder().setCustomId(`noodle:nav:buy:${userId}`).setLabel("🛒 Buy").setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:forage:${userId}`).setLabel("🌿 Forage").setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:profile:${userId}`).setLabel("🍜 Profile").setStyle(ButtonStyle.Secondary)
);
}

function noodleMainMenuRowNoOrders(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:buy:${userId}`).setLabel("🛒 Buy").setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:forage:${userId}`).setLabel("🌿 Forage").setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:pantry:${userId}`).setLabel("🧺 Pantry").setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:profile:${userId}`).setLabel("🍜 Profile").setStyle(ButtonStyle.Secondary)
);
}

function noodleOrdersActionRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:pick:accept:${userId}`).setLabel("✅ Accept").setStyle(ButtonStyle.Success),
new ButtonBuilder().setCustomId(`noodle:pick:cook:${userId}`).setLabel("🍲 Cook").setStyle(ButtonStyle.Primary),
new ButtonBuilder().setCustomId(`noodle:pick:serve:${userId}`).setLabel("🍜 Serve").setStyle(ButtonStyle.Primary)
);
}

function noodleOrdersActionRowWithBack(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:pick:accept:${userId}`).setLabel("✅ Accept").setStyle(ButtonStyle.Success),
new ButtonBuilder().setCustomId(`noodle:pick:cook:${userId}`).setLabel("🍲 Cook").setStyle(ButtonStyle.Primary),
new ButtonBuilder().setCustomId(`noodle:pick:serve:${userId}`).setLabel("🍜 Serve").setStyle(ButtonStyle.Primary),
new ButtonBuilder().setCustomId(`noodle:nav:orders:${userId}`).setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary)
);
}

function noodleOrdersMenuActionRow(userId, { showCancel = false } = {}) {
const row = new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:pick:accept:${userId}`).setLabel("✅ Accept").setStyle(ButtonStyle.Success),
new ButtonBuilder().setCustomId(`noodle:pick:cook:${userId}`).setLabel("🍲 Cook").setStyle(ButtonStyle.Primary),
new ButtonBuilder().setCustomId(`noodle:pick:serve:${userId}`).setLabel("🍜 Serve").setStyle(ButtonStyle.Primary)
);

if (showCancel) {
  row.addComponents(
    new ButtonBuilder().setCustomId(`noodle:pick:cancel:${userId}`).setLabel("❌ Cancel").setStyle(ButtonStyle.Danger)
  );
}

return row;
}

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

function shortOrderId(orderId) {
if (!orderId) return "??????";
const s = String(orderId)
.replace(/^ord_/, "")
.replace(/[^a-zA-Z0-9]/g, "");
return s.slice(-6).toUpperCase();
}

function getLimitedTimeWindowSeconds(player, baseSeconds) {
const blessing = getActiveBlessing(player);
if (blessing?.type !== "limited_time_window_add") return baseSeconds;
const mult = BLESSING_EFFECTS.limited_time_window_add?.speedWindowMult ?? 1;
return Math.max(1, Math.ceil(baseSeconds * mult));
}

function cozyError(errOrCode) {
const code = typeof errOrCode === "string" ? errOrCode : errOrCode?.code;
const map = {
ERR_LOCK_BUSY: "Your shop is already busy stirring a pot, try again in a moment.",
LOCK_BUSY: "Your shop is already busy stirring a pot, try again in a moment.",
ERR_CONFLICT: "Your ledger updated at the same time, run the command again."
};
return map[code] ?? "Something went a little sideways, try again.";
}

function ensureServer(serverId) {
let s = getServer(db, serverId);
if (!s) {
s = newServerState(serverId);
upsertServer(db, serverId, s, null);
s = getServer(db, serverId);
}
return s;
}

function ensurePlayer(serverId, userId) {
let p = getPlayer(db, serverId, userId);
if (!p) {
p = newPlayerProfile(userId);
upsertPlayer(db, serverId, userId, p, null, p.schema_version);
p = getPlayer(db, serverId, userId);
}
// Backfill missing starter recipes for legacy/partial profiles
if (!Array.isArray(p.known_recipes) || p.known_recipes.length === 0) {
  p.known_recipes = [...(STARTER_PROFILE.known_recipes || [])];
}
return p;
}

function displayItemName(id) {
  const known = content.items?.[id]?.name;
  if (known) return known;
  return String(id ?? "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || "Unknown item";
}

function renderProfileEmbed(player, displayName, partyName, ownerUser) {
if (!player.profile) {
  player.profile = {
    shop_name: "My Noodle Shop",
    tagline: "A tiny shop with a big simmer."
  };
}
let description = `*${player.profile.tagline}*`;
if (partyName) {
  description += `\n\n🎪 **${partyName}**`;
}
if (!player.lifetime) {
  player.lifetime = { bowls_served_total: 0 };
}
const embed = new EmbedBuilder()
.setTitle(`🍜 ${player.profile.shop_name}`)
.setDescription(description)
.addFields(
{ name: "⭐ Bowls Served", value: String(player.lifetime.bowls_served_total || 0), inline: true },
{ name: "Level", value: String(player.shop_level || 1), inline: true },
{ name: "REP", value: String(player.rep || 0), inline: true },
{ name: "Coins", value: `${player.coins || 0}c`, inline: true }
);

// Add cooked bowls inventory
if (player.inv_bowls && Object.keys(player.inv_bowls).length > 0) {
  const bowlLines = Object.entries(player.inv_bowls)
    .map(([key, bowl]) => {
      const recipeName = content.recipes?.[bowl.recipe_id]?.name ?? bowl.recipe_id;
      return `• **${recipeName}**: ${bowl.qty}`;
    })
    .join("\n");
  embed.addFields({ name: "🍲 Cooked Bowls", value: bowlLines || "None", inline: false });
}

applyOwnerFooter(embed, ownerUser);
return embed;
}

function resetTutorialState(player) {
player.tutorial = null;
ensureTutorial(player);
}

function tutorialSuffix(player) {
const step = getCurrentTutorialStep(player);
const msg = formatTutorialMessage(step);
return msg ? `\n\n${msg}` : "";
}

function getUnlockedIngredientIds(player, contentBundle) {
const out = new Set();
// Use getAvailableRecipes to include both permanent and temporary recipes
const known = getAvailableRecipes(player);

for (const recipeId of known) {
const r = contentBundle.recipes?.[recipeId];
if (!r) continue;

for (const ing of r.ingredients ?? []) {
  if (ing?.item_id) out.add(ing.item_id);
}

}

return out;
}

function formatRecipeNeeds({ recipeId, content: contentBundle, player }) {
const r = contentBundle.recipes?.[recipeId];
if (!r) return "";

  const missing = (r.ingredients ?? [])
    .map((ing) => {
      const need = ing.qty ?? 0;
      const have = player.inv_ingredients?.[ing.item_id] ?? 0;
      if (have >= need) return null;
      const itemName = displayItemName(ing.item_id);
      return `${itemName} ${need} (have ${have})`;
    })
    .filter(Boolean);

  if (!missing.length) return "";
  return `🧾 **Ingredients Needed:** ${missing.join(" · ")}`;
}

function sweepExpiredAcceptedOrders(p, _s, contentBundle, nowMs) {
const accepted = p?.orders?.accepted ?? {};
const expiredIds = [];

for (const [fullId, entry] of Object.entries(accepted)) {
const exp = entry?.expires_at ?? null;
if (exp && nowMs > exp) expiredIds.push(fullId);
}

if (!expiredIds.length) return { expiredIds: [], warning: "" };

// Track fail streak for each expired order (B4)
for (let i = 0; i < expiredIds.length; i++) {
  updateFailStreak(p, false); // failure per order
}

// Capture snapshots BEFORE delete
const snaps = expiredIds.map((id) => {
const entry = accepted[id];
return { id, order: entry?.order ?? null };
});

for (const id of expiredIds) delete accepted[id];

const lines = snaps.slice(0, 8).map(({ id, order }) => {
const rName = order ? (contentBundle.recipes[order.recipe_id]?.name ?? "a dish") : null;
const npcName = order ? (contentBundle.npcs[order.npc_archetype]?.name ?? "a customer") : null;

return `⚠️ Auto-canceled expired order \`${shortOrderId(id)}\`${rName ? ` — **${rName}**` : ""}${npcName ? ` for *${npcName}*` : ""}.`;

});

const more = expiredIds.length > 8 ? `\n…and **${expiredIds.length - 8}** more expired order(s).` : "";

return {
expiredIds,
warning: `${lines.join("\n")}${more}`
};
}

/* ------------------------------------------------------------------ */
/*  Component-safe commit helpers                                      */
/* ------------------------------------------------------------------ */

async function componentCommit(interaction, payload) {
const { ephemeral, targetMessageId, ...rest } = payload ?? {};

// Force ephemeral responses for modal submits when requested
if (interaction.isModalSubmit?.() && ephemeral === true) {
  if (interaction.deferred || interaction.replied) {
    try {
      return await interaction.followUp({ ...rest, ephemeral: true });
    } catch (e) {
      console.log(`⚠️ Modal followUp failed:`, e?.message);
      return;
    }
  }
  try {
    return await interaction.reply({ ...rest, ephemeral: true });
  } catch (e) {
    console.log(`⚠️ Modal reply failed:`, e?.message);
    return;
  }
}

// If targetMessageId is provided and not ephemeral, edit that message instead
if (targetMessageId && !ephemeral) {
  try {
    const target = await interaction.channel?.messages?.fetch(targetMessageId);
    if (target) {
      // Convert components to JSON if they're builder objects
      let editPayload = { ...rest };
      if (editPayload.components) {
        editPayload.components = editPayload.components.map(row => {
          if (row.components) {
            return { type: 1, components: row.components.map(comp => comp.toJSON?.() ?? comp) };
          }
          return row;
        });
      }
      // Dismiss the modal/interaction response
      if (interaction.deferred || interaction.replied) {
        try {
          await interaction.deleteReply();
        } catch (e) {
          // Ignore if already deleted
        }
      }
      return target.edit(editPayload);
    }
  } catch (e) {
    console.log(`⚠️ Failed to edit target message ${targetMessageId}:`, e?.message);
    // Fall through to normal response
  }
}

// Default: non-ephemeral UNLESS explicitly marked as ephemeral
// If payload has components (select menus, etc), don't make it ephemeral unless explicitly requested
const hasComponents = Array.isArray(rest.components) ? rest.components.length > 0 : Boolean(rest.components);
const shouldBeEphemeral = ephemeral === true && !hasComponents;
const options = shouldBeEphemeral ? { ...rest, flags: MessageFlags.Ephemeral } : { ...rest };

if (shouldBeEphemeral) {
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp({ ...rest, ephemeral: true });
  }
  return interaction.reply({ ...rest, ephemeral: true });
}

// Modal submits: deferred in index.js, so use editReply unless ephemeral
if (interaction.isModalSubmit?.()) {
  if (shouldBeEphemeral) {
    if (interaction.deferred || interaction.replied) {
      try {
        return await interaction.followUp({ ...rest, ephemeral: true });
      } catch (e) {
        console.log(`⚠️ Modal followUp failed:`, e?.message);
        return;
      }
    }
    try {
      return await interaction.reply({ ...rest, ephemeral: true });
    } catch (e) {
      console.log(`⚠️ Modal reply failed:`, e?.message);
      return;
    }
  }

  if (interaction.deferred || interaction.replied) {
    try {
      return await interaction.editReply(rest);
    } catch (e) {
      console.log(`⚠️ Modal editReply failed:`, e?.message);
      // If edit fails, try followUp as last resort
      try {
        return await interaction.followUp({ ...rest, ephemeral: true });
      } catch (e2) {
        console.log(`⚠️ Modal followUp also failed:`, e2?.message);
        return;
      }
    }
  }
  // If not deferred/replied, try regular reply (shouldn't happen but safety net)
  try {
    return await interaction.reply(options);
  } catch (e) {
    console.log(`⚠️ Modal reply failed:`, e?.message);
    return;
  }
}

// Slash commands: use deferReply (not deferUpdate)
if (interaction.isChatInputCommand?.()) {
if (!interaction.deferred && !interaction.replied) {
  try {
    await interaction.deferReply({ ephemeral: shouldBeEphemeral });
  } catch (e) {
    // Mark as deferred to prevent retry
    interaction.deferred = true;
  }
}
if (interaction.deferred || interaction.replied) {
  return interaction.editReply(rest);
}
return interaction.reply(options);
}

// For buttons/selects, deferUpdate should have been called in index.js
// We should NOT try to defer again here

// Convert components to JSON if they're builder objects
let finalOptions = { ...options };
if (finalOptions.components) {
  finalOptions.components = finalOptions.components.map(row => {
    if (row.components) {
      const converted = { type: 1, components: row.components.map(comp => {
        const json = comp.toJSON?.() ?? comp;
        if (json.options) {
          json.options.forEach((opt, i) => {
          });
        }
        return json;
      })};
      return converted;
    }
    return row;
  });
}

// Ensure embeds are included in finalOptions and converted to JSON
if (!finalOptions.embeds && rest.embeds) {
  finalOptions.embeds = rest.embeds;
}
// Convert EmbedBuilder objects to JSON
if (finalOptions.embeds) {
  finalOptions.embeds = finalOptions.embeds.map(embed => embed.toJSON?.() ?? embed);
}

// Use editReply for components that were deferred  
if (interaction.deferred || interaction.replied) {
  console.log("🔄 Component editReply, embeds:", finalOptions.embeds?.length ?? "none");
  try {
    return await interaction.editReply(finalOptions);
  } catch (e) {
    console.log(`⚠️ Component editReply failed:`, e?.message);
    // Try followUp as fallback
    try {
      return await interaction.followUp({ ...finalOptions, ephemeral: true });
    } catch (e2) {
      console.log(`⚠️ Component followUp fallback also failed:`, e2?.message);
      return;
    }
  }
}

// Last resort fallback - not deferred/replied yet
try {
  return await interaction.update(finalOptions);
} catch (e) {
  console.log(`⚠️ Component update failed:`, e?.message);
  return;
}
}

/* ------------------------------------------------------------------ */
/*  Multi-buy helpers (moved from index.js)                            */
/* ------------------------------------------------------------------ */

function resolveSelectedItemId(input, selectedIds, contentBundle) {
const norm = (s) =>
String(s ?? "")
.toLowerCase()
.replace(/[_-]+/g, " ")
.replace(/[^\p{L}\p{N}\s]/gu, "")
.trim()
.replace(/\s+/g, " ");

const q = norm(input);
if (!q) return null;

const exactId = selectedIds.find((id) => norm(id) === q);
if (exactId) return exactId;

const exactName = selectedIds.find((id) => norm(contentBundle.items?.[id]?.name) === q);
if (exactName) return exactName;

const matches = selectedIds.filter((id) => norm(contentBundle.items?.[id]?.name).includes(q));
if (matches.length === 1) return matches[0];

const idMatches = selectedIds.filter((id) => norm(id).includes(q));
if (idMatches.length === 1) return idMatches[0];

return null;
}

async function renderMultiBuyPicker({ interaction, userId, s, p }) {
if (!s.market_prices) s.market_prices = {};
if (!p.market_stock) p.market_stock = {};

const allowed = getUnlockedIngredientIds(p, content);

const opts = (MARKET_ITEM_IDS ?? [])
.map((id) => {
if (!allowed.has(id)) return null;

  const it = content.items?.[id];
  if (!it) return null;

  const price = s.market_prices?.[id] ?? it.base_price ?? 0;
  const stock = p.market_stock?.[id] ?? 0;
  if (stock <= 0) return null;

  const labelRaw = `${it.name} — ${price}c (stock ${stock})`;
  const label = labelRaw.length > 100 ? labelRaw.slice(0, 97) + "…" : labelRaw;

  return { label, value: id };
})
.filter(Boolean)
.slice(0, 25);

if (!opts.length) {
return componentCommit(interaction, {
content: "🛒 No market items are available for your unlocked recipes right now.",
components: [noodleMainMenuRow(userId)],
ephemeral: true
});
}

const menu = new StringSelectMenuBuilder()
.setCustomId(`noodle:multibuy:select:${userId}`)
.setPlaceholder("Select up to 5 items")
.setMinValues(1)
.setMaxValues(Math.min(5, opts.length))
.addOptions(opts);

return componentCommit(interaction, {
content: " ",
embeds: [buildMenuEmbed({
  title: "🛒 Multi-buy",
  description: "Select up to **5** items.\nWhen you’re done selecting, if on Desktop, press **Esc** to continue.",
  user: interaction.user
})],
components: [
  new ActionRowBuilder().addComponents(menu),
  new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:nav:profile:${userId}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  )
]
});
}

function buildMultiBuyButtonsRow(userId, selectedIds, sourceMessageId) {
const pickedNames = selectedIds.map((id) => displayItemName(id));
const msgId = sourceMessageId || "none";
const btnRow = new ActionRowBuilder().addComponents(
new ButtonBuilder()
.setCustomId(`noodle:multibuy:buy1:${userId}:${msgId}`)
.setLabel("Buy 1 each")
.setStyle(ButtonStyle.Success),
new ButtonBuilder()
.setCustomId(`noodle:multibuy:buy5:${userId}:${msgId}`)
.setLabel("Buy 5 each")
.setStyle(ButtonStyle.Primary),
new ButtonBuilder()
.setCustomId(`noodle:multibuy:buy10:${userId}:${msgId}`)
.setLabel("Buy 10 each")
.setStyle(ButtonStyle.Primary),
new ButtonBuilder()
.setCustomId(`noodle:multibuy:qty:${userId}:${msgId}`)
.setLabel("Enter quantities")
.setStyle(ButtonStyle.Secondary),
new ButtonBuilder()
.setCustomId(`noodle:multibuy:clear:${userId}:${msgId}`)
.setLabel("Clear")
.setStyle(ButtonStyle.Danger)
);

return { pickedNames, btnRow };
}

/* ------------------------------------------------------------------ */
/*  Core runner (shared by slash + component nav)                      */
/* ------------------------------------------------------------------ */

async function runNoodle(interaction, { sub, group = null, overrides = {} } = {}) {
const serverId = interaction.guildId;
if (!serverId) {
return interaction.reply({
content: "This game runs inside a server (not DMs).",
flags: MessageFlags.Ephemeral
});
}

const userId = interaction.user.id;

// Check if this is the status command (which needs ephemeral defer)
const subCmd = interaction.options?.getSubcommand?.();
const isStatusCmd = subCmd === "status";

// Defer immediately for slash commands (chat input) to prevent timeout
// DON'T defer for components - they're already deferred in index.js
// Skip defer for status command - it will defer with ephemeral flag
if ((interaction.isChatInputCommand?.() || interaction.isCommand?.()) && !interaction.deferred && !interaction.replied && !isStatusCmd) {
  try {
    await interaction.deferReply();
  } catch (e) {
    // If defer fails, mark as deferred to avoid double-reply attempts
    interaction.deferred = true;
  }
}

const opt = {
getString: (name) =>
overrides?.strings?.[name] ??
(interaction.options?.getString ? interaction.options.getString(name) : null),
getInteger: (name) =>
overrides?.integers?.[name] ??
(interaction.options?.getInteger ? interaction.options.getInteger(name) : null),
getUser: (name) =>
overrides?.users?.[name] ??
(interaction.options?.getUser ? interaction.options.getUser(name) : null)
};

const commit = async (payload) => {
// Slash: use editReply since we deferred at the start
if (interaction.isChatInputCommand?.()) {
const { ephemeral, ...rest } = payload ?? {};
// For ephemeral messages after a non-ephemeral defer, delete original and send ephemeral followUp
if (ephemeral && (interaction.deferred || interaction.replied)) {
  try {
    await interaction.deleteReply();
  } catch (e) {
    // Ignore errors if already deleted
  }
  return interaction.followUp({ ...rest, ephemeral: true });
}
const options = ephemeral ? { ...rest, ephemeral: true } : { ...rest };
// If deferred, use editReply. Otherwise use reply (shouldn't happen but safety)
if (interaction.deferred || interaction.replied) return interaction.editReply(options);
return interaction.reply(options);
}

// If a modal submit supplied a target message id, edit that message directly
if (overrides?.messageId && !payload?.ephemeral) {
  try {
    const target = await interaction.channel?.messages?.fetch(overrides.messageId);
    if (target) {
      // Convert components to JSON if they're builder objects
      let editPayload = { ...payload };
      if (editPayload.components) {
        editPayload.components = editPayload.components.map(row => {
          if (row.components) {
            return { type: 1, components: row.components.map(comp => comp.toJSON?.() ?? comp) };
          }
          return row;
        });
      }
      const result = await target.edit(editPayload);
      if (interaction.isModalSubmit?.() && (interaction.deferred || interaction.replied)) {
        try {
          await interaction.deleteReply();
        } catch (e) {
          // ignore
        }
      }
      return result;
    }
  } catch (e) {
    // fall through to componentCommit
  }
}

// Components: editReply flow
return componentCommit(interaction, payload);
};

try {
const owner = `discord:${interaction.id}`;

const server = ensureServer(serverId);
const settings = buildSettingsMap(settingsCatalog, server.settings);
server.season = computeActiveSeason(settings);
rollMarket({ serverId, content, serverState: server });

if (group === "dev" && sub === "reset_tutorial") {
  const target = opt.getUser("user");
  if (!target) {
    return commit({ content: "Pick a user to reset.", ephemeral: true });
  }

  return await withLock(db, `lock:user:${target.id}`, owner, 8000, async () => {
    const p = ensurePlayer(serverId, target.id);
    resetTutorialState(p);
    upsertPlayer(db, serverId, target.id, p, null, p.schema_version);

    const step = getCurrentTutorialStep(p);
    const tut = formatTutorialMessage(step);
    const mention = `<@${target.id}>`;

    return commit({
      content: `🔧 Complete reset for ${mention}.${tut ? `\n\n${tut}` : ""}`,
      ephemeral: true
    });
  });
}

const needsPlayer = group !== "dev" && !["help", "season", "event"].includes(sub);
const player = needsPlayer ? ensurePlayer(serverId, userId) : null;

/* ---------------- START ---------------- */
if (sub === "start") {
  return await withLock(db, `lock:user:${userId}`, owner, 8000, async () => {
    const p = ensurePlayer(serverId, userId);
    const embed = renderProfileEmbed(p, interaction.user.displayName, null, interaction.user);
    const step = getCurrentTutorialStep(p);
    const tut = formatTutorialMessage(step);

    return commit({
      content: ["Welcome to your Noodle Story.", tut ? `\n${tut}` : ""].join(""),
      embeds: [embed],
      components: [noodleMainMenuRow(userId), noodleSecondaryMenuRow(userId)]
    });
  });
}

/* ---------------- HELP ---------------- */
if (sub === "help") {
  const topic = opt.getString("topic") ?? "getting-started";
  const map = {
    "getting-started": "Use `/noodle start` to begin the tutorial & use buttons on menu to advance. Sell extra market items with `/noodle sell` item quantity.",
  };

  return commit({
    content: map[topic] ?? map["getting-started"]
  });
}

/* ---------------- PROFILE ---------------- */
if (sub === "profile") {
  const u = opt.getUser("user") ?? interaction.user;
  const p = ensurePlayer(serverId, u.id);
  const party = getUserActiveParty(db, u.id);
  
  const embed = renderProfileEmbed(p, u.displayName, party?.party_name, interaction.user);
  
  return commit({
    embeds: [embed],
    components: [noodleMainMenuRowNoProfile(userId), socialMainMenuRowNoProfile(userId)]
  });
}

/* ---------------- PANTRY ---------------- */
if (sub === "pantry") {
  const p = ensurePlayer(serverId, userId);
  const grouped = new Map();
  for (const [id, qty] of Object.entries(p.inv_ingredients ?? {})) {
    if (!qty || qty <= 0) continue;
    const item = content.items?.[id] ?? {};
    const category = String(item.category || "other").toLowerCase();
    const name = displayItemName(id);
    const catMap = grouped.get(category) ?? new Map();
    const key = name.toLowerCase();
    const cur = catMap.get(key) ?? { name, qty: 0 };
    cur.qty += qty;
    catMap.set(key, cur);
    grouped.set(category, catMap);
  }

  const categoryBlocks = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, items]) => {
      const title = category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const lines = [...items.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ name, qty }) => `• ${name}: **${qty}**`)
        .join("\n");
      return lines ? `**${title}**\n${lines}` : null;
    })
    .filter(Boolean);

  const pantryEmbed = buildMenuEmbed({
    title: "🧺 Pantry",
    description: categoryBlocks.length ? categoryBlocks.join("\n\n") : "No ingredients yet.",
    user: interaction.user
  });

  return commit({
    content: " ",
    embeds: [pantryEmbed],
    components: [noodleMainMenuRowNoPantry(userId)]
  });
}

/* ---------------- SEASON ---------------- */
if (sub === "season") {
  return commit({
    content: `🌿 The world is currently in **${server.season}**.`,
    components: [noodleMainMenuRow(userId)]
  });
}

/* ---------------- STATUS (DEBUG) ------------ */
if (sub === "status") {
  const p = ensurePlayer(serverId, userId);
  const ordersDay = p.orders_day ?? "unknown";
  const marketDay = server.market_day ?? "unknown";
  
  // Format as timestamp - these are day keys in YYYY-MM-DD format, assume midnight UTC
  const ordersTimestamp = ordersDay !== "unknown" ? new Date(`${ordersDay}T00:00:00Z`).getTime() / 1000 : "unknown";
  const marketTimestamp = marketDay !== "unknown" ? new Date(`${marketDay}T00:00:00Z`).getTime() / 1000 : "unknown";
  
  const ordersStr = ordersTimestamp !== "unknown" ? `<t:${Math.floor(ordersTimestamp)}:f>` : "unknown";
  const marketStr = marketTimestamp !== "unknown" ? `<t:${Math.floor(marketTimestamp)}:f>` : "unknown";
  
  const statusInfo = [
    `📅 Orders last reset: ${ordersStr}`,
    `🛒 Market last rolled: ${marketStr}`
  ].join("\n");
  
  // Defer as ephemeral, then editReply with the info
  if (!interaction.deferred && !interaction.replied) {
    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (e) {
      // ignore
    }
  }
  
  return await interaction.editReply({
    content: statusInfo
  });
}

/* ---------------- EVENT ---------------- */
if (sub === "event") {
  return commit({
    content: server.active_event_id ? `🎪 Event active: **${server.active_event_id}**` : "🌙 No event is active right now.",
    components: [noodleMainMenuRow(userId), noodleSecondaryMenuRow(userId)]
  });
}

const action = sub;
const idemKey = makeIdempotencyKey({ serverId, userId, action, interactionId: interaction.id });

// Skip idempotency check for component interactions to avoid stale cached responses
const isComponent = interaction.isButton?.() || interaction.isSelectMenu?.() || interaction.isModalSubmit?.();
const cached = isComponent ? null : getIdempotentResult(db, idemKey);

if (cached) {
  return commit(cached);
}

return await withLock(db, `lock:user:${userId}`, owner, 8000, async () => {
  let p = ensurePlayer(serverId, userId);
  let s = ensureServer(serverId);

  const now = nowTs();
  
  // C: Apply time catch-up BEFORE any state changes
  // Get last_active_at from database (before it's updated by upsertPlayer)
  const lastActiveAt = getLastActiveAt(db, serverId, userId) || now;
  
  const set = buildSettingsMap(settingsCatalog, s.settings);
  s.season = computeActiveSeason(set);
  
  // Apply time catch-up (spoilage, inactivity messages, cooldown checks)
  const timeCatchup = applyTimeCatchup(p, s, set, content, lastActiveAt, now);
  
  const sweep = sweepExpiredAcceptedOrders(p, s, content, now);

  rollMarket({ serverId, content, serverState: s });
  if (!s.market_prices) s.market_prices = {};
  
  // Roll per-player market stock daily
  rollPlayerMarketStock({ userId, serverId, content, playerState: p });
  if (!p.market_stock) p.market_stock = {};

  const prevOrdersDay = p.orders_day;
  ensureDailyOrdersForPlayer(p, set, content, s.season, serverId, userId);

  // DM the user when a new day's orders are posted
  const dayChanged = prevOrdersDay !== p.orders_day;
  if (dayChanged) {
    // Force market stock refresh to align with daily order reset
    p.market_stock_day = null;
    p.market_stock = null;
    rollPlayerMarketStock({ userId, serverId, content, playerState: p });

    const guildName = interaction.guild?.name ?? "this server";
    interaction.user?.send?.(
      `📬 New daily orders are up in **${guildName}**! Open /noodle orders to accept them.`
    ).catch(() => {});
  }

  // Apply resilience mechanics (B1-B9)
  const resilience = applyResilienceMechanics(p, s, content);

  // If resilience granted temporary recipes, regenerate order board to include them
  if (resilience.applied && p.resilience?.temp_recipes?.length > 0) {
    p.orders_day = null; // Force regeneration
    ensureDailyOrdersForPlayer(p, set, content, s.season, serverId, userId);
  }

  const commitState = async (replyObj) => {
    // Clear temporary recipes if player has coins again (B2)
    const hadTempRecipes = (p.resilience?.temp_recipes?.length || 0) > 0;
    clearTemporaryRecipes(p);
    const clearedTempRecipes = hadTempRecipes && (p.resilience?.temp_recipes?.length || 0) === 0;
    if (clearedTempRecipes) {
      // Regenerate orders for normal play after recovery
      p.orders_day = null;
      ensureDailyOrdersForPlayer(p, set, content, s.season, serverId, userId);
    }
    
    upsertPlayer(db, serverId, userId, p, null, p.schema_version);
    upsertServer(db, serverId, s, null);

    // Prepend time catch-up and resilience messages
    let finalContent = replyObj.content || "";
    
    // Time catch-up messages first (welcome back, spoilage)
    if (timeCatchup.messages.length > 0) {
      const catchupMsg = timeCatchup.messages.join("\n\n");
      finalContent = finalContent 
        ? `${catchupMsg}\n\n${finalContent}` 
        : catchupMsg;
    }
    
    // Then resilience messages
    if (resilience.messages.length > 0 && !finalContent.includes("🆘")) {
      const resilienceMsg = resilience.messages.join("\n\n");
      finalContent = finalContent 
        ? `${resilienceMsg}\n\n${finalContent}` 
        : resilienceMsg;
    }

    if (clearedTempRecipes) {
      const recoveryMsg = "✅ **Recovery complete**: You’re back to normal play and your full recipe pool is restored.";
      finalContent = finalContent ? `${finalContent}\n\n${recoveryMsg}` : recoveryMsg;
    }

    const out = {
      ...replyObj,
      content: finalContent,
      ephemeral: replyObj.ephemeral ?? false,
      components: replyObj.ephemeral ? (replyObj.components ?? []) : (replyObj.components ?? [noodleMainMenuRow(userId)])
    };

    putIdempotentResult(db, { key: idemKey, userId, action, ttlSeconds: 900, result: out });
    return commit(out);
  };

  /* ---------------- FORAGE ---------------- */
  if (sub === "forage") {
    const cooldownMs = 2 * 60 * 1000;
    const chk = canForage(p, now, cooldownMs);

    if (!chk.ok) {
      const msLeft = chk.nextAt - now;
      const mins = Math.ceil(msLeft / 60000);
      const nextAtTs = Math.floor(chk.nextAt / 1000);
      const cooldownEmbed = buildMenuEmbed({
        title: "🌿 Forage Cooldown",
        description: `You’ve foraged recently. Try again at <t:${nextAtTs}:t>, <t:${nextAtTs}:R>.`,
        user: interaction.user
      });
      return commitState({
        content: " ",
        embeds: [cooldownEmbed]
      });
    }

    const itemId = opt.getString("item") ?? null;
    const qtyRaw = opt.getInteger("quantity") ?? 1;
    const quantity = Math.max(1, Math.min(5, qtyRaw));

    const allowed = getUnlockedIngredientIds(p, content);
    const allowedForage = new Set((FORAGE_ITEM_IDS ?? []).filter((id) => allowed.has(id)));

    if (itemId && !allowedForage.has(itemId)) {
      return commitState({
        content: "You can only forage ingredients used by recipes you’ve unlocked."
      });
    }

    let drops;
    try {
      drops = rollForageDrops({
        serverId,
        userId: interaction.user.id,
        picks: 2,
        itemId,
        quantity,
        allowedItemIds: [...allowedForage]
      });
    } catch {
      const unlockedForageIds = (FORAGE_ITEM_IDS ?? []).filter((id) => allowed.has(id));
      if (!unlockedForageIds.length) {
        return commitState({
          content: "🌿 You haven’t unlocked any forageable ingredients yet. Unlock a recipe first!"
        });
      }

      const suggestions = unlockedForageIds
        .map((id) => `\`${displayItemName(id)}\``)
        .join(", ");

      return commitState({
        content: `That isn't a valid forage item for your unlocked recipes. Try one of: ${suggestions}`
      });
    }

    applyDropsToInventory(p, drops);
    setForageCooldown(p, now);
    advanceTutorial(p, "forage");

    const lines = Object.entries(drops).map(
      ([id, q]) => `• **${q}×** ${displayItemName(id)}`
    );

    const header = itemId
      ? `You search carefully and gather:\n`
      : `You wander into the nearby grove and return with:\n`;

    const forageEmbed = buildMenuEmbed({
      title: "🌿 Forage",
      description: `${header}${lines.join("\n")}${tutorialSuffix(p)}`,
      user: interaction.user
    });
    return commitState({
      content: " ",
      embeds: [forageEmbed]
    });
  }

  /* ---------------- BUY ---------------- */
  if (sub === "buy") {
    const itemId = opt.getString("item");
    const qty = opt.getInteger("quantity");

    // Multi-buy entry
    if (!itemId) {
      const allowed = getUnlockedIngredientIds(p, content);

      const opts = (MARKET_ITEM_IDS ?? [])
        .map((id) => {
          if (!allowed.has(id)) return null;

          const it = content.items?.[id];
          if (!it) return null;

          const price = s.market_prices?.[id] ?? it.base_price ?? 0;
          const stock = p.market_stock?.[id] ?? 0;
          if (stock <= 0) return null;

          const labelRaw = `${it.name} — ${price}c (stock ${stock})`;
          const label = labelRaw.length > 100 ? labelRaw.slice(0, 97) + "…" : labelRaw;

          return { label, value: id };
        })
        .filter(Boolean)
        .slice(0, 25);

      if (!opts.length) {
        return commitState({
          content: "🛒 No market items are available for your unlocked recipes right now.",
          ephemeral: true
        });
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`noodle:multibuy:select:${userId}`)
        .setPlaceholder("Select up to 5 items to buy.")
        .setMinValues(1)
        .setMaxValues(Math.min(5, opts.length))
        .addOptions(opts);

      const buyEmbed = buildMenuEmbed({
        title: "🛒 Multi-buy",
        description:
          "Select up to **5** items\n" +
          "When you’re done selecting, if on Desktop, press **Esc** to continue\n",
        user: interaction.user
      });

      return commit({
        content: " ",
        embeds: [buyEmbed],
        components: [
          new ActionRowBuilder().addComponents(menu),
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`noodle:nav:sell:${userId}`)
              .setLabel("💰 Sell Items")
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId(`noodle:nav:profile:${userId}`)
              .setLabel("Cancel")
              .setStyle(ButtonStyle.Secondary)
          )
        ]
      });
    }

    // Single buy
    if (!qty || qty <= 0) {
      return commitState({ content: "Pick a quantity for single-item buys.", ephemeral: true });
    }

    const allowed = getUnlockedIngredientIds(p, content);
    if (!allowed.has(itemId)) {
      return commitState({
        content: "You can only buy ingredients used by recipes you’ve unlocked.",
        ephemeral: true
      });
    }

    const item = content.items[itemId];
    if (!item || !item.base_price) {
      return commitState({ content: "That item isn’t on the market.", ephemeral: true });
    }

    // Check for pity discount (B6)
    const pityPrice = getPityDiscount(p, itemId);
    const price = pityPrice ?? (s.market_prices?.[itemId] ?? item.base_price);
    const stock = p.market_stock?.[itemId] ?? 0;
    const cost = price * qty;

    if (stock < qty) {
      const friendly = displayItemName(itemId);
      return commitState({ content: `Only ${stock} in stock today for **${friendly}**.`, ephemeral: true });
    }
    if (p.coins < cost) return commitState({ content: "Not enough coins for that purchase." });

    p.coins -= cost;
    p.inv_ingredients[itemId] = (p.inv_ingredients[itemId] ?? 0) + qty;
    p.market_stock[itemId] = stock - qty;

    advanceTutorial(p, "buy");

    return commitState({
      content: `🛒 Bought **${qty}× ${item.name}** for **${cost}c**.${tutorialSuffix(p)}`,
      embeds: []
    });
  }

  /* ---------------- SELL ---------------- */
  if (sub === "sell") {
    const itemId = opt.getString("item");
    const qty = opt.getInteger("quantity");

    if (!MARKET_ITEM_IDS.includes(itemId)) {
      return commitState({ content: "That item isn’t available in the market.", ephemeral: true });
    }

    const item = content.items[itemId];
    if (!item) return commitState({ content: "That item doesn’t exist.", ephemeral: true });
    if (!qty || qty <= 0) return commitState({ content: "Pick a positive quantity.", ephemeral: true });

    const owned = p.inv_ingredients?.[itemId] ?? 0;
    if (owned < qty) return commitState({ content: `You only have ${owned}.`, ephemeral: true });

    const unit = sellPrice(s, itemId);
    const gain = unit * qty;

    p.inv_ingredients[itemId] = owned - qty;
    p.coins += gain;
    p.lifetime.coins_earned += gain;

    return commitState({ content: `💰 Sold **${qty}× ${item.name}** for **${gain}c**.` });
  }

  /* ---------------- COOK ---------------- */
  if (sub === "cook") {
    const recipeId = opt.getString("recipe");
    const qty = opt.getInteger("quantity");

    const r = content.recipes[recipeId];
    if (!r) return commitState({ content: "That recipe doesn’t exist.", ephemeral: true });
    // Use getAvailableRecipes to include temporary recipes (B2)
    const availableRecipes = getAvailableRecipes(p);
    if (!availableRecipes.includes(recipeId)) {
      return commitState({ content: "You don't know that recipe yet.", ephemeral: true });
    }
    if (!qty || qty <= 0) return commitState({ content: "Pick a positive quantity.", ephemeral: true });

    for (const ing of r.ingredients) {
      const haveIng = p.inv_ingredients?.[ing.item_id] ?? 0;
      const need = ing.qty * qty;
      if (haveIng < need) {
        const missing = need - haveIng;
        return commitState({
          content: `You’re missing **${displayItemName(ing.item_id)}** — need **${missing}** more (have ${haveIng}/${need}).`,
          ephemeral: true
        });
      }
    }

    for (const ing of r.ingredients) {
      p.inv_ingredients[ing.item_id] -= ing.qty * qty;
    }

    const bowlKey = recipeId;
    const existing = p.inv_bowls?.[bowlKey];

    if (!existing) {
      if (!p.inv_bowls) p.inv_bowls = {};
      p.inv_bowls[bowlKey] = {
        recipe_id: recipeId,
        quality: "standard",
        tier: r.tier,
        qty,
        cooked_at: nowTs()
      };
    } else {
      existing.qty += qty;
    }

    const have = p.inv_bowls[bowlKey].qty;

    advanceTutorial(p, "cook");
    if (!p.lifetime) p.lifetime = { recipes_cooked: 0 };
    p.lifetime.recipes_cooked = (p.lifetime.recipes_cooked || 0) + 1;

    const cookEmbed = buildMenuEmbed({
      title: "🍲 Cooked",
      description: [
        `You cooked **${qty}× ${r.name}**.`,
        `You now have **${have}** bowl(s) ready.`,
        tutorialSuffix(p)
      ].filter(Boolean).join("\n"),
      user: interaction.user
    });

    return commitState({
      content: " ",
      embeds: [cookEmbed],
      components: [noodleOrdersActionRow(userId)]
    });
  }

  /* ---------------- ORDERS ---------------- */
  if (sub === "orders") {
    const now2 = nowTs();
    const sweep2 = sweepExpiredAcceptedOrders(p, s, content, now2);

    const acceptedEntries = Object.entries(p.orders?.accepted ?? {});
    
    // Aggregate ingredients needed across all accepted orders
    const allNeeded = {};
    acceptedEntries.forEach(([fullId, a]) => {
      const snap = a?.order ?? null;
      const order =
        snap ??
        (p.order_board ?? []).find((o) => o.order_id === fullId) ??
        null;
      
      if (order && order.recipe_id) {
        const recipe = content.recipes[order.recipe_id];
        if (recipe?.ingredients) {
          recipe.ingredients.forEach((ing) => {
            allNeeded[ing.item_id] = (allNeeded[ing.item_id] ?? 0) + ing.qty;
          });
        }
      }
    });
    
    // Calculate shortages
    const shortages = Object.entries(allNeeded)
      .map(([itemId, needed]) => {
        const have = p.inv_ingredients?.[itemId] ?? 0;
        const short = Math.max(0, needed - have);
        return { itemId, needed, have, short };
      })
      .filter((s) => s.short > 0);
    
    // Check if there are any ready bowls for accepted orders (deduplicate by recipe)
    const uniqueRecipes = new Set();
    acceptedEntries.forEach(([fullId, a]) => {
      const snap = a?.order ?? null;
      const order =
        snap ??
        (p.order_board ?? []).find((o) => o.order_id === fullId) ??
        null;
      if (order?.recipe_id) {
        uniqueRecipes.add(order.recipe_id);
      }
    });

    const readyBowls = Array.from(uniqueRecipes)
      .map((recipeId) => {
        const bowl = p.inv_bowls?.[recipeId];
        if (bowl && bowl.qty > 0) {
          const rName = content.recipes[recipeId]?.name ?? "a dish";
          return `• **${rName}** — **${bowl.qty}** bowl(s) ready`;
        }
        return null;
      })
      .filter(Boolean);

    const statusParts = [];
    if (shortages.length) {
      statusParts.push(
        `🧺 **Ingredients Needed**\n${shortages.map((s) => {
          const iName = displayItemName(s.itemId, content);
          return `• ${iName} - You have: **${s.have}**, you need **${s.needed}**`;
        }).join("\n")}`
      );
    } else {
      statusParts.push(`🧺 **Ingredients Needed**\n_All ingredients ready to cook!_`);
    }

    if (readyBowls.length > 0) {
      statusParts.push(`🍲 **Bowls Ready**\n${readyBowls.join("\n")}`);
    }

    const statusMsg = statusParts.join("\n\n");

    const acceptedLines = acceptedEntries.map(([fullId, a]) => {
      const snap = a?.order ?? null;

      let timeLeft = "";
      if (a?.expires_at) {
        const msLeft = a.expires_at - now2;
        if (msLeft <= 0) timeLeft = " *(expired)*";
        else timeLeft = ` *(<t:${Math.floor(a.expires_at / 1000)}:R>)*`;
      } else timeLeft = " *(no rush)*";

      const order =
        snap ??
        (p.order_board ?? []).find((o) => o.order_id === fullId) ??
        null;

      if (!order) return `✅ \`${shortOrderId(fullId)}\`${timeLeft}`;

      const npcName = content.npcs[order.npc_archetype]?.name ?? "a customer";
      const rName = content.recipes[order.recipe_id]?.name ?? "a dish";
      const lt = order.is_limited_time ? "⏳" : "•";

      return `✅ \`${shortOrderId(fullId)}\` ${lt} **${rName}** — *${npcName}* (${order.tier})${timeLeft}`;
    });

    const parts = [];
    if (sweep2.warning) parts.push(sweep2.warning, "");

    const remaining = (p.order_board ?? []).length;
    if (remaining > 0) {
      parts.push(
        "**Today’s Orders**",
        `There are **${remaining}** orders available. Tap **Accept** below to start serving customers.`
      );
    } else if (acceptedLines.length) {
      parts.push("📋 **Today’s Orders**", "No new orders left today. Finish your accepted ones and come back tomorrow.");
    } else {
      parts.push("🎉 You’ve completed all of today’s orders! Come back tomorrow for more.");
    }


    if (acceptedLines.length) {
      parts.push(
        "",
        "**Your Accepted Orders**",
        acceptedLines.join("\n"),
        "",
        statusMsg,
        ""
      );
    } else {
      parts.push("", "**Your Accepted Orders**", "_None right now._", "");
    }

    const tutSuffix = tutorialSuffix(p);
    if (tutSuffix) parts.push("", tutSuffix);

    const showCancel = acceptedEntries.length > 0;
    const menuEmbed = buildMenuEmbed({
      title: "📋 Orders",
      description: parts.join("\n"),
      user: interaction.user
    });
    return commitState({
      content: " ",
      embeds: [menuEmbed],
      components: [noodleOrdersMenuActionRow(userId, { showCancel }), noodleMainMenuRowNoOrders(userId)]
    });
  }

  /* ---------------- ACCEPT -------- */
  if (sub === "accept") {
    const rawInput = String(opt.getString("order_id") ?? "").trim();
    const tokens = rawInput
      .split(/[\s,]+/)
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);

    if (!tokens.length) return commitState({ content: "Pick at least one order to accept.", ephemeral: true });

    const cap = 5;
    // Ensure orders is a valid object (handle case where it might be an array or null)
    if (!p.orders || typeof p.orders !== 'object' || Array.isArray(p.orders)) {
      p.orders = { accepted: {}, seasonal_served_today: 0, epic_served_today: 0 };
    }
    
    const acceptedCount = Object.keys(p.orders?.accepted ?? {}).length;
    const available = Math.max(0, cap - acceptedCount);
    if (available <= 0) {
      return commitState({ content: `You can only hold ${cap} active orders right now.`, ephemeral: true });
    }

    if (!p.orders.accepted) p.orders.accepted = {};

    const board = p.order_board ?? [];
    const results = [];
    const readyBowlsByRecipe = new Map();
    let acceptedNow = 0;

    for (const tok of tokens) {
      if (acceptedNow >= available) {
        results.push("⚠️ Reached active order cap.");
        break;
      }

      const order = board.find((o) => {
        const full = String(o.order_id).toUpperCase();
        const short = shortOrderId(o.order_id);
        return full === tok || short === tok;
      });

      if (!order) {
        results.push(`❔ Order \`${tok}\` not found on today's board.`);
        continue;
      }

      if (p.orders.accepted[order.order_id]) {
        results.push(`⏩ Already accepted \`${shortOrderId(order.order_id)}\`.`);
        continue;
      }

      const acceptedAt = nowTs();
      const baseSpeedWindowSeconds = order.speed_window_seconds ?? 180;
      const speedWindowSeconds = order.is_limited_time
        ? getLimitedTimeWindowSeconds(p, baseSpeedWindowSeconds)
        : baseSpeedWindowSeconds;
      const expiresAt = order.is_limited_time
        ? acceptedAt + (speedWindowSeconds * 1000)
        : null;

      p.orders.accepted[order.order_id] = {
        accepted_at: acceptedAt,
        expires_at: expiresAt,
        order: {
          order_id: order.order_id,
          recipe_id: order.recipe_id,
          tier: order.tier,
          npc_archetype: order.npc_archetype,
          is_limited_time: order.is_limited_time,
          speed_window_seconds: speedWindowSeconds,
          base_speed_window_seconds: baseSpeedWindowSeconds
        }
      };

      const rName = content.recipes[order.recipe_id]?.name ?? "a dish";
      const timeNote = expiresAt
        ? `⏳ <t:${Math.floor(expiresAt / 1000)}:R> to serve.`
        : `🌿 No rush.`;

      results.push(`Accepted \`${shortOrderId(order.order_id)}\` — **${rName}** (${timeNote})`);

      const bowl = p.inv_bowls?.[order.recipe_id];
      if (bowl && bowl.qty > 0) {
        readyBowlsByRecipe.set(order.recipe_id, bowl.qty);
      } else {
        const needs = formatRecipeNeeds({ recipeId: order.recipe_id, content, player: p });
        if (needs) {
          results.push(needs, "");
        } else {
          results.push("✅ All ingredients ready to cook!", "");
        }
      }
      acceptedNow += 1;
    }

    if (acceptedNow > 0) advanceTutorial(p, "accept");

    if (readyBowlsByRecipe.size > 0) {
      const readyLines = [...readyBowlsByRecipe.entries()].map(([recipeId, qty]) => {
        const rName = content.recipes?.[recipeId]?.name ?? recipeId;
        return `• **${rName}** — **${qty}** bowl(s) ready`;
      });
      results.push("\n🍲 **Bowls Ready**", ...readyLines, "");
    }

    const acceptEmbed = buildMenuEmbed({
      title: "✅ Orders Accepted",
      description: `${results.join("\n")}${tutorialSuffix(p) ? `\n\n${tutorialSuffix(p)}` : ""}`,
      user: interaction.user
    });
    return commitState({
      content: " ",
      embeds: [acceptEmbed],
      components: [noodleOrdersActionRow(userId), noodleMainMenuRow(userId)]
    });
  }

  /* ---------------- CANCEL ---------------- */
  if (sub === "cancel") {
    const input = String(opt.getString("order_id") ?? "").trim().toUpperCase();

    // Ensure orders is a valid object (handle case where it might be an array or null)
    if (!p.orders || typeof p.orders !== 'object' || Array.isArray(p.orders)) {
      p.orders = { accepted: {}, seasonal_served_today: 0, epic_served_today: 0 };
    }
    if (!p.orders.accepted) p.orders.accepted = {};
    const accepted = p.orders.accepted;

    const fullId = Object.keys(accepted).find((id) => {
      const full = String(id).toUpperCase();
      const short = shortOrderId(id);
      return full === input || short === input;
    });

    if (!fullId) return commitState({ content: "You don’t have that order accepted.", ephemeral: true });

    const entry = accepted[fullId];
    const orderSnap = entry?.order ?? null;

    const rName = orderSnap ? (content.recipes[orderSnap.recipe_id]?.name ?? "a dish") : null;
    const npcName = orderSnap ? (content.npcs[orderSnap.npc_archetype]?.name ?? orderSnap.npc_archetype) : null;

    delete accepted[fullId];

    return commitState({
      content: `❌ Canceled order \`${shortOrderId(fullId)}\`${rName ? ` — **${rName}**` : ""}${npcName ? ` for *${npcName}*` : ""}.`
    });
  }

  /* ---------------- SERVE ---------------- */
  if (sub === "serve") {
    const rawInput = String(opt.getString("order_id") ?? "").trim();
    const bowlKey = opt.getString("bowl_key") ?? null;
    const tokens = rawInput
      .split(/[\s,]+/)
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);

    if (!tokens.length) return commitState({ content: "Pick at least one accepted order to serve." });

    const acceptedMap = p.orders?.accepted ?? {};
    // Ensure core stats and lifetime tracking exist
    p.coins = Number.isFinite(p.coins) ? p.coins : 0;
    p.rep = Number.isFinite(p.rep) ? p.rep : 0;
    p.sxp_total = Number.isFinite(p.sxp_total) ? p.sxp_total : 0;
    p.sxp_progress = Number.isFinite(p.sxp_progress) ? p.sxp_progress : 0;
    if (!p.lifetime) p.lifetime = {};
    p.lifetime.orders_served = p.lifetime.orders_served ?? 0;
    p.lifetime.bowls_served_total = p.lifetime.bowls_served_total ?? 0;
    p.lifetime.coins_earned = p.lifetime.coins_earned ?? 0;
    p.lifetime.limited_time_served = p.lifetime.limited_time_served ?? 0;
    p.lifetime.perfect_speed_serves = p.lifetime.perfect_speed_serves ?? 0;
    if (!p.lifetime.npc_seen) p.lifetime.npc_seen = {};
    if (!p.daily) p.daily = {};
    if (!p.buffs) p.buffs = {};
    
    const results = [];
    const discoveryMessages = [];
    let totalCoins = 0;
    let totalRep = 0;
    let totalSxp = 0;
    let servedCount = 0;
    let leveledUp = false;
    let recipeUnlocked = false;

    for (const tok of tokens) {
      const matchEntry = Object.entries(acceptedMap).find(([fullId]) => {
        const full = String(fullId).toUpperCase();
        const short = shortOrderId(fullId);
        return full === tok || short === tok;
      });

      if (!matchEntry) {
        results.push(`❔ Order \`${shortOrderId(tok)}\` isn't accepted.`);
        continue;
      }

      const [fullOrderId, accepted] = matchEntry;
      const now3 = nowTs();
      if (accepted.expires_at && now3 > accepted.expires_at) {
        delete acceptedMap[fullOrderId];
        // Track fail streak for manually expired order (B4)
        updateFailStreak(p, false); // failure
        results.push(`⏳ Order \`${shortOrderId(fullOrderId)}\` expired.`);
        continue;
      }

      const live = (p.order_board ?? []).find((o) => o.order_id === fullOrderId);
      const order = live ?? accepted.order;
      if (!order) {
        delete acceptedMap[fullOrderId];
        results.push(`⚠️ Order \`${shortOrderId(fullOrderId)}\` can't be found anymore.`);
        continue;
      }

      const key = bowlKey ?? order.recipe_id;
      const bowl = p.inv_bowls?.[key];
      if (!bowl || bowl.qty <= 0) {
        const recipeName = content.recipes?.[key]?.name ?? "that recipe";
        results.push(`🧺 You don't have a bowl ready for **${recipeName}**.`);
        continue;
      }
      if (bowl.recipe_id !== order.recipe_id) {
        results.push(`⚠️ Bowl doesn't match recipe for order \`${shortOrderId(fullOrderId)}\`.`);
        continue;
      }

      const servedAt = nowTs();
      const recipe = content.recipes?.[order.recipe_id];
      const baseSpeedWindowSeconds = accepted.order?.base_speed_window_seconds ?? order.speed_window_seconds ?? 180;
      const speedWindowSeconds = order.is_limited_time
        ? getLimitedTimeWindowSeconds(p, baseSpeedWindowSeconds)
        : baseSpeedWindowSeconds;
      const rewards = computeServeRewards({
        serverId,
        tier: order.tier,
        npcArchetype: order.npc_archetype,
        isLimitedTime: order.is_limited_time,
        servedAtMs: servedAt,
        acceptedAtMs: accepted.accepted_at,
        speedWindowSeconds,
        player: p,
        recipe,
        content
      });

      // Consume fail-streak relief after successful serve (B4)
      consumeFailStreakRelief(p);

      bowl.qty -= 1;
      if (bowl.qty <= 0) delete p.inv_bowls[key];

      delete acceptedMap[fullOrderId];
      if (Array.isArray(p.order_board)) {
        p.order_board = p.order_board.filter((o) => o.order_id !== fullOrderId);
      }

      p.coins += rewards.coins;
      p.rep += rewards.rep;
      p.sxp_total += rewards.sxp;
      p.sxp_progress += rewards.sxp;

      const leveled = applySxpLevelUp(p);
      leveledUp = leveledUp || leveled;

      p.lifetime.orders_served += 1;
      p.lifetime.bowls_served_total += 1;
      p.lifetime.coins_earned += rewards.coins;
      if (order.is_limited_time) p.lifetime.limited_time_served += 1;
      if (order.is_limited_time && (servedAt - accepted.accepted_at) <= (speedWindowSeconds * 1000)) {
        p.lifetime.perfect_speed_serves += 1;
      }
      if (!p.lifetime.npc_seen) p.lifetime.npc_seen = {};
      p.lifetime.npc_seen[order.npc_archetype] = true;

      // Update daily tracking for Sleepy Traveler
      const dayKey = dayKeyUTC(servedAt);
      p.daily.last_serve_day = dayKey;
      
      // Track last recipe served for Retired Captain
      if (p.buffs) {
        p.buffs.last_recipe_served = order.recipe_id;
      }
      
      // Apply NPC discovery buffs for next serve
      applyNpcDiscoveryBuff(p, order.npc_archetype);

      // Roll for recipe discovery
      // Note: Uses same seed (12345) as serve rewards for consistency,
      // but different streamName and extra parameters ensure independence
      const discoveryRng = makeStreamRng({ 
        mode: "seeded", 
        seed: 12345, 
        streamName: "discovery", 
        serverId, 
        dayKey,
        extra: `${fullOrderId}_${servedAt}` 
      });
      const discoveries = rollRecipeDiscovery({
        player: p,
        content,
        npcArchetype: order.npc_archetype,
        tier: order.tier,
        rng: discoveryRng
      });
      
      for (const discovery of discoveries ?? []) {
        const result = applyDiscovery(p, discovery, content, discoveryRng);
        if (result.message) {
          discoveryMessages.push(result.message);
        } else if (result.isDuplicate && result.reward) {
          discoveryMessages.push(`✨ ${result.reward}`);
        }
        
        // Track if a new recipe was unlocked
        if (result.recipeUnlocked) {
          recipeUnlocked = true;
        }
      }

      totalCoins += rewards.coins;
      totalRep += rewards.rep;
      totalSxp += rewards.sxp;
      servedCount += 1;

      const rName = content.recipes[order.recipe_id]?.name ?? "a dish";
      const npcName = content.npcs[order.npc_archetype]?.name ?? "a customer";
      
      // Build the serve message with bonus on same line
      let serveMsg = `Served **${rName}** to *${npcName}*.`;
      if (rewards.npcModifier === "coins_courier") serveMsg += ` 🌧️ +25% coins`;
      if (rewards.npcModifier === "coins_bard") serveMsg += ` 🎵 +10% coins`;
      if (rewards.npcModifier === "coins_festival") serveMsg += ` 🎉 +25% coins`;
      if (rewards.npcModifier === "speed") serveMsg += ` 🌙 Doubled speed bonus`;
      if (rewards.npcModifier === "sxp_forest") serveMsg += ` 🌲 +10% SXP`;
      if (rewards.npcModifier === "sxp_captain") serveMsg += ` ⛵ +10 SXP`;
      if (rewards.npcModifier === "rep_inspector") serveMsg += ` 📋 +10 REP`;
      if (rewards.npcModifier === "rep_sleepy") serveMsg += ` 😴 +5 REP`;
      if (rewards.npcModifier === "rep_moonlit") serveMsg += ` 🌙 +15 REP`;
      
      if (rewards.repAuraGranted) {
        // Check if aura already active
        const auraExpiry = p.buffs?.repAuraExpiry ?? 0;
        const now3_aura = nowTs();
        if (auraExpiry > now3_aura) {
          serveMsg += ` ✨ Aura buff doesn't stack (active for another ${Math.ceil((auraExpiry - now3_aura) / 1000 / 60)} min)`;
        } else {
          serveMsg += ` ✨ +2 REP for 15 min`;
        }
      }
      
      results.push(serveMsg);
    }

    if (!servedCount) {
      return commitState({ content: results.join("\n") || "Nothing served." });
    }
    
    // If a recipe was unlocked, force regenerate order board to include new recipe
    if (recipeUnlocked) {
      delete p.orders_day; // Force regeneration by clearing day marker
      ensureDailyOrdersForPlayer(p, set, content, s.season, serverId, userId);
    }

    const summary = `Rewards total: **+${totalCoins}c**, **+${totalSxp} SXP**, **+${totalRep} REP**.`;
    const levelLine = leveledUp ? `\n✨ Level up! You're now **Level ${p.shop_level}**.` : "";
    const discoveryLine = discoveryMessages.length > 0 ? `\n\n${discoveryMessages.join("\n")}` : "";
    const tut = advanceTutorial(p, "serve");
    const suffix = tut.finished ? `\n\n${formatTutorialCompletionMessage()}` : `${tutorialSuffix(p)}`;

    const components = [noodleOrdersActionRow(userId), noodleMainMenuRow(userId)];
    const embeds = tut.finished ? [renderProfileEmbed(p, interaction.user.displayName, null, interaction.user)] : [];

    const serveEmbed = buildMenuEmbed({
      title: "🍜 Orders Served",
      description: `${results.join("\n")}\n\n${summary}${levelLine}${discoveryLine}${suffix}`,
      user: interaction.user
    });

    return commitState({
      content: " ",
      components,
      embeds: [serveEmbed, ...embeds]
    });
  }

  return commitState({ content: "That subcommand exists but isn’t implemented yet.", ephemeral: true });
});

} catch (e) {
console.error("NOODLE CMD ERROR:", e?.stack ?? e);
return commit({ content: cozyError(e), ephemeral: true });
}
}

/* ------------------------------------------------------------------ */
/*  Component routing                                                  */
/* ------------------------------------------------------------------ */

async function handleComponent(interaction) {
const customId = String(interaction.customId || "");

// Note: deferUpdate is already called in index.js for most components
// We don't need to defer again here, just route to the appropriate handler

const serverId = interaction.guildId;
if (!serverId) {
return componentCommit(interaction, { content: "This game runs inside a server (not DMs).", ephemeral: true });
}

const userId = interaction.user.id;
const id = String(interaction.customId || "");
const parts = id.split(":"); // noodle:<kind>:<action>:<ownerId>:...

if (parts[0] !== "noodle") {
return componentCommit(interaction, { content: "Unknown component.", ephemeral: true });
}

const kind = parts[1] ?? "";
const action = parts[2] ?? "";
const ownerId = parts[3] ?? "";

// lock UI to owner when ownerId is present
if (ownerId && ownerId !== userId && (kind === "nav" || kind === "pick" || kind === "multibuy")) {
return componentCommit(interaction, { content: "That menu isn’t for you.", ephemeral: true });
}

/* -------- SPECIAL SELL NAV HANDLER -------- */
if (kind === "nav" && action === "sell") {
  const s = ensureServer(serverId);
  const p = ensurePlayer(serverId, userId);
  
  const ownedItems = Object.entries(p.inv_ingredients ?? {})
    .filter(([id, q]) => q > 0 && MARKET_ITEM_IDS.includes(id))
    .slice(0, 25);

  if (!ownedItems.length) {
    return componentCommit(interaction, {
      content: "💰 You don't have any market items to sell.",
      ephemeral: true
    });
  }

  const opts = ownedItems.map(([id, ownedQty]) => {
    const it = content.items?.[id];
    if (!it) return null;

    const price = sellPrice(s, id);
    const labelRaw = `${it.name} — ${price}c each (you have ${ownedQty})`;
    const label = labelRaw.length > 100 ? labelRaw.slice(0, 97) + "…" : labelRaw;

    return { label, value: id };
  }).filter(Boolean);

  if (!opts.length) {
    return componentCommit(interaction, {
      content: "💰 You don't have any market items to sell.",
      ephemeral: true
    });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`noodle:sell:select:${userId}`)
    .setPlaceholder("Select items to sell")
    .setMinValues(1)
    .setMaxValues(Math.min(5, opts.length))
    .addOptions(opts);

  const cancelButton = new ButtonBuilder()
    .setCustomId(`noodle:nav:profile:${userId}`)
    .setLabel("Cancel")
    .setStyle(ButtonStyle.Secondary);

  const sellEmbed = buildMenuEmbed({
    title: "💰 Sell Items",
    description:
      "Select up to **5** items to sell\n" +
      "When you’re done selecting, if on Desktop, press **Esc** to continue",
    user: interaction.user
  });

  return componentCommit(interaction, {
    content: " ",
    embeds: [sellEmbed],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(cancelButton)
    ]
  });
}

/* ---------------- NAV BUTTONS ---------------- */
if (kind === "nav") {
const sub = action;
const sourceMessageId = interaction.message?.id;
return runNoodle(interaction, { sub, group: null, overrides: { messageId: sourceMessageId } });
}

/* ---------------- LEGACY ACTION BUTTONS ---------------- */
if (kind === "action") {
  const sub = action;
  const sourceMessageId = interaction.message?.id;
  return runNoodle(interaction, { sub, group: null, overrides: { messageId: sourceMessageId } });
}

/* ---------------- QUICK PICKERS (BUTTONS ONLY) ---------------- */
// Skip modals - they're handled separately below
if (kind === "pick" && !action.endsWith("_select") && !interaction.isModalSubmit?.()) {
// noodle:pick:<what>:<ownerId>
if (action === "accept") {
const s = ensureServer(serverId);
const p = ensurePlayer(serverId, userId);
const set = buildSettingsMap(settingsCatalog, s.settings);
s.season = computeActiveSeason(set);
rollMarket({ serverId, content, serverState: s });
ensureDailyOrdersForPlayer(p, set, content, s.season, serverId, userId);

  const all = p.order_board ?? [];
  const rawPage = Number(parts[4] ?? 0);
  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(all.length / pageSize));
  const page = Math.min(Math.max(rawPage, 0), totalPages - 1);

  const opts = all.slice(page * pageSize, (page + 1) * pageSize).map((o) => {
    const rName = content.recipes[o.recipe_id]?.name ?? "a dish";
    const npcName = content.npcs[o.npc_archetype]?.name ?? "a customer";
    const labelRaw = `${shortOrderId(o.order_id)} — ${rName} (${npcName})`;
    const label = labelRaw.length > 100 ? labelRaw.slice(0, 97) + "…" : labelRaw;
    return { label, value: String(o.order_id) };
  });

  if (!opts.length) return componentCommit(interaction, { content: "No orders available to accept.", ephemeral: true });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`noodle:pick:accept_select:${userId}`)
    .setPlaceholder("Select orders to accept (up to 5)")
    .setMinValues(1)
    .setMaxValues(Math.min(5, opts.length))
    .addOptions(opts);

  const navRow = new ActionRowBuilder();
  if (totalPages > 1) {
    navRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:pick:accept:${userId}:${page - 1}`)
        .setLabel("Prev")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(`noodle:pick:accept:${userId}:${page + 1}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    );
  }

  const rows = [new ActionRowBuilder().addComponents(menu), noodleOrdersActionRowWithBack(userId)];
  if (totalPages > 1) rows.push(navRow);

  const acceptEmbed = buildMenuEmbed({
    title: "✅ Accept Orders",
    description: `Select orders to accept here.\nWhen you're done selecting, if on Desktop, press **Esc** to continue.\n\n(page ${page + 1}/${totalPages})`,
    user: interaction.user
  });

  return componentCommit(interaction, {
    content: " ",
    embeds: [acceptEmbed],
    components: rows
  });
}

if (action === "cancel" || action === "serve") {
  const p = ensurePlayer(serverId, userId);
  const accepted = Object.entries(p.orders?.accepted ?? {});

  const opts = accepted.slice(0, 25).map(([oid, entry]) => {
    const snap = entry?.order ?? null;
    const rName = snap ? (content.recipes[snap.recipe_id]?.name ?? snap.recipe_id) : "Unknown Recipe";
    const npcName = snap ? (content.npcs[snap.npc_archetype]?.name ?? snap.npc_archetype) : "Unknown NPC";
    const labelRaw = `${shortOrderId(oid)} — ${rName} (${npcName})`;
    const label = labelRaw.length > 100 ? labelRaw.slice(0, 97) + "…" : labelRaw;
    return { label, value: oid };
  });

  if (!opts.length) {
    return componentCommit(interaction, { content: "You don’t have any accepted orders.", ephemeral: true });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`noodle:pick:${action}_select:${userId}`)
    .setPlaceholder(action === "serve" ? "Select orders to serve" : "Select an order to cancel")
    .setMinValues(1)
    .setMaxValues(action === "serve" ? Math.min(5, opts.length) : 1)
    .addOptions(opts);

  const actionTitle = action === "serve" ? "🍜 Serve Orders" : "❌ Cancel Order";
  const actionDesc = action === "serve"
    ? "Select accepted orders to serve.\nWhen you're done selecting, if on Desktop, press **Esc** to continue."
    : "Select an accepted order to cancel.\nWhen you're done selecting, if on Desktop, press **Esc** to continue.";
  const actionEmbed = buildMenuEmbed({ title: actionTitle, description: actionDesc, user: interaction.user });

  return componentCommit(interaction, {
    content: " ",
    embeds: [actionEmbed],
    components: [
      new ActionRowBuilder().addComponents(menu),
      action === "serve" ? noodleOrdersActionRowWithBack(userId) : noodleOrdersActionRow(userId)
    ]
  });
}

if (action === "cook") {
  // select a recipe from known_recipes, then modal for qty
  const p = ensurePlayer(serverId, userId);
  const available = getAvailableRecipes(p);
  const opts = available.slice(0, 25).map((rid) => {
    const r = content.recipes?.[rid];
    const labelRaw = r ? `${r.name} (${r.tier})` : displayItemName(rid, content);
    const label = labelRaw.length > 100 ? labelRaw.slice(0, 97) + "…" : labelRaw;
    return { label, value: rid };
  });

  if (!opts.length) return componentCommit(interaction, { content: "You don’t know any recipes yet.", ephemeral: true });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`noodle:pick:cook_select:${userId}`)
    .setPlaceholder("Select a recipe to cook")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(opts);

  const cookEmbed = buildMenuEmbed({
    title: "🍲 Cook",
    description: "Select a recipe to cook:",
    user: interaction.user
  });

  return componentCommit(interaction, {
    content: " ",
    embeds: [cookEmbed],
    components: [new ActionRowBuilder().addComponents(menu), noodleOrdersActionRowWithBack(userId)]
  });
}

return componentCommit(interaction, { content: "Unknown picker action.", ephemeral: true });

}

/* ---------------- PICKER SELECT MENUS ---------------- */
// Handle select menus for pickers:
if (interaction.isSelectMenu?.()) {
const cid = interaction.customId;

// accept picker
if (cid.startsWith("noodle:pick:accept_select:")) {
  const orderIds = interaction.values ?? [];
  return await runNoodle(interaction, {
    sub: "accept",
    overrides: { strings: { order_id: orderIds.join(",") } }
  });
}

// cancel picker
if (cid.startsWith("noodle:pick:cancel_select:")) {
  const orderId = interaction.values?.[0];
  return await runNoodle(interaction, {
    sub: "cancel",
    overrides: { strings: { order_id: orderId } }
  });
}

// serve picker
if (cid.startsWith("noodle:pick:serve_select:")) {
  const orderIds = interaction.values ?? [];
  return await runNoodle(interaction, {
    sub: "serve",
    overrides: { strings: { order_id: orderIds.join(",") } }
  });
}

// cook picker -> open qty modal
if (cid.startsWith("noodle:pick:cook_select:")) {
  const recipeId = interaction.values?.[0];

  if (interaction.deferred || interaction.replied) {
    return componentCommit(interaction, { content: "That menu expired, tap again.", ephemeral: true });
  }

  const sourceMessageId = interaction.message?.id ?? "none";
  const modal = new ModalBuilder()
    .setCustomId(`noodle:pick:cook_qty:${userId}:${recipeId}:${sourceMessageId}`)
    .setTitle("Cook bowls");

  const input = new TextInputBuilder()
    .setCustomId("qty")
    .setLabel("Quantity")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("1");

  modal.addComponents(new ActionRowBuilder().addComponents(input));

  try {
    return await interaction.showModal(modal);
  } catch (e) {
    console.log(`⚠️ showModal failed for cook:`, e?.message);
    return componentCommit(interaction, { 
      content: "⚠️ Discord couldn't show the modal. Try using `/noodle cook` directly instead.", 
      ephemeral: true 
    });
  }
}

}

  /* ---------------- COOK QTY MODAL ---------------- */
  if (interaction.isModalSubmit?.() && interaction.customId.startsWith("noodle:pick:cook_qty:")) {
    const parts2 = interaction.customId.split(":");
    // noodle:pick:cook_qty:<ownerId>:<recipeId>:<messageId>
    const owner = parts2[3];
    const recipeId = parts2[4];
    const messageId = parts2[5] && parts2[5] !== "none" ? parts2[5] : null;

    if (owner && owner !== interaction.user.id) {
      return componentCommit(interaction, { content: "That cooking prompt isn’t for you.", ephemeral: true });
    }

    const rawQty = String(interaction.fields.getTextInputValue("qty") ?? "").trim();
    const qty = Number(rawQty);

    if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
      return componentCommit(interaction, { content: "Enter a whole number quantity (1–99).", ephemeral: true });
    }

    if (messageId) {
      try {
        await interaction.deferReply({ ephemeral: true });
      } catch (e) {
        // ignore
      }
    }

    const result = await runNoodle(interaction, {
      sub: "cook",
      overrides: { strings: { recipe: recipeId }, integers: { quantity: qty }, messageId }
    });

    return result;
  }

  /* ---------------- MULTI-BUY SELECT MENU ---------------- */
  if (interaction.isSelectMenu?.() && interaction.customId.startsWith("noodle:multibuy:select:")) {
    const owner = interaction.customId.split(":")[3];
    if (owner && owner !== interaction.user.id) {
      return componentCommit(interaction, { content: "That menu isn’t for you.", ephemeral: true });
    }

    const picked = (interaction.values ?? []).slice(0, 5);
    if (!picked.length) {
      return componentCommit(interaction, { content: "Pick at least one item.", ephemeral: true });
    }

    const sourceMessageId = interaction.message?.id ?? "none";
    const cacheKey = `${interaction.user.id}:${sourceMessageId}`;
    multibuyCacheV2.set(cacheKey, {
      selectedIds: picked.slice(0, 5),
      sourceMessageId: sourceMessageId === "none" ? null : sourceMessageId,
      expiresAt: Date.now() + 5 * 60 * 1000
    });

    const { pickedNames, btnRow } = buildMultiBuyButtonsRow(interaction.user.id, picked, sourceMessageId);

    const sellButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:nav:sell:${interaction.user.id}`)
        .setLabel("💰 Sell Items")
        .setStyle(ButtonStyle.Secondary)
    );

    const selectionEmbed = buildMenuEmbed({
      title: "🛒 Multi-buy",
      description: `**Selected:** ${pickedNames.join(", ")}\nChoose how you want to buy:`,
      user: interaction.user
    });

    return componentCommit(interaction, {
      content: " ",
      embeds: [selectionEmbed],
      components: [btnRow, sellButton]
    });
  }

  /* ---------------- MULTI-BUY BUTTONS ---------------- */
  if (interaction.isButton?.() && interaction.customId.startsWith("noodle:multibuy:")) {
    const parts2 = interaction.customId.split(":");
    // noodle:multibuy:<mode>:<ownerId>:<messageId>
    const mode = parts2[2];
    const owner = parts2[3];
    const sourceMessageId = parts2[4] && parts2[4] !== "none" ? parts2[4] : null;
    const cacheKey = `${interaction.user.id}:${sourceMessageId || "none"}`;
    const cacheEntry = multibuyCacheV2.get(cacheKey);

    if (!cacheEntry) {
      return componentCommit(interaction, { content: "⚠️ Selection expired. Please try again.", ephemeral: true });
    }

    if (cacheEntry.expiresAt < Date.now()) {
      multibuyCacheV2.delete(cacheKey);
      return componentCommit(interaction, { content: "⚠️ Selection expired. Please try again.", ephemeral: true });
    }

    const selectedIds = (cacheEntry.selectedIds ?? []).slice(0, 5);

    if (owner && owner !== interaction.user.id) {
      return componentCommit(interaction, { content: "That menu isn’t for you.", ephemeral: true });
    }

    if (!selectedIds.length) {
      return componentCommit(interaction, { content: "No items selected.", ephemeral: true });
    }

    // Enter quantities -> show modal IMMEDIATELY (before any DB work to avoid timeout)
    if (mode === "qty") {
      // Check if interaction is still valid before attempting modal
      if (interaction.deferred || interaction.replied) {
        // If already deferred/replied, we can't show a modal - try to defer and use reply instead
        try {
          await interaction.deferReply({ ephemeral: true });
          return componentCommit(interaction, { 
            content: "⚠️ Discord couldn't show the modal. Try using `/noodle buy` with individual items instead.", 
            ephemeral: true 
          });
        } catch (e) {
          return componentCommit(interaction, { 
            content: "⚠️ Discord couldn't show the modal. Try using `/noodle buy` with individual items instead.", 
            ephemeral: true 
          });
        }
      }

      const sourceMessageId = interaction.message?.id ?? "";
      const modal = new ModalBuilder()
        .setCustomId(`noodle:multibuy:qty:${interaction.user.id}:${sourceMessageId || "none"}`)
        .setTitle("Multi-buy quantities");

      console.log(`📝 Creating multibuy modal with sourceMessageId="${sourceMessageId}", button message id: ${interaction.message?.id}`);

      const pickedNames = selectedIds.map((id) => content.items?.[id]?.name ?? displayItemName(id));

      const input = new TextInputBuilder()
        .setCustomId("lines")
        .setLabel("One per line: item=qty (Carrots=3)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setPlaceholder(pickedNames.map((n) => `${n}=1`).join("\n"));

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      
      // Store the selected items in cache to avoid custom ID length limit
      const cacheKey = `${interaction.user.id}:${sourceMessageId || "none"}`;
      multibuyCacheV2.set(cacheKey, {
        selectedIds: selectedIds.slice(0, 5),
        sourceMessageId: sourceMessageId || null,
        expiresAt: Date.now() + 5 * 60 * 1000
      });
      
      try {
        return await interaction.showModal(modal);
      } catch (e) {
        console.log(`⚠️ showModal failed for multibuy:`, e?.message);
        // If modal fails, try to acknowledge and give user a fallback message
        try {
          if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ ephemeral: true });
          }
        } catch (defer_err) {
          // Ignore defer errors
        }
        return componentCommit(interaction, { 
          content: "⚠️ Discord couldn't show the modal. Try using `/noodle buy` with individual items instead.", 
          ephemeral: true 
        });
      }
    }

    // All other button modes need DB queries first
    const serverState = ensureServer(serverId);
    const settings = buildSettingsMap(settingsCatalog, serverState.settings);
    serverState.season = computeActiveSeason(settings);
    rollMarket({ serverId, content, serverState });

    const p = ensurePlayer(serverId, userId);

    // Clear -> re-render picker
    if (mode === "clear") {
      multibuyCacheV2.delete(cacheKey);
      return renderMultiBuyPicker({ interaction, userId, s: serverState, p });
    }

    // Buy N each -> perform purchase
    if (mode === "buy1" || mode === "buy5" || mode === "buy10") {
      const qtyEach = mode === "buy10" ? 10 : mode === "buy5" ? 5 : 1;
      const sourceMessageId = interaction.message?.id;
      const action = `multibuy_buy${qtyEach}`;
      const idemKey = makeIdempotencyKey({ serverId, userId, action, interactionId: interaction.id });
      const cached = getIdempotentResult(db, idemKey);
      if (cached) return componentCommit(interaction, cached);

      const ownerLock = `discord:${interaction.id}`;

      return await withLock(db, `lock:user:${userId}`, ownerLock, 8000, async () => {
        let s = ensureServer(serverId);
        let p2 = ensurePlayer(serverId, userId);
        if (!p2.market_stock) p2.market_stock = {};

        const want = {};
        for (const id3 of selectedIds) want[id3] = qtyEach;

        let totalCost = 0;
        const buyLines = [];

        for (const [id3, qty3] of Object.entries(want)) {
          if (!MARKET_ITEM_IDS.includes(id3)) {
            const friendly = displayItemName(id3);
            return componentCommit(interaction, { content: `${friendly} isn’t a market item.`, ephemeral: true });
          }

          const it = content.items?.[id3];
          if (!it) {
            const friendly = displayItemName(id3);
            return componentCommit(interaction, { content: `Unknown item: ${friendly}.`, ephemeral: true });
          }

          const price = s.market_prices?.[id3] ?? it.base_price ?? 0;
          const stock = p2.market_stock?.[id3] ?? 0;

          if (stock < qty3) {
            const friendly = displayItemName(id3);
            return componentCommit(interaction, {
              content: `Only ${stock} in stock today for **${friendly}**.`,
              ephemeral: true
            });
          }

          totalCost += price * qty3;
          buyLines.push({ id: id3, qty: qty3, name: it.name, price });
        }

        if ((p2.coins ?? 0) < totalCost) {
          return componentCommit(interaction, { content: `Not enough coins. Total is **${totalCost}c**.`, ephemeral: true });
        }

        // Apply purchase
        p2.coins -= totalCost;
        if (!p2.inv_ingredients) p2.inv_ingredients = {};

        for (const x of buyLines) {
          p2.inv_ingredients[x.id] = (p2.inv_ingredients[x.id] ?? 0) + x.qty;
          p2.market_stock[x.id] = (p2.market_stock[x.id] ?? 0) - x.qty;
        }

        advanceTutorial(p2, "buy");

        // Persist
        upsertPlayer(db, serverId, userId, p2, null, p2.schema_version);
        upsertServer(db, serverId, s, null);

        const pretty = buyLines.map((x) => `• **${x.qty}×** ${x.name} (${x.price}c ea)`).join("\n");

        const buyEmbed = buildMenuEmbed({
          title: "🛒 Purchase Complete",
          description: `Bought:\n${pretty}\n\nTotal: **${totalCost}c**.${tutorialSuffix(p2)}`,
          user: interaction.user
        });

        const replyObj = {
          content: " ",
          embeds: [buyEmbed],
          components: [noodleMainMenuRow(userId)]
        };

        putIdempotentResult(db, { key: idemKey, userId, action, ttlSeconds: 900, result: replyObj });
        
        // Edit original message if we have the messageId
        if (sourceMessageId) {
          try {
            const targetMsg = await interaction.channel.messages.fetch(sourceMessageId);
            if (targetMsg) {
              await targetMsg.edit(replyObj);
              // Acknowledge the button interaction
              await interaction.update({});
              return;
            }
          } catch (e) {
            console.log(`⚠️ Failed to edit message ${sourceMessageId}:`, e?.message);
          }
        }
        
        return componentCommit(interaction, replyObj);
      });
    }

    return componentCommit(interaction, { content: "Unknown multi-buy action.", ephemeral: true });
  }

  /* ---------------- MULTI-BUY QTY MODAL SUBMIT ---------------- */
  if (interaction.isModalSubmit?.() && interaction.customId.startsWith("noodle:multibuy:qty:")) {
    const parts2 = interaction.customId.split(":");
    // noodle:multibuy:qty:<ownerId>:<messageId>
    const owner = parts2[3];
    const sourceMessageId = parts2[4] && parts2[4] !== "none" ? parts2[4] : null;

    if (owner && owner !== interaction.user.id) {
      return componentCommit(interaction, { content: "That purchase isn’t for you.", ephemeral: true });
    }

    const cacheKey = `${interaction.user.id}:${sourceMessageId || "none"}`;
    const cacheEntry = multibuyCacheV2.get(cacheKey);
    if (!cacheEntry) {
      return componentCommit(interaction, { content: "⚠️ Selection expired. Please try again.", ephemeral: true });
    }

    if (cacheEntry.expiresAt < Date.now()) {
      multibuyCacheV2.delete(cacheKey);
      return componentCommit(interaction, { content: "⚠️ Selection expired. Please try again.", ephemeral: true });
    }

    const { selectedIds, sourceMessageId: cachedSourceMessageId } = cacheEntry;
    const sourceMessageIdFinal = cachedSourceMessageId ?? sourceMessageId;

    const raw = String(interaction.fields.getTextInputValue("lines") ?? "").trim();
    const want = {};

    for (const lineRaw of raw.split("\n")) {
      const line = lineRaw.trim();
      if (!line) continue;

      const [kRaw, vRaw] = line.split("=").map((s) => s?.trim());
      if (!kRaw || !vRaw) {
        return componentCommit(interaction, {
          content: "Use `item=qty` per line (example: `Carrots=3`).",
          ephemeral: true
        });
      }

      const qty = Number(vRaw);
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
        return componentCommit(interaction, {
          content: `Invalid qty for \`${kRaw}\`. Use 1–99.`,
          ephemeral: true
        });
      }

      const resolvedId = resolveSelectedItemId(kRaw, selectedIds, content);
      if (!resolvedId) {
        return componentCommit(interaction, {
          content: `I couldn’t match \`${kRaw}\` to one of your selected items. Try the exact item name shown in the menu.`,
          ephemeral: true
        });
      }

      want[resolvedId] = (want[resolvedId] ?? 0) + qty;
    }

    if (!Object.keys(want).length) {
      return componentCommit(interaction, { content: "No quantities provided.", ephemeral: true });
    }

    // Idempotency (prevents double submit)
    const action = "multibuy";
    const idemKey = makeIdempotencyKey({ serverId, userId, action, interactionId: interaction.id });
    const cached = getIdempotentResult(db, idemKey);
    if (cached) return componentCommit(interaction, cached);

    const ownerLock = `discord:${interaction.id}`;

    return await withLock(db, `lock:user:${userId}`, ownerLock, 8000, async () => {
      let s = ensureServer(serverId);
      let p2 = ensurePlayer(serverId, userId);

      // Refresh season + market state
      const set = buildSettingsMap(settingsCatalog, s.settings);
      s.season = computeActiveSeason(set);

      rollMarket({ serverId, content, serverState: s });
      if (!s.market_prices) s.market_prices = {};
      rollPlayerMarketStock({ userId, serverId, content, playerState: p2 });
      if (!p2.market_stock) p2.market_stock = {};

      // Validate stock + compute cost
      let totalCost = 0;
      const buyLines = [];

      for (const [id3, qty3] of Object.entries(want)) {
        if (!MARKET_ITEM_IDS.includes(id3)) {
          const friendly = displayItemName(id3);
          return componentCommit(interaction, { content: `${friendly} isn’t a market item.`, ephemeral: true });
        }

        const it = content.items?.[id3];
        if (!it) {
          const friendly = displayItemName(id3);
          return componentCommit(interaction, { content: `Unknown item: ${friendly}.`, ephemeral: true });
        }

        const price = s.market_prices?.[id3] ?? it.base_price ?? 0;
        const stock = p2.market_stock?.[id3] ?? 0;

        if (stock < qty3) {
          const friendly = displayItemName(id3);
          return componentCommit(interaction, {
            content: `Only ${stock} in stock today for **${friendly}**.`,
            ephemeral: true
          });
        }

        totalCost += price * qty3;
        buyLines.push({ id: id3, qty: qty3, name: it.name, price });
      }

      if ((p2.coins ?? 0) < totalCost) {
        return componentCommit(interaction, { content: `Not enough coins. Total is **${totalCost}c**.`, ephemeral: true });
      }

      // Apply purchase
      p2.coins -= totalCost;
      if (!p2.inv_ingredients) p2.inv_ingredients = {};

      for (const x of buyLines) {
        p2.inv_ingredients[x.id] = (p2.inv_ingredients[x.id] ?? 0) + x.qty;
        p2.market_stock[x.id] = (p2.market_stock[x.id] ?? 0) - x.qty;
      }

      advanceTutorial(p2, "buy");

      // Persist
      upsertPlayer(db, serverId, userId, p2, null, p2.schema_version);
      upsertServer(db, serverId, s, null);

      const pretty = buyLines.map((x) => `• **${x.qty}×** ${x.name} (${x.price}c ea)`).join("\n");

      const buyEmbed = buildMenuEmbed({
        title: "🛒 Purchase Complete",
        description: `Bought:\n${pretty}\n\nTotal: **${totalCost}c**.`,
        user: interaction.user
      });

      const replyObj = {
        content: " ",
        embeds: [buyEmbed],
        components: [noodleMainMenuRow(userId)],
        targetMessageId: sourceMessageIdFinal // Edit the original message
      };

      putIdempotentResult(db, { key: idemKey, userId, action, ttlSeconds: 900, result: replyObj });
      
      return componentCommit(interaction, replyObj);
    });
  }

  /* ---------------- SELL SELECT MENU ---------------- */
  if (interaction.isSelectMenu?.() && interaction.customId.startsWith("noodle:sell:select:")) {
    const owner = interaction.customId.split(":")[3];
    if (owner && owner !== interaction.user.id) {
      return componentCommit(interaction, { content: "That menu isn't for you.", ephemeral: true });
    }

    const picked = (interaction.values ?? []).slice(0, 5);
    if (!picked.length) {
      return componentCommit(interaction, { content: "Pick at least one item.", ephemeral: true });
    }

    const pickedNames = picked.map((id) => displayItemName(id));
    
    const btnRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:sell:sell1:${interaction.user.id}:${picked.join(",")}`)
        .setLabel("Sell 1 each")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`noodle:sell:qty:${interaction.user.id}:${picked.join(",")}`)
        .setLabel("Enter quantities")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`noodle:nav:sell:${interaction.user.id}`)
        .setLabel("Clear")
        .setStyle(ButtonStyle.Danger)
    );

    return componentCommit(interaction, {
      content: `💰 **Selected:** ${pickedNames.join(", ")}\nChoose how you want to sell:`,
      components: [btnRow]
    });
  }

  /* ---------------- SELL BUTTONS ---------------- */
  if (interaction.isButton?.() && interaction.customId.startsWith("noodle:sell:")) {
    const parts2 = interaction.customId.split(":");
    // noodle:sell:<mode>:<ownerId>:<id1,id2,...>
    const mode = parts2[2];
    const owner = parts2[3];
    const idsPart = parts2.slice(4).join(":");
    const selectedIds = idsPart.split(",").filter(Boolean).slice(0, 5);

    if (owner && owner !== interaction.user.id) {
      return componentCommit(interaction, { content: "That menu isn't for you.", ephemeral: true });
    }

    if (!selectedIds.length) {
      return componentCommit(interaction, { content: "No items selected.", ephemeral: true });
    }

    // Enter quantities -> show modal
    if (mode === "qty") {
      if (interaction.deferred || interaction.replied) {
        return componentCommit(interaction, { content: "That menu expired, tap again.", ephemeral: true });
      }

      const modal = new ModalBuilder()
        .setCustomId(`noodle:sell:qty:${interaction.user.id}:${selectedIds.join(",")}`)
        .setTitle("Sell quantities");

      const pickedNames = selectedIds.map((id) => content.items?.[id]?.name ?? displayItemName(id));

      const input = new TextInputBuilder()
        .setCustomId("lines")
        .setLabel("One per line: item=qty (Carrots=3)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setPlaceholder(pickedNames.map((n) => `${n}=1`).join("\n"));

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      
      try {
        return await interaction.showModal(modal);
      } catch (e) {
        console.log(`⚠️ showModal failed for sell:`, e?.message);
        return componentCommit(interaction, { 
          content: "⚠️ Discord couldn't show the modal. Try using `/noodle sell` with individual items instead.", 
          ephemeral: true 
        });
      }
    }

    // Sell 1 each
    if (mode === "sell1") {
      const action = "sell";
      const idemKey = makeIdempotencyKey({ serverId, userId, action, interactionId: interaction.id });
      const cached = getIdempotentResult(db, idemKey);
      if (cached) return componentCommit(interaction, cached);

      const owner2 = `discord:${interaction.id}`;
      return await withLock(db, `lock:user:${userId}`, owner2, 8000, async () => {
        let s = ensureServer(serverId);
        let p2 = ensurePlayer(serverId, userId);

        const sellLines = [];
        let totalGain = 0;

        for (const id of selectedIds) {
          const it = content.items[id];
          if (!it) continue;
          
          const owned = p2.inv_ingredients?.[id] ?? 0;
          if (owned < 1) continue;

          const unit = sellPrice(s, id);
          const gain = unit * 1;

          p2.inv_ingredients[id] = owned - 1;
          p2.coins += gain;
          p2.lifetime.coins_earned += gain;
          totalGain += gain;

          sellLines.push({ id, name: it.name, qty: 1, price: unit });
        }

        if (!sellLines.length) {
          return componentCommit(interaction, {
            content: "❌ You don't have any of those items to sell.",
            ephemeral: true
          });
        }

        upsertPlayer(db, serverId, userId, p2, null, p2.schema_version);

        const pretty = sellLines.map((x) => `• **${x.qty}× ** ${x.name} (${x.price}c ea)`).join("\n");

        const replyObj = {
          content: `💰 Sold:\n${pretty}\n\nTotal: **${totalGain}c**.`,
          components: [noodleMainMenuRow(userId)]
        };

        putIdempotentResult(db, { key: idemKey, userId, action, ttlSeconds: 900, result: replyObj });
        return componentCommit(interaction, replyObj);
      });
    }
  }

  /* ---------------- SELL QTY MODAL SUBMIT ---------------- */
  if (interaction.isModalSubmit?.() && interaction.customId.startsWith("noodle:sell:qty:")) {
    const parts3 = interaction.customId.split(":");
    const owner = parts3[3];
    const idsPart = parts3.slice(4).join(":");
    const selectedIds = idsPart.split(",").filter(Boolean).slice(0, 5);

    if (owner && owner !== interaction.user.id) {
      return componentCommit(interaction, { content: "That modal isn't for you.", ephemeral: true });
    }

    const rawInput = interaction.fields.getTextInputValue("lines");
    const lines = rawInput.split("\n").filter(Boolean);

    const action = "sell";
    const idemKey = makeIdempotencyKey({ serverId, userId, action, interactionId: interaction.id });
    const cached = getIdempotentResult(db, idemKey);
    if (cached) return componentCommit(interaction, cached);

    const owner2 = `discord:${interaction.id}`;
    return await withLock(db, `lock:user:${userId}`, owner2, 8000, async () => {
      let s = ensureServer(serverId);
      let p2 = ensurePlayer(serverId, userId);

      const sellLines = [];
      const errors = [];
      let totalGain = 0;

      for (const line of lines) {
        const match = line.match(/^(.+?)=(\d+)$/);
        if (!match) {
          errors.push(`Invalid format: "${line}"`);
          continue;
        }

        const [, itemStr, qtyStr] = match;
        const qty = parseInt(qtyStr, 10);
        if (!qty || qty <= 0) {
          errors.push(`Invalid quantity for "${itemStr}"`);
          continue;
        }

        const resolvedId = resolveSelectedItemId(itemStr, selectedIds, content);
        if (!resolvedId) {
          errors.push(`Couldn't find "${itemStr}" in your selection`);
          continue;
        }

        const it = content.items[resolvedId];
        if (!it) {
          errors.push(`Item doesn't exist: ${resolvedId}`);
          continue;
        }

        const owned = p2.inv_ingredients?.[resolvedId] ?? 0;
        if (owned < qty) {
          errors.push(`Not enough ${it.name} (have ${owned}, want ${qty})`);
          continue;
        }

        const unit = sellPrice(s, resolvedId);
        const gain = unit * qty;

        p2.inv_ingredients[resolvedId] = owned - qty;
        p2.coins += gain;
        p2.lifetime.coins_earned += gain;
        totalGain += gain;

        sellLines.push({ id: resolvedId, name: it.name, qty, price: unit });
      }

      if (!sellLines.length) {
        const errMsg = errors.length ? `Errors:\n${errors.slice(0, 3).join("\n")}` : "No valid items to sell.";
        return componentCommit(interaction, { content: `❌ ${errMsg}`, ephemeral: true });
      }

      upsertPlayer(db, serverId, userId, p2, null, p2.schema_version);

      const pretty = sellLines.map((x) => `• **${x.qty}× ** ${x.name} (${x.price}c ea)`).join("\n");
      const errSuffix = errors.length ? `\n\n⚠️ Some items had errors (${errors.length})` : "";

      const replyObj = {
        content: `💰 Sold:\n${pretty}\n\nTotal: **${totalGain}c**.${errSuffix}`,
        components: [noodleMainMenuRow(userId)]
      };

      putIdempotentResult(db, { key: idemKey, userId, action, ttlSeconds: 900, result: replyObj });
      return componentCommit(interaction, replyObj);
    });
  }

  /* ---------------- FALLTHROUGH ---------------- */
  return componentCommit(interaction, { content: "Unknown component interaction.", ephemeral: true });
}

/* ------------------------------------------------------------------ */
/*  Slash command export                                               */
/* ------------------------------------------------------------------ */

export const noodleCommand = {
  data: new SlashCommandBuilder()
    .setName("noodle")
    .setDescription("Run your cozy noodle shop.")
    .addSubcommand((sc) => sc.setName("start").setDescription("Tutorial: Start your noodle story."))
    .addSubcommand((sc) =>
      sc
        .setName("help")
        .setDescription("Help topics")
        .addStringOption((o) => o.setName("topic").setDescription("Topic").setRequired(false))
    )
    .addSubcommand((sc) =>
      sc
        .setName("profile")
        .setDescription("View a shop profile")
        .addUserOption((o) => o.setName("user").setDescription("User").setRequired(false))
    )
    .addSubcommand((sc) => sc.setName("season").setDescription("Show the current season."))
    .addSubcommand((sc) => sc.setName("pantry").setDescription("View your ingredient pantry."))
    .addSubcommand((sc) => sc.setName("status").setDescription("Show reset timestamps (debug info)."))
    .addSubcommand((sc) => sc.setName("event").setDescription("Show the current event (if any)."))
    .addSubcommandGroup((group) =>
      group
        .setName("dev")
        .setDescription("Developer tools.")
        .addSubcommand((sc) =>
          sc
            .setName("reset_tutorial")
            .setDescription("Reset a user’s tutorial progress.")
            .addUserOption((o) => o.setName("user").setDescription("User to reset").setRequired(true))
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName("buy")
        .setDescription("Buy an item from the market (leave blank for multi-buy).")
        .addStringOption((o) =>
          o.setName("item").setDescription("Market item (type to search)").setRequired(false).setAutocomplete(true)
        )
        .addIntegerOption((o) => o.setName("quantity").setDescription("Qty (used for single buy)").setRequired(false).setMinValue(1))
    )
    .addSubcommand((sc) =>
      sc
        .setName("sell")
        .setDescription("Sell an item to the market.")
        .addStringOption((o) => o.setName("item").setDescription("Market item (type to search)").setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName("quantity").setDescription("Qty").setRequired(true).setMinValue(1))
    )
    .addSubcommand((sc) => sc.setName("orders").setDescription("View today’s orders."))
    .addSubcommand((sc) =>
      sc
        .setName("accept")
        .setDescription("Accept an order.")
        .addStringOption((o) => o.setName("order_id").setDescription("Order ID").setRequired(true))
    )
    .addSubcommand((sc) =>
      sc
        .setName("cancel")
        .setDescription("Cancel an accepted order.")
        .addStringOption((o) => o.setName("order_id").setDescription("Order ID").setRequired(true))
    )
    .addSubcommand((sc) =>
      sc
        .setName("cook")
        .setDescription("Cook a noodle recipe.")
        .addStringOption((o) => o.setName("recipe").setDescription("Recipe (type to search)").setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName("quantity").setDescription("Qty").setRequired(true).setMinValue(1))
    )
    .addSubcommand((sc) =>
      sc
        .setName("serve")
        .setDescription("Serve your accepted order.")
        .addStringOption((o) => o.setName("order_id").setDescription("Order ID").setRequired(true))
        .addStringOption((o) => o.setName("bowl_key").setDescription("Bowl key (optional; defaults to recipe)").setRequired(false))
    )
    .addSubcommand((sc) =>
      sc
        .setName("forage")
        .setDescription("Forage for fresh ingredients.")
        .addStringOption((o) => o.setName("item").setDescription("What to forage for (type to search)").setRequired(false).setAutocomplete(true))
        .addIntegerOption((o) => o.setName("quantity").setDescription("Quantity (1-5)").setRequired(false).setMinValue(1).setMaxValue(5))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup(false);
    return runNoodle(interaction, { sub, group });
  },

  async handleComponent(interaction) {
    return handleComponent(interaction);
  }
};

export { noodleMainMenuRow, noodleMainMenuRowNoProfile, displayItemName };

