import {
canForage,
rollForageDrops,
applyDropsToInventory,
setForageCooldown,
FORAGE_ITEM_IDS
} from "../game/forage.js";
import { addIngredientsToInventory } from "../game/inventory.js";
import {
advanceTutorial,
ensureTutorial,
getCurrentTutorialStep,
formatTutorialMessage,
formatTutorialCompletionMessage
} from "../game/tutorial.js";
import {
  loadContentBundle,
  loadSettingsCatalog,
  loadStaffContent,
  loadUpgradesContent,
  loadQuestsContent,
  loadDailyRewards,
  loadBadgesContent,
  loadCollectionsContent,
  loadSpecializationsContent,
  loadDecorContent,
  loadDecorSetsContent
} from "../content/index.js";
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
import {
  STARTER_PROFILE,
  CLUES_TO_UNLOCK_RECIPE,
  INGREDIENT_CAPACITY_BASE,
  PROFILE_DEFAULT_TAGLINE,
  PROFILE_BADGES_SHOWN,
  PROFILE_COLLECTIONS_SHOWN
} from "../constants.js";
import { nowTs } from "../util/time.js";
import { containsProfanity } from "../util/profanity.js";
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
import { applyQuestProgress, ensureQuests, claimCompletedQuests, getQuestSummary } from "../game/quests.js";
import { claimDailyReward } from "../game/daily.js";
import { ensureBadgeState, getBadgeById, getOwnedBadges, unlockBadges, grantTemporaryBadge } from "../game/badges.js";
import {
  applyCollectionProgressOnServe,
  applyCollectionProgressOnCook,
  ensureCollectionsState,
  getCollectionsSummary
} from "../game/collections.js";
import {
  canSelectSpecialization,
  ensureSpecializationState,
  getActiveSpecialization,
  getSpecializationById,
  meetsSpecializationRequirements,
  selectSpecialization
} from "../game/specialization.js";
import {
  ensureDecorState,
  grantUnlockedDecor,
  buildDecorOwnershipSummary,
  getDecorItemById,
  getOwnedDecorItems
} from "../game/decor.js";
import {
  getCookBatchOutput,
  rollCookBatchOutcome,
  getQualityMultiplier,
  rollCookQuality
} from "../game/cooking.js";
import {
  calculateCombinedEffects,
  applyCooldownReduction,
  applyMarketDiscount,
  rollIngredientSave,
  rollDoubleCraft
} from "../game/upgrades.js";
import { calculateStaffEffects } from "../game/staff.js";
import { theme } from "../ui/theme.js";
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
const upgradesContent = loadUpgradesContent();
const staffContent = loadStaffContent();
const questsContent = loadQuestsContent();
const dailyRewards = loadDailyRewards();
const badgesContent = loadBadgesContent();
const collectionsContent = loadCollectionsContent();
const specializationsContent = loadSpecializationsContent();
const decorContent = loadDecorContent();
const decorSetsContent = loadDecorSetsContent();
const db = openDb();

const HERALD_BADGE_ID = "seasonal_herald_placeholder";
const HERALD_BADGE_DURATION_MS = 24 * 60 * 60 * 1000;
const DEV_ADMIN_USER_ID = "705521883335885031";

const DECOR_SET_SPECIALIZATION_MAP = {
  festival_noodle_house: "festival_noodle_house",
  forest_kitchen: "forest_kitchen",
  comfort_food_inn: "comfort_food_inn",
  riverstone_kitchen: "riverstone_kitchen",
  moonlit_atelier: "moonlit_atelier",
  starlight_caravan: "starlight_caravan",
  comet_kitchen: "comet_kitchen",
  aurora_bistro: "aurora_bistro",
  lotus_teahouse: "lotus_teahouse",
  stormforged_wok: "stormforged_wok",
  coral_cove_canteen: "coral_cove_canteen",
  spice_route_caravan: "spice_route_caravan",
  sunlit_veranda: "sunlit_veranda",
  frostpeak_izakaya: "frostpeak_izakaya",
  gilded_pavilion: "gilded_pavilion",
  misty_grove_stall: "misty_grove_stall",
  emberglass_kitchen: "emberglass_kitchen",
  celestial_observatory: "celestial_observatory",
  velvet_night_noodle: "velvet_night_noodle",
  mythic_dragon_hall: "mythic_dragon_hall",
  hearth_classic: "golden_hearth",
  lucky_pavilion: "lucky_ladle_pavilion",
  legend_hall: "legendary_noodle_hall"
};

function getDecorSetSpecId(setId) {
  return DECOR_SET_SPECIALIZATION_MAP[setId] ?? null;
}

function getDecorSetIdForSpec(specId) {
  return Object.keys(DECOR_SET_SPECIALIZATION_MAP)
    .find((setId) => DECOR_SET_SPECIALIZATION_MAP[setId] === specId) ?? null;
}

function applyDecorSetForSpecialization(player, specId) {
  if (!specId) return false;
  const setId = getDecorSetIdForSpec(specId);
  if (!setId) return false;
  const set = (decorSetsContent?.sets ?? []).find((s) => s.set_id === setId);
  if (!set) return false;

  ensureDecorState(player);
  const slots = { front: null, counter: null, wall: null, sign: null, frame: null };
  for (const piece of set.pieces ?? []) {
    if (!piece?.slot || !piece?.item_id) continue;
    slots[piece.slot] = piece.item_id;
    if (!player.cosmetics_owned) player.cosmetics_owned = {};
    player.cosmetics_owned[piece.item_id] = 1;
  }
  player.profile.decor_slots = slots;
  return true;
}

function getDecorItemRequiredSpecId(item) {
  if (!item?.set_id) return null;
  return getDecorSetSpecId(item.set_id);
}

function isSpecializationSet(set) {
  if (!set?.set_id) return false;
  const specId = getDecorSetSpecId(set.set_id);
  if (!specId) return false;
  const spec = getSpecializationById(specializationsContent, specId);
  if (!spec) return false;
  return !spec.is_permanent;
}

/* ------------------------------------------------------------------ */
/*  UI helpers                                                         */
/* ------------------------------------------------------------------ */

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

function isDevAdmin(userId) {
  return String(userId ?? "") === DEV_ADMIN_USER_ID;
}

function buildHelpPage({ page, userId, user }) {
  const pages = [
    {
      title: "🧾 Help",
      description: [
        "**Hello chef! Begin the tutorial with `/noodle start`, you can play exclusively with buttons.**",
        "\n**When you've completed the tutorial, you will only need to use `/noodle orders` any time you want to access all play commands.**",
        "",
        "Error messages are sent only to you.\n\nTip: Copy/paste the '/noodle start' or '/noodle orders' text into a message on this channel and send!"
      ].join("\n")
    },
    {
      title: "🧾 Help — Buttons",
      description: [
        "**Main Menu**",
        "• `/noodle orders` — View today's orders.",
        "• `/noodle buy` — Buy ingredients (multi-buy).",
        "• `/noodle forage` — Forage for ingredients.",
        "• `/noodle pantry` — View your pantry.",
        "• `/noodle profile` — View your profile.",
        "",
        "**Orders Menu**",
        "• `/noodle accept` — Accept an order.",
        "• `/noodle cook` — Cook a recipe.",
        "• `/noodle serve` — Serve accepted orders.",
        "• `/noodle cancel` — Cancel an accepted order.",
        "",
        "**Profile / Customize**",
        "• `/noodle specialize` — Choose a shop specialization.",
        "• `/noodle decor` — View your decor sets.",
        "• `/noodle recipes` — View your recipes and clues.",
        "• `/noodle regulars` — View your shop regulars.",
        "• `/noodle season` — View the current season.",
        "• `/noodle event` — View the current event.",
        "",
        "**Quests Menu**",
        "• `/noodle quests` — View quests.",
        "• `/noodle quests_daily` — Claim your daily reward.",
        "• `/noodle quests_claim` — Claim your quest rewards.",
        "",
        "**Party Menu**",
        "• `/noodle-social party` — Manage your party.",
        "• `/noodle-social tip` — Tip another player.",
        "• `/noodle-social visit` — Bless another player's shop.",
        "• `/noodle-social leaderboard` — View leaderboard.",
        "• `/noodle-social stats` — View your social stats.",
        "",
        "**Upgrades Menu**",
        "• `/noodle-upgrades` — View your shop upgrades.",
        "• `/noodle-staff` — Manage your staff."
      ].join("\n")
    },
    {
      title: "🧾 Help — Slash Commands Only",
      description: [
        "Commands without buttons:",
        "",
        "**Noodle**",
        "• `/noodle start` — Start the tutorial.",
        "• `/noodle help` — Show this help menu."
      ].join("\n")
    }
  ];

  const safePage = Math.min(Math.max(Number(page) || 0, 0), pages.length - 1);
  const current = pages[safePage];
  const embed = buildMenuEmbed({
    title: current.title,
    description: current.description,
    user
  });
  const ownerText = user ? ownerFooterText(user) : null;
  const footerText = ownerText
    ? `Page ${safePage + 1}/${pages.length} • ${ownerText}`
    : `Page ${safePage + 1}/${pages.length}`;
  embed.setFooter({ text: footerText });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:help:page:${userId}:${safePage - 1}`)
      .setLabel("Prev")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage <= 0),
    new ButtonBuilder()
      .setCustomId(`noodle:help:page:${userId}:${safePage + 1}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage >= pages.length - 1)
  );

  return { embed, components: [row] };
}

function buildDmReminderComponents({ userId, serverId, channelUrl, optOut }) {
  const row = new ActionRowBuilder();
  if (channelUrl) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel("Open Channel")
        .setStyle(ButtonStyle.Link)
        .setURL(channelUrl)
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:dm:reminders_toggle:${userId}:${serverId}`)
      .setLabel(optOut ? "Enable reminders" : "Disable reminders")
      .setStyle(optOut ? ButtonStyle.Success : ButtonStyle.Secondary)
  );
  return [row];
}

function renderDecorSetsEmbedLocal({ player, ownerUser, view = "specialization", page = 0, pageSize = 5 }) {
  const completed = new Set(player.profile?.decor_sets_completed ?? []);
  const owned = new Set(getOwnedDecorItems(player));
  const activeSpecId = player.profile?.specialization?.active_spec_id ?? null;
  const equippedSetId = activeSpecId ? getDecorSetIdForSpec(activeSpecId) : null;
  const showSpecialization = view === "specialization";
  const sets = (decorSetsContent?.sets ?? []).filter((set) => (
    showSpecialization ? isSpecializationSet(set) : !isSpecializationSet(set)
  ));
  const totalPages = showSpecialization
    ? Math.max(1, Math.ceil(sets.length / pageSize))
    : 1;
  const safePage = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);
  const pageSets = showSpecialization
    ? sets.slice(safePage * pageSize, (safePage + 1) * pageSize)
    : sets;
  const lines = pageSets.map((set) => {
    const specId = getDecorSetSpecId(set.set_id);
    const spec = specId ? getSpecializationById(specializationsContent, specId) : null;
    const requirements = spec?.requirements ?? null;
    const reqCheck = spec ? meetsSpecializationRequirements(player, requirements) : { ok: false, reason: "Unavailable." };
    const status = showSpecialization
      ? (equippedSetId === set.set_id
        ? "✅ Equipped"
        : reqCheck.ok
          ? "Available"
          : `🔒 ${reqCheck.reason}`)
      : (equippedSetId === set.set_id
        ? "✅ Equipped"
        : completed.has(set.set_id)
          ? "✅ Complete"
          : "🧩");
    const description = set.description ? `_${set.description}_` : "_No description._";

    const pieces = (set.pieces ?? []).map((p) => {
      const item = getDecorItemById(decorContent, p.item_id);
      return { item, itemId: p.item_id };
    });
    const piecesList = pieces.map(({ item, itemId }) => item?.name ?? itemId).join(", ");

    if (showSpecialization) {
      return `${status} **${set.name}**\n${piecesList}\n${description}`;
    }

    const totalPieces = (set.pieces ?? []).length;
    const ownedPieces = (set.pieces ?? []).filter((p) => owned.has(p.item_id)).length;
    const countLine = `Pieces: ${ownedPieces}/${totalPieces}`;
    const missingItems = pieces.filter(({ itemId }) => !owned.has(itemId));
    let missingBlock = "**All pieces collected.**";
    if (missingItems.length) {
      const collectionUnlocks = missingItems
        .map(({ item }) => (item?.unlock_source === "collection"
          ? { collectionId: item?.unlock_rule?.collection_id, entry: item?.unlock_rule?.entry }
          : null))
        .filter((u) => u?.collectionId);
      const collectionIds = [...new Set(collectionUnlocks.map((u) => u.collectionId))];
      if (collectionIds.length === 1 && collectionUnlocks.length === missingItems.length) {
        const collectionId = collectionIds[0];
        const collectionName = (collectionsContent?.collections ?? [])
          .find((c) => c.collection_id === collectionId)?.name ?? collectionId;
        missingBlock = `Unlock all pieces by completing collection **${collectionName}**.`;
      } else {
        const nonCollection = missingItems.length - collectionUnlocks.length;
        if (!nonCollection && collectionIds.length > 1) {
          const names = collectionIds.map((id) => (collectionsContent?.collections ?? [])
            .find((c) => c.collection_id === id)?.name ?? id);
          missingBlock = `Unlock pieces by completing collections: ${names.join(", ")}.`;
        } else {
          missingBlock = "Complete the remaining unlock requirements to collect all pieces.";
        }
      }
    }
    return `${status} **${set.name}**\n${piecesList}\n${countLine}\n${description}\n${missingBlock}`;
  });

  let description = lines.length ? lines.join("\n\n") : "_No sets available on this page yet._";
  if (showSpecialization && totalPages > 1) {
    description += `\n\n*(page ${safePage + 1}/${totalPages})*`;
  }

  const embed = buildMenuEmbed({
    title: showSpecialization ? "🪞 Décor — Specialization Sets" : "🪞 Décor — Collection Sets",
    description,
    user: ownerUser
  });

  return { embed, page: safePage, totalPages };
}

function formatDecorUnlockRequirement(item) {
  if (!item) return "Unknown requirement";
  const rule = item.unlock_rule ?? {};
  switch (item.unlock_source) {
    case "shop_level":
      return `Reach shop level ${Number(rule.level || 0)}`;
    case "rep":
      return `Earn ${Number(rule.rep || 0)} REP`;
    case "collection":
      return rule.entry
        ? `Complete collection ${rule.collection_id} entry ${rule.entry}`
        : `Complete collection ${rule.collection_id}`;
    case "event":
      return rule.event_id ? `Participate in ${rule.event_id}` : "Participate in an event";
    case "quest":
      return "Complete a quest objective";
    case "market_cosmetic":
      return "Check the market for cosmetics";
    default:
      return "Unknown requirement";
  }
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

function noodleTutorialMenuRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:orders:${userId}`).setLabel("📋 Orders").setStyle(ButtonStyle.Primary)
);
}

function noodleTutorialBuyRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:buy:${userId}`).setLabel("🛒 Buy").setStyle(ButtonStyle.Primary)
);
}

function noodleTutorialForageRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:forage:${userId}`).setLabel("🌿 Forage").setStyle(ButtonStyle.Primary)
);
}

function noodleTutorialCookRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:pick:cook:${userId}`).setLabel("🍲 Cook").setStyle(ButtonStyle.Primary)
);
}

function noodleTutorialServeRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:pick:serve:${userId}`).setLabel("🍜 Serve").setStyle(ButtonStyle.Primary)
);
}

function noodleOrdersAcceptOnlyRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:pick:accept:${userId}`).setLabel("✅ Accept").setStyle(ButtonStyle.Success)
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

function noodleRecipesMenuRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:recipes:${userId}`).setLabel("📖 Recipes").setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:regulars:${userId}`).setLabel("🧑‍🍳 Regulars").setStyle(ButtonStyle.Secondary)
);
}

function noodleSecondaryMenuRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:quests:${userId}`).setLabel("📜 Quests").setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:event:${userId}`).setLabel("🎪 Event").setStyle(ButtonStyle.Secondary)
);
}

function noodleProfileEditRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`noodle:profile:edit_shop_name:${userId}`).setLabel("🏷️ Shop Name").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`noodle:profile:edit_tagline:${userId}`).setLabel("📝 Tagline").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`noodle:nav:specialize:${userId}`).setLabel("✨ Specializations").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`noodle:nav:decor:${userId}`).setLabel("🪞 Decor").setStyle(ButtonStyle.Secondary)
  );
}

function noodleProfileEditBackRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`noodle:nav:profile:${userId}`).setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary)
  );
}

function noodleSpecializeSelectRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:profile:specialize_select:${userId}`)
      .setLabel("Select Specialization")
      .setStyle(ButtonStyle.Primary)
  );
}

function noodleDecorMenuRow() {
  return null;
}

function noodleDecorBackRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`noodle:nav:profile_edit:${userId}`).setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary)
  );
}


function noodleQuestsActionRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:action:quests_daily:${userId}`).setLabel("🎁 Daily Reward").setStyle(ButtonStyle.Success),
new ButtonBuilder().setCustomId(`noodle:action:quests_claim:${userId}`).setLabel("✅ Claim Quests").setStyle(ButtonStyle.Primary)
);
}

function noodleQuestsSecondaryRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:season:${userId}`).setLabel("🍂 Season").setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:event:${userId}`).setLabel("🎪 Event").setStyle(ButtonStyle.Secondary)
);
}

function hasClaimableQuests(player) {
return Object.values(player?.quests?.active ?? {}).some((quest) => quest?.completed_at && !quest?.claimed_at);
}

function hasDailyRewardAvailable(player, now = nowTs()) {
  const lastClaimedAt = player?.daily?.last_claimed_at ?? null;
  if (!lastClaimedAt) return true;
  const todayKey = dayKeyUTC(now);
  const lastKey = dayKeyUTC(lastClaimedAt);
  return lastKey !== todayKey;
}

function noodleQuestsMenuRow(userId, { showClaim, showDaily, showQuests } = {}) {
const dailyAvailable = showDaily ?? true;
const primaryButton = showQuests
  ? new ButtonBuilder()
      .setCustomId(`noodle:nav:quests:${userId}`)
      .setLabel("📜 Quests")
      .setStyle(ButtonStyle.Secondary)
  : new ButtonBuilder()
      .setCustomId(`noodle:action:quests_daily:${userId}`)
      .setLabel("🎁 Daily Reward")
      .setStyle(dailyAvailable ? ButtonStyle.Success : ButtonStyle.Secondary);
const row = new ActionRowBuilder().addComponents(primaryButton);

if (showClaim) {
  row.addComponents(
    new ButtonBuilder().setCustomId(`noodle:action:quests_claim:${userId}`).setLabel("✅ Claim Quests").setStyle(ButtonStyle.Primary)
  );
}

row.addComponents(
  new ButtonBuilder().setCustomId(`noodle:nav:season:${userId}`).setLabel("🍂 Season").setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId(`noodle:nav:event:${userId}`).setLabel("🎪 Event").setStyle(ButtonStyle.Secondary)
);

return row;
}

function noodleQuestsBackRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:profile:${userId}`).setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary)
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

function formatBonusValue(key, value) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (key.includes("_mult")) return `×${value}`;
    if (key.includes("_chance")) return value <= 1 ? `${Math.round(value * 100)}%` : `${value}%`;
    if (key.includes("_minutes")) return `${value} min`;
    if (key.includes("_flat")) return value >= 0 ? `+${value}` : `${value}`;
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function formatBonusLabel(key) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeIngredientType(itemId) {
  const raw = String(content.items?.[itemId]?.category ?? "").toLowerCase();
  if (raw === "broth") return "broth";
  if (raw === "noodles" || raw === "noodle") return "noodles";
  if (raw === "spice" || raw === "aromatic") return "spice";
  if (raw === "topping") return "topping";
  return "topping";
}

function getIngredientCountsByType(player) {
  const counts = { broth: 0, noodles: 0, spice: 0, topping: 0 };
  for (const [id, qtyRaw] of Object.entries(player?.inv_ingredients ?? {})) {
    const qty = Math.max(0, Number(qtyRaw) || 0);
    if (!qty) continue;
    const type = normalizeIngredientType(id);
    counts[type] = (counts[type] ?? 0) + qty;
  }
  return counts;
}

function getIngredientCountForType(player, type) {
  return getIngredientCountsByType(player)[type] ?? 0;
}

function getIngredientCapacityPerType(_player, effects) {
  const bonus = Math.floor(effects?.ingredient_capacity || 0);
  return Math.max(0, INGREDIENT_CAPACITY_BASE + bonus);
}

function getBowlCount(player) {
  return Object.values(player?.inv_bowls ?? {}).reduce(
    (sum, bowl) => sum + Math.max(0, Number(bowl?.qty) || 0),
    0
  );
}

function getBowlCapacity(player, effects) {
  const base = getIngredientCapacityPerType(player, effects);
  const bonus = Math.floor(effects?.bowl_storage_capacity || 0);
  const ladleBonus = Math.floor(effects?.bowl_capacity_bonus || 0);
  return Math.max(0, base + bonus + ladleBonus);
}

const QUALITY_ORDER = ["salvage", "standard", "good", "excellent"];

function normalizeQuality(quality) {
  const q = String(quality ?? "standard").toLowerCase();
  return QUALITY_ORDER.includes(q) ? q : "standard";
}

function qualityRank(quality) {
  return QUALITY_ORDER.indexOf(normalizeQuality(quality));
}

function formatQualityLabel(quality) {
  const q = normalizeQuality(quality);
  const labels = {
    salvage: "S-",
    standard: "S",
    good: "G",
    excellent: "E"
  };
  return labels[q] ?? "S";
}

function getBowlEntriesByRecipe(player, recipeId) {
  return Object.entries(player?.inv_bowls ?? {})
    .map(([key, bowl]) => ({ key, bowl }))
    .filter(({ bowl }) => bowl?.recipe_id === recipeId && (bowl?.qty ?? 0) > 0);
}

function getTotalBowlsForRecipe(player, recipeId) {
  return getBowlEntriesByRecipe(player, recipeId)
    .reduce((sum, { bowl }) => sum + (bowl?.qty ?? 0), 0);
}

function getBestBowlEntry(player, recipeId) {
  const entries = getBowlEntriesByRecipe(player, recipeId);
  if (!entries.length) return null;
  return entries.sort((a, b) => {
    const qa = qualityRank(a.bowl?.quality);
    const qb = qualityRank(b.bowl?.quality);
    if (qa !== qb) return qb - qa;
    return (b.bowl?.cooked_at ?? 0) - (a.bowl?.cooked_at ?? 0);
  })[0];
}

function resolveBowlKeyForQuality(player, recipeId, quality) {
  const q = normalizeQuality(quality);
  if (q === "standard" && player?.inv_bowls?.[recipeId]) return recipeId;
  return `${recipeId}:${q}`;
}

function addBowlsWithQuality(player, recipeId, tier, quality, qty) {
  if (!qty || qty <= 0) return;
  if (!player.inv_bowls) player.inv_bowls = {};
  const q = normalizeQuality(quality);
  const bowlKey = resolveBowlKeyForQuality(player, recipeId, q);
  const existing = player.inv_bowls[bowlKey];
  if (!existing) {
    player.inv_bowls[bowlKey] = {
      recipe_id: recipeId,
      quality: q,
      tier,
      qty,
      cooked_at: nowTs()
    };
  } else {
    existing.qty += qty;
    existing.quality = q;
  }
}


function applyIngredientCapacityToDrops(drops, player, effects) {
  const capacity = getIngredientCapacityPerType(player, effects);
  const current = getIngredientCountsByType(player);
  const remainingByType = {
    broth: Math.max(0, capacity - (current.broth ?? 0)),
    noodles: Math.max(0, capacity - (current.noodles ?? 0)),
    spice: Math.max(0, capacity - (current.spice ?? 0)),
    topping: Math.max(0, capacity - (current.topping ?? 0))
  };

  const accepted = {};
  const rejected = {};

  for (const [id, qtyRaw] of Object.entries(drops ?? {})) {
    const qty = Math.max(0, Number(qtyRaw) || 0);
    if (qty <= 0) continue;
    const type = normalizeIngredientType(id);
    const remaining = remainingByType[type] ?? 0;
    if (remaining <= 0) {
      rejected[id] = (rejected[id] ?? 0) + qty;
      continue;
    }
    const take = Math.min(qty, remaining);
    if (take > 0) accepted[id] = (accepted[id] ?? 0) + take;
    if (take < qty) rejected[id] = (rejected[id] ?? 0) + (qty - take);
    remainingByType[type] = remaining - take;
  }

  return { accepted, rejected, current, capacity, remainingByType };
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
  if (!db) return newServerState(serverId);
  let s = getServer(db, serverId);
  if (!s) {
    s = newServerState(serverId);
    upsertServer(db, serverId, s, null);
    s = getServer(db, serverId);
  }
  return s;
}

function ensurePlayer(serverId, userId) {
  if (!db) return newPlayerProfile(userId);
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
  if (!p.profile) {
    p.profile = {
      shop_name: "My Noodle Shop",
      tagline: PROFILE_DEFAULT_TAGLINE,
      featured_badge_id: null,
      decor_slots: { front: null, counter: null, wall: null, sign: null, frame: null },
      specialization: { active_spec_id: null, chosen_at: null, change_cooldown_expires_at: null }
    };
  }
  ensureBadgeState(p);
  ensureCollectionsState(p);
  ensureSpecializationState(p);
  return p;
}

function isTutorialStep(player, stepId) {
  const step = getCurrentTutorialStep(player);
  return step?.id === stepId;
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
      tagline: PROFILE_DEFAULT_TAGLINE
    };
  }
  ensureBadgeState(player);
  ensureCollectionsState(player);
  ensureSpecializationState(player);

  let description = `*${player.profile.tagline || PROFILE_DEFAULT_TAGLINE}*`;
  const activeSpec = getActiveSpecialization(player, specializationsContent);
  const specState = ensureSpecializationState(player);
  if (activeSpec) {
    const specIcon = activeSpec.icon ?? "✨";
    description += `\n${specIcon} **${activeSpec.name}**`;
  } else if (specState?.active_spec_id) {
    description += `\n✨ **${specState.active_spec_id}**`;
  }
  if (partyName) {
    description += `\n\n🎪 **${partyName}**`;
  }
  if (!player.lifetime) {
    player.lifetime = { bowls_served_total: 0 };
  }

  const ownedBadges = getOwnedBadges(player);
  const featured = player.profile.featured_badge_id;
  const orderedBadges = featured && ownedBadges.includes(featured)
    ? [featured, ...ownedBadges.filter((id) => id !== featured)]
    : [...ownedBadges];

  const badgeLines = orderedBadges.map((id) => {
    const badge = getBadgeById(badgesContent, id);
    const icon = badge?.icon ?? "🏷️";
    return `${icon}`;
  });

  const badgeRows = [];
  for (let i = 0; i < badgeLines.length; i += 4) {
    badgeRows.push(badgeLines.slice(i, i + 4).join(" "));
  }
  const badgesText = badgeRows.length ? badgeRows.join("\n") : "_No badges yet._";

  const completedIds = player.collections?.completed ?? [];
  const completedNames = completedIds
    .map((id) => (collectionsContent?.collections ?? []).find((c) => c.collection_id === id)?.name ?? null)
    .filter(Boolean);
  const collectionsText = completedNames.length
    ? completedNames.map((name) => `• ${name}`).join("\n")
    : "_No collections completed yet._";

  const embed = new EmbedBuilder()
    .setTitle(`🍜 ${player.profile.shop_name}`)
    .setDescription(description)
    .addFields(
      { name: "⭐ Bowls Served", value: String(player.lifetime.bowls_served_total || 0), inline: true },
      { name: "Level", value: String(player.shop_level || 1), inline: true },
      { name: "REP", value: String(player.rep || 0), inline: true },
      { name: "Coins", value: `${player.coins || 0}c`, inline: true },
      { name: "🏅 Badges", value: badgesText, inline: false },
      { name: "📚 Collections", value: collectionsText, inline: false },
      { name: "🪞 Decor Set", value: " ", inline: false }
    );

  applyOwnerFooter(embed, ownerUser);
  return embed;
}

function isSpecializationVisible(player, spec) {
  if (!spec) return false;
  if (!spec.hidden_until_unlocked) return true;
  const reqCheck = meetsSpecializationRequirements(player, spec.requirements);
  return reqCheck.ok || player?.profile?.specialization?.active_spec_id === spec.spec_id;
}

