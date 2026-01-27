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
import { openDb, getPlayer, upsertPlayer, getServer, upsertServer } from "../db/index.js";
import { withLock } from "../infra/locks.js";
import { makeIdempotencyKey, getIdempotentResult, putIdempotentResult } from "../infra/idempotency.js";
import { newPlayerProfile } from "../game/player.js";
import { newServerState } from "../game/server.js";
import { computeActiveSeason } from "../game/seasons.js";
import { rollMarket, sellPrice, MARKET_ITEM_IDS } from "../game/market.js";
import { ensureDailyOrders } from "../game/orders.js";
import { computeServeRewards, applySxpLevelUp } from "../game/serve.js";
import { nowTs } from "../util/time.js";
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

function noodleMainMenuRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:orders:${userId}`).setLabel("📋 Orders").setStyle(ButtonStyle.Primary),
new ButtonBuilder().setCustomId(`noodle:nav:buy:${userId}`).setLabel("🛒 Buy").setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:forage:${userId}`).setLabel("🌿 Forage").setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:profile:${userId}`).setLabel("🍜 Profile").setStyle(ButtonStyle.Secondary)
);
}

function noodleSecondaryMenuRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:season:${userId}`).setLabel("🍂 Season").setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:event:${userId}`).setLabel("🎪 Event").setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:help:${userId}`).setLabel("❓ Help").setStyle(ButtonStyle.Secondary)
);
}

function noodleOrdersActionRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:pick:accept:${userId}`).setLabel("✅ Accept").setStyle(ButtonStyle.Success),
new ButtonBuilder().setCustomId(`noodle:pick:cook:${userId}`).setLabel("🍲 Cook").setStyle(ButtonStyle.Primary),
new ButtonBuilder().setCustomId(`noodle:pick:serve:${userId}`).setLabel("🍜 Serve").setStyle(ButtonStyle.Primary)
);
}

function noodleOrdersMenuActionRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:pick:accept:${userId}`).setLabel("✅ Accept").setStyle(ButtonStyle.Success),
new ButtonBuilder().setCustomId(`noodle:pick:cook:${userId}`).setLabel("🍲 Cook").setStyle(ButtonStyle.Primary),
new ButtonBuilder().setCustomId(`noodle:pick:serve:${userId}`).setLabel("🍜 Serve").setStyle(ButtonStyle.Primary),
new ButtonBuilder().setCustomId(`noodle:pick:cancel:${userId}`).setLabel("❌ Cancel").setStyle(ButtonStyle.Danger)
);
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

function renderProfileEmbed(player, displayName) {
const embed = new EmbedBuilder()
.setTitle(`🍜 ${player.profile.shop_name}`)
.setDescription(`*${player.profile.tagline}*`)
.addFields(
{ name: "⭐ Bowls Served", value: String(player.lifetime.bowls_served_total), inline: true },
{ name: "Level", value: String(player.shop_level), inline: true },
{ name: "REP", value: String(player.rep), inline: true },
{ name: "Coins", value: `${player.coins}c`, inline: true }
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

// Add ingredients inventory
if (player.inv_ingredients && Object.keys(player.inv_ingredients).length > 0) {
  // Aggregate quantities by display name to avoid duplicates (e.g., soy_broth vs Soy Broth)
  const agg = new Map();
  for (const [id, qty] of Object.entries(player.inv_ingredients)) {
    if (!qty || qty <= 0) continue; // skip zeros
    const name = displayItemName(id);
    const key = name.toLowerCase();
    const cur = agg.get(key) ?? { name, qty: 0 };
    cur.qty += qty;
    agg.set(key, cur);
  }

  const ingLines = [...agg.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ name, qty }) => `• **${name}**: ${qty}`)
    .join("\n");

  if (ingLines) embed.addFields({ name: "🥕 Ingredients", value: ingLines, inline: false });
}

embed.setFooter({ text: `Owner: ${displayName}` });
return embed;
}

function resetTutorialState(player) {
player.tutorial = null;
ensureTutorial(player);
}

function completeUserReset(player) {
// Reset tutorial
player.tutorial = null;
ensureTutorial(player);

// Clear inventory
player.inv_ingredients = {};
player.inv_bowls = {};

// Reset progress
player.orders = { accepted: {}, seasonal_served_today: 0, epic_served_today: 0 };
player.daily = { last_claimed_at: null, streak_days: 0, streak_last_day: null };
player.quests = { active: {}, completed: [], claimed: [] };
player.buffs = { rep_aura_expires_at: null, apprentice_bonus_pending: false, last_recipe_served: null, fail_streak: 0 };
player.cooldowns = {};
player.clues_owned = {};
player.scrolls_owned = {};
}