function buildSpecializationListEmbed(player, ownerUser, now = nowTs(), page = 0, pageSize = 5) {
  const state = ensureSpecializationState(player);
  const specs = (specializationsContent?.specializations ?? [])
    .filter((spec) => isSpecializationVisible(player, spec));
  const totalPages = Math.max(1, Math.ceil(specs.length / pageSize));
  const safePage = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);
  const pageSpecs = specs.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const lines = pageSpecs.map((spec) => {
    const isActive = state.active_spec_id === spec.spec_id;
    const check = canSelectSpecialization(player, specializationsContent, spec.spec_id, now);
    const status = isActive
      ? "✅ Equipped"
      : check.ok
        ? "Available"
        : `🔒 ${check.reason}`;
    const icon = spec.icon ?? "✨";
    const description = spec.description ? `\n_${spec.description}_` : "";
    return `${icon} **${spec.name}** — ${status}${description}`;
  });

  if (state?.active_spec_id && !specs.some((s) => s.spec_id === state.active_spec_id)) {
    lines.unshift(`✨ **${state.active_spec_id}** — ✅ Equipped`);
  }

  let description = lines.length
    ? `${lines.join("\n\n")}\n\nUse **Select Specialization** below to switch.`
    : "No specializations available.";

  if (totalPages > 1) {
    description += `\n\n*(page ${safePage + 1}/${totalPages})*`;
  }

  const embed = buildMenuEmbed({
    title: "✨ Specializations",
    description,
    user: ownerUser
  });

  return { embed, page: safePage, totalPages };
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
      // Dismiss the modal response only for modal submits
      if (interaction.isModalSubmit?.() && (interaction.deferred || interaction.replied)) {
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
  try {
    if (interaction.deferred || interaction.replied) {
      return interaction.followUp({ ...rest, ephemeral: true });
    }
    return interaction.reply({ ...rest, ephemeral: true });
  } catch (e) {
    if (e?.code === 10062 || e?.message?.includes("Unknown interaction") || e?.message?.includes("already been acknowledged")) {
      console.log(`⏭️  Skipping ephemeral reply - interaction invalid or already handled`);
      return;
    }
    console.log(`⚠️ Ephemeral reply failed:`, e?.message);
    return;
  }
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

const buyEmbed = buildMenuEmbed({
  title: "🛒 Multi-buy",
  description: "Select up to **5** items.\nWhen you’re done selecting, if on Desktop, press **Esc** to continue.",
  user: interaction.member ?? interaction.user
});
buyEmbed.setFooter({
  text: `Coins: ${p.coins || 0}c\n${ownerFooterText(interaction.member ?? interaction.user)}`
});

return componentCommit(interaction, {
  content: " ",
  embeds: [buyEmbed],
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

function buildMultiBuyButtonsRow(userId, selectedIds, sourceMessageId, { limitToBuy1 = false } = {}) {
const pickedNames = selectedIds.map((id) => displayItemName(id));
const msgId = sourceMessageId || "none";
const btnRow = new ActionRowBuilder().addComponents(
new ButtonBuilder()
.setCustomId(`noodle:multibuy:buy1:${userId}:${msgId}`)
.setLabel("Buy 1 each")
.setStyle(ButtonStyle.Success)
);

if (!limitToBuy1) {
  btnRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:multibuy:buy5:${userId}:${msgId}`)
      .setLabel("Buy 5 each")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`noodle:multibuy:buy10:${userId}:${msgId}`)
      .setLabel("Buy 10 each")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`noodle:multibuy:clear:${userId}:${msgId}`)
      .setLabel("Clear")
      .setStyle(ButtonStyle.Danger)
  );
}

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
  getBoolean: (name) =>
    overrides?.booleans?.[name] ??
    (interaction.options?.getBoolean ? interaction.options.getBoolean(name) : null),
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
  if (!isDevAdmin(userId)) {
    return commit({ content: "You don’t have access to that command.", ephemeral: true });
  }
  const target = opt.getUser("user");
  if (!target) {
    return commit({ content: "Pick a user to reset.", ephemeral: true });
  }

  if (!db) {
    return commit({ content: "Database unavailable in this environment.", ephemeral: true });
  }
  return await withLock(db, `lock:user:${target.id}`, owner, 8000, async () => {
    const p = ensurePlayer(serverId, target.id);
    resetTutorialState(p);
    if (db) {
      upsertPlayer(db, serverId, target.id, p, null, p.schema_version);
    }
    if (db) {
      upsertPlayer(db, serverId, target.id, p, null, p.schema_version);
    }

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

if (player) {
  if (!player.notifications) {
    player.notifications = {
      pending_pantry_messages: [],
      dm_reminders_opt_out: false,
      last_noodle_channel_id: null,
      last_noodle_guild_id: null
    };
  }
  if (interaction.channelId) {
    player.notifications.last_noodle_channel_id = interaction.channelId;
    player.notifications.last_noodle_guild_id = serverId;
  }
}

/* ---------------- START ---------------- */
if (sub === "start") {
  if (!db) {
    return commit({ content: "Database unavailable in this environment.", ephemeral: true });
  }
  return await withLock(db, `lock:user:${userId}`, owner, 8000, async () => {
    const p = ensurePlayer(serverId, userId);
    const step = getCurrentTutorialStep(p);
    const tut = formatTutorialMessage(step);
    const tutorialDone = !p.tutorial?.active || !step;
    const tutorialEmbed = buildMenuEmbed({
      title: tutorialDone ? "✅ Tutorial Complete" : "🧾 Tutorial",
      description: tutorialDone
        ? "You’ve already completed the tutorial. Use the menu below to play."
        : (tut ?? "Welcome to your Noodle Story."),
      user: interaction.member ?? interaction.user
    });

    return commit({
      content: " ",
      embeds: [tutorialEmbed],
      components: tutorialDone
        ? [noodleMainMenuRow(userId), noodleSecondaryMenuRow(userId)]
        : [noodleTutorialMenuRow(userId)]
    });
  });
}

/* ---------------- HELP ---------------- */
if (sub === "help") {
  const { embed, components } = buildHelpPage({
    page: 0,
    userId,
    user: interaction.member ?? interaction.user
  });

  return commit({
    content: " ",
    embeds: [embed],
    components
  });
}

/* ---------------- PROFILE ---------------- */
if (sub === "profile") {
  const u = opt.getUser("user") ?? interaction.user;
  const p = ensurePlayer(serverId, u.id);
  const party = getUserActiveParty(db, u.id);
  
  const embed = renderProfileEmbed(p, u.displayName, party?.party_name, interaction.member ?? interaction.user);
  
  return commit({
    embeds: [embed],
    components: [noodleMainMenuRowNoProfile(userId), socialMainMenuRowNoProfile(userId)]
  });
}

/* ---------------- PROFILE EDIT ---------------- */
if (sub === "profile_edit") {
  const embed = buildMenuEmbed({
    title: "✏️ Customize Profile",
    description: "Once you unlock specializations based on your shop level, you can change the active specialization and that will update your shop's decor!",
    user: interaction.member ?? interaction.user
  });

  return commit({
    content: " ",
    embeds: [embed],
    components: [noodleProfileEditRow(userId), noodleProfileEditBackRow(userId)]
  });
}

/* ---------------- PANTRY ---------------- */
if (sub === "pantry") {
  const p = ensurePlayer(serverId, userId);
  const grouped = new Map();
  for (const [id, qty] of Object.entries(p.inv_ingredients ?? {})) {
    if (!qty || qty <= 0) continue;
    const category = normalizeIngredientType(id);
    const name = displayItemName(id);
    const catMap = grouped.get(category) ?? new Map();
    const key = name.toLowerCase();
    const cur = catMap.get(key) ?? { name, qty: 0 };
    cur.qty += qty;
    catMap.set(key, cur);
    grouped.set(category, catMap);
  }

  const combinedEffects = calculateCombinedEffects(p, upgradesContent, staffContent, calculateStaffEffects);
  const perTypeCap = getIngredientCapacityPerType(p, combinedEffects);
  const countsByType = getIngredientCountsByType(p);
  const typeOrder = ["broth", "noodles", "spice", "topping"];
  const typeLabels = {
    broth: "Broth",
    noodles: "Noodles",
    spice: "Spice",
    topping: "Topping"
  };

  const categoryBlocks = typeOrder
    .map((category) => {
      const items = grouped.get(category) ?? new Map();
      const lines = [...items.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ name, qty }) => `• ${name}: **${qty}**`)
        .join("\n");
      const have = countsByType[category] ?? 0;
      const title = `${typeLabels[category]} (${have}/${perTypeCap})`;
      return lines ? `**${title}**\n${lines}` : `**${title}**\n_None yet._`;
    })
    .filter(Boolean);

  const bowlGroups = new Map();
  for (const [, bowl] of Object.entries(p.inv_bowls ?? {})) {
    if (!bowl?.qty || bowl.qty <= 0) continue;
    const recipeId = bowl.recipe_id ?? "unknown";
    const list = bowlGroups.get(recipeId) ?? [];
    list.push({
      qty: bowl.qty,
      quality: normalizeQuality(bowl.quality)
    });
    bowlGroups.set(recipeId, list);
  }

  const bowlLines = [...bowlGroups.entries()]
    .sort(([a], [b]) => {
      const nameA = content.recipes?.[a]?.name ?? a;
      const nameB = content.recipes?.[b]?.name ?? b;
      return String(nameA).localeCompare(String(nameB));
    })
    .map(([recipeId, entries]) => {
      const recipeName = content.recipes?.[recipeId]?.name ?? recipeId;
      const counts = entries.reduce((acc, entry) => {
        const q = normalizeQuality(entry.quality);
        acc[q] = (acc[q] ?? 0) + Number(entry.qty || 0);
        return acc;
      }, {});
      const order = ["excellent", "good", "standard", "salvage"];
      const parts = order
        .filter((q) => counts[q])
        .map((q) => `${formatQualityLabel(q)} (${counts[q]})`);
      return `• ${recipeName}: **${parts.join(" · ")}**`;
    })
    .join("\n");
  const bowlCount = getBowlCount(p);
  const bowlCap = getBowlCapacity(p, combinedEffects);
  const bowlsBlock = bowlLines
    ? `**🍲 Cooked Bowls (${bowlCount}/${bowlCap})**\n${bowlLines}`
    : `**🍲 Cooked Bowls (${bowlCount}/${bowlCap})**\n_None yet._`;

  const pendingPantryMessages = p.notifications?.pending_pantry_messages ?? [];
  if (pendingPantryMessages.length > 0) {
    p.notifications.pending_pantry_messages = [];
  }

  const pantryDescription = [
    pendingPantryMessages.length ? pendingPantryMessages.join("\n") : null,
    categoryBlocks.length ? categoryBlocks.join("\n\n") : "No ingredients yet.",
    bowlsBlock
  ].join("\n\n");

  const pantryEmbed = buildMenuEmbed({
    title: "🧺 Pantry",
    description: pantryDescription,
    user: interaction.member ?? interaction.user
  });
  pantryEmbed.setFooter({
    text: `S-:Salvage, S:Standard, G:Good, E:Excellent\n\nForageable items spoil over time. \nTip: Cold Cellar upgrades reduce spoilage.\n\n${ownerFooterText(interaction.member ?? interaction.user)}`
  });

  return commit({
    content: " ",
    embeds: [pantryEmbed],
    components: [noodleMainMenuRowNoPantry(userId), noodleRecipesMenuRow(userId)]
  });
}

/* ---------------- RECIPES ---------------- */
if (sub === "recipes") {
  const p = ensurePlayer(serverId, userId);
  const knownIds = getAvailableRecipes(p);
  const knownRecipes = knownIds
    .map((id) => content.recipes?.[id])
    .filter(Boolean)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const knownLines = knownRecipes.map((r) => {
    const tier = r.tier ? ` (${r.tier})` : "";
    const ingredients = (r.ingredients ?? [])
      .map((ing) => displayItemName(ing.item_id))
      .join(", ");
    const ingredientLine = ingredients ? ingredients : "_No ingredients listed._";
    return `• **${r.name}**${tier}\n  ${ingredientLine}`;
  });

  const cluesMap = p.clues_owned ?? {};
  const clueEntries = Object.values(cluesMap).filter(Boolean);
  const clueLines = clueEntries
    .map((entry) => {
      const recipeId = entry.recipe_id;
      const recipe = content.recipes?.[recipeId];
      const name = recipe?.name ?? recipeId ?? "Unknown recipe";
      const tier = recipe?.tier ? ` (${recipe.tier})` : "";
      const count = entry.count ?? 0;
      const revealed = entry.revealed_ingredients ?? [];
      const revealedNames = revealed.length
        ? revealed.map((id) => displayItemName(id)).join(", ")
        : "_No ingredients revealed yet._";
      return `• **${name}**${tier}\n **${count}/${CLUES_TO_UNLOCK_RECIPE}** Clues revealed: ${revealedNames}`;
    })
    .sort((a, b) => a.localeCompare(b));

  const totalRecipes = Object.keys(content.recipes ?? {}).length;
  const totalPages = 2;
  const rawPage = opt.getInteger("page") ?? 0;
  const page = Math.min(Math.max(rawPage, 0), totalPages - 1);

  const pageTitle = page === 0
    ? `**Unlocked Recipes (${knownRecipes.length}/${totalRecipes})**`
    : `**Clues Collected (${clueEntries.length})**`;
  const pageBody = page === 0
    ? (knownLines.length ? knownLines.join("\n\n") : "_None yet._")
    : (clueLines.length ? clueLines.join("\n\n") : "_No clues yet._");

  const section = `${pageTitle}\n${pageBody}\n\n*(page ${page + 1}/${totalPages})*`;

  const recipesEmbed = buildMenuEmbed({
    title: "📖 **Recipes**",
    description: section,
    user: interaction.member ?? interaction.user
  });

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:nav:recipes:${userId}:${page - 1}`)
      .setLabel("◀ Prev")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:recipes:${userId}:${page + 1}`)
      .setLabel("Next ▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1)
  );

  return commit({
    content: " ",
    embeds: [recipesEmbed],
    components: [noodleMainMenuRow(userId), navRow]
  });
}

/* ---------------- REGULARS ---------------- */
if (sub === "regulars") {
  const npcs = Object.values(content.npcs ?? {})
    .filter(Boolean)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const pageSize = 5;
  const maxPages = 3;
  const totalPages = Math.max(1, Math.min(maxPages, Math.ceil(npcs.length / pageSize)));
  const rawPage = opt.getInteger("page") ?? 0;
  const page = Math.min(Math.max(rawPage, 0), totalPages - 1);
  const pageItems = npcs.slice(page * pageSize, (page + 1) * pageSize);

  const lines = pageItems.map((npc) => {
    const rarity = npc.rarity ? ` (${npc.rarity})` : "";
    const flavor = npc.flavor ? `_${npc.flavor}_` : "_No flavor text._";
    const bonuses = npc.bonuses && Object.keys(npc.bonuses).length
      ? Object.entries(npc.bonuses)
          .map(([key, value]) => `• ${formatBonusLabel(key)}: **${formatBonusValue(key, value)}**`)
          .join("\n")
      : "• _No bonuses listed._";

    return `**${npc.name}**${rarity}\n${flavor}\n${bonuses}`;
  });

  const regularsEmbed = buildMenuEmbed({
    title: "🧑‍🍳 Regulars",
    description: lines.length
      ? `${lines.join("\n\n")}\n\n*(page ${page + 1}/${totalPages})*`
      : "No regulars found.",
    user: interaction.member ?? interaction.user
  });

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:nav:regulars:${userId}:${page - 1}`)
      .setLabel("◀ Prev")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:regulars:${userId}:${page + 1}`)
      .setLabel("Next ▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1)
  );

  return commit({
    content: " ",
    embeds: [regularsEmbed],
    components: totalPages > 1 ? [noodleMainMenuRow(userId), navRow] : [noodleMainMenuRow(userId)]
  });
}

/* ---------------- SEASON ---------------- */
if (sub === "season") {
  const p = ensurePlayer(serverId, userId);
  const availableRecipes = getAvailableRecipes(p);
  const seasonalRecipes = Object.values(content.recipes ?? {})
    .filter((recipe) => recipe?.tier === "seasonal" && recipe?.season === server.season);
  const seasonalLine = seasonalRecipes.length
    ? seasonalRecipes
        .map((recipe) => {
          const unlocked = availableRecipes.includes(recipe.recipe_id)
            ? "You have discovered this recipe!"
            : "You have not discovered this yet!";
          return `• **${recipe.name}** — ${unlocked}`;
        })
        .join("\n")
    : "_No seasonal recipe found for this season._";

  const seasonEmbed = buildMenuEmbed({
    title: "🍂 Season",
    description: [
      `The world is currently in **${server.season}**.`,
      "",
      "**Seasonal Recipe**",
      seasonalLine
    ].join("\n"),
    user: interaction.member ?? interaction.user
  });

  const dailyAvailable = hasDailyRewardAvailable(p, nowTs());
  const seasonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:action:quests_daily:${userId}`)
      .setLabel("🎁 Daily Reward")
      .setStyle(dailyAvailable ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:quests:${userId}`)
      .setLabel("📜 Quests")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:event:${userId}`)
      .setLabel("🎪 Event")
      .setStyle(ButtonStyle.Secondary)
  );

  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`noodle:nav:profile:${userId}`).setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary)
  );

  return commit({
    content: " ",
    embeds: [seasonEmbed],
    components: [seasonRow, backRow]
  });
}

/* ---------------- STATUS (DEBUG) ------------ */
if (sub === "status") {
  if (!isDevAdmin(userId)) {
    return commit({ content: "You don’t have access to that command.", ephemeral: true });
  }
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
  const dailyAvailable = hasDailyRewardAvailable(ensurePlayer(serverId, userId), nowTs());
  const eventRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:action:quests_daily:${userId}`)
      .setLabel("🎁 Daily Reward")
      .setStyle(dailyAvailable ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:quests:${userId}`)
      .setLabel("📜 Quests")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:season:${userId}`)
      .setLabel("🍂 Season")
      .setStyle(ButtonStyle.Secondary)
  );

  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`noodle:nav:profile:${userId}`).setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary)
  );

  const eventEmbed = buildMenuEmbed({
    title: "🎪 Event",
    description: server.active_event_id
      ? `Event active: **${server.active_event_id}**\n\n_More event details coming soon._`
      : "No event is active right now.\n\n_More event details coming soon._",
    user: interaction.member ?? interaction.user
  });

  return commit({
    content: " ",
    embeds: [eventEmbed],
    components: [eventRow, backRow]
  });
}

const action = sub;
const idemKey = makeIdempotencyKey({ serverId, userId, action, interactionId: interaction.id });

// Skip idempotency check for button/select interactions to avoid stale cached responses
const isComponent = interaction.isButton?.() || interaction.isSelectMenu?.();
const cached = isComponent || !db ? null : getIdempotentResult(db, idemKey);

if (cached) {
  return commit(cached);
}

if (!db) {
  return commit({ content: "Database unavailable in this environment.", ephemeral: true });
}
return await withLock(db, `lock:user:${userId}`, owner, 8000, async () => {
  let p = ensurePlayer(serverId, userId);
  let s = ensureServer(serverId);

  const now = nowTs();
  const combinedEffects = calculateCombinedEffects(p, upgradesContent, staffContent, calculateStaffEffects);
  
  // C: Apply time catch-up BEFORE any state changes
  // Get last_active_at from database (before it's updated by upsertPlayer)
  const lastActiveAt = db ? (getLastActiveAt(db, serverId, userId) || now) : now;
  
  const set = buildSettingsMap(settingsCatalog, s.settings);
  s.season = computeActiveSeason(set);
  
  // Apply time catch-up (spoilage, inactivity messages, cooldown checks)
  const timeCatchup = applyTimeCatchup(p, s, set, content, lastActiveAt, now, combinedEffects);
  
  const sweep = sweepExpiredAcceptedOrders(p, s, content, now);

  rollMarket({ serverId, content, serverState: s });
  if (!s.market_prices) s.market_prices = {};
  
  // Roll per-player market stock daily
  rollPlayerMarketStock({ userId, serverId, content, playerState: p });
  if (!p.market_stock) p.market_stock = {};

  const prevOrdersDay = p.orders_day;
  ensureDailyOrdersForPlayer(p, set, content, s.season, serverId, userId);
  ensureQuests(p, questsContent, userId, now);

  // DM the user when a new day's orders are posted
  const dayChanged = prevOrdersDay !== p.orders_day;
  if (dayChanged) {
    // Force market stock refresh to align with daily order reset
    p.market_stock_day = null;
    p.market_stock = null;
    rollPlayerMarketStock({ userId, serverId, content, playerState: p });
    const dailyAvailable = hasDailyRewardAvailable(p, now);
    const remindersOptOut = p.notifications?.dm_reminders_opt_out === true;
    if (dailyAvailable && !remindersOptOut) {
      const guildName = interaction.guild?.name ?? "this server";
      const lastGuildId = p.notifications?.last_noodle_guild_id ?? serverId;
      const lastChannelId = p.notifications?.last_noodle_channel_id ?? interaction.channelId ?? null;
      const channelUrl = lastChannelId
        ? `https://discord.com/channels/${lastGuildId}/${lastChannelId}`
        : null;
      const channelLine = lastChannelId ? `Last kitchen: <#${lastChannelId}>.` : null;

      const reminderEmbed = buildMenuEmbed({
        title: "📬 Daily Reward Ready",
        description: [
          `Your daily reward is ready in **${guildName}**.`,
          "Open /noodle quests to claim it.",
          channelLine,
          "Use the button below to turn reminders on or off."
        ].filter(Boolean).join("\n"),
        user: interaction.user
      });

      const components = buildDmReminderComponents({
        userId,
        serverId: lastGuildId,
        channelUrl,
        optOut: remindersOptOut
      });

      interaction.user?.send?.({
        embeds: [reminderEmbed],
        components
      }).catch(() => {});
    }
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
    
    if (db) {
      upsertPlayer(db, serverId, userId, p, null, p.schema_version);
      upsertServer(db, serverId, s, null);
    }
    if (db) {
      upsertPlayer(db, serverId, userId, p, null, p.schema_version);
      upsertServer(db, serverId, s, null);
    }

    // Prepend time catch-up and resilience messages
    let finalContent = replyObj.content || "";
    let finalEmbeds = replyObj.embeds ? [...replyObj.embeds] : undefined;

    const spoilageMessages = timeCatchup.spoilage?.messages ?? [];
    if (spoilageMessages.length > 0) {
      if (!p.notifications) {
        p.notifications = {
          pending_pantry_messages: [],
          dm_reminders_opt_out: false,
          last_noodle_channel_id: null,
          last_noodle_guild_id: null
        };
      }
      if (!Array.isArray(p.notifications.pending_pantry_messages)) {
        p.notifications.pending_pantry_messages = [];
      }
      p.notifications.pending_pantry_messages.push(...spoilageMessages);
    }

    const spoilageSet = new Set(spoilageMessages);
    const catchupMsgs = timeCatchup.messages.filter((msg) => !spoilageSet.has(msg));
    const catchupMsg = catchupMsgs.length > 0
      ? catchupMsgs.join("\n\n")
      : "";

    const banner = [catchupMsg].filter(Boolean).join("\n\n");

    if (banner) {
      if (finalEmbeds && finalEmbeds.length > 0) {
        const first = { ...finalEmbeds[0] };
        const existing = first.description || "";
        first.description = existing ? `${banner}\n\n${existing}` : banner;
        finalEmbeds[0] = first;
      } else {
        finalContent = finalContent ? `${banner}\n\n${finalContent}` : banner;
      }
    }

    const rescueEmbeds = [];
    if (resilience.messages.length > 0) {
      rescueEmbeds.push(buildMenuEmbed({
        title: "🆘 Rescue Mode",
        description: resilience.messages.join("\n\n"),
        user: interaction.member ?? interaction.user
      }));
    }
    if (clearedTempRecipes) {
      rescueEmbeds.push(buildMenuEmbed({
        title: "✅ Recovery Complete",
        description: "You’re back to normal play and your full recipe pool is restored.",
        user: interaction.member ?? interaction.user
      }));
    }
    if (rescueEmbeds.length > 0) {
      finalEmbeds = [...rescueEmbeds, ...(finalEmbeds ?? [])];
    }

    const out = {
      ...replyObj,
      content: finalContent,
      embeds: finalEmbeds ?? replyObj.embeds,
      ephemeral: replyObj.ephemeral ?? false,
      components: replyObj.ephemeral
        ? (replyObj.components ?? [])
        : (replyObj.components ?? [noodleMainMenuRow(userId)])
    };

    if (db) {
      putIdempotentResult(db, { key: idemKey, userId, action, ttlSeconds: 900, result: out });
    }
    if (db) {
      putIdempotentResult(db, { key: idemKey, userId, action, ttlSeconds: 900, result: out });
    }
    return commit(out);
  };

  /* ---------------- QUESTS ---------------- */
  if (sub === "quests") {
    const summary = getQuestSummary(p, questsContent, userId, now);
    const active = summary.active;
    const cadenceOrder = ["daily", "weekly", "monthly", "story", "seasonal"];
    const cadenceLabel = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", story: "Story", seasonal: "Seasonal" };
    const grouped = cadenceOrder.map((cadence) => ({
      cadence,
      label: cadenceLabel[cadence] ?? cadence,
      quests: active
        .filter((q) => q.cadence === cadence)
        .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))
    }));

    const lines = active.length
      ? grouped.flatMap(({ label, quests }) => {
          if (!quests.length) return [];
          const header = `**${label}**`;
          const entries = quests.map((q) => {
            const status = q.completed_at ? "✅" : "📝";
            const rewardParts = [];
            if (q.reward?.coins) rewardParts.push(`${q.reward.coins}c`);
            if (q.reward?.sxp) rewardParts.push(`${q.reward.sxp} SXP`);
            if (q.reward?.rep) rewardParts.push(`${q.reward.rep} REP`);
            const rewardText = rewardParts.length ? ` — Rewards: ${rewardParts.join(" · ")}` : "";
            return `${status} **${q.name}** (${q.progress}/${q.target})${rewardText}`;
          });
          return [header, ...entries, ""];
        }).filter((line) => line !== "")
      : ["_No quests available right now._"]; 

    const questsEmbed = buildMenuEmbed({
      title: "📜 Quests",
      description: lines.join("\n"),
      user: interaction.member ?? interaction.user
    });

    return commitState({
      content: " ",
      embeds: [questsEmbed],
      components: [
        noodleQuestsMenuRow(userId, { showClaim: hasClaimableQuests(p), showDaily: hasDailyRewardAvailable(p, now) }),
        noodleQuestsBackRow(userId)
      ]
    });
  }

  /* ---------------- QUESTS: DAILY ---------------- */
  if (sub === "quests_daily") {
    const result = claimDailyReward(p, dailyRewards, now);
    if (!result.ok) {
      const embed = buildMenuEmbed({
        title: "🎁 Daily Reward",
        description: result.message,
        user: interaction.member ?? interaction.user
      });
      return commitState({
        content: " ",
        embeds: [embed],
        components: [
          noodleQuestsMenuRow(userId, {
            showClaim: hasClaimableQuests(p),
            showDaily: hasDailyRewardAvailable(p, now),
            showQuests: true
          }),
          noodleQuestsBackRow(userId)
        ]
      });
    }

    const rewardLines = [];
    if (result.reward.coins) rewardLines.push(`💰 **${result.reward.coins}c**`);
    if (result.reward.sxp) rewardLines.push(`✨ **${result.reward.sxp} SXP**`);
    if (result.reward.rep) rewardLines.push(`⭐ **${result.reward.rep} REP**`);

    const levelLine = result.leveledUp > 0 ? `\n🎉 Level up! **+${result.leveledUp}**` : "";
    const embed = buildMenuEmbed({
      title: "🎁 Daily Reward",
      description: `Streak: **${result.streak}** day(s)\nRewards: ${rewardLines.join(" · ")}${levelLine}`,
      user: interaction.member ?? interaction.user
    });
    return commitState({
      content: " ",
      embeds: [embed],
      components: [
        noodleQuestsMenuRow(userId, {
          showClaim: hasClaimableQuests(p),
          showDaily: hasDailyRewardAvailable(p, now),
          showQuests: true
        }),
        noodleQuestsBackRow(userId)
      ]
    });
  }

  /* ---------------- QUESTS: CLAIM ---------------- */
  if (sub === "quests_claim") {
    const result = claimCompletedQuests(p);
    const lines = result.claimed.length
      ? result.claimed.map((entry) => {
          const rewardParts = [];
          if (entry.reward?.coins) rewardParts.push(`${entry.reward.coins}c`);
          if (entry.reward?.sxp) rewardParts.push(`${entry.reward.sxp} SXP`);
          if (entry.reward?.rep) rewardParts.push(`${entry.reward.rep} REP`);
          return `✅ **${entry.quest.name}** — ${rewardParts.join(" · ")}`;
        })
      : ["_No completed quests to claim._"]; 

    const levelLine = result.leveledUp > 0 ? `\n🎉 Level up! **+${result.leveledUp}**` : "";
    const embed = buildMenuEmbed({
      title: "✅ Quest Rewards",
      description: `${lines.join("\n")}${levelLine}`,
      user: interaction.member ?? interaction.user
    });
    return commitState({
      content: " ",
      embeds: [embed],
      components: [
        noodleQuestsMenuRow(userId, { showClaim: hasClaimableQuests(p), showDaily: hasDailyRewardAvailable(p, now) }),
        noodleQuestsBackRow(userId)
      ]
    });
  }


  /* ---------------- SPECIALIZE ---------------- */
  if (sub === "specialize") {
    const specId = opt.getString("spec");
    const confirm = opt.getBoolean("confirm");
    const state = ensureSpecializationState(p);

    if (!specId) {
      const rawPage = opt.getInteger("page") ?? 0;
      const { embed, page, totalPages } = buildSpecializationListEmbed(
        p,
        interaction.member ?? interaction.user,
        now,
        rawPage,
        5
      );
      const components = [];
      if (totalPages > 1) {
        components.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`noodle:nav:specialize:${userId}:${page - 1}`)
            .setLabel("Prev")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page <= 0),
          new ButtonBuilder()
            .setCustomId(`noodle:nav:specialize:${userId}:${page + 1}`)
            .setLabel("Next")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1)
        ));
      }
      components.push(noodleSpecializeSelectRow(userId), noodleProfileEditRow(userId), noodleProfileEditBackRow(userId));
      return commitState({
        content: " ",
        embeds: [embed],
        components
      });
    }

    const spec = getSpecializationById(specializationsContent, specId);
    if (!spec) return commitState({ content: "Specialization not found.", ephemeral: true });

    const check = canSelectSpecialization(p, specializationsContent, specId, now);
    if (!check.ok) {
      return commitState({ content: check.reason, ephemeral: true });
    }

    if (!confirm) {
      const embed = buildMenuEmbed({
        title: "✨ Confirm Specialization",
        description: `You're about to switch to **${spec.name}**. Re-run with confirm=true to proceed.`,
        user: interaction.member ?? interaction.user
      });
      return commitState({
        content: " ",
        embeds: [embed],
        components: [noodleSpecializeSelectRow(userId), noodleProfileEditRow(userId), noodleProfileEditBackRow(userId)]
      });
    }

    const result = selectSpecialization(p, specializationsContent, specId, now);
    if (!result.ok) return commitState({ content: result.reason, ephemeral: true });

    applyDecorSetForSpecialization(p, specId);

    if (db) {
      upsertPlayer(db, serverId, userId, p, null, p.schema_version);
    }

    const embed = buildMenuEmbed({
      title: "✨ Specialization Updated",
      description: `Active specialization: **${result.specialization?.name ?? specId}**.`,
      user: interaction.member ?? interaction.user
    });
    return commitState({
      content: " ",
      embeds: [embed],
      components: [noodleSpecializeSelectRow(userId), noodleProfileEditRow(userId), noodleProfileEditBackRow(userId)]
    });
  }

  /* ---------------- DECOR ---------------- */
  if (sub === "decor" || sub === "decor_sets_spec") {
    const p = ensurePlayer(serverId, userId);
    const s = ensureServer(serverId);
    ensureDecorState(p);
    grantUnlockedDecor(p, decorContent, s);

    const rawPage = opt.getInteger("page") ?? 0;
    const { embed, page, totalPages } = renderDecorSetsEmbedLocal({
      player: p,
      ownerUser: interaction.member ?? interaction.user,
      view: "specialization",
      page: rawPage,
      pageSize: 5
    });

    const components = [];
    if (totalPages > 1) {
      components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`noodle:nav:decor:${userId}:${page - 1}`)
          .setLabel("Prev")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page <= 0),
        new ButtonBuilder()
          .setCustomId(`noodle:nav:decor:${userId}:${page + 1}`)
          .setLabel("Next")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page >= totalPages - 1)
      ));
    }
    components.push(noodleDecorBackRow(userId));

    return commitState({
      content: " ",
      embeds: [embed],
      components
    });
  }

  /* ---------------- COLLECTIONS ---------------- */
  if (sub === "collections") {
    const p = ensurePlayer(serverId, userId);
    ensureCollectionsState(p);

    const collectionsList = collectionsContent?.collections ?? [];
    const lines = collectionsList.map((collection) => {
      const progress = p.collections?.progress?.[collection.collection_id] ?? { completed_entries: [] };
      const totalEntries = Array.isArray(collection.entries) && collection.entries.length > 0
        ? collection.entries.length
        : (collection.entry_source === "npcs"
          ? Object.keys(content.npcs ?? {}).length
          : (collection.entry_source === "recipes"
            ? Object.values(content.recipes ?? {}).filter((r) => !collection.tier || r?.tier === collection.tier).length
            : 0));
      const completed = progress.completed_entries?.length ?? 0;
      const percent = totalEntries > 0 ? Math.floor((completed / totalEntries) * 100) : 0;
      const status = percent >= 100 ? "✅" : "🧩";
      const description = collection.description ? `\n_${collection.description}_` : "";
      return `\n${status} **${collection.name}** — ${completed}/${totalEntries} (${percent}%)${description}`;
    });

    const embed = buildMenuEmbed({
      title: "📚 Collections",
      description: lines.length ? lines.join("\n") : "_No collections defined yet._",
      user: interaction.member ?? interaction.user
    });

    return commitState({
      content: " ",
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`noodle-social:nav:stats:${userId}`)
          .setLabel("⬅️ Back")
          .setStyle(ButtonStyle.Secondary)
      )]
    });
  }

  /* ---------------- FORAGE ---------------- */
  if (sub === "forage") {
    const baseCooldownMs = 2 * 60 * 1000;
    const cooldownMs = applyCooldownReduction(baseCooldownMs, combinedEffects);
    const chk = canForage(p, now, cooldownMs);

    if (!chk.ok) {
      const msLeft = chk.nextAt - now;
      const mins = Math.ceil(msLeft / 60000);
      const nextAtTs = Math.floor(chk.nextAt / 1000);
      const cooldownEmbed = buildMenuEmbed({
        title: "🌿 Forage Cooldown",
        description: `You’ve foraged recently. Try again at <t:${nextAtTs}:t>, <t:${nextAtTs}:R>.`,
        user: interaction.member ?? interaction.user
      });
      return commitState({
        content: " ",
        embeds: [cooldownEmbed]
      });
    }

    const itemId = opt.getString("item") ?? null;
    const qtyRaw = opt.getInteger("quantity") ?? 1;
    const quantity = Math.max(1, Math.min(5, qtyRaw));
    const bonusItems = Math.max(0, Math.floor(combinedEffects.forage_bonus_items || 0));

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
        picks: 2 + bonusItems,
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

    if (itemId && bonusItems > 0) {
      drops[itemId] = (drops[itemId] ?? 0) + bonusItems;
    }
    const capacityResult = applyIngredientCapacityToDrops(drops, p, combinedEffects);
    const { accepted, rejected } = capacityResult;

    if (!Object.keys(accepted).length) {
      setForageCooldown(p, now);
      return commitState({
        content: "🧺 Your pantry is full. Upgrade storage or use ingredients to make room."
      });
    }

    const inventoryResult = applyDropsToInventory(p, accepted);
    setForageCooldown(p, now);
    advanceTutorial(p, "forage");
    applyQuestProgress(p, questsContent, userId, { type: "forage", amount: 1 }, now);

    const lines = Object.entries(inventoryResult.added).map(
      ([id, q]) => `• **${q}×** ${displayItemName(id)}`
    );

    const header = itemId
      ? `You search carefully and gather:\n`
      : `You wander into the nearby grove and return with:\n`;

    let description = `${header}${lines.join("\n")}`;
    
    // Add warning if some items were blocked due to capacity
    if (!inventoryResult.success && Object.keys(inventoryResult.blocked).length > 0) {
      const blockedLines = Object.entries(inventoryResult.blocked).map(
        ([id, q]) => `**${q}×** ${displayItemName(id)}`
      );
      description += `\n\n⚠️ **Pantry Full!** Could not collect: ${blockedLines.join(", ")}\n_Upgrade your Pantry to increase capacity._`;
    }
    
    description += tutorialSuffix(p);

    const forageEmbed = buildMenuEmbed({
      title: "🌿 Forage",
      description: `${header}${lines.join("\n")}${
        Object.keys(rejected).length
          ? `\n\n🧺 Pantry full — left behind ${Object.values(rejected).reduce((sum, v) => sum + v, 0)} item(s).`
          : ""
      }${tutorialSuffix(p)}`,
      user: interaction.member ?? interaction.user
    });
    return commitState({
      content: " ",
      embeds: [forageEmbed],
      components: isTutorialStep(p, "intro_cook") ? [noodleTutorialCookRow(userId)] : undefined
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
        user: interaction.member ?? interaction.user
      });
      buyEmbed.setFooter({
        text: `Coins: ${p.coins || 0}c\n${ownerFooterText(interaction.member ?? interaction.user)}`
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
    const basePrice = pityPrice ?? (s.market_prices?.[itemId] ?? item.base_price);
    const price = applyMarketDiscount(basePrice, combinedEffects);
    const stock = p.market_stock?.[itemId] ?? 0;
    const type = normalizeIngredientType(itemId);
    const perTypeCap = getIngredientCapacityPerType(p, combinedEffects);
    const remaining = perTypeCap - getIngredientCountForType(p, type);
    if (remaining <= 0) {
      const label = type.charAt(0).toUpperCase() + type.slice(1);
      return commitState({
        content: `🧺 Your ${label} storage is full. Upgrade storage or use ingredients to make room.`,
        ephemeral: true
      });
    }

    const qtyToBuy = Math.min(qty, remaining);
    const cost = price * qtyToBuy;

    if (stock < qtyToBuy) {
      const friendly = displayItemName(itemId);
      return commitState({ content: `Only ${stock} in stock today for **${friendly}**.`, ephemeral: true });
    }
    if (p.coins < cost) return commitState({ content: "Not enough coins for that purchase." });

    // Check inventory capacity before purchase
    const inventoryResult = addIngredientsToInventory(p, { [itemId]: qty }, "block");
    
    if (!inventoryResult.success) {
      const friendly = displayItemName(itemId);
      return commitState({ 
        content: `⚠️ **Pantry Full!** Cannot store ${qty}× **${friendly}**.\nUpgrade your Pantry to increase capacity.`,
        ephemeral: true
      });
    }

    p.coins -= cost;
    p.inv_ingredients[itemId] = (p.inv_ingredients[itemId] ?? 0) + qtyToBuy;
    p.market_stock[itemId] = stock - qtyToBuy;

    applyQuestProgress(p, questsContent, userId, { type: "buy", amount: qtyToBuy }, now);

    advanceTutorial(p, "buy");
    const tutorialOnlyForage = isTutorialStep(p, "intro_forage");

    const capacityNote = qtyToBuy < qty ? `\n🧺 Pantry capacity limited your purchase to **${qtyToBuy}**.` : "";
    return commitState({
      content: `🛒 Bought **${qtyToBuy}× ${item.name}** for **${cost}c**.${capacityNote}${tutorialSuffix(p)}`,
      embeds: [],
      components: tutorialOnlyForage ? [noodleTutorialForageRow(userId)] : undefined
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

    applyQuestProgress(p, questsContent, userId, { type: "earn_coins", amount: gain }, now);

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
    if (r.tier === "seasonal") {
      const activeSeason = s?.season ?? null;
      if (!activeSeason || r.season !== activeSeason) {
        return commitState({
          content: `That recipe can only be cooked during **${r.season ?? "its season"}**. The current season is **${activeSeason ?? "unknown"}**.`,
          ephemeral: true
        });
      }
    }
    if (!qty || qty <= 0) return commitState({ content: "Pick a positive quantity.", ephemeral: true });

    const bowlCap = getBowlCapacity(p, combinedEffects);
    const bowlCount = getBowlCount(p);
    const remainingBowls = bowlCap - bowlCount;
    if (remainingBowls <= 0) {
      return commitState({
        content: "🧺 Your cooked bowls storage is full. Serve bowls or upgrade storage to make room.",
        ephemeral: true
      });
    }

    const now = nowTs();

    const qtyToCook = Math.min(qty, remainingBowls);
    const batchOutput = Math.min(getCookBatchOutput(qtyToCook, p, combinedEffects), remainingBowls);

    for (const ing of r.ingredients) {
      const haveIng = p.inv_ingredients?.[ing.item_id] ?? 0;
      const need = ing.qty * qtyToCook;
      if (haveIng < need) {
        const missing = need - haveIng;
        return commitState({
          content: `You’re missing **${displayItemName(ing.item_id)}** — need **${missing}** more (have ${haveIng}/${need}).`,
          ephemeral: true
        });
      }
    }

    const cookRng = makeStreamRng({ mode: "secure", streamName: "cook", serverId, userId });
    const savedLines = [];
    const consumedByItem = {};
    for (const ing of r.ingredients) {
      const need = ing.qty * qtyToCook;
      let saved = 0;
      if (combinedEffects.ingredient_save_chance > 0) {
        for (let i = 0; i < need; i += 1) {
          if (rollIngredientSave(combinedEffects, cookRng)) saved += 1;
        }
      }
      const consume = Math.max(0, need - saved);
      p.inv_ingredients[ing.item_id] -= consume;
      if (consume > 0) {
        consumedByItem[ing.item_id] = (consumedByItem[ing.item_id] ?? 0) + consume;
      }
      if (saved > 0) {
        savedLines.push(`🧺 Saved **${saved}× ${displayItemName(ing.item_id)}**`);
      }
    }

    const blessing = getActiveBlessing(p);
    const outcome = rollCookBatchOutcome({
      quantity: batchOutput,
      tier: r.tier,
      player: p,
      effects: combinedEffects,
      rng: cookRng,
      blessing
    });

    const doubleCrafted = combinedEffects.double_craft_chance > 0 && rollDoubleCraft(combinedEffects, cookRng);
    let extra = 0;
    if (doubleCrafted) {
      const remainingAfter = Math.max(0, bowlCap - (bowlCount + batchOutput));
      extra = Math.min(batchOutput, remainingAfter);
      for (let i = 0; i < extra; i += 1) {
        const quality = rollCookQuality(cookRng, p, combinedEffects, blessing);
        outcome.qualityCounts[quality] = (outcome.qualityCounts[quality] ?? 0) + 1;
      }
    }

    const qualityCounts = outcome.qualityCounts ?? {};
    for (const [quality, count] of Object.entries(qualityCounts)) {
      addBowlsWithQuality(p, recipeId, r.tier, quality, count);
    }

    if (!p.lifetime) p.lifetime = {};
    p.lifetime.cook_failures = p.lifetime.cook_failures ?? 0;
    if (outcome.failed > 0) p.lifetime.cook_failures += outcome.failed;
    if (outcome.success > 0) updateFailStreak(p, true);
    if (outcome.success === 0) updateFailStreak(p, false);
    if (!p.cooldowns) p.cooldowns = {};

    const have = getTotalBowlsForRecipe(p, recipeId);

    advanceTutorial(p, "cook");
    p.lifetime.recipes_cooked = (p.lifetime.recipes_cooked || 0) + 1;

    applyQuestProgress(p, questsContent, userId, { type: "cook", amount: batchOutput }, now);
    applyCollectionProgressOnCook(p, collectionsContent, content, { recipeId, bowlsCooked: batchOutput });

    const lostLine = (r.ingredients ?? [])
      .map((ing) => {
        const lostQty = (ing.qty ?? 0) * outcome.failed;
        return lostQty > 0 ? `**${lostQty}× ${displayItemName(ing.item_id)}**` : null;
      })
      .filter(Boolean)
      .join(" · ");
    const salvageLine = outcome.salvage > 0 ? ` Salvaged **${outcome.salvage}** bowl(s).` : "";
    const failInfo = outcome.failed > 0
      ? `⚠️ **Cook failure**: ${outcome.failed} bowl(s) failed. Lost: ${lostLine}. Cause: recipe tier risk.${salvageLine}`
      : null;

    const cookEmbed = buildMenuEmbed({
      title: "🍲 Cooked",
      description: [
        `You cooked **${batchOutput}× ${r.name}**.`,
        qtyToCook < qty ? `🧺 Bowl storage limited this cook to **${qtyToCook}**.` : null,
        batchOutput > qtyToCook ? `🍜 Prep bonus: **+${batchOutput - qtyToCook}** bowl(s).` : null,
        failInfo,
        doubleCrafted ? `✨ Double craft! **+${extra}** extra bowl(s).` : null,
        savedLines.length ? savedLines.join("\n") : null,
        `You now have **${have}** bowl(s) ready.`,
        tutorialSuffix(p)
      ].filter(Boolean).join("\n"),
      user: interaction.member ?? interaction.user
    });

    const tutorialOnlyServe = isTutorialStep(p, "intro_serve");

    return commitState({
      content: " ",
      embeds: [cookEmbed],
      components: tutorialOnlyServe ? [noodleTutorialServeRow(userId)] : [noodleOrdersActionRow(userId)]
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
        const total = getTotalBowlsForRecipe(p, recipeId);
        if (total > 0) {
          const rName = content.recipes[recipeId]?.name ?? "a dish";
          return `• **${rName}** — **${total}** bowl(s) ready`;
        }
        return null;
      })
      .filter(Boolean);

    const statusParts = [];
    if (readyBowls.length > 0) {
      statusParts.push(`🍲 **Bowls Ready**\n${readyBowls.join("\n")}`);
    }

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
      user: interaction.member ?? interaction.user
    });
    const tutorialOnlyAccept = isTutorialStep(p, "intro_order");
    return commitState({
      content: " ",
      embeds: [menuEmbed],
      components: tutorialOnlyAccept
        ? [noodleOrdersAcceptOnlyRow(userId)]
        : [noodleOrdersMenuActionRow(userId, { showCancel }), noodleMainMenuRowNoOrders(userId)]
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
    const acceptedOrdersNow = [];
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
      const total = getTotalBowlsForRecipe(p, order.recipe_id);
      if (total > 0) {
        readyBowlsByRecipe.set(order.recipe_id, total);
      }
      acceptedOrdersNow.push(order);
      acceptedNow += 1;
    }

    const prepChefLevel = Math.max(0, Number(p.staff_levels?.prep_chef || 0));
    if (prepChefLevel > 0 && acceptedOrdersNow.length > 0) {
      const autoOrderCap = Math.min(acceptedOrdersNow.length, prepChefLevel);

      const inventoryAvailable = { ...(p.inv_ingredients ?? {}) };
      const stockRemaining = { ...(p.market_stock ?? {}) };
      const combinedEffects = calculateCombinedEffects(p, upgradesContent, staffContent, calculateStaffEffects);
      const perTypeCap = getIngredientCapacityPerType(p, combinedEffects);
      const countsByType = getIngredientCountsByType(p);
      const remainingByType = {
        broth: Math.max(0, perTypeCap - (countsByType.broth ?? 0)),
        noodles: Math.max(0, perTypeCap - (countsByType.noodles ?? 0)),
        spice: Math.max(0, perTypeCap - (countsByType.spice ?? 0)),
        topping: Math.max(0, perTypeCap - (countsByType.topping ?? 0))
      };
      const bowlsRemaining = {};
      const coinsStart = Number(p.coins || 0);
      let coinsRemaining = coinsStart;

      for (const order of acceptedOrdersNow) {
        bowlsRemaining[order.recipe_id] = getTotalBowlsForRecipe(p, order.recipe_id);
      }

      const purchasedByItem = {};
      let totalAutoCost = 0;
      let ordersCovered = 0;

      for (const order of acceptedOrdersNow.slice(0, autoOrderCap)) {
        const recipe = content.recipes?.[order.recipe_id];
        if (!recipe?.ingredients) continue;

        if ((bowlsRemaining[order.recipe_id] ?? 0) > 0) {
          bowlsRemaining[order.recipe_id] -= 1;
          ordersCovered += 1;
          continue;
        }

        const allItems = [];
        const neededItems = [];
        let orderCost = 0;
        let orderOk = true;

        for (const ing of recipe.ingredients) {
          const itemId = ing.item_id;
          const need = Math.max(0, Number(ing.qty) || 0);
          const have = Math.max(0, Number(inventoryAvailable[itemId] || 0));
          const missing = Math.max(0, need - have);

          const item = content.items?.[itemId];
          if (!item) {
            orderOk = false;
            break;
          }

          const type = normalizeIngredientType(itemId);
          allItems.push({ itemId, need, have, missing, type, name: item.name });

          if (missing > 0) {
            if (!MARKET_ITEM_IDS.includes(itemId)) {
              orderOk = false;
              break;
            }

            const remaining = remainingByType[type] ?? 0;
            if (remaining < missing) {
              orderOk = false;
              break;
            }

            const stock = stockRemaining[itemId] ?? 0;
            if (stock < missing) {
              orderOk = false;
              break;
            }

            const basePrice = s.market_prices?.[itemId] ?? item.base_price ?? 0;
            const price = applyMarketDiscount(basePrice, combinedEffects);
            orderCost += price * missing;
            neededItems.push({ itemId, qty: missing, name: item.name, price, type });
          }
        }

        if (!orderOk || coinsRemaining < orderCost) {
          continue;
        }

        // Reserve inventory and apply purchases for this order
        for (const item of allItems) {
          const usedFromInventory = Math.min(item.need, item.have);
          inventoryAvailable[item.itemId] = Math.max(0, (inventoryAvailable[item.itemId] || 0) - usedFromInventory);
        }

        for (const needItem of neededItems) {
          remainingByType[needItem.type] = Math.max(0, (remainingByType[needItem.type] ?? 0) - needItem.qty);
          stockRemaining[needItem.itemId] = Math.max(0, (stockRemaining[needItem.itemId] ?? 0) - needItem.qty);
          purchasedByItem[needItem.itemId] = (purchasedByItem[needItem.itemId] ?? 0) + needItem.qty;
        }

        coinsRemaining -= orderCost;
        totalAutoCost += orderCost;
        ordersCovered += 1;
      }

      const purchasedItems = Object.entries(purchasedByItem)
        .map(([id, qty]) => `**${qty}× ${displayItemName(id)}**`)
        .join(" · ");

      if (totalAutoCost > 0) {
        if (!p.inv_ingredients) p.inv_ingredients = {};
        if (!p.market_stock) p.market_stock = {};
        for (const [id, qty] of Object.entries(purchasedByItem)) {
          p.inv_ingredients[id] = (p.inv_ingredients[id] ?? 0) + qty;
          p.market_stock[id] = (p.market_stock[id] ?? 0) - qty;
        }
        p.coins = coinsRemaining;
        results.push(`🧑‍🍳 Prep Chef auto-bought: ${purchasedItems} (Total **${totalAutoCost}c**).`);
      }
    }

    if (acceptedNow > 0) advanceTutorial(p, "accept");

    // Build summary for accepted orders
    const acceptedEntries = Object.entries(p.orders?.accepted ?? {});
    const neededByItem = {};
    const neededByRecipe = {};

    acceptedEntries.forEach(([fullId, a]) => {
      const snap = a?.order ?? null;
      const order =
        snap ??
        (p.order_board ?? []).find((o) => o.order_id === fullId) ??
        null;

      if (!order?.recipe_id) return;

      neededByRecipe[order.recipe_id] = (neededByRecipe[order.recipe_id] ?? 0) + 1;
    });

    // Only count ingredients for orders that don't already have bowls ready
    Object.entries(neededByRecipe).forEach(([recipeId, needed]) => {
      const readyTotal = getTotalBowlsForRecipe(p, recipeId);
      const ready = Math.min(needed, readyTotal);
      const remainingToCook = Math.max(0, needed - ready);
      if (remainingToCook <= 0) return;

      const recipe = content.recipes?.[recipeId];
      if (!recipe?.ingredients) return;
      recipe.ingredients.forEach((ing) => {
        neededByItem[ing.item_id] = (neededByItem[ing.item_id] ?? 0) + (ing.qty ?? 0) * remainingToCook;
      });
    });

    const shortages = Object.entries(neededByItem)
      .map(([itemId, needed]) => {
        const have = p.inv_ingredients?.[itemId] ?? 0;
        const short = Math.max(0, needed - have);
        return { itemId, needed, have, short };
      })
      .filter((s) => s.short > 0);

    const readyBowls = Object.entries(neededByRecipe)
      .map(([recipeId, needed]) => {
        const readyTotal = getTotalBowlsForRecipe(p, recipeId);
        const ready = Math.min(needed, readyTotal);
        if (ready <= 0) return null;
        const rName = content.recipes?.[recipeId]?.name ?? recipeId;
        return `• **${rName}** — **${ready}/${needed}** bowl(s) ready`;
      })
      .filter(Boolean);

    const statusParts = [];
    if (readyBowls.length > 0) {
      statusParts.push(`🍲 **Bowls Ready**\n${readyBowls.join("\n")}`);
    }

    if (shortages.length) {
      statusParts.push(
        `\n🧺 **Ingredients Needed**\n${shortages.map((s) => {
          const iName = displayItemName(s.itemId, content);
          return `• ${iName} - You have: **${s.have}**, you need **${s.needed}**`;
        }).join("\n")}`
      );
    } else {
      statusParts.push(`\n🧺 **Ingredients Needed**\n_All ingredients ready to cook!_`);
    }

    if (statusParts.length) {
      results.push("", ...statusParts, "");
    }

    const acceptEmbed = buildMenuEmbed({
      title: "✅ Orders Accepted",
      description: `${results.join("\n")}${tutorialSuffix(p) ? `\n\n${tutorialSuffix(p)}` : ""}`,
      user: interaction.member ?? interaction.user
    });
    const tutorialOnlyBuy = isTutorialStep(p, "intro_market");
    return commitState({
      content: " ",
      embeds: [acceptEmbed],
      components: tutorialOnlyBuy
        ? [noodleTutorialBuyRow(userId)]
        : [noodleOrdersActionRow(userId), noodleMainMenuRow(userId)]
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

    const cancelMsg = `❌ Canceled order \`${shortOrderId(fullId)}\`${rName ? ` — **${rName}**` : ""}${npcName ? ` for *${npcName}*` : ""}.`;
    const cancelEmbed = buildMenuEmbed({
      title: "❌ Order Canceled",
      description: cancelMsg,
      user: interaction.member ?? interaction.user
    });
    return commitState({
      content: " ",
      embeds: [cancelEmbed]
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

      const pickedKey = bowlKey ?? null;
      const selectedEntry = pickedKey && p.inv_bowls?.[pickedKey]
        ? { key: pickedKey, bowl: p.inv_bowls[pickedKey] }
        : getBestBowlEntry(p, order.recipe_id);
      const bowl = selectedEntry?.bowl ?? null;
      if (!bowl || (bowl.qty ?? 0) <= 0) {
        const recipeName = content.recipes?.[order.recipe_id]?.name ?? "that recipe";
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
        content,
        effects: combinedEffects
      });

      const bowlQuality = normalizeQuality(bowl.quality);
      const qualityMult = getQualityMultiplier(bowlQuality);
      rewards.coins = Math.floor(rewards.coins * qualityMult);
      rewards.rep = Math.floor(rewards.rep * qualityMult);
      rewards.sxp = Math.floor(rewards.sxp * qualityMult);

      // Consume fail-streak relief after successful serve (B4)
      consumeFailStreakRelief(p);

      bowl.qty -= 1;
      if (bowl.qty <= 0) delete p.inv_bowls[selectedEntry?.key ?? order.recipe_id];

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
      
      const allowDiscovery = bowlQuality !== "salvage";
      if (allowDiscovery) {
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
          rng: discoveryRng,
          activeSeason: s.season
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
      }

      totalCoins += rewards.coins;
      totalRep += rewards.rep;
      totalSxp += rewards.sxp;
      servedCount += 1;

      const rName = content.recipes[order.recipe_id]?.name ?? "a dish";
      const npcName = content.npcs[order.npc_archetype]?.name ?? "a customer";
      
      // Build the serve message with bonus on same line
      const qualityNote = bowlQuality !== "standard" ? ` (${formatQualityLabel(bowlQuality)})` : "";
      let serveMsg = `Served **${rName}**${qualityNote} to *${npcName}*.`;
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

      if (order.npc_archetype === "seasonal_herald") {
        const badgeResult = grantTemporaryBadge(p, badgesContent, HERALD_BADGE_ID, HERALD_BADGE_DURATION_MS);
        if (badgeResult.status === "granted" || badgeResult.status === "refreshed") {
          const badge = getBadgeById(badgesContent, HERALD_BADGE_ID);
          const icon = badge?.icon ?? "✨";
          const name = badge?.name ?? "Herald's Sign";
          const expiry = badgeResult.expiresAt ? ` (expires <t:${Math.floor(badgeResult.expiresAt / 1000)}:R>)` : "";
          const verb = badgeResult.status === "refreshed" ? "refreshed" : "awarded";
          results.push(`${icon} **${name}** badge ${verb} for 24 hours${expiry}.`);
        }
      }

      applyCollectionProgressOnServe(p, collectionsContent, content, {
        npcArchetype: order.npc_archetype,
        recipeId: order.recipe_id,
        quality: bowlQuality
      });
    }

    if (!servedCount) {
      const failEmbed = buildMenuEmbed({
        title: "🍜 Orders Served",
        description: results.join("\n") || "Nothing served.",
        user: interaction.member ?? interaction.user
      });
      return commitState({ content: " ", embeds: [failEmbed] });
    }

    if (servedCount > 0) {
      applyQuestProgress(p, questsContent, userId, { type: "serve", amount: servedCount }, now);
      if (totalCoins > 0) {
        applyQuestProgress(p, questsContent, userId, { type: "earn_coins", amount: totalCoins }, now);
      }
      unlockBadges(p, badgesContent);
    }

    const state = ensureSpecializationState(p);
    const bowlsServedAfter = p.lifetime.bowls_served_total;
    const newlyUnlockedSpecs = (specializationsContent?.specializations ?? []).filter((spec) => {
      if (!spec?.hidden_until_unlocked) return false;
      const req = spec?.requirements?.bowls_served_total;
      if (!req || bowlsServedAfter < req) return false;
      return !state.unlocked_spec_ids.includes(spec.spec_id);
    });
    if (newlyUnlockedSpecs.length) {
      for (const spec of newlyUnlockedSpecs) {
        state.unlocked_spec_ids.push(spec.spec_id);
      }
      const unlockLines = newlyUnlockedSpecs.map((spec) => {
        const icon = spec.icon ?? "✨";
        return `${icon} **Specialization unlocked:** ${spec.name}`;
      });
      results.push(...unlockLines);
    }
    
    // If a recipe was unlocked, force regenerate order board to include new recipe
    if (recipeUnlocked) {
      delete p.orders_day; // Force regeneration by clearing day marker
      ensureDailyOrdersForPlayer(p, set, content, s.season, serverId, userId);
    }

    applyQuestProgress(p, questsContent, userId, { type: "serve", amount: servedCount }, now);
    if (totalCoins > 0) {
      applyQuestProgress(p, questsContent, userId, { type: "earn_coins", amount: totalCoins }, now);
    }

    const summary = `Rewards total: **+${totalCoins}c**, **+${totalSxp} SXP**, **+${totalRep} REP**.`;
    const levelLine = leveledUp ? `\n✨ Level up! You're now **Level ${p.shop_level}**.` : "";
    const discoveryLine = discoveryMessages.length > 0 ? `\n\n${discoveryMessages.join("\n")}` : "";
    const tut = advanceTutorial(p, "serve");
    const suffix = tut.finished ? `\n\n${formatTutorialCompletionMessage()}` : `${tutorialSuffix(p)}`;

    const components = tut.finished
      ? [noodleMainMenuRow(userId)]
      : [noodleOrdersActionRow(userId), noodleMainMenuRow(userId)];
    const embeds = [];

    const serveEmbed = buildMenuEmbed({
      title: "🍜 Orders Served",
      description: `${results.join("\n")}\n\n${summary}${levelLine}${discoveryLine}${suffix}`,
      user: interaction.member ?? interaction.user
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
const userId = interaction.user.id;
const id = String(interaction.customId || "");
const parts = id.split(":"); // noodle:<kind>:<action>:<ownerId>:...

if (parts[0] !== "noodle") {
return componentCommit(interaction, { content: "Unknown component.", ephemeral: true });
}

const kind = parts[1] ?? "";
const action = parts[2] ?? "";
const ownerId = parts[3] ?? "";

if (kind === "help" && action === "page") {
  if (ownerId && ownerId !== userId) {
    return componentCommit(interaction, { content: "That menu isn’t for you.", ephemeral: true });
  }
  const page = Number(parts[4] ?? 0);
  const { embed, components } = buildHelpPage({
    page,
    userId,
    user: interaction.member ?? interaction.user
  });
  return componentCommit(interaction, {
    content: " ",
    embeds: [embed],
    components,
    targetMessageId: interaction.message?.id
  });
}

if (kind === "dm" && action === "reminders_toggle") {
  const targetServerId = parts[4] ?? "";
  if (!targetServerId) {
    return componentCommit(interaction, { content: "Missing server info for reminders.", ephemeral: true });
  }
  if (ownerId && ownerId !== userId) {
    return componentCommit(interaction, { content: "That button isn’t for you.", ephemeral: true });
  }

  const p = ensurePlayer(targetServerId, userId);
  if (!p.notifications) {
    p.notifications = {
      pending_pantry_messages: [],
      dm_reminders_opt_out: false,
      last_noodle_channel_id: null,
      last_noodle_guild_id: null
    };
  }
  const nextOptOut = !(p.notifications.dm_reminders_opt_out === true);
  p.notifications.dm_reminders_opt_out = nextOptOut;

  if (db) {
    upsertPlayer(db, targetServerId, userId, p, null, p.schema_version);
  }

  const guildName = interaction.client?.guilds?.cache?.get(targetServerId)?.name ?? "this server";
  const channelId = p.notifications.last_noodle_channel_id ?? null;
  const channelUrl = channelId ? `https://discord.com/channels/${targetServerId}/${channelId}` : null;

  const reminderEmbed = buildMenuEmbed({
    title: "📬 Daily Rewards Reminder",
    description: nextOptOut
      ? `Reminders are now **off** for **${guildName}**.`
      : `Reminders are now **on** for **${guildName}**.`,
    user: interaction.user
  });

  const components = buildDmReminderComponents({
    userId,
    serverId: targetServerId,
    channelUrl,
    optOut: nextOptOut
  });

  return componentCommit(interaction, {
    content: " ",
    embeds: [reminderEmbed],
    components
  });
}

const serverId = interaction.guildId;
if (!serverId) {
  return componentCommit(interaction, { content: "This game runs inside a server (not DMs).", ephemeral: true });
}

// lock UI to owner when ownerId is present
if (ownerId && ownerId !== userId && (kind === "nav" || kind === "pick" || kind === "multibuy" || kind === "profile" || kind === "decor")) {
return componentCommit(interaction, { content: "That menu isn’t for you.", ephemeral: true });
}


/* ---------------- PROFILE SPECIALIZATION BUTTONS ---------------- */
if (kind === "profile" && (action === "edit_shop_name" || action === "edit_tagline")) {
  if (!interaction.isButton?.()) {
    return componentCommit(interaction, { content: "That action isn’t available right now.", ephemeral: true });
  }

  const p = ensurePlayer(serverId, userId);
  const sourceMessageId = interaction.message?.id ?? "none";
  const isShopName = action === "edit_shop_name";

  const modal = new ModalBuilder()
    .setCustomId(`noodle:profile:${isShopName ? "shop_name_modal" : "tagline_modal"}:${userId}:${sourceMessageId}`)
    .setTitle(isShopName ? "Edit Shop Name" : "Edit Tagline");

  const input = new TextInputBuilder()
    .setCustomId("value")
    .setLabel(isShopName ? "Shop name" : "Tagline")
    .setStyle(isShopName ? TextInputStyle.Short : TextInputStyle.Paragraph)
    .setRequired(true)
    .setPlaceholder(isShopName
      ? (p.profile?.shop_name ?? "My Noodle Shop")
      : (p.profile?.tagline ?? PROFILE_DEFAULT_TAGLINE));

  modal.addComponents(new ActionRowBuilder().addComponents(input));

  try {
    return await interaction.showModal(modal);
  } catch (e) {
    console.log(`⚠️ showModal failed for profile edit:`, e?.message);
    const code = e?.code ?? e?.message;
    if (code === 10062 || e?.message?.includes("Unknown interaction") || e?.message?.includes("already been acknowledged")) {
      return;
    }
    return componentCommit(interaction, {
      content: "⚠️ Discord couldn't show the edit modal. Try again.",
      ephemeral: true
    });
  }
}

if (kind === "profile" && action === "specialize_select") {
  const p = ensurePlayer(serverId, userId);
  const now = nowTs();
  const specs = (specializationsContent?.specializations ?? []).filter((spec) => {
    if (!isSpecializationVisible(p, spec)) return false;
    const check = canSelectSpecialization(p, specializationsContent, spec.spec_id, now);
    return check.ok || p?.profile?.specialization?.active_spec_id === spec.spec_id;
  });
  if (!specs.length) {
    return componentCommit(interaction, { content: "No specializations available yet.", ephemeral: true });
  }

  const options = specs.map((spec) => ({
    label: spec.name?.slice(0, 100) ?? spec.spec_id,
    description: (spec.description ?? "").slice(0, 100) || "No description yet.",
    value: spec.spec_id
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`noodle:profile:specialize_pick:${userId}`)
    .setPlaceholder("Select a specialization")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options.slice(0, 25));

  const embed = buildMenuEmbed({
    title: "✨ Choose Specialization",
    description: "Pick a specialization to preview and confirm.",
    user: interaction.member ?? interaction.user
  });

  return componentCommit(interaction, {
    content: " ",
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu), noodleProfileEditRow(userId), noodleProfileEditBackRow(userId)],
    targetMessageId: interaction.message?.id
  });
}

/* ---------------- PROFILE BADGE BUTTONS ---------------- */

if (kind === "profile" && action === "specialize_cancel") {
  const p = ensurePlayer(serverId, userId);
  const { embed, page, totalPages } = buildSpecializationListEmbed(p, interaction.member ?? interaction.user, nowTs(), 0, 5);
  const components = [];
  if (totalPages > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:nav:specialize:${userId}:${page - 1}`)
        .setLabel("Prev")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(`noodle:nav:specialize:${userId}:${page + 1}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    ));
  }
  components.push(noodleSpecializeSelectRow(userId), noodleProfileEditRow(userId), noodleProfileEditBackRow(userId));
  return componentCommit(interaction, {
    content: " ",
    embeds: [embed],
    components,
    targetMessageId: interaction.message?.id
  });
}

if (kind === "profile" && action === "specialize_confirm") {
  const specId = parts[4] ?? "";
  const p = ensurePlayer(serverId, userId);
  const now = nowTs();
  const spec = getSpecializationById(specializationsContent, specId);
  if (!spec) {
    return componentCommit(interaction, { content: "Specialization not found.", ephemeral: true });
  }

  const check = canSelectSpecialization(p, specializationsContent, specId, now);
  if (!check.ok) {
    return componentCommit(interaction, { content: check.reason, ephemeral: true });
  }

  const result = selectSpecialization(p, specializationsContent, specId, now);
  if (!result.ok) {
    return componentCommit(interaction, { content: result.reason, ephemeral: true });
  }

  applyDecorSetForSpecialization(p, specId);

  if (db) {
    upsertPlayer(db, serverId, userId, p, null, p.schema_version);
  }

  const embed = buildMenuEmbed({
    title: "✨ Specialization Updated",
    description: `Active specialization: **${result.specialization?.name ?? specId}**.`,
    user: interaction.member ?? interaction.user
  });

  return componentCommit(interaction, {
    content: " ",
    embeds: [embed],
    components: [noodleSpecializeSelectRow(userId), noodleProfileEditRow(userId), noodleProfileEditBackRow(userId)],
    targetMessageId: interaction.message?.id
  });
}

/* -------- SPECIAL SELL NAV HANDLER -------- */
if (kind === "nav" && action === "sell") {
  const s = ensureServer(serverId);
  const p = ensurePlayer(serverId, userId);
  const targetMessageId = interaction.message?.id ?? null;
  
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
    user: interaction.member ?? interaction.user
  });

  return componentCommit(interaction, {
    content: " ",
    embeds: [sellEmbed],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(cancelButton)
    ],
    targetMessageId
  });
}

/* ---------------- NAV BUTTONS ---------------- */
if (kind === "nav") {
const sub = action;
const sourceMessageId = interaction.message?.id;
const page = parts[4] ? Number(parts[4]) : null;
return runNoodle(interaction, {
  sub,
  group: null,
  overrides: {
    messageId: sourceMessageId,
    integers: page !== null && Number.isFinite(page) ? { page } : undefined
  }
});
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

  const rows = [new ActionRowBuilder().addComponents(menu)];
  if (totalPages > 1) rows.push(navRow);

  const acceptEmbed = buildMenuEmbed({
    title: "✅ Accept Orders",
    description: `Select orders to accept here.\nWhen you're done selecting, if on Desktop, press **Esc** to continue.\n\n(page ${page + 1}/${totalPages})`,
    user: interaction.member ?? interaction.user
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
  const actionEmbed = buildMenuEmbed({ title: actionTitle, description: actionDesc, user: interaction.member ?? interaction.user });
  const tutorialOnlyServeMenu = action === "serve" && isTutorialStep(p, "intro_serve");

  return componentCommit(interaction, {
    content: " ",
    embeds: [actionEmbed],
    components: [
      new ActionRowBuilder().addComponents(menu),
      ...(tutorialOnlyServeMenu ? [] : [action === "serve" ? noodleOrdersActionRowWithBack(userId) : noodleOrdersActionRow(userId)])
    ]
  });
}

if (action === "cook") {
  // select a recipe from known_recipes, then modal for qty
  const p = ensurePlayer(serverId, userId);
  const s = ensureServer(serverId);
  const available = getAvailableRecipes(p);
  const activeSeason = s?.season ?? null;
  const seasonFiltered = available.filter((rid) => {
    const r = content.recipes?.[rid];
    if (!r) return true;
    if (r.tier !== "seasonal") return true;
    return !!activeSeason && r.season === activeSeason;
  });
  const opts = seasonFiltered.slice(0, 25).map((rid) => {
    const r = content.recipes?.[rid];
    const labelRaw = r ? `${r.name} (${r.tier})` : displayItemName(rid, content);
    const label = labelRaw.length > 100 ? labelRaw.slice(0, 97) + "…" : labelRaw;
    return { label, value: rid };
  });

  if (!opts.length) {
    const msg = available.length > 0
      ? "You don’t have any recipes available to cook this season."
      : "You don’t know any recipes yet.";
    return componentCommit(interaction, { content: msg, ephemeral: true });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`noodle:pick:cook_select:${userId}`)
    .setPlaceholder("Select a recipe to cook")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(opts);

  const cookEmbed = buildMenuEmbed({
    title: "🍲 Cook",
    description: "Select a recipe to cook:",
    user: interaction.member ?? interaction.user
  });

  const tutorialOnlyMenu = isTutorialStep(p, "intro_cook");
  const components = tutorialOnlyMenu
    ? [new ActionRowBuilder().addComponents(menu)]
    : [new ActionRowBuilder().addComponents(menu), noodleOrdersActionRowWithBack(userId)];

  return componentCommit(interaction, {
    content: " ",
    embeds: [cookEmbed],
    components
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
    const code = e?.code ?? e?.message;
    if (code === 10062 || e?.message?.includes("Unknown interaction") || e?.message?.includes("already been acknowledged")) {
      return;
    }
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

  /* ---------------- PROFILE EDIT MODALS ---------------- */
  if (interaction.isModalSubmit?.() && interaction.customId.startsWith("noodle:profile:shop_name_modal:")) {
    const parts2 = interaction.customId.split(":");
    const owner = parts2[3];
    const messageId = parts2[4] && parts2[4] !== "none" ? parts2[4] : null;

    if (owner && owner !== interaction.user.id) {
      return componentCommit(interaction, { content: "That edit prompt isn’t for you.", ephemeral: true });
    }

    const raw = String(interaction.fields.getTextInputValue("value") ?? "").trim();
    const trimmed = raw.replace(/\s+/g, " ");
    if (!trimmed) {
      return componentCommit(interaction, { content: "Shop name can't be empty.", ephemeral: true });
    }
    if (trimmed.length > 32) {
      return componentCommit(interaction, { content: "Shop name must be 32 characters or fewer.", ephemeral: true });
    }
    if (containsProfanity(trimmed)) {
      return componentCommit(interaction, { content: "Shop name contains blocked words. Please keep it friendly.", ephemeral: true });
    }

    if (!interaction.deferred && !interaction.replied) {
      try {
        await interaction.deferReply({ ephemeral: true });
      } catch (e) {
        // ignore
      }
    }

    const p = ensurePlayer(serverId, userId);
    if (!p.profile) p.profile = { shop_name: "My Noodle Shop", tagline: PROFILE_DEFAULT_TAGLINE };
    p.profile.shop_name = trimmed;

    if (db) {
      upsertPlayer(db, serverId, userId, p, null, p.schema_version);
    }

    const embed = buildMenuEmbed({
      title: "✅ Shop Name Updated",
      description: `Your shop is now **${trimmed}**.`,
      user: interaction.member ?? interaction.user
    });

    return componentCommit(interaction, {
      content: " ",
      embeds: [embed],
      components: [noodleProfileEditRow(userId), noodleProfileEditBackRow(userId)],
      targetMessageId: messageId ?? interaction.message?.id
    });
  }

  if (interaction.isModalSubmit?.() && interaction.customId.startsWith("noodle:profile:tagline_modal:")) {
    const parts2 = interaction.customId.split(":");
    const owner = parts2[3];
    const messageId = parts2[4] && parts2[4] !== "none" ? parts2[4] : null;

    if (owner && owner !== interaction.user.id) {
      return componentCommit(interaction, { content: "That edit prompt isn’t for you.", ephemeral: true });
    }

    const raw = String(interaction.fields.getTextInputValue("value") ?? "").trim();
    const trimmed = raw.replace(/\s+/g, " ");
    if (!trimmed) {
      return componentCommit(interaction, { content: "Tagline can't be empty.", ephemeral: true });
    }
    if (trimmed.length > 80) {
      return componentCommit(interaction, { content: "Tagline must be 80 characters or fewer.", ephemeral: true });
    }
    if (containsProfanity(trimmed)) {
      return componentCommit(interaction, { content: "Tagline contains blocked words. Please keep it friendly.", ephemeral: true });
    }

    if (!interaction.deferred && !interaction.replied) {
      try {
        await interaction.deferReply({ ephemeral: true });
      } catch (e) {
        // ignore
      }
    }

    const p = ensurePlayer(serverId, userId);
    if (!p.profile) p.profile = { shop_name: "My Noodle Shop", tagline: PROFILE_DEFAULT_TAGLINE };
    p.profile.tagline = trimmed;

    if (db) {
      upsertPlayer(db, serverId, userId, p, null, p.schema_version);
    }

    const embed = buildMenuEmbed({
      title: "✅ Tagline Updated",
      description: `Your tagline is now: *${trimmed}*`,
      user: interaction.member ?? interaction.user
    });

    return componentCommit(interaction, {
      content: " ",
      embeds: [embed],
      components: [noodleProfileEditRow(userId), noodleProfileEditBackRow(userId)],
      targetMessageId: messageId ?? interaction.message?.id
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

    const sourceMessageId = interaction.message?.id ?? "none";
    const cacheKey = `${interaction.user.id}:${sourceMessageId}`;
    multibuyCacheV2.set(cacheKey, {
      selectedIds: picked.slice(0, 5),
      sourceMessageId: sourceMessageId === "none" ? null : sourceMessageId,
      expiresAt: Date.now() + 5 * 60 * 1000
    });

    const p = ensurePlayer(serverId, interaction.user.id);
    const tutorialOnlyBuy1 = isTutorialStep(p, "intro_market");
    const { pickedNames, btnRow } = buildMultiBuyButtonsRow(interaction.user.id, picked, sourceMessageId, { limitToBuy1: tutorialOnlyBuy1 });

    const sellButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:nav:sell:${interaction.user.id}`)
        .setLabel("💰 Sell Items")
        .setStyle(ButtonStyle.Secondary)
    );

    const selectionEmbed = buildMenuEmbed({
      title: "🛒 Multi-buy",
      description: `**Selected:** ${pickedNames.join(", ")}\nChoose how you want to buy:`,
      user: interaction.member ?? interaction.user
    });
    selectionEmbed.setFooter({
      text: `Coins: ${p.coins || 0}c\n${ownerFooterText(interaction.member ?? interaction.user)}`
    });

    return componentCommit(interaction, {
      content: " ",
      embeds: [selectionEmbed],
      components: tutorialOnlyBuy1 ? [btnRow] : [btnRow, sellButton]
    });
  }

  /* ---------------- SPECIALIZATION SELECT MENU ---------------- */
  if (interaction.isSelectMenu?.() && interaction.customId.startsWith("noodle:profile:specialize_pick:")) {
    const owner = interaction.customId.split(":")[3];
    if (owner && owner !== interaction.user.id) {
      return componentCommit(interaction, { content: "That menu isn’t for you.", ephemeral: true });
    }

    const specId = interaction.values?.[0];
    const p = ensurePlayer(serverId, userId);
    const now = nowTs();
    const spec = getSpecializationById(specializationsContent, specId);
    if (!spec) return componentCommit(interaction, { content: "Specialization not found.", ephemeral: true });

    const check = canSelectSpecialization(p, specializationsContent, specId, now);
    const description = spec.description ? `\n_${spec.description}_` : "";

    if (!check.ok) {
      const embed = buildMenuEmbed({
        title: "✨ Specialization Locked",
        description: `You can't select **${spec.name}** yet.\nReason: ${check.reason}${description}`,
        user: interaction.member ?? interaction.user
      });

      return componentCommit(interaction, {
        content: " ",
        embeds: [embed],
        components: [noodleSpecializeSelectRow(userId), noodleProfileEditRow(userId), noodleProfileEditBackRow(userId)],
        targetMessageId: interaction.message?.id
      });
    }

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:profile:specialize_confirm:${userId}:${specId}`)
        .setLabel("Confirm")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`noodle:profile:specialize_cancel:${userId}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
    );

    const embed = buildMenuEmbed({
      title: "✨ Confirm Specialization",
      description: `You're about to switch to **${spec.name}**.${description}\n\nPress **Confirm** to apply.`,
      user: interaction.member ?? interaction.user
    });

    return componentCommit(interaction, {
      content: " ",
      embeds: [embed],
      components: [confirmRow, noodleProfileEditRow(userId), noodleProfileEditBackRow(userId)],
      targetMessageId: interaction.message?.id
    });
  }

  /* ---------------- BADGE SELECT MENU ---------------- */

  /* ---------------- MULTI-BUY BUTTONS ---------------- */
  if (interaction.isButton?.() && interaction.customId.startsWith("noodle:multibuy:")) {
    const parts2 = interaction.customId.split(":");
    // noodle:multibuy:<mode>:<ownerId>:<messageId>
    const mode = parts2[2];
    const owner = parts2[3];
    const sourceMessageId = parts2[4] && parts2[4] !== "none" ? parts2[4] : null;
    let cacheKey = `${interaction.user.id}:${sourceMessageId || "none"}`;
    let cacheEntry = multibuyCacheV2.get(cacheKey);

    if (!cacheEntry) {
      const prefix = `${interaction.user.id}:`;
      let newestKey = null;
      let newestEntry = null;
      for (const [key, entry] of multibuyCacheV2.entries()) {
        if (!key.startsWith(prefix)) continue;
        if (!newestEntry || (entry?.expiresAt ?? 0) > (newestEntry?.expiresAt ?? 0)) {
          newestKey = key;
          newestEntry = entry;
        }
      }
      if (newestEntry) {
        cacheKey = newestKey;
        cacheEntry = newestEntry;
      }
    }

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

    if (mode === "qty") {
      const sourceId = cacheEntry.sourceMessageId || interaction.message?.id || "none";
      const p = ensurePlayer(serverId, userId);
      const tutorialOnlyBuy1 = isTutorialStep(p, "intro_market");
      const { pickedNames, btnRow } = buildMultiBuyButtonsRow(interaction.user.id, selectedIds, sourceId, { limitToBuy1: tutorialOnlyBuy1 });
      const sellButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`noodle:nav:sell:${interaction.user.id}`)
          .setLabel("💰 Sell Items")
          .setStyle(ButtonStyle.Secondary)
      );
      const selectionEmbed = buildMenuEmbed({
        title: "🛒 Multi-buy",
        description: `**Selected:** ${pickedNames.join(", ")}\nQuantity entry has been removed. Use Buy 1/5/10 each instead.`,
        user: interaction.member ?? interaction.user
      });
      selectionEmbed.setFooter({
        text: `Coins: ${p.coins || 0}c\n${ownerFooterText(interaction.member ?? interaction.user)}`
      });
      return componentCommit(interaction, {
        content: " ",
        embeds: [selectionEmbed],
        components: tutorialOnlyBuy1 ? [btnRow] : [btnRow, sellButton],
        targetMessageId: sourceId !== "none" ? sourceId : undefined
      });
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
      const cached = db ? getIdempotentResult(db, idemKey) : null;
      if (cached) return componentCommit(interaction, cached);

      const ownerLock = `discord:${interaction.id}`;

      return await withLock(db, `lock:user:${userId}`, ownerLock, 8000, async () => {
        let s = ensureServer(serverId);
        let p2 = ensurePlayer(serverId, userId);
        if (!p2.market_stock) p2.market_stock = {};

        const combinedEffects = calculateCombinedEffects(p2, upgradesContent, staffContent, calculateStaffEffects);
        const perTypeCap = getIngredientCapacityPerType(p2, combinedEffects);
        const countsByType = getIngredientCountsByType(p2);
        const remainingByType = {
          broth: Math.max(0, perTypeCap - (countsByType.broth ?? 0)),
          noodles: Math.max(0, perTypeCap - (countsByType.noodles ?? 0)),
          spice: Math.max(0, perTypeCap - (countsByType.spice ?? 0)),
          topping: Math.max(0, perTypeCap - (countsByType.topping ?? 0))
        };

        const want = {};
        for (const id3 of selectedIds) want[id3] = qtyEach;

        let totalCost = 0;
        const buyLines = [];
        let capacityReduced = false;

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

          const basePrice = s.market_prices?.[id3] ?? it.base_price ?? 0;
          const price = applyMarketDiscount(basePrice, combinedEffects);
          const stock = p2.market_stock?.[id3] ?? 0;
          const type = normalizeIngredientType(id3);
          const remaining = remainingByType[type] ?? 0;
          const qtyToBuy = Math.min(qty3, remaining);

          if (qtyToBuy <= 0) {
            capacityReduced = true;
            continue;
          }

          if (stock < qtyToBuy) {
            const friendly = displayItemName(id3);
            return componentCommit(interaction, {
              content: `Only ${stock} in stock today for **${friendly}**.`,
              ephemeral: true
            });
          }

          if (qtyToBuy < qty3) capacityReduced = true;

          totalCost += price * qtyToBuy;
          buyLines.push({ id: id3, qty: qtyToBuy, name: it.name, price });
          remainingByType[type] = remaining - qtyToBuy;
        }

        if (!buyLines.length) {
          return componentCommit(interaction, {
            content: "🧺 Your pantry is full. Upgrade storage or use ingredients to make room.",
            ephemeral: true
          });
        }

        if ((p2.coins ?? 0) < totalCost) {
          return componentCommit(interaction, { content: `Not enough coins. Total is **${totalCost}c**.`, ephemeral: true });
        }

        // Check inventory capacity before purchase
        const purchaseItems = {};
        for (const x of buyLines) {
          purchaseItems[x.id] = x.qty;
        }
        
        const inventoryResult = addIngredientsToInventory(p2, purchaseItems, "block");
        
        if (!inventoryResult.success) {
          const blockedItems = Object.entries(inventoryResult.blocked)
            .map(([id, qty]) => `${qty}× ${displayItemName(id)}`)
            .join(", ");
          return componentCommit(interaction, { 
            content: `⚠️ **Pantry Full!** Cannot store: ${blockedItems}\nUpgrade your Pantry to increase capacity.`,
            ephemeral: true
          });
        }

        // Apply purchase
        p2.coins -= totalCost;

        for (const x of buyLines) {
          p2.market_stock[x.id] = (p2.market_stock[x.id] ?? 0) - x.qty;
        }

        advanceTutorial(p2, "buy");

        // Persist
        if (db) {
          upsertPlayer(db, serverId, userId, p2, null, p2.schema_version);
          upsertServer(db, serverId, s, null);
        }
        if (db) {
          upsertPlayer(db, serverId, userId, p2, null, p2.schema_version);
          upsertServer(db, serverId, s, null);
        }

        const pretty = buyLines.map((x) => `• **${x.qty}×** ${x.name} (${x.price}c ea)`).join("\n");

        const buyEmbed = buildMenuEmbed({
          title: "🛒 Purchase Complete",
          description: `Bought:\n${pretty}\n\nTotal: **${totalCost}c**.${capacityReduced ? "\n🧺 Pantry capacity limited this purchase." : ""}${tutorialSuffix(p2)}`,
          user: interaction.member ?? interaction.user
        });
        buyEmbed.setFooter({
          text: `Coins: ${p2.coins || 0}c\n${ownerFooterText(interaction.member ?? interaction.user)}`
        });

        const tutorialOnlyForage = isTutorialStep(p2, "intro_forage");
        const tutorialActive = Boolean(p2.tutorial?.active && getCurrentTutorialStep(p2));

        let components;
        if (tutorialActive) {
          components = tutorialOnlyForage
            ? [noodleTutorialForageRow(userId)]
            : [noodleMainMenuRow(userId), noodleSecondaryMenuRow(userId)];
        } else {
          const { btnRow } = buildMultiBuyButtonsRow(interaction.user.id, selectedIds, sourceMessageId, { limitToBuy1: false });
          const sellRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`noodle:nav:sell:${interaction.user.id}`)
              .setLabel("💰 Sell Items")
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId(`noodle:nav:profile:${interaction.user.id}`)
              .setLabel("Back")
              .setStyle(ButtonStyle.Secondary)
          );
          components = [btnRow, sellRow];
        }

        const replyObj = {
          content: " ",
          embeds: [buyEmbed],
          components,
          targetMessageId: interaction.message?.id ?? sourceMessageId ?? null
        };

        if (db) {
          putIdempotentResult(db, { key: idemKey, userId, action, ttlSeconds: 900, result: replyObj });
        }
        if (db) {
          putIdempotentResult(db, { key: idemKey, userId, action, ttlSeconds: 900, result: replyObj });
        }
        
        return componentCommit(interaction, replyObj);
      });
    }

    return componentCommit(interaction, { content: "Unknown multi-buy action.", ephemeral: true });
  }

  /* ---------------- MULTI-BUY QTY MODAL SUBMIT ---------------- */
  if (interaction.isModalSubmit?.() && interaction.customId.startsWith("noodle:multibuy:qty:")) {
    return componentCommit(interaction, {
      content: "Quantity entry has been removed. Use Buy 1/5/10 each instead.",
      ephemeral: true
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
    
    const sourceMessageId = interaction.message?.id ?? "none";
    const btnRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:sell:sell1:${interaction.user.id}:${picked.join(",")}`)
        .setLabel("Sell 1 each")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`noodle:sell:sell5:${interaction.user.id}:${picked.join(",")}`)
        .setLabel("Sell 5 each")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`noodle:sell:sell10:${interaction.user.id}:${picked.join(",")}`)
        .setLabel("Sell 10 each")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`noodle:nav:sell:${interaction.user.id}`)
        .setLabel("Clear")
        .setStyle(ButtonStyle.Danger)
    );

    const sellEmbed = buildMenuEmbed({
      title: "💰 Sell Items",
      description: `**Selected:** ${pickedNames.join(", ")}\nChoose how you want to sell:`,
      user: interaction.member ?? interaction.user
    });

    return componentCommit(interaction, {
      content: " ",
      embeds: [sellEmbed],
      components: [btnRow],
      targetMessageId: interaction.message?.id ?? null
    });
  }

  /* ---------------- SELL BUTTONS ---------------- */
  if (interaction.isButton?.() && interaction.customId.startsWith("noodle:sell:")) {
    const parts2 = interaction.customId.split(":");
    // noodle:sell:<mode>:<ownerId>:<messageId?>:<id1,id2,...>
    const mode = parts2[2];
    const owner = parts2[3];
    const maybeMessageId = parts2[4] && parts2[4] !== "none" ? parts2[4] : null;
    const hasMessageId = Boolean(maybeMessageId) && parts2.length > 5;
    const messageId = hasMessageId ? maybeMessageId : null;
    const idsPart = hasMessageId ? parts2.slice(5).join(":") : parts2.slice(4).join(":");
    const selectedIds = idsPart.split(",").filter(Boolean).slice(0, 5);

    if (owner && owner !== interaction.user.id) {
      return componentCommit(interaction, { content: "That menu isn't for you.", ephemeral: true });
    }

    if (!selectedIds.length) {
      return componentCommit(interaction, { content: "No items selected.", ephemeral: true });
    }

    if (mode === "qty") {
      const pickedNames = selectedIds.map((id) => displayItemName(id));
      const btnRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`noodle:sell:sell1:${interaction.user.id}:${selectedIds.join(",")}`)
          .setLabel("Sell 1 each")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`noodle:sell:sell5:${interaction.user.id}:${selectedIds.join(",")}`)
          .setLabel("Sell 5 each")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`noodle:sell:sell10:${interaction.user.id}:${selectedIds.join(",")}`)
          .setLabel("Sell 10 each")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`noodle:nav:sell:${interaction.user.id}`)
          .setLabel("Clear")
          .setStyle(ButtonStyle.Danger)
      );

      const sellEmbed = buildMenuEmbed({
        title: "💰 Sell Items",
        description: `**Selected:** ${pickedNames.join(", ")}\nQuantity entry has been removed. Use Sell 1/5/10 each instead.`,
        user: interaction.member ?? interaction.user
      });

      return componentCommit(interaction, {
        content: " ",
        embeds: [sellEmbed],
        components: [btnRow],
        targetMessageId: interaction.message?.id ?? null
      });
    }

    // Sell N each
    if (mode === "sell1" || mode === "sell5" || mode === "sell10") {
      const qtyEach = mode === "sell10" ? 10 : mode === "sell5" ? 5 : 1;
      const action = "sell";
      const idemKey = makeIdempotencyKey({ serverId, userId, action, interactionId: interaction.id });
      const cached = db ? getIdempotentResult(db, idemKey) : null;
      if (cached) return componentCommit(interaction, cached);

      const owner2 = `discord:${interaction.id}`;
      if (!db) {
        return componentCommit(interaction, { content: "Database unavailable in this environment.", ephemeral: true });
      }
      return await withLock(db, `lock:user:${userId}`, owner2, 8000, async () => {
        let s = ensureServer(serverId);
        let p2 = ensurePlayer(serverId, userId);

        const sellLines = [];
        let totalGain = 0;

        for (const id of selectedIds) {
          const it = content.items[id];
          if (!it) continue;
          
          const owned = p2.inv_ingredients?.[id] ?? 0;
          if (owned < qtyEach) continue;

          const unit = sellPrice(s, id);
          const gain = unit * qtyEach;

          p2.inv_ingredients[id] = owned - qtyEach;
          p2.coins += gain;
          p2.lifetime.coins_earned += gain;
          totalGain += gain;

          sellLines.push({ id, name: it.name, qty: qtyEach, price: unit });
        }

        if (!sellLines.length) {
          return componentCommit(interaction, {
            content: "❌ You don't have any of those items to sell.",
            ephemeral: true
          });
        }

        if (db) {
          upsertPlayer(db, serverId, userId, p2, null, p2.schema_version);
        }
        if (db) {
          upsertPlayer(db, serverId, userId, p2, null, p2.schema_version);
        }

        const pretty = sellLines.map((x) => `• **${x.qty}× ** ${x.name} (${x.price}c ea)`).join("\n");

        const sellEmbed = buildMenuEmbed({
          title: "💰 Sold Items",
          description: `Sold:\n${pretty}\n\nTotal: **${totalGain}c**.`,
          user: interaction.member ?? interaction.user
        });

        const replyObj = {
          content: " ",
          embeds: [sellEmbed],
          components: [noodleMainMenuRow(userId)],
          targetMessageId: interaction.message?.id ?? null
        };

        if (db) {
          putIdempotentResult(db, { key: idemKey, userId, action, ttlSeconds: 900, result: replyObj });
        }
        if (db) {
          putIdempotentResult(db, { key: idemKey, userId, action, ttlSeconds: 900, result: replyObj });
        }
        return componentCommit(interaction, replyObj);
      });
    }
  }

  /* ---------------- SELL QTY MODAL SUBMIT ---------------- */
  if (interaction.isModalSubmit?.() && interaction.customId.startsWith("noodle:sell:qty:")) {
    return componentCommit(interaction, {
      content: "Quantity entry has been removed. Use Sell 1/5/10 each instead.",
      ephemeral: true
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
    .addSubcommand((sc) =>
      sc
        .setName("specialize")
        .setDescription("Choose a shop specialization")
        .addStringOption((o) =>
          o
            .setName("spec")
            .setDescription("Specialization id")
            .setRequired(false)
            .setAutocomplete(true)
        )
        .addBooleanOption((o) => o.setName("confirm").setDescription("Confirm specialization change").setRequired(false))
    )
    .addSubcommand((sc) => sc.setName("season").setDescription("Show the current season."))
    .addSubcommand((sc) => sc.setName("pantry").setDescription("View your ingredient pantry."))
    .addSubcommand((sc) => sc.setName("recipes").setDescription("View your unlocked recipes and clues."))
    .addSubcommand((sc) => sc.setName("regulars").setDescription("View regular NPCs and their bonuses."))
    .addSubcommand((sc) => sc.setName("status").setDescription("Show reset timestamps (debug info)."))
    .addSubcommand((sc) => sc.setName("event").setDescription("Show the current event (if any)."))
    .addSubcommand((sc) => sc.setName("quests").setDescription("View active quests."))
    .addSubcommand((sc) => sc.setName("quests_daily").setDescription("Claim your daily reward."))
    .addSubcommand((sc) => sc.setName("quests_claim").setDescription("Claim completed quest rewards."))
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

export { noodleMainMenuRow, noodleMainMenuRowNoProfile, displayItemName, renderProfileEmbed };