function tutorialSuffix(player) {
const step = getCurrentTutorialStep(player);
const msg = formatTutorialMessage(step);
return msg ? `\n\n${msg}` : "";
}

function getUnlockedIngredientIds(player, contentBundle) {
const out = new Set();
const known = Array.isArray(player?.known_recipes) ? player.known_recipes : [];

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

const lines = (r.ingredients ?? []).map((ing) => {
const need = ing.qty ?? 0;
const have = player.inv_ingredients?.[ing.item_id] ?? 0;

const itemName = contentBundle.items?.[ing.item_id]?.name ?? ing.item_id;
const ok = have >= need;

const marker = ok ? "✅" : "🧺";
const shortage = ok ? "" : ` (need ${need - have} more)`;

return `${marker} **${itemName}** — need **${need}**, you have **${have}**${shortage}`;

});

return ["🧾 **Ingredients needed:**", ...lines].join("\n");
}

function sweepExpiredAcceptedOrders(p, _s, contentBundle, nowMs) {
const accepted = p?.orders?.accepted ?? {};
const expiredIds = [];

for (const [fullId, entry] of Object.entries(accepted)) {
const exp = entry?.expires_at ?? null;
if (exp && nowMs > exp) expiredIds.push(fullId);
}

if (!expiredIds.length) return { expiredIds: [], warning: "" };

// Capture snapshots BEFORE delete
const snaps = expiredIds.map((id) => {
const entry = accepted[id];
return { id, order: entry?.order ?? null };
});

for (const id of expiredIds) delete accepted[id];

const lines = snaps.slice(0, 8).map(({ id, order }) => {
const rName = order ? (contentBundle.recipes[order.recipe_id]?.name ?? order.recipe_id) : null;
const npcName = order ? (contentBundle.npcs[order.npc_archetype]?.name ?? order.npc_archetype) : null;

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
const { ephemeral, ...rest } = payload ?? {};
// Default: non-ephemeral UNLESS explicitly marked as ephemeral
// If payload has components (select menus, etc), don't make it ephemeral unless explicitly requested
const shouldBeEphemeral = ephemeral === true && !rest.components;
const options = shouldBeEphemeral ? { ...rest, flags: MessageFlags.Ephemeral } : { ...rest };

// Modal submits: deferred in index.js, so use editReply
if (interaction.isModalSubmit?.()) {
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

// Use editReply for components that were deferred, or followUp for ephemeral  
if (interaction.deferred || interaction.replied) {
  if (shouldBeEphemeral === true) {
    try {
      return await interaction.followUp(finalOptions);
    } catch (e) {
      console.log(`⚠️ Component followUp failed:`, e?.message);
      return;
    }
  }
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
  return await interaction.reply(finalOptions);
} catch (e) {
  console.log(`⚠️ Component reply failed:`, e?.message);
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
if (!s.market_stock) s.market_stock = {};

const allowed = getUnlockedIngredientIds(p, content);

const opts = (MARKET_ITEM_IDS ?? [])
.map((id) => {
if (!allowed.has(id)) return null;

  const it = content.items?.[id];
  if (!it) return null;

  const price = s.market_prices?.[id] ?? it.base_price ?? 0;
  const stock = s.market_stock?.[id] ?? 0;
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
components: [noodleMainMenuRow(userId), noodleSecondaryMenuRow(userId)],
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
content:
"🛒 **Multi-buy**\n" +
"Select up to **5** items.\n" +
"When you’re done selecting, if on Desktop, press **Esc** to continue.",
components: [new ActionRowBuilder().addComponents(menu)]
});
}

function buildMultiBuyButtonsRow(userId, selectedIds) {
const pickedNames = selectedIds.map((id) => content.items?.[id]?.name ?? id);
const btnRow = new ActionRowBuilder().addComponents(
new ButtonBuilder()
.setCustomId(`noodle:multibuy:buy1:${userId}:${selectedIds.join(",")}`)
.setLabel("Buy 1 each")
.setStyle(ButtonStyle.Success),
new ButtonBuilder()
.setCustomId(`noodle:multibuy:qty:${userId}:${selectedIds.join(",")}`)
.setLabel("Enter quantities")
.setStyle(ButtonStyle.Secondary),
new ButtonBuilder()
.setCustomId(`noodle:multibuy:clear:${userId}:${selectedIds.join(",")}`)
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

// Defer immediately for slash commands (chat input) to prevent timeout
// DON'T defer for components - they're already deferred in index.js
if ((interaction.isChatInputCommand?.() || interaction.isCommand?.()) && !interaction.deferred && !interaction.replied) {
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
const options = ephemeral ? { ...rest, flags: MessageFlags.Ephemeral } : { ...rest };
// If deferred, use editReply. Otherwise use reply (shouldn't happen but safety)
if (interaction.deferred || interaction.replied) return interaction.editReply(rest);
return interaction.reply(options);
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

  return withLock(db, `lock:user:${target.id}`, owner, 8000, async () => {
    const p = ensurePlayer(serverId, target.id);
    completeUserReset(p);
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
  return withLock(db, `lock:user:${userId}`, owner, 8000, async () => {
    const p = ensurePlayer(serverId, userId);
    const embed = renderProfileEmbed(p, interaction.user.displayName);
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
  const embed = renderProfileEmbed(p, u.displayName);

  return commit({
    embeds: [embed],
    components: [noodleMainMenuRow(userId)]
  });
}

/* ---------------- SEASON ---------------- */
if (sub === "season") {
  return commit({
    content: `🌿 The world is currently in **${server.season}**.`,
    components: [noodleMainMenuRow(userId)]
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
const cached = getIdempotentResult(db, idemKey);
if (cached) return commit(cached);

return withLock(db, `lock:user:${userId}`, owner, 8000, async () => {
  let p = ensurePlayer(serverId, userId);
  let s = ensureServer(serverId);

  const now = nowTs();
  const sweep = sweepExpiredAcceptedOrders(p, s, content, now);

  const set = buildSettingsMap(settingsCatalog, s.settings);
  s.season = computeActiveSeason(set);
  rollMarket({ serverId, content, serverState: s });
  if (!s.market_prices) s.market_prices = {};
  if (!s.market_stock) s.market_stock = {};

  const pool = new Set(p.known_recipes);
  ensureDailyOrders(s, set, content, pool, serverId);

  const commitState = async (replyObj) => {
    upsertPlayer(db, serverId, userId, p, null, p.schema_version);
    upsertServer(db, serverId, s, null);

    const out = {
      ...replyObj,
      components: replyObj.components ?? [noodleMainMenuRow(userId), noodleSecondaryMenuRow(userId)]
    };

    putIdempotentResult(db, { key: idemKey, userId, action, ttlSeconds: 900, result: out });
    return commit(out);
  };

  /* ---------------- FORAGE ---------------- */
  if (sub === "forage") {
    const cooldownMs = 5 * 60 * 1000;
    const chk = canForage(p, now, cooldownMs);

    if (!chk.ok) {
      const msLeft = chk.nextAt - now;
      const mins = Math.ceil(msLeft / 60000);
      return commitState({
        content: `🌿 You’ve foraged recently. Try again in **~${mins} min**.`,
        ephemeral: true
      });
    }

    const itemId = opt.getString("item") ?? null;
    const qtyRaw = opt.getInteger("quantity") ?? 1;
    const quantity = Math.max(1, Math.min(5, qtyRaw));

    const allowed = getUnlockedIngredientIds(p, content);
    const allowedForage = new Set((FORAGE_ITEM_IDS ?? []).filter((id) => allowed.has(id)));

    if (itemId && !allowedForage.has(itemId)) {
      return commitState({
        content: "You can only forage ingredients used by recipes you’ve unlocked.",
        ephemeral: true
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
          content: "🌿 You haven’t unlocked any forageable ingredients yet. Unlock a recipe first!",
          ephemeral: true
        });
      }

      const suggestions = unlockedForageIds
        .map((id) => `\`${content.items?.[id]?.name ?? id}\``)
        .join(", ");

      return commitState({
        content: `That isn’t a valid forage item for your unlocked recipes. Try one of: ${suggestions}`,
        ephemeral: true
      });
    }

    applyDropsToInventory(p, drops);
    setForageCooldown(p, now);
    advanceTutorial(p, "forage");

    const lines = Object.entries(drops).map(
      ([id, q]) => `• **${q}×** ${content.items[id]?.name ?? id}`
    );

    const header = itemId
      ? `🌿 You search carefully and gather:\n`
      : `🌿 You wander into the nearby grove and return with:\n`;

    return commitState({
      content: `${header}${lines.join("\n")}${tutorialSuffix(p)}`
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
          const stock = s.market_stock?.[id] ?? 0;
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

      return commit({
        content:
          "🛒 **Multi-buy**\n" +
          "1) Select up to **5** items\n" +
          "2) When you’re done selecting, if on Desktop, press **Esc** to continue\n" +
          "3) Then choose **Buy 1 each** or **Enter quantities**",
        components: [new ActionRowBuilder().addComponents(menu)]
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

    const price = s.market_prices?.[itemId] ?? item.base_price;
    const stock = s.market_stock?.[itemId] ?? 0;
    const cost = price * qty;

    if (stock < qty) {
      const friendly = displayItemName(itemId);
      return commitState({ content: `Only ${stock} in stock today for **${friendly}**.`, ephemeral: true });
    }
    if (p.coins < cost) return commitState({ content: "Not enough coins for that purchase.", ephemeral: true });

    p.coins -= cost;
    p.inv_ingredients[itemId] = (p.inv_ingredients[itemId] ?? 0) + qty;
    s.market_stock[itemId] = stock - qty;

    advanceTutorial(p, "buy");

    return commitState({
      content: `🛒 Bought **${qty}× ${item.name}** for **${cost}c**.${tutorialSuffix(p)}`
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
    if (!p.known_recipes.includes(recipeId)) return commitState({ content: "You don’t know that recipe yet.", ephemeral: true });
    if (!qty || qty <= 0) return commitState({ content: "Pick a positive quantity.", ephemeral: true });

    for (const ing of r.ingredients) {
      const haveIng = p.inv_ingredients?.[ing.item_id] ?? 0;
      if (haveIng < ing.qty * qty) {
        return commitState({
          content: `You’re missing **${content.items[ing.item_id]?.name ?? ing.item_id}**.`,
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
    p.lifetime.recipes_cooked += 1;

    return commitState({
      content: [
        `🍲 You cooked **${qty}× ${r.name}**.`,
        `You now have **${have}** bowl(s) ready.`,
        tutorialSuffix(p)
      ].filter(Boolean).join("\n"),
      components: [noodleOrdersActionRow(userId)]
    });
  }

  /* ---------------- ORDERS ---------------- */
  if (sub === "orders") {
    const now2 = nowTs();
    const sweep2 = sweepExpiredAcceptedOrders(p, s, content, now2);

    const acceptedEntries = Object.entries(p.orders?.accepted ?? {});
    const acceptedLines = acceptedEntries.map(([fullId, a]) => {
      const snap = a?.order ?? null;

      let timeLeft = "";
      if (a?.expires_at) {
        const msLeft = a.expires_at - now2;
        if (msLeft <= 0) timeLeft = " *(expired)*";
        else timeLeft = ` *(~${Math.ceil(msLeft / 60000)} min left)*`;
      } else timeLeft = " *(no rush)*";

      const order =
        snap ??
        (s.order_board ?? []).find((o) => o.order_id === fullId) ??
        null;

      if (!order) return `✅ \`${shortOrderId(fullId)}\`${timeLeft}`;

      const npcName = content.npcs[order.npc_archetype]?.name ?? order.npc_archetype;
      const rName = content.recipes[order.recipe_id]?.name ?? order.recipe_id;
      const lt = order.is_limited_time ? "⏳" : "•";

      return `✅ \`${shortOrderId(fullId)}\` ${lt} **${rName}** — *${npcName}* (${order.tier})${timeLeft}`;
    });

    const boardLines = (s.order_board ?? []).slice(0, 16).map((o) => {
      const npcName = content.npcs[o.npc_archetype]?.name ?? o.npc_archetype;
      const rName = content.recipes[o.recipe_id]?.name ?? o.recipe_id;
      const lt = o.is_limited_time ? "⏳" : "•";
      return `${lt} \`${shortOrderId(o.order_id)}\` **${rName}** — *${npcName}* (${o.tier})`;
    });

    const parts = [];
    if (sweep2.warning) parts.push(sweep2.warning, "");

    if (acceptedLines.length) {
      parts.push(
        "✅ **Your Accepted Orders** *(serve/cancel with buttons below or slash commands)*",
        acceptedLines.join("\n"),
        ""
      );
    } else {
      parts.push("✅ **Your Accepted Orders**", "_None right now._", "");
    }

    parts.push(
      "📋 **Today’s Orders**",
      boardLines.length ? boardLines.join("\n") : "No orders available right now."
    );

    return commitState({
      content: parts.join("\n"),
      components: [noodleOrdersMenuActionRow(userId)]
    });
  }

  /* ---------------- ACCEPT -------- */
  if (sub === "accept") {
    const input = String(opt.getString("order_id") ?? "").trim().toUpperCase();

    const order = (s.order_board ?? []).find((o) => {
      const full = String(o.order_id).toUpperCase();
      const short = shortOrderId(o.order_id);
      return full === input || short === input;
    });

    if (!order) return commitState({ content: "That order isn’t on today’s board.", ephemeral: true });

    const cap = 2;
    const acceptedCount = Object.keys(p.orders?.accepted ?? {}).length;
    if (acceptedCount >= cap) {
      return commitState({ content: `You can only hold ${cap} active orders right now.`, ephemeral: true });
    }

    if (!p.orders) p.orders = { accepted: {}, seasonal_served_today: 0, epic_served_today: 0 };
    if (!p.orders.accepted) p.orders.accepted = {};

    if (p.orders.accepted[order.order_id]) {
      return commitState({ content: "You’ve already accepted that order.", ephemeral: true });
    }

    const acceptedAt = nowTs();
    const expiresAt = order.is_limited_time
      ? acceptedAt + ((order.speed_window_seconds ?? 180) * 1000)
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
        speed_window_seconds: order.speed_window_seconds
      }
    };

    advanceTutorial(p, "accept");

    const shown = shortOrderId(order.order_id);
    const rName = content.recipes[order.recipe_id]?.name ?? order.recipe_id;

    const needs = formatRecipeNeeds({ recipeId: order.recipe_id, content, player: p });
    
    // Check if player already has a cooked bowl for this recipe
    const hasBowl = p.inv_bowls?.[order.recipe_id];
    const statusMsg = hasBowl
      ? `🍲 You have **${hasBowl.qty}** cooked bowl${hasBowl.qty > 1 ? "s" : ""}! Ready to serve.`
      : needs;

    const timeNote = expiresAt
      ? `
⏳ Limited-time: **~${Math.ceil((expiresAt - acceptedAt) / 60000)} min** to serve.`
      : `
🌿 No rush, this order won't expire.`;

    return commitState({
      content:
        `✅ Accepted order \`${shown}\` — **${rName}**.${timeNote}\n\n${statusMsg}\n${tutorialSuffix(p)}`,
      components: [noodleOrdersActionRow(userId), noodleMainMenuRow(userId)]
    });
  }

  /* ---------------- CANCEL ---------------- */
  if (sub === "cancel") {
    const input = String(opt.getString("order_id") ?? "").trim().toUpperCase();

    if (!p.orders) p.orders = { accepted: {}, seasonal_served_today: 0, epic_served_today: 0 };
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

    const rName = orderSnap ? (content.recipes[orderSnap.recipe_id]?.name ?? orderSnap.recipe_id) : null;
    const npcName = orderSnap ? (content.npcs[orderSnap.npc_archetype]?.name ?? orderSnap.npc_archetype) : null;

    delete accepted[fullId];

    return commitState({
      content: `❌ Canceled order \`${shortOrderId(fullId)}\`${rName ? ` — **${rName}**` : ""}${npcName ? ` for *${npcName}*` : ""}.`
    });
  }

  /* ---------------- SERVE ---------------- */
  if (sub === "serve") {
    const input = String(opt.getString("order_id") ?? "").trim().toUpperCase();
    const bowlKey = opt.getString("bowl_key") ?? null;

    const acceptedEntries = Object.entries(p.orders?.accepted ?? {});
    const match = acceptedEntries.find(([fullId]) => {
      const full = String(fullId).toUpperCase();
      const short = shortOrderId(fullId);
      return full === input || short === input;
    });

    if (!match) return commitState({ content: "You haven’t accepted that order.", ephemeral: true });

    const [fullOrderId, accepted] = match;

    const now3 = nowTs();
    if (accepted.expires_at && now3 > accepted.expires_at) {
      delete p.orders.accepted[fullOrderId];
      return commitState({
        content: `⏳ That accepted order \`${shortOrderId(fullOrderId)}\` expired.`,
        ephemeral: true
      });
    }

    const live = (s.order_board ?? []).find((o) => o.order_id === fullOrderId);
    const order = live ?? accepted.order;

    if (!order) {
      delete p.orders.accepted[fullOrderId];
      return commitState({ content: "That order can’t be found anymore.", ephemeral: true });
    }

    const key = bowlKey ?? order.recipe_id;
    const bowl = p.inv_bowls?.[key];

    if (!bowl || bowl.qty <= 0) return commitState({ content: `You don’t have a bowl ready for \`${key}\`.`, ephemeral: true });
    if (bowl.recipe_id !== order.recipe_id) return commitState({ content: "That bowl doesn’t match the order’s recipe.", ephemeral: true });

    const servedAt = nowTs();
    const rewards = computeServeRewards({
      serverId,
      tier: order.tier,
      npcArchetype: order.npc_archetype,
      isLimitedTime: order.is_limited_time,
      servedAtMs: servedAt,
      acceptedAtMs: accepted.accepted_at,
      speedWindowSeconds: order.speed_window_seconds
    });

    bowl.qty -= 1;
    if (bowl.qty <= 0) delete p.inv_bowls[key];

    delete p.orders.accepted[fullOrderId];

    p.coins += rewards.coins;
    p.rep += rewards.rep;
    p.sxp_total += rewards.sxp;
    p.sxp_progress += rewards.sxp;

    const leveled = applySxpLevelUp(p);

    p.lifetime.orders_served += 1;
    p.lifetime.bowls_served_total += 1;
    p.lifetime.coins_earned += rewards.coins;
    if (order.is_limited_time) p.lifetime.limited_time_served += 1;
    if (order.is_limited_time && (servedAt - accepted.accepted_at) <= (order.speed_window_seconds * 1000)) {
      p.lifetime.perfect_speed_serves += 1;
    }
    p.lifetime.npc_seen[order.npc_archetype] = true;

    const msg = [
      `🍜 Served **${content.recipes[order.recipe_id]?.name ?? order.recipe_id}** to *${content.npcs[order.npc_archetype]?.name ?? order.npc_archetype}*.`,
      `Rewards: **+${rewards.coins}c**, **+${rewards.sxp} SXP**, **+${rewards.rep} REP**.`,
      leveled ? `✨ Level up! You’re now **Level ${p.shop_level}**.` : null
    ].filter(Boolean).join("\n");

    const tut = advanceTutorial(p, "serve");
    const suffix = tut.finished ? `\n\n${formatTutorialCompletionMessage()}` : `${tutorialSuffix(p)}`;

    const components = [noodleOrdersActionRow(userId), noodleMainMenuRow(userId)];
    const embeds = tut.finished ? [renderProfileEmbed(p, interaction.user.displayName)] : [];

    return commitState({ content: `${msg}${suffix}`, components, embeds });
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

/* ---------------- NAV BUTTONS ---------------- */
if (kind === "nav") {
const sub = action;
return runNoodle(interaction, { sub, group: null, overrides: {} });
}

/* ---------------- QUICK PICKERS (BUTTONS ONLY) ---------------- */
// Skip modals - they're handled separately below
if (kind === "pick" && !action.endsWith("_select") && !interaction.isModalSubmit?.()) {
// noodle:pick:<what>:<ownerId>
if (action === "accept") {
const s = ensureServer(serverId);
const set = buildSettingsMap(settingsCatalog, s.settings);
s.season = computeActiveSeason(set);
rollMarket({ serverId, content, serverState: s });

  const opts = (s.order_board ?? []).slice(0, 25).map((o) => {
    const rName = content.recipes[o.recipe_id]?.name ?? o.recipe_id;
    const npcName = content.npcs[o.npc_archetype]?.name ?? o.npc_archetype;
    const labelRaw = `${shortOrderId(o.order_id)} — ${rName} (${npcName})`;
    const label = labelRaw.length > 100 ? labelRaw.slice(0, 97) + "…" : labelRaw;
    const value = String(o.order_id);

    return { label, value };
  });

  if (!opts.length) return componentCommit(interaction, { content: "No orders available to accept.", ephemeral: true });


  const menu = new StringSelectMenuBuilder()
    .setCustomId(`noodle:pick:accept_select:${userId}`)
    .setPlaceholder("Select an order to accept")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(opts);

  return componentCommit(interaction, {
    content: "Select an order to accept:",
    components: [new ActionRowBuilder().addComponents(menu), noodleOrdersActionRow(userId)]
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
    .setPlaceholder(action === "serve" ? "Select an order to serve" : "Select an order to cancel")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(opts);

  return componentCommit(interaction, {
    content: action === "serve" ? "Select an accepted order to serve:" : "Select an accepted order to cancel:",
    components: [new ActionRowBuilder().addComponents(menu), noodleOrdersActionRow(userId)]
  });
}

if (action === "cook") {
  // select a recipe from known_recipes, then modal for qty
  const p = ensurePlayer(serverId, userId);
  const known = Array.isArray(p.known_recipes) ? p.known_recipes : [];
  const opts = known.slice(0, 25).map((rid) => {
    const r = content.recipes?.[rid];
    const labelRaw = r ? `${r.name} (${r.tier})` : rid;
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

  return componentCommit(interaction, {
    content: "Select a recipe to cook:",
    components: [new ActionRowBuilder().addComponents(menu), noodleOrdersActionRow(userId)]
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
  const orderId = interaction.values?.[0];
  return runNoodle(interaction, {
    sub: "accept",
    overrides: { strings: { order_id: orderId } }
  });
}

// cancel picker
if (cid.startsWith("noodle:pick:cancel_select:")) {
  const orderId = interaction.values?.[0];
  return runNoodle(interaction, {
    sub: "cancel",
    overrides: { strings: { order_id: orderId } }
  });
}

// serve picker
if (cid.startsWith("noodle:pick:serve_select:")) {
  const orderId = interaction.values?.[0];
  return runNoodle(interaction, {
    sub: "serve",
    overrides: { strings: { order_id: orderId } }
  });
}

// cook picker -> open qty modal
if (cid.startsWith("noodle:pick:cook_select:")) {
  const recipeId = interaction.values?.[0];

  if (interaction.deferred || interaction.replied) {
    return componentCommit(interaction, { content: "That menu expired, tap again.", ephemeral: true });
  }

  const modal = new ModalBuilder()
    .setCustomId(`noodle:pick:cook_qty:${userId}:${recipeId}`)
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
    // noodle:pick:cook_qty:<ownerId>:<recipeId>
    const owner = parts2[3];
    const recipeId = parts2.slice(4).join(":"); // recipeId safe (no ':' expected but safe)

    if (owner && owner !== interaction.user.id) {
      return componentCommit(interaction, { content: "That cooking prompt isn’t for you.", ephemeral: true });
    }

    const rawQty = String(interaction.fields.getTextInputValue("qty") ?? "").trim();
    const qty = Number(rawQty);

    if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
      return componentCommit(interaction, { content: "Enter a whole number quantity (1–99).", ephemeral: true });
    }

    return runNoodle(interaction, {
      sub: "cook",
      overrides: { strings: { recipe: recipeId }, integers: { quantity: qty } }
    });
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

    const { pickedNames, btnRow } = buildMultiBuyButtonsRow(interaction.user.id, picked);

    return componentCommit(interaction, {
      content: `🛒 **Selected:** ${pickedNames.join(", ")}\nChoose how you want to buy:`,
      components: [btnRow]
    });
  }

  /* ---------------- MULTI-BUY BUTTONS ---------------- */
  if (interaction.isButton?.() && interaction.customId.startsWith("noodle:multibuy:")) {
    const parts2 = interaction.customId.split(":");
    // noodle:multibuy:<mode>:<ownerId>:<id1,id2,...>
    const mode = parts2[2];
    const owner = parts2[3];
    const idsPart = parts2.slice(4).join(":");
    const selectedIds = idsPart.split(",").filter(Boolean).slice(0, 5);

    if (owner && owner !== interaction.user.id) {
      return componentCommit(interaction, { content: "That menu isn’t for you.", ephemeral: true });
    }

    if (!selectedIds.length) {
      return componentCommit(interaction, { content: "No items selected.", ephemeral: true });
    }

    // Enter quantities -> show modal IMMEDIATELY (before any DB work to avoid timeout)
    if (mode === "qty") {
      if (interaction.deferred || interaction.replied) {
        return componentCommit(interaction, { content: "That menu expired, tap again.", ephemeral: true });
      }

      const modal = new ModalBuilder()
        .setCustomId(`noodle:multibuy:qty:${interaction.user.id}:${selectedIds.join(",")}`)
        .setTitle("Multi-buy quantities");

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
        console.log(`⚠️ showModal failed for multibuy:`, e?.message);
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
      return renderMultiBuyPicker({ interaction, userId, s: serverState, p });
    }

    // Buy 1 each -> perform purchase
    if (mode === "buy1") {
      // Immediately acknowledge button click + remove components
      await componentCommit(interaction, { content: "🛒 Buying **1 each**…", components: [] });

      const action = "multibuy_buy1";
      const idemKey = makeIdempotencyKey({ serverId, userId, action, interactionId: interaction.id });
      const cached = getIdempotentResult(db, idemKey);
      if (cached) return componentCommit(interaction, cached);

      const ownerLock = `discord:${interaction.id}`;

      return withLock(db, `lock:user:${userId}`, ownerLock, 8000, async () => {
        let s = ensureServer(serverId);
        let p2 = ensurePlayer(serverId, userId);

        // refresh market
        const set = buildSettingsMap(settingsCatalog, s.settings);
        s.season = computeActiveSeason(set);
        rollMarket({ serverId, content, serverState: s });
        if (!s.market_prices) s.market_prices = {};
        if (!s.market_stock) s.market_stock = {};

        const want = {};
        for (const id3 of selectedIds) want[id3] = 1;

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
          const stock = s.market_stock?.[id3] ?? 0;

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
          s.market_stock[x.id] = (s.market_stock[x.id] ?? 0) - x.qty;
        }

        advanceTutorial(p2, "buy");

        // Persist
        upsertPlayer(db, serverId, userId, p2, null, p2.schema_version);
        upsertServer(db, serverId, s, null);

        const pretty = buyLines.map((x) => `• **${x.qty}×** ${x.name} (${x.price}c ea)`).join("\n");

        const replyObj = {
          content: `🛒 Bought:\n${pretty}\n\nTotal: **${totalCost}c**.${tutorialSuffix(p2)}`,
          components: [noodleMainMenuRow(userId), noodleSecondaryMenuRow(userId)]
        };

        putIdempotentResult(db, { key: idemKey, userId, action, ttlSeconds: 900, result: replyObj });
        return componentCommit(interaction, replyObj);
      });
    }

    return componentCommit(interaction, { content: "Unknown multi-buy action.", ephemeral: true });
  }

  /* ---------------- MULTI-BUY QTY MODAL SUBMIT ---------------- */
  if (interaction.isModalSubmit?.() && interaction.customId.startsWith("noodle:multibuy:qty:")) {
    const parts2 = interaction.customId.split(":");
    // noodle:multibuy:qty:<ownerId>:<id1,id2,...>
    const owner = parts2[3];
    const idsPart = parts2.slice(4).join(":");
    const selectedIds = idsPart.split(",").filter(Boolean).slice(0, 5);

    if (owner && owner !== interaction.user.id) {
      return componentCommit(interaction, { content: "That purchase isn’t for you.", ephemeral: true });
    }

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

    // Send immediate acknowledgment before DB work to avoid timeout
    await componentCommit(interaction, { content: "🛒 Processing your purchase…", components: [] });

    // Idempotency (prevents double submit)
    const action = "multibuy";
    const idemKey = makeIdempotencyKey({ serverId, userId, action, interactionId: interaction.id });
    const cached = getIdempotentResult(db, idemKey);
    if (cached) return componentCommit(interaction, cached);

    const ownerLock = `discord:${interaction.id}`;

    return withLock(db, `lock:user:${userId}`, ownerLock, 8000, async () => {
      let s = ensureServer(serverId);
      let p2 = ensurePlayer(serverId, userId);

      // Refresh season + market state
      const set = buildSettingsMap(settingsCatalog, s.settings);
      s.season = computeActiveSeason(set);

      rollMarket({ serverId, content, serverState: s });
      if (!s.market_prices) s.market_prices = {};
      if (!s.market_stock) s.market_stock = {};

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
        const stock = s.market_stock?.[id3] ?? 0;

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
        s.market_stock[x.id] = (s.market_stock[x.id] ?? 0) - x.qty;
      }

      advanceTutorial(p2, "buy");

      // Persist
      upsertPlayer(db, serverId, userId, p2, null, p2.schema_version);
      upsertServer(db, serverId, s, null);

      const pretty = buyLines.map((x) => `• **${x.qty}×** ${x.name} (${x.price}c ea)`).join("\n");

      const replyObj = {
        content: `🛒 Bought:\n${pretty}\n\nTotal: **${totalCost}c**.${tutorialSuffix(p2)}`,
        components: [noodleMainMenuRow(userId), noodleSecondaryMenuRow(userId)]
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

