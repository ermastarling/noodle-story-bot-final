import fs from "fs";
import path from "path";
import {
  canForage,
  rollForageDrops,
  applyDropsToInventory,
  setForageCooldown,
  FORAGE_ITEM_IDS,
  RARE_FORAGE_ITEM_IDS
} from "../game/forage.js";
import { addIngredientsToInventory, removeIngredientsFromInventory } from "../game/inventory.js";
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
  loadDecorSetsContent,
  loadEventsContent
} from "../content/index.js";
import { buildSettingsMap } from "../settings/resolve.js";
import { openDb, getPlayer, upsertPlayer, getServer, upsertServer, getLastActiveAt } from "../db/index.js";
import { withLock } from "../infra/locks.js";
import { makeIdempotencyKey, getIdempotentResult, putIdempotentResult } from "../infra/idempotency.js";
import { newPlayerProfile, trackLastKitchen } from "../game/player.js";
import { newServerState } from "../game/server.js";
import { computeActiveSeason } from "../game/seasons.js";
import { rollMarket, rollPlayerMarketStock, sellPrice, MARKET_ITEM_IDS } from "../game/market.js";
import {
  ensureDailyOrdersForPlayer,
  computeOrderCount,
  generateOrderPageForPlayer,
  findOrderByToken,
  getOrdersMeta,
  markOrderConsumed
} from "../game/orders.js";
import { computeServeRewards, applySxpLevelUp } from "../game/serve.js";
import {
  STARTER_PROFILE,
  CLUES_TO_UNLOCK_RECIPE,
  INGREDIENT_CAPACITY_BASE,
  BOWL_STORAGE_CAPACITY_BASE,
  PROFILE_DEFAULT_TAGLINE,
  PROFILE_BADGES_SHOWN,
  PROFILE_COLLECTIONS_SHOWN
} from "../constants.js";
import { nowTs, dayKeyUTC, parseYYYYMMDD } from "../util/time.js";
import { containsProfanity } from "../util/profanity.js";
import { socialMainMenuRow, socialMainMenuRowNoProfile } from "./noodleSocial.js";
import { getUserActiveParty, getActiveBlessing, clearExpiredBlessings, BLESSING_EFFECTS } from "../game/social.js";
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
import { getActiveEvent, getActiveEventEffects, getEventWindow, getActiveEventRecipes, withEventRecipes, buildEventRecipeSeasonMap } from "../game/events.js";
import { rollRecipeDiscovery, applyDiscovery, applyNpcDiscoveryBuff } from "../game/discovery.js";
import { makeStreamRng } from "../util/rng.js";
import { applyQuestProgress, ensureQuests, claimCompletedQuests, getQuestSummary } from "../game/quests.js";
import { claimDailyReward, hasDailyRewardAvailable } from "../game/daily.js";
import { ensureBadgeState, getBadgeById, getOwnedBadges, unlockBadges, grantTemporaryBadge, grantEventBadgesForKnownRecipes } from "../game/badges.js";
import {
  applyCollectionProgressOnServe,
  applyCollectionProgressOnCook,
  ensureCollectionsState,
  ensureCollectionProgress,
  getCollectionsSummary,
  resolveCollectionEntries,
  backfillRecipeCollections,
  revalidateCollections
} from "../game/collections.js";
import {
  canSelectSpecialization,
  ensureSpecializationState,
  getActiveSpecialization,
  getSpecializationById,
  hasNewShopLevelSpecialization,
  getUnseenHiddenSpecializations,
  markSpecializationShopLevelSeen,
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
import {
  ensureGardenState,
  isGardenUnlocked,
  getGardenUnlockState,
  addSeeds,
  getCompostCap,
  getGardenPlotCount,
  ensureGardenPlots,
  plantSeedInPlot,
  harvestGardenPlots,
  autoHarvestReadyPlots,
  getCompostableForageables,
  craftCompostBags,
  getSeedIdForIngredient,
  getSeedDisplayName,
  getSeedYieldMap,
  getPlotYieldRemaining,
  describeYieldMap,
  getYieldTotal,
  formatSeedLines,
  formatSpoiledLines,
  formatPlotLines,
  GARDEN_UNLOCK_LEVEL,
  COMPOST_PER_BAG,
  SPOILED_STASH_KEY
} from "../game/garden.js";
import {
  canFish,
  rollFishingDrops,
  setFishingCooldown,
  ensureFishingState,
  getFishingUnlockState,
  applyFishingDrops,
  FISHING_RECIPE_IDS,
  unlockFishingRecipesFromDrops,
  FISHING_BASE_COOLDOWN_MS,
  FISHING_UNLOCK_LEVEL,
  RARE_FISHING_ITEM_IDS,
  FISHING_ITEM_IDS,
  isFishingUnlocked,
  isFishingIngredientLocked
} from "../game/fishing.js";
import {
  ensureKitchenState,
  getKitchenStatus,
  getKitchenBatches,
  getKitchenCapacity,
  getKitchenUnlockState,
  getKitchenForagePool,
  getCraftableCountForBroth,
  getBrothRecipe,
  planKitchenIngredients,
  KITCHEN_FORAGE_PER_BROTH,
  getKitchenSimmerDurationMs,
  KITCHEN_BROTH_RECIPES,
  KITCHEN_UNLOCK_LEVEL
} from "../game/kitchen.js";
import { theme } from "../ui/theme.js";
import { getIcon, getIconUrl, getButtonEmoji, resolveIcon } from "../ui/icons.js";
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
// Temporary cache for compost selections keyed by message id
const compostSelectionCache = new Map();

function gardenUnlockLine(prevLevel, newLevel) {
  if ((prevLevel ?? 0) < GARDEN_UNLOCK_LEVEL && (newLevel ?? 0) >= GARDEN_UNLOCK_LEVEL) {
    return `\n${getIcon("tree")} Garden unlocked! Find it in Forage or Pantry.`;
  }
  return "";
}

function fishingUnlockLine(prevLevel, newLevel) {
  if ((prevLevel ?? 0) < FISHING_UNLOCK_LEVEL && (newLevel ?? 0) >= FISHING_UNLOCK_LEVEL) {
    return `\n${getIcon("fishing")} Fishing unlocked! Head out through the Pantry to start fishing.`;
  }
  return "";
}

function applyUnlockNoticeEmbeds(payload = {}, player, user) {
  if (!player) return payload;

  const garden = getGardenUnlockState(player);
  const kitchen = getKitchenUnlockState(player);
  const fishing = getFishingUnlockState(player);

  const notices = [];
  if (garden?.justUnlocked) {
    notices.push(
      buildMenuEmbed({
        title: `${getIcon("tree")} Garden Unlocked`,
        description: "Plant seeds and harvest ingredients with `/noodle garden` (find it through your Pantry).",
        user
      })
    );
  }
  if (kitchen?.justUnlocked) {
    notices.push(
      buildMenuEmbed({
        title: `${getIcon("cook")} Kitchen Unlocked`,
        description: "Simmer your own broths with `/noodle kitchen` (find it through your Pantry).",
        user
      })
    );
  }
  if (fishing?.justUnlocked) {
    notices.push(
      buildMenuEmbed({
        title: `${getIcon("fishing")} Fishing Unlocked`,
        description: "Catch fish and seafood with `/noodle fishing` (find it through your Pantry).",
        user
      })
    );
  }

  if (!notices.length) return payload;

  const updated = { ...(payload ?? {}) };
  const existingEmbeds = Array.isArray(updated.embeds) ? [...updated.embeds] : [];

  for (const notice of notices) {
    if (!notice) continue;
    const title = notice?.title ?? notice?.data?.title ?? "";
    const alreadyPresent = existingEmbeds.some((e) => {
      const t = e?.title ?? e?.data?.title ?? "";
      return title && t === title;
    });
    if (!alreadyPresent) existingEmbeds.push(notice);
  }

  if (existingEmbeds.length) {
    updated.embeds = existingEmbeds;
    if (updated.content === undefined) updated.content = " ";
  }

  Object.defineProperty(updated, "__unlockNoticeApplied", { value: true, enumerable: false });
  return updated;
}

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

const PROTEIN_ITEM_IDS = new Set([
  "topping_roasted_pork",
  "topping_grilled_chicken",
  "topping_braised_tofu",
  "topping_brisket"
]);
const SELLABLE_ITEM_IDS = new Set([...MARKET_ITEM_IDS, ...FISHING_ITEM_IDS]);

function getStarBrothCount(player, brothId) {
  const raw = Math.max(0, Number(player?.star_broths?.[brothId] || 0));
  const invQty = Math.max(0, Number(player?.inv_ingredients?.[brothId] || 0));
  return Math.max(0, Math.min(raw, invQty));
}

function addStarBroths(player, drops) {
  if (!player.star_broths) player.star_broths = {};
  for (const [id, qty] of Object.entries(drops ?? {})) {
    const q = Math.max(0, Number(qty) || 0);
    if (!q) continue;
    player.star_broths[id] = (player.star_broths[id] ?? 0) + q;
  }
}

function consumeStarBroth(player, brothId, qty) {
  if (!player?.star_broths) return 0;
  const current = Math.max(0, Number(player.star_broths[brothId] || 0));
  const use = Math.min(current, Math.max(0, Number(qty) || 0));
  if (use > 0) {
    player.star_broths[brothId] = current - use;
    if (player.star_broths[brothId] <= 0) delete player.star_broths[brothId];
  }
  return use;
}

const baseContent = loadContentBundle(1);
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
const eventsContent = loadEventsContent();
const content = withEventRecipes(baseContent, eventsContent);
const eventRecipeSeasonIndex = buildEventRecipeSeasonMap(eventsContent);
const db = openDb();

const HERALD_BADGE_ID = "seasonal_herald";
const HERALD_BADGE_DURATION_MS = 24 * 60 * 60 * 1000;
const DEV_ADMIN_USER_ID = "705521883335885031";
const DISCORD_STORE_URL = "https://noodlestory.lol/home/shop/";

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
  legend_hall: "legendary_noodle_hall",
  tideglass_pavilion: "tideglass_pavilion",
  bloomwarden_garden_hall: "bloomwarden_garden_hall",
  astral_caravan: "astral_caravan",
  imperial_silk_noodle_court: "imperial_silk_noodle_court",
  elderwood_hearth: "elderwood_hearth",
  celestial_archive_kitchen: "celestial_archive_kitchen",
  sakura_sweetheart_noodle_atelier: "sakura_sweetheart_noodle_atelier"
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

function getSpecializationAlert(player) {
  const hiddenUnseen = getUnseenHiddenSpecializations(player, specializationsContent);
  if (hiddenUnseen.length) return true;
  return hasNewShopLevelSpecialization(player, specializationsContent);
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

function hasGreenButton(components) {
  const rows = Array.isArray(components) ? components : (components ? [components] : []);
  for (const row of rows) {
    const rowJson = row?.toJSON ? row.toJSON() : row;
    const comps = row?.components ?? rowJson?.components ?? [];
    for (const comp of comps) {
      const style = comp?.style ?? comp?.data?.style;
      if (style === ButtonStyle.Success || style === 3) return true;
      if (typeof style === "string" && style.toLowerCase() === "success") return true;
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

function buildMarketRefreshFooterText(existingFooterText, marketRestockMs, nowMs = Date.now()) {
  if (!marketRestockMs) return existingFooterText;
  if (existingFooterText?.toLowerCase?.().includes("market restock:")) return existingFooterText;

  const locale = "en-US";
  const dateText = new Date(marketRestockMs).toLocaleString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });

  const diffMs = marketRestockMs - nowMs;
  const absMinutes = Math.round(Math.abs(diffMs) / 60000);
  let relativeText = "";
  if (absMinutes === 0) {
    relativeText = "now";
  } else if (absMinutes < 60) {
    relativeText = `${absMinutes} min ${diffMs >= 0 ? "from now" : "ago"}`;
  } else {
    const hours = Math.round(absMinutes / 60);
    const mins = absMinutes % 60;
    const hourPart = `${hours} hr${hours === 1 ? "" : "s"}`;
    const minPart = mins ? ` ${mins} min` : "";
    relativeText = `${hourPart}${minPart} ${diffMs >= 0 ? "from now" : "ago"}`;
  }

  const marketText = `Market Restock: ${dateText}${relativeText ? ` (${relativeText})` : ""}`;
  return existingFooterText ? `${existingFooterText} • ${marketText}` : marketText;
}

function isDevAdmin(userId) {
  return String(userId ?? "") === DEV_ADMIN_USER_ID;
}

function buildHelpPage({ page, userId, user }) {
  const pages = [
    {
      title: `${getIcon("help")} Help`,
      description: [
        "**Hello chef! Begin the tutorial with `/noodle start`, you can play exclusively with buttons.**",
        "\n**When you've completed the tutorial, you will only need to use `/noodle orders` any time you want to access all play commands.**",
        "",
        `Error messages are sent only to you.\n${getIcon("help")} If you need further help, screenshot your error & head over to the ⁠support server! [Join here](https://discord.gg/uue7K92pwj)\n\nTip: Copy/paste the '/noodle start' or '/noodle orders' text into a message on this channel and send!`
      ].join("\n"),
      supportUrl: "https://discord.gg/uue7K92pwj"
    },
    {
      title: `${getIcon("help")} Help — Buttons`,
      description: "Commands you can play with buttons.",
      fields: [
        {
          name: "Main Menu",
          value: [
            "• `/noodle orders` — View today's orders.",
            "• `/noodle buy` — Buy ingredients (multi-buy).",
            "• `/noodle profile` — View your profile.",
            "• `/noodle pantry` — View your pantry."
          ].join("\n"),
          inline: true
        },
        {
          name: "Orders Menu",
          value: [
            "• `/noodle accept` — Accept an order.",
            "• `/noodle cook` — Cook a recipe.",
            "• `/noodle serve` — Serve accepted orders.",
            "• `/noodle cancel` — Cancel an accepted order."
          ].join("\n"),
          inline: true
        },
        {
          name: "Pantry & Gathering",
          value: [
            "• `/noodle pantry` — View your pantry.",
            "• `/noodle forage` — Forage for ingredients.",
            "• `/noodle recipes` — View your recipes and clues.",
            "• `/noodle regulars` — View your shop regulars.",            
            `• \`/noodle garden\` — Tend your garden. ${getIcon("lock")} Unlocks at shop level ${GARDEN_UNLOCK_LEVEL}.`,
            `• \`/noodle kitchen\` — Simmer your own broths. ${getIcon("lock")} Unlocks at shop level ${KITCHEN_UNLOCK_LEVEL}.`,
            `• \`/noodle fishing\` — Cast a line for fresh catches. ${getIcon("lock")} Unlocks at shop level ${FISHING_UNLOCK_LEVEL}.`
          ].join("\n"),
          inline: true
        },
        {
          name: "Profile & Customize",
          value: [
            "• `/noodle-upgrades` — View and purchase shop upgrades.",
            "• `/noodle-staff` — Hire, level, and manage your staff.",
            "• `/noodle specialize` — Choose a shop specialization.",
            "• Shop Name & Tagline buttons — Edit shop name/tagline.",
            "• Store button — Opens the decor/cosmetics store."
          ].join("\n"),
          inline: true
        },
        {
          name: "Quests & Events",
          value: [
            "• `/noodle quests` — View quests.",
            "• `/noodle quests_daily` — Claim your daily reward.",
            "• `/noodle quests_claim` — Claim your quest rewards.",
            "• `/noodle season` — View the current season.",
            "• `/noodle event` — View the current event."
          ].join("\n"),
          inline: true
        },
        {
          name: "Social & Party",
          value: [
            "• `/noodle-social party` — Manage your party.",
            "• `/noodle-social stats` — View your social stats.",
            "• `/noodle-social visit` — Visit another shop (grants a blessing).",
            "• `/noodle-social tip` — Send a tip to another player.",
            "• `/noodle-social leaderboard` — View server leaderboards.",
            "• Collections button — View your collections."
          ].join("\n"),
          inline: true
        }
      ]
    },
    {
      title: `${getIcon("help")} Help — Slash Commands Only`,
      description: [
        "Commands without buttons:",
        "",
        "**Noodle**",
        "• `/noodle start` — Start the tutorial.",
        "• `/noodle help` — Show this help menu.",
        "",
        "**Party**",
        "• `/noodle-social party action:rename name:<new>` — Change party name.",
        "• `/noodle-social party action:transfer_leader user:<member>` — Transfer leadership.",
        "• `/noodle-social party action:kick user:<member>` — Kick a party member."
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
  if (current.fields) {
    embed.setFields(current.fields);
  }
  const ownerText = user ? ownerFooterText(user) : null;
  const footerText = ownerText
    ? `Page ${safePage + 1}/${pages.length} • ${ownerText}`
    : `Page ${safePage + 1}/${pages.length}`;
  embed.setFooter({ text: footerText });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:help:page:${userId}:${safePage - 1}`)
      .setLabel("Prev")
      .setEmoji(getButtonEmoji("back"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage <= 0),
    new ButtonBuilder()
      .setCustomId(`noodle:help:page:${userId}:${safePage + 1}`)
      .setLabel("Next")
      .setEmoji(getButtonEmoji("next"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage >= pages.length - 1)
  );

  const rows = [row];
  if (current.supportUrl) {
    const supportRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("Join Support Server")
        .setStyle(ButtonStyle.Link)
        .setURL(current.supportUrl)
    );
    rows.unshift(supportRow);
  }

  return { embed, components: rows };
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
    const reqCheck = spec ? meetsSpecializationRequirements(player, requirements, specId) : { ok: false, reason: "Unavailable." };
    const status = showSpecialization
      ? (equippedSetId === set.set_id
        ? `${getIcon("status_complete")} Equipped`
        : reqCheck.ok
          ? "Available"
          : `${getIcon("lock")} ${reqCheck.reason}`)
      : (equippedSetId === set.set_id
        ? `${getIcon("status_complete")} Equipped`
        : completed.has(set.set_id)
          ? `${getIcon("status_complete")} Complete`
          : `${getIcon("status_incomplete")}`);
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
    title: showSpecialization
      ? `${getIcon("decor")} Decor — Specialization Sets`
      : `${getIcon("decor")} Decor — Collection Sets`,
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
new ButtonBuilder().setCustomId(`noodle:nav:orders:${userId}`).setLabel("Orders").setEmoji(getButtonEmoji("orders")).setStyle(ButtonStyle.Primary),
new ButtonBuilder().setCustomId(`noodle:nav:buy:${userId}`).setLabel("Buy").setEmoji(getButtonEmoji("cart")).setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:pantry:${userId}`).setLabel("Pantry").setEmoji(getButtonEmoji("basket")).setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:profile:${userId}`).setLabel("Profile").setEmoji(getButtonEmoji("profile")).setStyle(ButtonStyle.Secondary)
);
}

function noodleForageGardenRow(userId, {
  active = "forage",
  gardenLocked = false,
  includeGardenButton = true,
  includeFishingButton = false,
  includeKitchenButton = false,
  kitchenUnlocked = false,
  kitchenJustUnlocked = false,
  fishingUnlocked = false,
  fishingJustUnlocked = false,
  canCompost = false,
  canHarvest = false,
  showGardenActions = false,
  gardenStyleOverride = null,
  fishingStyleOverride = null
} = {}) {
  const foragePrimary = active === "forage";
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:nav:forage:${userId}`)
      .setLabel("Forage").setEmoji(getButtonEmoji("forage"))
      .setStyle(foragePrimary ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  if (includeGardenButton) {
    const gardenPrimary = active === "garden";
    const gardenUnlocked = !gardenLocked;
    const gardenStyleBase = gardenStyleOverride ?? (gardenUnlocked ? ButtonStyle.Success : ButtonStyle.Secondary);
    const gardenStyle = gardenPrimary ? (gardenStyleOverride ?? ButtonStyle.Success) : gardenStyleBase;
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:nav:garden:${userId}`)
        .setLabel("Garden").setEmoji(getButtonEmoji("tree"))
        .setStyle(gardenStyle)
        .setDisabled(gardenLocked)
    );
  }

  if (includeFishingButton) {
    const fishingPrimary = active === "fishing";
    const fishingStyleBase = fishingStyleOverride ?? (!fishingUnlocked
      ? ButtonStyle.Secondary
      : (fishingJustUnlocked ? ButtonStyle.Success : ButtonStyle.Secondary));
    const fishingStyle = fishingPrimary ? (fishingStyleOverride ?? ButtonStyle.Success) : fishingStyleBase;
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:nav:fishing:${userId}`)
        .setLabel("Fishing")
        .setEmoji(getButtonEmoji("fishing"))
        .setStyle(fishingStyle)
        .setDisabled(!fishingUnlocked)
    );
  }

  if (includeKitchenButton) {
    const kitchenPrimary = active === "kitchen";
    const kitchenStyle = !kitchenUnlocked
      ? ButtonStyle.Secondary
      : (kitchenJustUnlocked ? ButtonStyle.Success : ButtonStyle.Secondary);
    const kitchenEmoji = kitchenPrimary ? getButtonEmoji("refresh") : getButtonEmoji("cook");
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:nav:kitchen:${userId}`)
        .setLabel("Kitchen")
        .setEmoji(kitchenEmoji)
        .setStyle(kitchenPrimary ? ButtonStyle.Success : kitchenStyle)
        .setDisabled(!kitchenUnlocked)
    );
  }

  if (showGardenActions) {
    const compostPrimary = active === "compost";
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:action:compost:${userId}`)
        .setLabel("Make Compost")
        .setEmoji(getButtonEmoji("basket"))
        .setStyle(compostPrimary ? ButtonStyle.Success : ButtonStyle.Primary)
        .setDisabled(!canCompost),
      new ButtonBuilder()
        .setCustomId(`noodle:action:harvest:${userId}`)
        .setLabel("Harvest All")
        .setEmoji(getButtonEmoji("basket"))
        .setStyle(canHarvest ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(!canHarvest)
    );
  }

  return row;
}

function getGardenActionState(player, effects) {
  const garden = ensureGardenState(player);
  const plots = ensureGardenPlots(player, effects);
  const now = Date.now();

  const compostCap = getCompostCap(player, effects);
  const compostCount = garden.compost_bags || 0;
  const spoiledTotal = Object.values(garden.spoiled || {}).reduce((sum, v) => sum + (v || 0), 0);
  const pantryForageables = getCompostableForageables(player, content);
  const pantryTotal = Object.values(pantryForageables).reduce((sum, v) => sum + (v || 0), 0);
  const craftableBags = Math.floor((spoiledTotal + pantryTotal) / COMPOST_PER_BAG);
  const room = Math.max(0, compostCap - compostCount);
  const canCraft = craftableBags > 0 && room > 0;

  const readyPlots = plots
    .map((plot, idx) => ({ plot, idx, remainingTotal: getYieldTotal(getPlotYieldRemaining(plot)) }))
    .filter(({ plot, remainingTotal }) => plot?.seed_id && remainingTotal > 0 && (!plot.harvest_ready_at || plot.harvest_ready_at <= now))
    .map(({ plot, idx, remainingTotal }) => ({ ...plot, idx, remainingTotal }));

  return {
    canCraft,
    compostCap,
    compostCount,
    readyPlots,
    hasHarvestable: readyPlots.length > 0,
    spoiledTotal,
    pantryTotal
  };
}

function gardenPageRow(userId, page = 0) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:nav:garden:${userId}:0`)
      .setLabel("Plots")
      .setStyle(page === 0 ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:garden:${userId}:1`)
      .setLabel("Seeds / Compost")
      .setStyle(page === 1 ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );
}

function chunkTextByLength(text, maxLen = 900) {
  if (!text) return [];
  const lines = String(text).split("\n");
  const chunks = [];
  let buf = "";
  for (const line of lines) {
    const next = buf ? `${buf}\n${line}` : line;
    if (next.length > maxLen && buf) {
      chunks.push(buf);
      buf = line;
    } else if (next.length > maxLen) {
      chunks.push(next.slice(0, maxLen));
      buf = next.slice(maxLen);
    } else {
      buf = next;
    }
  }
  if (buf) chunks.push(buf);
  return chunks.filter(Boolean);
}

function sanitizeEmbedsForDiscord(embeds) {
  if (!Array.isArray(embeds)) return embeds;

  const MAX_FIELD = 1024;
  const SAFE_SLICE = 900;
  const MAX_DESC = 4000; // Leave headroom for suffixes

  const chunkField = (field) => {
    const name = field?.name ?? " ";
    const inline = field?.inline ?? false;
    const value = field?.value ?? "";
    if (!value || String(value).length <= MAX_FIELD) return [{ name, value, inline }];
    const parts = chunkTextByLength(String(value), SAFE_SLICE);
    return parts.map((part, idx) => ({
      name: idx === 0 ? name : `${name} (cont.)`,
      value: part,
      inline
    }));
  };

  return embeds.map((embed) => {
    if (!embed) return embed;
    const safe = embed.toJSON ? new EmbedBuilder(embed) : embed; // clone if builder
    const fields = safe?.data?.fields || safe?.fields || [];
    if (fields.length) {
      const newFields = fields.flatMap((f) => chunkField(f));
      if (safe.spliceFields) safe.spliceFields(0, safe.fields?.length ?? fields.length, ...newFields);
      else safe.fields = newFields;
    }

    const desc = safe?.data?.description ?? safe?.description ?? "";
    if (desc && desc.length > MAX_DESC && safe.setDescription) {
      const truncated = desc.slice(0, MAX_DESC);
      safe.setDescription(`${truncated}\n\n(Description truncated)`);
    }

    return safe;
  });
}

function pantryPageRow(userId, page = 0, totalPages = 1, ingredientPages = 1) {
  const clampedTotal = Math.max(1, totalPages);
  const safePage = Math.min(Math.max(page, 0), clampedTotal - 1);
  const ingredientsPageCount = Math.max(1, ingredientPages);
  const bowlsStartPage = ingredientsPageCount;
  const viewingIngredients = safePage < ingredientsPageCount;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:nav:pantry:${userId}:${Math.max(0, safePage - 1)}`)
      .setLabel("Prev")
      .setEmoji(getButtonEmoji("back"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage <= 0),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:pantry:${userId}:0`)
      .setLabel("Ingredients")
      .setEmoji(getButtonEmoji("basket"))
      .setStyle(viewingIngredients ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:pantry:${userId}:${bowlsStartPage}`)
      .setLabel("Cooked Bowls")
      .setEmoji(getButtonEmoji("cook"))
      .setStyle(viewingIngredients ? ButtonStyle.Secondary : ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:pantry:${userId}:${Math.min(clampedTotal - 1, safePage + 1)}`)
      .setLabel("Next")
      .setEmoji(getButtonEmoji("next"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage >= clampedTotal - 1)
  );
}

function buildGardenView({ player, combinedEffects, user, userId, kitchenUnlocked = false, kitchenJustUnlocked = false, page = 0 }) {
  const garden = ensureGardenState(player);
  const plots = ensureGardenPlots(player, combinedEffects);
  const gardenState = getGardenActionState(player, combinedEffects);
  const allowedIngredients = getUnlockedIngredientIds(player, content);
  const compostCap = gardenState.compostCap;
  const compostCount = gardenState.compostCount;
  const spoiledTotal = gardenState.spoiledTotal;
  const pantryTotal = gardenState.pantryTotal;
  const canCraft = gardenState.canCraft;
  const readyPlots = gardenState.readyPlots;
  const room = Math.max(0, compostCap - compostCount);

  const seedSection = formatSeedLines(garden.seeds, content);
  const spoiledSection = formatSpoiledLines(garden.spoiled, content);
  const plotsSection = formatPlotLines(player, content, combinedEffects);

  const hasHarvestable = readyPlots.length > 0;
  const hasEmptyPlot = plots.some((plot) => !plot?.seed_id || getYieldTotal(getPlotYieldRemaining(plot)) <= 0);

  const plotSummary = `${getIcon("tree")} Plots available: **${getGardenPlotCount(player, combinedEffects)}**`;
  const plotsLinesRaw = plotsSection ? plotsSection.split("\n").filter(Boolean) : [];
  const plotsLines = plotsLinesRaw.length ? plotsLinesRaw : ["_No plots available yet._"];

  const seedsValue = [
    "· · · · · · ·",
    `${getIcon("tree")} **Seeds (unlimited)**`,
    seedSection
  ].join("\n");

  const compostValue = [
    "· · · · · · ·",
    `${getIcon("basket")} Compost: **${compostCount}/${compostCap}** bags${room <= 0 ? " (capacity reached)" : ""}`,
    `**Compost Inputs**`,
    `Spoiled saved: **${spoiledTotal}**`,
    `Fresh forageables: **${pantryTotal}**`,
    `Recipe: ${COMPOST_PER_BAG} spoiled or fresh forageables = 1 bag`
  ].join("\n");

  const description = [`Manage your garden.`, plotSummary].join("\n\n");

  const seedOptions = Object.entries(garden.seeds || {})
    .filter(([, qty]) => qty > 0)
    .map(([seedId, qty]) => ({
      label: `${getSeedDisplayName(seedId, content)} (${qty} seeds)`?.slice(0, 100),
      value: seedId,
      description: `Uses 1 compost bag — yields ${describeYieldMap(getSeedYieldMap(seedId, { allowedIngredients }), content)}`.slice(0, 100)
    }))
    .slice(0, 25);

  if (!seedOptions.length) {
    seedOptions.push({
      label: "No seeds available",
      value: "no_seed",
      description: "Forage to collect seeds"
    });
  }

  const plantRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`noodle:garden:plant_select:${userId}`)
      .setPlaceholder("Plant a seed (1 compost + 1 seed)")
      .setDisabled(!hasEmptyPlot || compostCount <= 0 || seedOptions.length === 0)
      .addOptions(seedOptions)
  );

  const harvestOptions = readyPlots.map((plot) => ({
    label: `${getSeedDisplayName(plot.seed_id, content)} — Plot ${plot.idx + 1}`.slice(0, 100),
    value: String(plot.idx),
    description: `Harvest up to ${Math.floor(plot.remainingTotal ?? 0)} items`.slice(0, 100)
  })).slice(0, 25);

  const harvestSelectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`noodle:garden:harvest_select:${userId}`)
      .setPlaceholder(hasHarvestable ? "Harvest a ready plot" : "No plots ready to harvest")
      .setDisabled(!hasHarvestable)
      .addOptions(harvestOptions.length ? harvestOptions : [{ label: "No plots ready", value: "none" }])
  );

  const navRow = noodleForageGardenRow(userId, {
    active: "garden",
    includeGardenButton: false,
    includeKitchenButton: true,
    kitchenUnlocked,
    kitchenJustUnlocked,
    showGardenActions: true,
    canCompost: canCraft,
    canHarvest: hasHarvestable
  });
  const pageRow = gardenPageRow(userId, page);

  const embed = buildMenuEmbed({
    title: `${getIcon("tree")} Garden`,
    description,
    user,
    color: theme.colors.success
  });

  if (page === 0) {
    // Plots page — chunk plots into inline columns
    const columns = plotsLines.length <= 2
      ? Math.max(1, plotsLines.length)
      : (plotsLines.length <= 4 ? 2 : 3);
    const chunkSize = Math.max(1, Math.ceil(plotsLines.length / Math.max(1, columns)));
    for (let i = 0; i < columns; i++) {
      const chunk = plotsLines.slice(i * chunkSize, (i + 1) * chunkSize);
      if (!chunk.length) continue;
      const value = ["· · · · · · ·", ...chunk].join("\n");
      embed.addFields({ name: " ", value, inline: true });
    }
  } else {
    // Seeds / Compost page
    embed.addFields(
      { name: " ", value: seedsValue, inline: true },
      { name: " ", value: compostValue, inline: true }
    );
  }

  return {
    embed,
    rows: { navRow, pageRow, plantRow, harvestSelectRow },
    flags: { canCraft, hasHarvestable, hasEmptyPlot }
  };
}

function noodleTutorialMenuRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:orders:${userId}`).setLabel("Orders").setEmoji(getButtonEmoji("orders")).setStyle(ButtonStyle.Primary)
);
}

function noodleTutorialBuyRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:buy:${userId}`).setLabel("Buy").setEmoji(getButtonEmoji("cart")).setStyle(ButtonStyle.Primary)
);
}

function noodleTutorialForageRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:forage:${userId}`).setLabel("Forage").setEmoji(getButtonEmoji("forage")).setStyle(ButtonStyle.Primary)
);
}

function noodleTutorialCookRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:pick:cook:${userId}`).setLabel("Cook").setEmoji(getButtonEmoji("cook")).setStyle(ButtonStyle.Primary)
);
}

function noodleTutorialServeRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:pick:serve:${userId}`).setLabel("Serve").setEmoji(getButtonEmoji("serve")).setStyle(ButtonStyle.Primary)
);
}

function noodleOrdersAcceptOnlyRow(userId, { highlightAccept = true, disableAccept = false } = {}) {
  const style = disableAccept ? ButtonStyle.Secondary : (highlightAccept ? ButtonStyle.Success : ButtonStyle.Secondary);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:pick:accept:${userId}`)
      .setLabel("Accept")
      .setEmoji(getButtonEmoji("status_complete"))
      .setStyle(style)
      .setDisabled(disableAccept)
  );
}

function noodleMainMenuRowNoProfile(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:orders:${userId}`).setLabel("Orders").setEmoji(getButtonEmoji("orders")).setStyle(ButtonStyle.Primary),
new ButtonBuilder().setCustomId(`noodle:nav:buy:${userId}`).setLabel("Buy").setEmoji(getButtonEmoji("cart")).setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:pantry:${userId}`).setLabel("Pantry").setEmoji(getButtonEmoji("basket")).setStyle(ButtonStyle.Secondary)
);
}

function noodleRecipesMenuRow(userId, { kitchenUnlocked = false, kitchenJustUnlocked = false, active = null } = {}) {
  const kitchenStyle = !kitchenUnlocked
    ? ButtonStyle.Secondary
    : (kitchenJustUnlocked ? ButtonStyle.Success : ButtonStyle.Secondary);
  const kitchenEmoji = active === "kitchen" ? getButtonEmoji("refresh") : getButtonEmoji("cook");
  const recipesStyle = active === "recipes" ? ButtonStyle.Primary : ButtonStyle.Secondary;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`noodle:nav:recipes:${userId}`).setLabel("Recipes").setEmoji(getButtonEmoji("recipes")).setStyle(recipesStyle),
    new ButtonBuilder().setCustomId(`noodle:nav:regulars:${userId}`).setLabel("Regulars").setEmoji(getButtonEmoji("chef")).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:kitchen:${userId}`)
      .setLabel("Kitchen")
      .setEmoji(kitchenEmoji)
      .setStyle(kitchenStyle)
      .setDisabled(!kitchenUnlocked)
  );
}

function noodleSecondaryMenuRow(userId, { questsAvailable = false } = {}) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:quests:${userId}`).setLabel("Quests").setEmoji(getButtonEmoji("quests")).setStyle(questsAvailable ? ButtonStyle.Success : ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:event:${userId}`).setLabel("Event").setEmoji(getButtonEmoji("event")).setStyle(ButtonStyle.Secondary)
);
}

function noodleProfileEditRow(userId, { specializationsAvailable = false } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`noodle:profile:edit_shop_name:${userId}`).setLabel("Shop Name").setEmoji(getButtonEmoji("note")).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`noodle:profile:edit_tagline:${userId}`).setLabel("Tagline").setEmoji(getButtonEmoji("tag")).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`noodle:nav:specialize:${userId}`).setLabel("Specializations").setEmoji(getButtonEmoji("sparkle")).setStyle(specializationsAvailable ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setLabel("Store").setEmoji(getButtonEmoji("cart")).setStyle(ButtonStyle.Link).setURL(DISCORD_STORE_URL)
  );
}

function noodleProfileEditBackRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`noodle:nav:profile:${userId}`).setLabel("Back").setEmoji(getButtonEmoji("back")).setStyle(ButtonStyle.Secondary)
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
    new ButtonBuilder().setCustomId(`noodle:nav:profile_edit:${userId}`).setLabel("Back").setEmoji(getButtonEmoji("back")).setStyle(ButtonStyle.Secondary)
  );
}


function noodleQuestsActionRow(userId, { dailyAvailable = true } = {}) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:action:quests_daily:${userId}`).setLabel("Daily Reward").setEmoji(getButtonEmoji("daily_reward")).setStyle(dailyAvailable ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!dailyAvailable),
new ButtonBuilder().setCustomId(`noodle:action:quests_claim:${userId}`).setLabel("Claim Quests").setEmoji(getButtonEmoji("status_complete")).setStyle(ButtonStyle.Success)
);
}

function noodleQuestsSecondaryRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:season:${userId}`).setLabel("Season").setEmoji(getButtonEmoji("season")).setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:event:${userId}`).setLabel("Event").setEmoji(getButtonEmoji("event")).setStyle(ButtonStyle.Secondary)
);
}

function hasClaimableQuests(player) {
return Object.values(player?.quests?.active ?? {}).some((quest) => quest?.completed_at && !quest?.claimed_at);
}

function noodleQuestsMenuRow(userId, { showClaim, showDaily, showQuests } = {}) {
const dailyAvailable = showDaily ?? true;
const primaryButton = showQuests
  ? new ButtonBuilder()
      .setCustomId(`noodle:nav:quests:${userId}`)
      .setLabel("Quests").setEmoji(getButtonEmoji("quests"))
      .setStyle(ButtonStyle.Secondary)
  : new ButtonBuilder()
      .setCustomId(`noodle:action:quests_daily:${userId}`)
      .setLabel("Daily Reward").setEmoji(getButtonEmoji("daily_reward"))
    .setStyle(dailyAvailable ? ButtonStyle.Success : ButtonStyle.Secondary)
    .setDisabled(!dailyAvailable);
const row = new ActionRowBuilder().addComponents(primaryButton);

if (showClaim) {
  row.addComponents(
    new ButtonBuilder().setCustomId(`noodle:action:quests_claim:${userId}`).setLabel("Claim Quests").setEmoji(getButtonEmoji("status_complete")).setStyle(ButtonStyle.Success)
  );
}

row.addComponents(
  new ButtonBuilder().setCustomId(`noodle:nav:season:${userId}`).setLabel("Season").setEmoji(getButtonEmoji("season")).setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId(`noodle:nav:event:${userId}`).setLabel("Event").setEmoji(getButtonEmoji("event")).setStyle(ButtonStyle.Secondary)
);

return row;
}

function noodleQuestsBackRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:profile:${userId}`).setLabel("Back").setEmoji(getButtonEmoji("back")).setStyle(ButtonStyle.Secondary)
);
}

function noodleMainMenuRowNoPantry(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:orders:${userId}`).setLabel("Orders").setEmoji(getButtonEmoji("orders")).setStyle(ButtonStyle.Primary),
new ButtonBuilder().setCustomId(`noodle:nav:buy:${userId}`).setLabel("Buy").setEmoji(getButtonEmoji("cart")).setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:profile:${userId}`).setLabel("Profile").setEmoji(getButtonEmoji("profile")).setStyle(ButtonStyle.Secondary)
);
}

function noodleMainMenuRowNoOrders(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:buy:${userId}`).setLabel("Buy").setEmoji(getButtonEmoji("cart")).setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:pantry:${userId}`).setLabel("Pantry").setEmoji(getButtonEmoji("basket")).setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:profile:${userId}`).setLabel("Profile").setEmoji(getButtonEmoji("profile")).setStyle(ButtonStyle.Secondary)
);
}

function noodleOrdersActionRow(userId, { highlightAccept = true, disableAccept = false, disableServe = false } = {}) {
  const acceptStyle = disableAccept ? ButtonStyle.Secondary : (highlightAccept ? ButtonStyle.Success : ButtonStyle.Secondary);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:pick:accept:${userId}`)
      .setLabel("Accept")
      .setEmoji(getButtonEmoji("status_complete"))
      .setStyle(acceptStyle)
      .setDisabled(disableAccept),
    new ButtonBuilder().setCustomId(`noodle:pick:cook:${userId}`).setLabel("Cook").setEmoji(getButtonEmoji("cook")).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`noodle:pick:serve:${userId}`).setLabel("Serve").setEmoji(getButtonEmoji("serve")).setStyle(disableServe ? ButtonStyle.Secondary : ButtonStyle.Primary).setDisabled(disableServe)
  );
}

function noodleOrdersActionRowWithBack(userId, { highlightAccept = true, disableAccept = false, disableServe = false, showServeAll = false, disableServeAll = false } = {}) {
  const acceptStyle = disableAccept ? ButtonStyle.Secondary : (highlightAccept ? ButtonStyle.Success : ButtonStyle.Secondary);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:pick:accept:${userId}`)
      .setLabel("Accept")
      .setEmoji(getButtonEmoji("status_complete"))
      .setStyle(acceptStyle)
      .setDisabled(disableAccept),
    new ButtonBuilder().setCustomId(`noodle:pick:cook:${userId}`).setLabel("Cook").setEmoji(getButtonEmoji("cook")).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`noodle:pick:serve:${userId}`).setLabel("Serve").setEmoji(getButtonEmoji("serve")).setStyle(disableServe ? ButtonStyle.Secondary : ButtonStyle.Primary).setDisabled(disableServe),
    ...(showServeAll
      ? [
          new ButtonBuilder()
            .setCustomId(`noodle:pick:serveall:${userId}`)
            .setLabel("Serve All")
            .setEmoji(getButtonEmoji("serve"))
            .setStyle(disableServeAll ? ButtonStyle.Secondary : ButtonStyle.Success)
            .setDisabled(disableServeAll)
        ]
      : []),
    new ButtonBuilder().setCustomId(`noodle:nav:orders:${userId}`).setLabel("Back").setEmoji(getButtonEmoji("back")).setStyle(ButtonStyle.Secondary)
  );
}

function noodleOrdersMenuActionRow(userId, { showCancel = false, highlightAccept = true, disableAccept = false, disableServe = false } = {}) {
const acceptStyle = disableAccept ? ButtonStyle.Secondary : (highlightAccept ? ButtonStyle.Success : ButtonStyle.Secondary);
const row = new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:pick:accept:${userId}`).setLabel("Accept").setEmoji(getButtonEmoji("status_complete")).setStyle(acceptStyle).setDisabled(disableAccept),
new ButtonBuilder().setCustomId(`noodle:pick:cook:${userId}`).setLabel("Cook").setEmoji(getButtonEmoji("cook")).setStyle(ButtonStyle.Primary),
new ButtonBuilder().setCustomId(`noodle:pick:serve:${userId}`).setLabel("Serve").setEmoji(getButtonEmoji("serve")).setStyle(disableServe ? ButtonStyle.Secondary : ButtonStyle.Primary).setDisabled(disableServe)
);

if (showCancel) {
  row.addComponents(
    new ButtonBuilder().setCustomId(`noodle:pick:cancel:${userId}`).setLabel("Cancel").setEmoji(getButtonEmoji("cancel")).setStyle(ButtonStyle.Danger)
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
  const tags = Array.isArray(content.items?.[itemId]?.tags) ? content.items[itemId].tags.map((t) => String(t).toLowerCase()) : [];
  if (raw === "broth") return "broth";
  if (raw === "noodles" || raw === "noodle") return "noodles";
  if (raw === "spice" || raw === "aromatic") return "spice";
  if (tags.includes("fish") || tags.includes("seafood") || tags.includes("protein") || tags.includes("meat") || PROTEIN_ITEM_IDS.has(itemId)) return "protein";
  if (raw === "topping") return "topping";
  return "topping";
}

function getIngredientCountsByType(player) {
  const counts = { broth: 0, noodles: 0, spice: 0, topping: 0, protein: 0 };
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

function getIngredientCapacityPerType(_player, effects, type = null) {
  const bonus = Math.floor(effects?.ingredient_capacity || 0);
  const proteinBonus = (type === "protein") ? Math.floor(effects?.protein_capacity_bonus || 0) : 0;
  return Math.max(0, INGREDIENT_CAPACITY_BASE + bonus + proteinBonus);
}

function getIngredientCapacitiesByType(player, effects) {
  return {
    broth: getIngredientCapacityPerType(player, effects, "broth"),
    noodles: getIngredientCapacityPerType(player, effects, "noodles"),
    spice: getIngredientCapacityPerType(player, effects, "spice"),
    topping: getIngredientCapacityPerType(player, effects, "topping"),
    protein: getIngredientCapacityPerType(player, effects, "protein")
  };
}

function getBowlCount(player) {
  return Object.values(player?.inv_bowls ?? {}).reduce(
    (sum, bowl) => sum + Math.max(0, Number(bowl?.qty) || 0),
    0
  );
}

function getBowlCapacity(player, effects) {
  const base = BOWL_STORAGE_CAPACITY_BASE;
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
  if (q === "salvage") return getIcon("rarity_salvage", "S-");
  if (q === "standard") return getIcon("rarity_standard", "S");
  if (q === "good") return getIcon("rarity_good", "G");
  if (q === "excellent") return getIcon("rarity_excellent", "E");
  return "S";
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

function canServeAllOrders(player) {
  const acceptedEntries = Object.values(player?.orders?.accepted ?? {});
  if (!acceptedEntries.length) return false;

  const now = nowTs();
  const neededByRecipe = {};

  for (const entry of acceptedEntries) {
    const order = entry?.order;
    if (!order) return false; // Missing snapshot means we can't confidently serve

    if (entry.expires_at && now > entry.expires_at) return false; // Expired order blocks serve-all

    const recipeId = order.recipe_id;
    if (!recipeId) return false;
    neededByRecipe[recipeId] = (neededByRecipe[recipeId] ?? 0) + 1;
  }

  for (const [recipeId, count] of Object.entries(neededByRecipe)) {
    const ready = getTotalBowlsForRecipe(player, recipeId);
    if (ready < count) return false;
  }

  return true;
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

function applyGuaranteedExcellent(qualityCounts, guaranteed, successTotal) {
  const target = Math.min(Math.max(0, successTotal || 0), Math.max(0, guaranteed || 0));
  const current = Math.max(0, Number(qualityCounts?.excellent || 0));
  let needed = target - current;
  if (needed <= 0) return;

  const buckets = ["standard", "good"];
  for (const key of buckets) {
    const available = Math.max(0, Number(qualityCounts[key] || 0));
    if (!available) continue;
    const take = Math.min(available, needed);
    if (take > 0) {
      qualityCounts[key] = available - take;
      qualityCounts.excellent = (qualityCounts.excellent ?? 0) + take;
      needed -= take;
      if (needed <= 0) break;
    }
  }

  if (needed > 0) {
    qualityCounts.excellent = (qualityCounts.excellent ?? 0) + needed;
  }
}


function applyIngredientCapacityToDrops(drops, player, effects, options = {}) {
  const { allowDisplacingInventory = false } = options;
  const capacityByType = getIngredientCapacitiesByType(player, effects);
  const current = getIngredientCountsByType(player);
  const remainingByType = {
    broth: Math.max(0, (capacityByType.broth ?? 0) - (current.broth ?? 0)),
    noodles: Math.max(0, (capacityByType.noodles ?? 0) - (current.noodles ?? 0)),
    spice: Math.max(0, (capacityByType.spice ?? 0) - (current.spice ?? 0)),
    topping: Math.max(0, (capacityByType.topping ?? 0) - (current.topping ?? 0)),
    protein: Math.max(0, (capacityByType.protein ?? 0) - (current.protein ?? 0))
  };

  const accepted = {};
  const rejected = {};
  const evicted = {};

  const rarityRank = {
    seasonal: 5,
    epic: 4,
    rare: 3,
    uncommon: 2,
    common: 1
  };

  const getRarityScore = (itemId) => {
    const item = content.items?.[itemId] ?? {};
    const rarity = String(item.tier ?? item.rarity ?? "common").toLowerCase();
    return rarityRank[rarity] ?? 0;
  };

  const entriesByType = new Map();

  // Existing inventory (only used when displacement is allowed)
  if (allowDisplacingInventory) {
    for (const [id, qtyRaw] of Object.entries(player?.inv_ingredients ?? {})) {
      const qty = Math.max(0, Number(qtyRaw) || 0);
      if (qty <= 0) continue;
      const type = normalizeIngredientType(id);
      const list = entriesByType.get(type) ?? [];
      list.push({ id, qty, rarityScore: getRarityScore(id), source: "existing" });
      entriesByType.set(type, list);
    }
  }

  // Incoming drops
  for (const [id, qtyRaw] of Object.entries(drops ?? {})) {
    const qty = Math.max(0, Number(qtyRaw) || 0);
    if (qty <= 0) continue;
    const type = normalizeIngredientType(id);
    const list = entriesByType.get(type) ?? [];
    list.push({ id, qty, rarityScore: getRarityScore(id), source: "drop" });
    entriesByType.set(type, list);
  }

  for (const [type, entries] of entriesByType.entries()) {
    const capacityForType = capacityByType[type] ?? capacityByType.topping ?? INGREDIENT_CAPACITY_BASE;
    const sorted = [...entries].sort((a, b) => {
      if (b.rarityScore !== a.rarityScore) return b.rarityScore - a.rarityScore;
      return String(a.id).localeCompare(String(b.id));
    });

    const existingCount = current[type] ?? 0;
    let remainingSlots = allowDisplacingInventory
      ? capacityForType
      : Math.max(0, capacityForType - existingCount);

    for (const entry of sorted) {
      if (remainingSlots <= 0) {
        if (entry.source === "drop") {
          rejected[entry.id] = (rejected[entry.id] ?? 0) + entry.qty;
        } else if (allowDisplacingInventory) {
          evicted[entry.id] = (evicted[entry.id] ?? 0) + entry.qty;
        }
        continue;
      }

      const take = Math.min(entry.qty, remainingSlots);
      if (entry.source === "drop") {
        if (take > 0) accepted[entry.id] = (accepted[entry.id] ?? 0) + take;
        if (take < entry.qty) rejected[entry.id] = (rejected[entry.id] ?? 0) + (entry.qty - take);
      } else if (allowDisplacingInventory) {
        // Keep highest-rarity existing items; anything beyond capacity is marked for eviction above
        if (take < entry.qty) evicted[entry.id] = (evicted[entry.id] ?? 0) + (entry.qty - take);
      }
      remainingSlots -= take;
    }

    remainingByType[type] = Math.max(0, remainingSlots);
  }

  return { accepted, rejected, evicted, current, capacity: capacityByType, remainingByType };
}

function getKitchenBrothItems(player) {
  const tierOrder = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
  const byTierThenName = (a, b) => {
    const aTier = tierOrder[String(a?.tier ?? "common").toLowerCase()] ?? 99;
    const bTier = tierOrder[String(b?.tier ?? "common").toLowerCase()] ?? 99;
    if (aTier !== bTier) return aTier - bTier;
    return String(a?.name ?? a?.item_id ?? "").localeCompare(String(b?.name ?? b?.item_id ?? ""));
  };

  const brothItems = Object.values(content.items ?? {}).filter((item) => String(item?.category ?? "").toLowerCase() === "broth");
  const marketBroths = brothItems.filter((item) => String(item?.acquisition ?? "").toLowerCase() === "market");
  const kitchenBroths = brothItems.filter((item) => String(item?.acquisition ?? "").toLowerCase() === "kitchen");

  // Show all kitchen broths the player can potentially simmer, even if they don't yet have ingredients on hand.
  // The craftability check later will indicate if they can actually start it.
  return [...marketBroths, ...kitchenBroths].sort(byTierThenName);
}

function formatDurationShort(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  }
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function buildKitchenViewPayload({ player, user, userId, server = null, pendingMessages = [], banner = null, now = nowTs(), kitchenUnlocked = false, kitchenJustUnlocked = false, effects = {}, page = 0 }) {
  ensureKitchenState(player);
  const status = getKitchenStatus(player, now);
  const batches = status.batches ?? [];
  const readyBatches = batches.filter((b) => b.ready);
  const capacity = getKitchenCapacity(player, effects);
  const remainingSlots = Math.max(0, capacity - batches.length);
  const nextReadyMs = status.nextReadyMs ?? null;
  const nextReadyTs = nextReadyMs != null ? Math.floor((now + nextReadyMs) / 1000) : null;
  const availableRecipes = getAvailableRecipes(player);
  const activeSeason = server?.season ?? null;
  const activeEventId = server?.active_event_id ?? null;
  const seasonFilteredRecipes = availableRecipes.filter((rid) => {
    const r = content.recipes?.[rid];
    if (!r) return true;
    if (r.is_event_recipe) {
      return !!activeEventId && r.event_id === activeEventId;
    }
    if (r.tier !== "seasonal") return true;
    return !!activeSeason && r.season === activeSeason;
  });

  const unlockedBrothIds = new Set();
  seasonFilteredRecipes.forEach((rid) => {
    const r = content.recipes?.[rid];
    (r?.ingredients ?? []).forEach((ing) => {
      if (normalizeIngredientType(ing.item_id) === "broth") {
        unlockedBrothIds.add(ing.item_id);
      }
    });
  });

  const unlockedBrothKey = [...unlockedBrothIds].sort().join(",");
  const lastNoticeKey = player?.kitchen?.broth_notice_key ?? "";
  const showNewBrothNotice = unlockedBrothKey && unlockedBrothKey !== lastNoticeKey;

  const unlockedBrothLabels = [...unlockedBrothIds]
    .map((bid) => displayItemName(bid))
    .sort((a, b) => String(a).localeCompare(String(b)))
    .slice(0, 5);

  const brothItems = getKitchenBrothItems(player).filter((item) => {
    if (unlockedBrothIds.size === 0) return true;
    return unlockedBrothIds.has(item?.item_id);
  });

  const recipePlans = brothItems.map((item) => {
    const plan = planKitchenIngredients(player, item?.item_id);
    const recipe = getBrothRecipe(item?.item_id) ?? [];
    const recipeLine = recipe
      .map((ing) => `${displayItemName(ing.item_id)} x${ing.qty}`)
      .join(" · ") || `${KITCHEN_FORAGE_PER_BROTH} forageables`;
    const missingLine = Object.entries(plan.missing ?? {})
      .map(([id, qty]) => `${displayItemName(id)} x${qty}`)
      .join(" · ");
    const craftableCount = getCraftableCountForBroth(player, item?.item_id);
    return { item, plan, recipe, recipeLine, missingLine, craftableCount };
  });

  const craftableMax = recipePlans.reduce((max, entry) => Math.max(max, entry.craftableCount ?? 0), 0);
  const bestCraftable = recipePlans.reduce((best, entry) => {
    if (!best) return entry;
    if ((entry?.craftableCount ?? 0) > (best?.craftableCount ?? 0)) return entry;
    return best;
  }, null);

  const foragePool = getKitchenForagePool(player);
  const forageEntries = Object.entries(foragePool).filter(([, qty]) => qty > 0);
  const totalForage = forageEntries.reduce((sum, [, qty]) => sum + qty, 0);

  const proteinEntries = Object.entries(player.inv_ingredients ?? {})
    .filter(([id, qty]) => qty > 0 && normalizeIngredientType(id) === "protein");
  const totalProtein = proteinEntries.reduce((sum, [, qty]) => sum + qty, 0);

  const kitchenLines = [];
  if (!kitchenUnlocked) {
    kitchenLines.push(`${getIcon("lock")} Reach shop level ${KITCHEN_UNLOCK_LEVEL} to unlock the kitchen.`);
  } else {
    const summaryLine = `${getIcon("cook")} Simmering **${batches.length}/${capacity}** broths${readyBatches.length ? ` — ${readyBatches.length} ready` : ""}${!readyBatches.length && nextReadyMs != null ? ` — next ready ${nextReadyTs ? `<t:${nextReadyTs}:R>` : `in ${formatDurationShort(nextReadyMs)}`}` : ""}`;
    kitchenLines.push(summaryLine);

    if (showNewBrothNotice && unlockedBrothLabels.length > 0) {
      const list = unlockedBrothLabels.join(" · ");
      const suffix = unlockedBrothIds.size > unlockedBrothLabels.length ? " …" : "";
      kitchenLines.push(`${getIcon("sparkle")} New broths unlocked from recipes: ${list}${suffix}`);
    }

    if (batches.length === 0) {
      if (!recipePlans.length) {
        kitchenLines.push(`${getIcon("warning")} No broths are available to simmer yet — unlock broth recipes by progressing and discovering more dishes.`);
      } else {
        kitchenLines.push(`${getIcon("cook")} Select a broth below to start.`);
        if (craftableMax === 0) {
          kitchenLines.push(`${getIcon("warning")} No broths are ready to simmer — forage for ingredients or catch fish to begin.`);
        }
      }
    } else {
      const batchLines = batches.slice(0, 5).map((batch) => {
        const readyText = batch.ready
          ? `${getIcon("status_complete")} Ready`
          : `${getIcon("hourglass")} Ready ${batch.ready_at ? `<t:${Math.floor(batch.ready_at / 1000)}:R>` : "soon"}`;
        return `• ${displayItemName(batch.broth_id)} — ${readyText}`;
      });
      const extra = batches.length - batchLines.length;
      const batchBlock = extra > 0
        ? `${batchLines.join("\n")}\n${getIcon("cook")} …and ${extra} more batch${extra === 1 ? "" : "es"}.`
        : batchLines.join("\n");
      kitchenLines.push(`**What’s simmering (by broth)**\n${batchBlock}`);
    }
  }

  if (!player.kitchen) player.kitchen = {};
  player.kitchen.broth_notice_key = unlockedBrothKey;

  if (kitchenUnlocked && batches.length === 0 && craftableMax === 0) {
    const hasEmptyMessage = kitchenLines.some((line) => typeof line === "string" && line.toLowerCase().includes("no broths"));
    if (!hasEmptyMessage) {
      kitchenLines.push(`${getIcon("warning")} No broths are ready to simmer — forage for ingredients or catch fish to begin.`);
    }
  }

  const forageList = forageEntries
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, 10)
    .map(([id, qty]) => `• ${displayItemName(id)}: **${qty}**`)
    .join("\n") || "_No forageables yet_.";
  const hiddenCount = Math.max(0, forageEntries.length - 10);
  const forageFooter = hiddenCount > 0 ? `\n…and ${hiddenCount} more.` : "";
  const craftableLine = craftableMax > 0
    ? null
    : " ";
  const pantryIcon = getIcon("basket");
  const forageValue = [
    "· · · · · · ·",
    `${pantryIcon} **${totalForage}** in pantry.`,
    craftableLine,
    `${forageList}${forageFooter}`
  ].filter(Boolean).join("\n");

  const proteinList = proteinEntries
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, 10)
    .map(([id, qty]) => `• ${displayItemName(id)}: **${qty}**`)
    .join("\n") || "_No proteins yet_.";
  const proteinHiddenCount = Math.max(0, proteinEntries.length - 10);
  const proteinFooter = proteinHiddenCount > 0 ? `\n…and ${proteinHiddenCount} more.` : "";
  const proteinValue = [
    "· · · · · · ·",
    `${pantryIcon} **${totalProtein}** in pantry.`,
    `${proteinList}${proteinFooter}`
  ].filter(Boolean).join("\n");

  const kitchenStatusValue = kitchenLines.join("\n\n") || `${getIcon("cook")} Select a broth below to start.`;
  const descriptionParts = [banner, pendingMessages.length ? pendingMessages.join("\n") : null].filter(Boolean);
  const embed = buildMenuEmbed({
    title: `${getIcon("cook")} Kitchen`,
    description: descriptionParts.join("\n\n"),
    user
  });

  embed.addFields(
    {
      name: "Forageables",
      value: forageValue,
      inline: true
    },
    {
      name: "Proteins",
      value: proteinValue,
      inline: true
    },
    {
      name: "Kitchen Status",
      value: ["· · · · · · ·", kitchenStatusValue].join("\n"),
      inline: true
    }
  );

  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(recipePlans.length / pageSize));
  const safePage = Math.min(Math.max(Number(page ?? 0), 0), totalPages - 1);

  const pagePlans = recipePlans.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const cannotSimmer = kitchenUnlocked && (remainingSlots <= 0 || craftableMax <= 0 || pagePlans.length === 0);
  if (cannotSimmer) {
    const lowerLines = kitchenLines.map((line) => (typeof line === "string" ? line.toLowerCase() : ""));
    const alreadyNoted = lowerLines.some((line) => line.includes("no broths") || line.includes("cannot simmer") || line.includes("slots are full"));
    if (!alreadyNoted) {
      const reason = remainingSlots <= 0
        ? `${getIcon("cook")} All simmer slots are full — collect broths to open space.`
        : `${getIcon("warning")} No broths are ready to simmer — forage for ingredients or catch fish to begin.`;
      kitchenLines.push(reason);
    }
  }

  const options = pagePlans.map(({ item, plan, recipe, craftableCount }) => {
    const ingTokens = (recipe ?? []).map((ing) => {
      const have = Math.max(0, Number(player?.inv_ingredients?.[ing.item_id] ?? 0));
      const name = displayItemName(ing.item_id);
      const base = `${name}:${have}`;
      return ing.optional ? `${base} (opt)` : base;
    });
    const maxCraft = Math.max(0, craftableCount ?? 0);
    const descRaw = ingTokens.length
      ? `${ingTokens.join(" · ")} | Max ${maxCraft}`
      : `Max ${maxCraft}`;
    const description = descRaw.length > 100 ? `${descRaw.slice(0, 97)}…` : descRaw;
    const craftableFlag = maxCraft > 0;
    const labelRaw = `${item?.name ?? item?.item_id ?? "Unknown"}`;
    const label = labelRaw.length > 100 ? `${labelRaw.slice(0, 97)}…` : labelRaw;

    const option = {
      label,
      value: item?.item_id ?? "unknown",
      description
    };

    if (craftableFlag) {
      const emoji = getButtonEmoji("status_complete");
      if (emoji) option.emoji = emoji;
    }

    return option;
  });

  const components = [];
  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`noodle:kitchen:start:${userId}`)
      .setMaxValues(1)
      .setDisabled(!kitchenUnlocked || remainingSlots <= 0 || craftableMax <= 0 || options.length === 0)
      .addOptions(options.length ? options : [{ label: "No broths available", value: "none", description: "Missing broth data" }])
  );
  components.push(selectRow);

  if (totalPages > 1) {
    const navRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:nav:kitchen:${userId}:${safePage - 1}`)
        .setLabel("Prev")
        .setEmoji(getButtonEmoji("back"))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage <= 0),
      new ButtonBuilder()
        .setCustomId(`noodle:nav:kitchen:${userId}:${safePage + 1}`)
        .setLabel("Next")
        .setEmoji(getButtonEmoji("next"))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage >= totalPages - 1)
    );
    components.push(navRow);
  }

  if (readyBatches.length > 0) {
    const collectRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:kitchen:collect:${userId}`)
        .setLabel(`Collect ${readyBatches.length} Ready`)
        .setEmoji(getButtonEmoji("cook"))
        .setStyle(ButtonStyle.Success)
        .setDisabled(false)
    );
    components.push(collectRow);
  }

  components.push(noodleRecipesMenuRow(userId, { kitchenUnlocked, kitchenJustUnlocked, active: "kitchen" }), noodleMainMenuRow(userId));

  if (totalPages > 1) {
    const pageLabel = `Broths ${safePage + 1}/${totalPages}`;
    const existingFooter = embed?.data?.footer?.text ?? embed?.footer?.text ?? "";
    embed.setFooter({ text: existingFooter ? `${pageLabel} • ${existingFooter}` : pageLabel });
  }

  return { content: " ", embeds: [embed], components };
}

function getLimitedTimeWindowSeconds(player, baseSeconds) {
const blessing = getActiveBlessing(player);
if (blessing?.type !== "limited_time_window_add") return baseSeconds;
const mult = BLESSING_EFFECTS.limited_time_window_add?.speedWindowMult ?? 1;
return Math.max(1, Math.ceil(baseSeconds * mult));
}

function cozyError(errOrCode) {
  return friendlyErrorMessage(errOrCode);
}

function friendlyErrorMessage(errOrCode) {
  const code = typeof errOrCode === "string" ? errOrCode : errOrCode?.code || errOrCode?.name || "";
  const message = String(typeof errOrCode === "string" ? errOrCode : errOrCode?.message || "").toLowerCase();

  if (code === 10062 || message.includes("unknown interaction")) {
    return "That action expired. Please press a button again.";
  }
  if (code === "LOCK_BUSY" || code === "ERR_LOCK_BUSY") {
    return "Your shop is already busy. Try again in a moment.";
  }
  if (message.includes("rate limit") || code === "RATE_LIMITED") {
    return "You're going too fast, please slow down and try again.";
  }
  if (message.includes("missing access") || message.includes("missing permissions")) {
    return "I don't have permission to reply here. Try a different channel or update Discord permissions.";
  }
  if (message.includes("could not find the requested resource") || message.includes("unknown channel")) {
    return "I couldn't find that channel. Try again from a visible channel.";
  }
  if (code === "INTERACTION_ALREADY_REPLIED") {
    return "That interaction was already handled. Use the latest buttons or run the command again.";
  }

  return "Something went a little sideways. Please try again.";
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
  clearExpiredBlessings(p);
  ensureBadgeState(p);
  grantEventBadgesForKnownRecipes(p, content, badgesContent);
  ensureCollectionsState(p);
  backfillRecipeCollections(p, collectionsContent, content);
  revalidateCollections(p, collectionsContent, content);
  ensureSpecializationState(p);
  if (!p.seasons) {
    p.seasons = { last_seen: null, last_rewarded_from: null, last_rewarded_at: null };
  }
  return p;
}

function applySeasonRolloverReward(player, currentSeason) {
  if (!player || !currentSeason) return null;
  if (!player.seasons) {
    player.seasons = { last_seen: null, last_rewarded_from: null, last_rewarded_at: null };
  }

  const previousSeason = player.seasons.last_seen ?? null;
  const seasonChanged = previousSeason && previousSeason !== currentSeason;
  player.seasons.last_seen = currentSeason;

  const invBowls = player.inv_bowls ?? {};
  const getRecipeSeason = (recipeId) => eventRecipeSeasonIndex?.[recipeId] ?? content?.recipes?.[recipeId]?.season ?? null;

  let bowlCount = 0;
  const clearedKeys = [];
  let fromSeason = previousSeason;

  // Clear any cooked bowls tied to a season that is no longer active.
  for (const [key, bowl] of Object.entries(invBowls)) {
    const recipeSeason = getRecipeSeason(bowl?.recipe_id);
    if (!recipeSeason) continue;
    if (recipeSeason === currentSeason) continue;

    const qty = Math.max(0, Number(bowl?.qty || 0));
    if (!qty) continue;

    bowlCount += qty;
    clearedKeys.push(key);
    fromSeason = fromSeason ?? recipeSeason;
  }

  const rewardFromSeason = fromSeason ?? (seasonChanged ? previousSeason : null);
  if (rewardFromSeason) {
    player.seasons.last_rewarded_from = rewardFromSeason;
  }

  if (bowlCount <= 0) return null;

  // Clear event bowls from inventory now that they've been rewarded.
  for (const key of clearedKeys) {
    delete invBowls[key];
  }

  const coins = bowlCount * 5 + 10;
  const rep = Math.max(1, Math.ceil(bowlCount / 3) + 10);
  const sxp = bowlCount * 2 + 10;

  player.coins = (player.coins || 0) + coins;
  player.rep = (player.rep || 0) + rep;
  player.sxp_total = (player.sxp_total || 0) + sxp;
  player.sxp_progress = (player.sxp_progress || 0) + sxp;
  if (!player.lifetime) player.lifetime = {};
  player.lifetime.coins_earned = (player.lifetime.coins_earned || 0) + coins;
  const leveled = applySxpLevelUp(player);

  player.seasons.last_rewarded_at = nowTs();

  const friendlyFrom = rewardFromSeason
    ? rewardFromSeason.charAt(0).toUpperCase() + rewardFromSeason.slice(1)
    : "Last season";
  const friendlyCurrent = currentSeason.charAt(0).toUpperCase() + currentSeason.slice(1);
  const bowlLabel = `Cleared ${bowlCount} bowl${bowlCount === 1 ? "" : "s"}.`;
  const message = `${getIcon("season")} As ${friendlyFrom} hands the ladle to ${friendlyCurrent}, your event bowls found cozy homes. ${bowlLabel} Reward: **${coins}c**, **${rep} REP**, **${sxp} SXP**.`;

  return { message, leveled, cleared: clearedKeys.length, bowlsCleared: bowlCount };
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

function formatIngredientLabel(ing) {
  const name = displayItemName(ing.item_id);
  return ing?.optional ? `${name} (optional)` : name;
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
    const specIcon = resolveIcon(activeSpec.icon, getIcon("sparkle"));
    description += `\n${specIcon} **${activeSpec.name}**`;
  } else if (specState?.active_spec_id) {
    description += `\n${getIcon("sparkle")} **${specState.active_spec_id}**`;
  }
  if (partyName) {
    description += `\n\n${getIcon("party")} **${partyName}**`;
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
    const icon = resolveIcon(badge?.icon, getIcon("tag"));
    return `${icon}`;
  });

  const badgeRows = [];
  for (let i = 0; i < badgeLines.length; i += 6) {
    badgeRows.push(badgeLines.slice(i, i + 6).join(" "));
  }
  const badgesText = badgeRows.length ? badgeRows.join("\n") : "_No badges yet._";

  const completedIds = player.collections?.completed ?? [];
  const completedNames = completedIds
    .map((id) => (collectionsContent?.collections ?? []).find((c) => c.collection_id === id)?.name ?? null)
    .filter(Boolean);
  const collectionsText = completedNames.length
    ? completedNames.map((name) => `• ${name}`).join("\n")
    : "_No collections completed yet._";

  const activeSpecId = activeSpec?.spec_id ?? specState?.active_spec_id ?? null;
  const decorSetId = activeSpecId ? getDecorSetIdForSpec(activeSpecId) : null;
  const decorSet = decorSetId
    ? (decorSetsContent?.sets ?? []).find((set) => set.set_id === decorSetId)
    : null;
  const decorSetName = decorSet?.name ?? (decorSetId ? decorSetId : null);
  const decorSetValue = "\u200b";
  const decorSetImageUrl = activeSpecId
    ? (
      decorSet?.image_url
        ?? getIconUrl(`decor_set_${activeSpecId}`)
        ?? (decorSetId ? getIconUrl(`decor_set_${decorSetId}`) : null)
        ?? getIconUrl("decor_set_placeholder")
    )
    : getIconUrl("decor_set_placeholder");

  const embed = new EmbedBuilder()
    .setTitle(`${getIcon("profile")} ${player.profile.shop_name}`)
    .setDescription(description)
    .setColor(theme.colors.primary)
    .addFields(
      {
        name: `${getIcon("serve")} Bowls Served`,
        value: String(player.lifetime.bowls_served_total || 0),
        inline: true
      },
      {
        name: `${getIcon("sxp")} Level`,
        value: String(player.shop_level || 1),
        inline: true
      },
      {
        name: `${getIcon("rep")} REP`,
        value: String(player.rep || 0),
        inline: true
      },
      {
        name: `${getIcon("coins")} Coins`,
        value: `${player.coins || 0}c`,
        inline: true
      },
      { name: `${getIcon("badges")} Badges`, value: badgesText, inline: false },
      { name: `${getIcon("collections")} Collections`, value: collectionsText, inline: false },
      { name: `${getIcon("decor")} Decor Set`, value: decorSetValue, inline: false }
    );

  if (decorSetImageUrl) {
    embed.setImage(decorSetImageUrl);
  }

  applyOwnerFooter(embed, ownerUser);
  return embed;
}

function isSpecializationVisible(player, spec) {
  if (!spec) return false;
  if (!spec.hidden_until_unlocked) return true;
  const reqCheck = meetsSpecializationRequirements(player, spec.requirements, spec.spec_id);
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
      ? `${getIcon("status_complete")} Equipped`
      : check.ok
        ? "Available"
        : `${getIcon("lock")} ${check.reason}`;
    const icon = resolveIcon(spec.icon, getIcon("sparkle"));
    const description = spec.description ? `\n_${spec.description}_` : "";
    return `${icon} **${spec.name}** — ${status}${description}`;
  });

  if (state?.active_spec_id && !specs.some((s) => s.spec_id === state.active_spec_id)) {
    lines.unshift(`${getIcon("sparkle")} **${state.active_spec_id}** — ${getIcon("status_complete")} Equipped`);
  }

  let description = lines.length
    ? `${lines.join("\n\n")}\n\nUse **Select Specialization** below to switch.`
    : "No specializations available.";

  const embed = buildMenuEmbed({
    title: `${getIcon("sparkle")} Specializations`,
    description,
    user: ownerUser
  });

  const pageLabel = `Page ${safePage + 1}/${totalPages}`;
  const existingFooter = embed?.data?.footer?.text ?? embed?.footer?.text ?? "";
  const footerText = existingFooter ? `${pageLabel} • ${existingFooter}` : pageLabel;
  embed.setFooter({ text: footerText });

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
  const knownSet = new Set(known);
  const fishingUnlocked = isFishingUnlocked(player);

  const addRecipeIngredients = (recipeId) => {
    const r = contentBundle.recipes?.[recipeId];
    if (!r) return;
    for (const ing of r.ingredients ?? []) {
      if (!ing?.item_id) continue;
      if (!fishingUnlocked && FISHING_ITEM_IDS.includes(ing.item_id)) continue;
      out.add(ing.item_id);
    }
  };

  // All known recipes
  for (const recipeId of knownSet) addRecipeIngredients(recipeId);

  // Ensure fishing recipes that just unlocked contribute their forageables immediately
  for (const recipeId of FISHING_RECIPE_IDS) {
    if (knownSet.has(recipeId)) addRecipeIngredients(recipeId);
  }

  // If the kitchen is unlocked, also expose forageables needed for unlocked broths
  const { unlocked: kitchenUnlocked } = getKitchenUnlockState(player);
  if (kitchenUnlocked) {
    const brothIds = Object.keys(KITCHEN_BROTH_RECIPES ?? {});
    for (const brothId of brothIds) {
      const recipe = KITCHEN_BROTH_RECIPES[brothId] ?? [];
      for (const ing of recipe) {
        if (!ing?.item_id) continue;
        if (!fishingUnlocked && FISHING_ITEM_IDS.includes(ing.item_id)) continue;
        out.add(ing.item_id);
      }
    }
  }

  return out;
}

function formatRecipeNeeds({ recipeId, content: contentBundle, player }) {
const r = contentBundle.recipes?.[recipeId];
if (!r) return "";

  const relevantIngredients = (r.ingredients ?? []).filter((ing) => !isFishingIngredientLocked(player, ing?.item_id));

  const missing = relevantIngredients
    .filter((ing) => !ing?.optional)
    .map((ing) => {
      const need = ing.qty ?? 0;
      const have = player.inv_ingredients?.[ing.item_id] ?? 0;
      if (have >= need) return null;
      const itemName = displayItemName(ing.item_id);
      return `${itemName} ${need} (have ${have})`;
    })
    .filter(Boolean);

  if (!missing.length) return "";
  return `${getIcon("receipt")} **Ingredients Needed:** ${missing.join(" · ")}`;
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

return `${getIcon("warning")} Auto-canceled expired order \`${shortOrderId(id)}\`${rName ? ` — **${rName}**` : ""}${npcName ? ` for *${npcName}*` : ""}.`;

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

function normalizeComponents(rows) {
  if (!Array.isArray(rows)) return rows;
  const normalized = [];
  for (const row of rows) {
    if (!row) continue;
    const baseRow = row.toJSON?.() ?? row;
    const rawComponents = baseRow.components ?? row.components ?? [];
    const seenIds = new Set();
    const mapped = (rawComponents || [])
      .map((comp) => comp?.toJSON?.() ?? comp)
      .filter((comp) => {
        if (!comp) return false;
        const cid = comp.custom_id ?? comp.customId ?? null;
        if (cid && seenIds.has(cid)) return false;
        if (cid) seenIds.add(cid);
        return true;
      });
    if (!mapped.length) continue;
    normalized.push({ type: 1, components: mapped });
  }
  return normalized.length ? normalized : [];
}

async function componentCommit(interaction, payload) {
const { ephemeral, targetMessageId, ...rest } = payload ?? {};

if (rest.embeds) {
  rest.embeds = sanitizeEmbedsForDiscord(rest.embeds);
}

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
      const editPayload = { ...rest };
      if (editPayload.components) {
        editPayload.components = normalizeComponents(editPayload.components);
      }
      if (editPayload.embeds) {
        editPayload.embeds = sanitizeEmbedsForDiscord(editPayload.embeds);
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
const options = shouldBeEphemeral ? { ...rest, flags: MessageFlags.Ephemeral, ephemeral: true } : { ...rest };
if (options.embeds) {
  options.embeds = sanitizeEmbedsForDiscord(options.embeds);
}
if (options.components) {
  options.components = normalizeComponents(options.components);
}

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
  finalOptions.components = normalizeComponents(finalOptions.components);
}

// Ensure embeds are included in finalOptions and converted to JSON
if (!finalOptions.embeds && rest.embeds) {
  finalOptions.embeds = rest.embeds;
}
if (finalOptions.embeds) {
  finalOptions.embeds = applyGreenButtonFooter(finalOptions.embeds, finalOptions.components);
}
// Convert EmbedBuilder objects to JSON
if (finalOptions.embeds) {
  finalOptions.embeds = finalOptions.embeds.map(embed => embed.toJSON?.() ?? embed);
}

// Use editReply for components that were deferred  
if (interaction.deferred || interaction.replied) {
  try {
    return await interaction.editReply(finalOptions);
  } catch (e) {
    console.error(`Component editReply failed:`, e?.message);
    // Try followUp as fallback
    try {
      return await interaction.followUp({ ...finalOptions, ephemeral: true });
    } catch (e2) {
      console.error(`Component followUp fallback also failed:`, e2?.message);
      return;
    }
  }
}

// Last resort fallback - not deferred/replied yet
try {
  return await interaction.update(finalOptions);
} catch (e) {
  console.error(`Component update failed:`, e?.message);
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

function buildMultiBuyPickerPayload({ userId, p, s, ownerUser, page = 0 }) {
  if (!s.market_prices) s.market_prices = {};
  if (!p.market_stock) p.market_stock = {};

  const allowed = getUnlockedIngredientIds(p, content);

  const allOpts = (MARKET_ITEM_IDS ?? [])
    .map((id) => {
      if (!allowed.has(id)) return null;

      const it = content.items?.[id];
      if (!it) return null;

      const price = s.market_prices?.[id] ?? it.base_price ?? 0;
      const stock = p.market_stock?.[id] ?? 0;
      if (stock <= 0) return null;

      const ownedQty = p.inv_ingredients?.[id] ?? 0;
      const labelRaw = `${it.name} — ${price}c (stock ${stock}, you have ${ownedQty})`;
      const label = labelRaw.length > 100 ? labelRaw.slice(0, 97) + "…" : labelRaw;

      return { label, value: id };
    })
    .filter(Boolean)
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));

  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(allOpts.length / pageSize));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const opts = allOpts.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const marketRestockDay = p.market_stock_day ?? s.market_day ?? dayKeyUTC();
  const marketRestockMs = parseYYYYMMDD(marketRestockDay) + (24 * 60 * 60 * 1000);
  const marketRestockTs = Math.floor(marketRestockMs / 1000);
  const marketRestockLine = `\n${getIcon("refresh")} Market restocks <t:${marketRestockTs}:f> (<t:${marketRestockTs}:R>).`;

  if (!opts.length) {
    const emptyEmbed = buildMenuEmbed({
      title: `${getIcon("cart")} Multi-buy`,
      description: `${getIcon("cart")} No market items are available for your unlocked recipes right now.\n\n${marketRestockLine}`,
      user: ownerUser
    });
    emptyEmbed.setTimestamp(new Date(marketRestockMs));
    return {
      content: " ",
      embeds: [emptyEmbed],
      components: [noodleMainMenuRow(userId)],
      ephemeral: true
    };
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`noodle:multibuy:select:${userId}`)
    .setPlaceholder("Select up to 5 items to buy.")
    .setMinValues(1)
    .setMaxValues(Math.min(5, opts.length))
    .addOptions(opts);

  const navRow = totalPages > 1
    ? new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`noodle:nav:buy:${userId}:${safePage - 1}`)
          .setLabel("Prev")
          .setEmoji(getButtonEmoji("back"))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage <= 0),
        new ButtonBuilder()
          .setCustomId(`noodle:nav:buy:${userId}:${safePage + 1}`)
          .setLabel("Next")
          .setEmoji(getButtonEmoji("next"))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage >= totalPages - 1)
      )
    : null;

  const acceptedEntries = Object.entries(p.orders?.accepted ?? {});
  const allNeeded = {};

  // Account for cooked bowls so shopping list only shows truly missing ingredients
  const neededCountsByRecipe = {};
  acceptedEntries.forEach(([, entry]) => {
    const recipeId = entry?.order?.recipe_id;
    if (!recipeId) return;
    neededCountsByRecipe[recipeId] = (neededCountsByRecipe[recipeId] ?? 0) + 1;
  });

  for (const [recipeId, neededCount] of Object.entries(neededCountsByRecipe)) {
    const recipe = content.recipes[recipeId];
    if (!recipe?.ingredients) continue;

    const ready = getTotalBowlsForRecipe(p, recipeId);
    const remaining = Math.max(0, neededCount - ready);
    if (remaining <= 0) continue;

    recipe.ingredients.forEach((ing) => {
      allNeeded[ing.item_id] = (allNeeded[ing.item_id] ?? 0) + (ing.qty * remaining);
    });
  }

  const shortages = Object.entries(allNeeded)
    .map(([id, needed]) => {
      const have = p.inv_ingredients?.[id] ?? 0;
      const short = Math.max(0, needed - have);
      return { id, needed, have, short };
    })
    .filter((s) => s.short > 0);

  const shoppingShortages = shortages.filter(
    (s) => MARKET_ITEM_IDS.includes(s.id) && !FORAGE_ITEM_IDS.includes(s.id)
  );

  const showShoppingList = acceptedEntries.length > 0;
  const maxShoppingLines = 8;
  const shoppingLines = shoppingShortages
    .slice(0, maxShoppingLines)
    .map((s) => `• ${displayItemName(s.id, content)} — need **${s.short}**`);
  const shoppingSummary = shoppingShortages.length > maxShoppingLines
    ? `\n…and **${shoppingShortages.length - maxShoppingLines}** more`
    : "";
  const shoppingList = showShoppingList
    ? (shoppingShortages.length
      ? `\n${getIcon("basket")} **Shopping List**\n${shoppingLines.join("\n")}${shoppingSummary}`
      : shortages.length
        ? `\n${getIcon("basket")} **Shopping List**\n_Forage-only ingredients aren't shown here. Forage to gather what's left._`
        : `\n${getIcon("basket")} **Shopping List**\n_All ingredients ready for accepted orders._`)
    : null;

  const descriptionLines = [
    "Select up to **5** items",
    "When you’re done selecting, if on Desktop, press **Esc** to continue",
    shoppingList ? "" : null,
    shoppingList,
    "",
    marketRestockLine
  ].filter(Boolean);

  const buyEmbed = buildMenuEmbed({
    title: `${getIcon("cart")} Multi-buy`,
    description: descriptionLines.join("\n"),
    user: ownerUser
  });
  const footerBase = `Coins: ${p.coins || 0}c`;
  const footerOwner = ownerFooterText(ownerUser);
  const pageLabel = totalPages > 1 ? `Page ${safePage + 1}/${totalPages}` : null;
  const footerParts = [footerBase, pageLabel].filter(Boolean).join(" • ");
  buyEmbed.setFooter({
    text: `${footerParts}\n${footerOwner}`
  });

  const rows = [new ActionRowBuilder().addComponents(menu)];
  if (navRow) rows.push(navRow);
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:nav:sell:${userId}`)
        .setLabel("Sell Items").setEmoji(getButtonEmoji("coins"))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`noodle:nav:profile:${userId}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
    )
  );

  return {
    content: " ",
    embeds: [buyEmbed],
    components: rows
  };
}

function buildSellQuantityRow(userId, selectedIds, page) {
  const ids = (selectedIds ?? []).filter(Boolean).slice(0, 5);
  const safePage = Number.isFinite(page) ? Number(page) : 0;
  const joined = ids.join(",");

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:sell:sell1:${userId}:${safePage}:${joined}`)
      .setLabel("Sell 1 each")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`noodle:sell:sell5:${userId}:${safePage}:${joined}`)
      .setLabel("Sell 5 each")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`noodle:sell:sell10:${userId}:${safePage}:${joined}`)
      .setLabel("Sell 10 each")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:sell:${userId}:${safePage}`)
      .setLabel("Clear")
      .setStyle(ButtonStyle.Danger)
  );
}

function buildSellPickerPayload({ userId, p, s, ownerUser, page = 0 }) {
  const ownedItems = Object.entries(p.inv_ingredients ?? {})
    .filter(([id, q]) => q > 0 && SELLABLE_ITEM_IDS.has(id))
    .map(([id, ownedQty]) => {
      const it = content.items?.[id];
      if (!it) return null;

      const price = sellPrice(s, id);
      if (price <= 0) return null;

      return { id, ownedQty, name: it.name || id, price };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  if (!ownedItems.length) {
    return {
      content: `${getIcon("coins")} You don't have any sellable items right now.`,
      ephemeral: true
    };
  }

  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(ownedItems.length / pageSize));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const ownedPage = ownedItems.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const opts = ownedPage.map(({ id, ownedQty, name, price }) => {
    const labelRaw = `${name} — ${price}c each (you have ${ownedQty})`;
    const label = labelRaw.length > 100 ? labelRaw.slice(0, 97) + "…" : labelRaw;

    return { label, value: id };
  }).filter(Boolean);

  if (!opts.length) {
    return {
      content: `${getIcon("coins")} You don't have any sellable items right now.`,
      ephemeral: true
    };
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`noodle:sell:select:${userId}:${safePage}`)
    .setPlaceholder("Select items to sell")
    .setMinValues(1)
    .setMaxValues(Math.min(5, opts.length))
    .addOptions(opts);

  const cancelButton = new ButtonBuilder()
    .setCustomId(`noodle:nav:profile:${userId}`)
    .setLabel("Cancel")
    .setStyle(ButtonStyle.Secondary);

  const navRow = totalPages > 1
    ? new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`noodle:nav:sell:${userId}:${safePage - 1}`)
          .setLabel("Prev")
          .setEmoji(getButtonEmoji("back"))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage <= 0),
        new ButtonBuilder()
          .setCustomId(`noodle:nav:sell:${userId}:${safePage + 1}`)
          .setLabel("Next")
          .setEmoji(getButtonEmoji("next"))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage >= totalPages - 1)
      )
    : null;

  const sellEmbed = buildMenuEmbed({
    title: `${getIcon("coins")} Sell Items`,
    description:
      "Select up to **5** sellable items (market or fresh catches)\n" +
      "When you’re done selecting, if on Desktop, press **Esc** to continue",
    user: ownerUser
  });

  const footerBase = `Coins: ${p.coins || 0}c`;
  const footerOwner = ownerFooterText(ownerUser);
  const pageLabel = totalPages > 1 ? `Page ${safePage + 1}/${totalPages}` : null;
  const footerParts = [footerBase, pageLabel].filter(Boolean).join(" • ");
  const footerText = footerOwner ? `${footerParts}\n${footerOwner}` : footerParts;
  sellEmbed.setFooter({ text: footerText });

  return {
    content: " ",
    embeds: [sellEmbed],
    components: [
      new ActionRowBuilder().addComponents(menu),
      ...(navRow ? [navRow] : []),
      new ActionRowBuilder().addComponents(cancelButton)
    ]
  };
}

function buildAcceptPickerPayload({ userId, serverId, p, s, ownerUser, page = 0 }) {
  const set = buildSettingsMap(settingsCatalog, s.settings);
  s.season = computeActiveSeason(set);
  const activeEventEffects = getActiveEventEffects(eventsContent, s);
  const activeEventId = s.active_event_id ?? null;
  rollMarket({ serverId, content, serverState: s, eventEffects: activeEventEffects });
  ensureDailyOrdersForPlayer(p, set, content, s.season, serverId, userId, activeEventId);

  const pageSize = 25;
  const { totalCount, consumedSet, availableCount } = getOrdersMeta(p);
  const totalPages = Math.max(1, Math.ceil(Math.max(0, totalCount) / pageSize));
  const rawPage = Number.isFinite(page) ? page : 0;
  const requestedPage = rawPage < 0 ? totalPages - 1 : Math.max(0, rawPage);
  let safePage = Math.min(requestedPage, totalPages - 1);

  const loadPage = (pageNumber) => generateOrderPageForPlayer({
    playerState: p,
    settings: set,
    content,
    activeSeason: s.season,
    serverId,
    userId,
    activeEventId,
    page: pageNumber,
    pageSize
  });

  let pageData = loadPage(safePage);

  // If the requested page is empty but there are still available orders, jump to the nearest page with orders
  if (!pageData.orders.length && availableCount > 0) {
    let firstAvailableIndex = null;
    for (let i = 0; i < totalCount; i++) {
      if (!consumedSet.has(i)) {
        firstAvailableIndex = i;
        break;
      }
    }
    if (firstAvailableIndex !== null) {
      const fallbackPage = Math.floor(firstAvailableIndex / pageSize);
      if (fallbackPage !== safePage) {
        safePage = fallbackPage;
        pageData = loadPage(safePage);
      }
    }
  }

  if (!pageData.orders.length) {
    return { content: "No orders available to accept.", ephemeral: true };
  }

  const opts = pageData.orders.map((o) => {
    const rName = content.recipes[o.recipe_id]?.name ?? "a dish";
    const npcName = content.npcs[o.npc_archetype]?.name ?? "a customer";
    const readyBowls = getTotalBowlsForRecipe(p, o.recipe_id);
    const labelRaw = `${shortOrderId(o.order_id)} — ${readyBowls} ready — ${rName}`;
    const label = labelRaw.length > 100 ? labelRaw.slice(0, 97) + "…" : labelRaw;
    const descRaw = `${npcName}`;
    const description = descRaw.length > 100 ? descRaw.slice(0, 97) + "…" : descRaw;
    const option = { label, value: String(o.order_id), description };
    if (readyBowls > 0) {
      const emoji = getButtonEmoji("status_complete");
      if (emoji) option.emoji = emoji;
    }
    return option;
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`noodle:pick:accept_select:${userId}`)
    .setPlaceholder("Select orders to accept (up to 5)")
    .setMinValues(1)
    .setMaxValues(Math.min(5, opts.length))
    .addOptions(opts);

  const navRow = new ActionRowBuilder();
  if (totalPages > 1) {
    const prevTarget = (safePage - 1 + totalPages) % totalPages;
    const nextTarget = Math.min(totalPages - 1, safePage + 1);
    navRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:pick:accept:${userId}:${prevTarget}`)
        .setLabel("Prev")
        .setEmoji(getButtonEmoji("back"))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(totalPages <= 1),
      new ButtonBuilder()
        .setCustomId(`noodle:pick:accept:${userId}:${nextTarget}`)
        .setLabel("Next")
        .setEmoji(getButtonEmoji("next"))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage >= totalPages - 1)
    );
  }

  const rows = [new ActionRowBuilder().addComponents(menu)];
  if (totalPages > 1) rows.push(navRow);
  const tutorialOnlyAccept = isTutorialStep(p, "intro_order");
  if (!tutorialOnlyAccept) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`noodle:nav:orders:${userId}`)
          .setLabel("Back")
          .setEmoji(getButtonEmoji("back"))
          .setStyle(ButtonStyle.Secondary)
      )
    );
  }

  const acceptEmbed = buildMenuEmbed({
    title: `${getIcon("status_complete")} Accept Orders`,
    description: `Select orders to accept here.\nWhen you're done selecting, if on Desktop, press **Esc** to continue.`,
    user: ownerUser
  });

  const pageLabel = `Page ${safePage + 1}/${totalPages}`;
  const existingFooter = acceptEmbed?.data?.footer?.text ?? acceptEmbed?.footer?.text ?? "";
  const footerText = existingFooter ? `${pageLabel} • ${existingFooter}` : pageLabel;
  acceptEmbed.setFooter({ text: footerText });

  return {
    content: " ",
    embeds: [acceptEmbed],
    components: rows
  };
}

function buildCancelServePickerPayload({ action, userId, p, ownerUser }) {
  const accepted = Object.entries(p.orders?.accepted ?? {});
  const hasAcceptedOrders = accepted.length > 0;
  const canServeAll = action === "serve" ? canServeAllOrders(p) : false;

  // Summarize missing bowls for accepted orders
  const neededByRecipe = {};
  if (action === "serve" && hasAcceptedOrders) {
    accepted.forEach(([, entry]) => {
      const recipeId = entry?.order?.recipe_id;
      if (!recipeId) return;
      neededByRecipe[recipeId] = (neededByRecipe[recipeId] ?? 0) + 1;
    });
  }

  const missingLines = Object.entries(neededByRecipe)
    .map(([recipeId, need]) => {
      const ready = getTotalBowlsForRecipe(p, recipeId);
      if (ready >= need) return null;
      const rName = content.recipes?.[recipeId]?.name ?? recipeId;
      const short = need - ready;
      return `• ${rName} — need **${need}**, ready **${ready}** (cook **${short}** more)`;
    })
    .filter(Boolean);

  const opts = accepted.slice(0, 25).map(([oid, entry]) => {
    const snap = entry?.order ?? null;
    const rName = snap ? (content.recipes[snap.recipe_id]?.name ?? snap.recipe_id) : "Unknown Recipe";
    const npcName = snap ? (content.npcs[snap.npc_archetype]?.name ?? snap.npc_archetype) : "Unknown NPC";
    const labelRaw = `${shortOrderId(oid)} — ${rName}`;
    const label = labelRaw.length > 100 ? labelRaw.slice(0, 97) + "…" : labelRaw;
    const descRaw = `${npcName}`;
    const description = descRaw.length > 100 ? descRaw.slice(0, 97) + "…" : descRaw;
    const ready = entry?.order?.recipe_id ? getTotalBowlsForRecipe(p, entry.order.recipe_id) > 0 : false;
    const option = { label, value: oid, description };
    if (action === "serve" && ready) {
      const emoji = getButtonEmoji("status_complete");
      if (emoji) option.emoji = emoji;
    }
    return option;
  });

  if (!opts.length) {
    return { content: "You don’t have any accepted orders.", ephemeral: true };
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`noodle:pick:${action}_select:${userId}`)
    .setPlaceholder(action === "serve" ? "Select orders to serve" : "Select an order to cancel")
    .setMinValues(1)
    .setMaxValues(action === "serve" ? Math.min(5, opts.length) : 1)
    .addOptions(opts);

  const actionTitle = action === "serve"
    ? `${getIcon("bowl")} Serve Orders`
    : `${getIcon("cancel")} Cancel Order`;
  const actionDesc = action === "serve"
    ? "Select accepted orders to serve.\nWhen you're done selecting, if on Desktop, press **Esc** to continue."
    : "Select an accepted order to cancel.\nWhen you're done selecting, if on Desktop, press **Esc** to continue.";
  const descWithMissing = missingLines.length
    ? `${actionDesc}\n\n${getIcon("basket")} Missing bowls\n${missingLines.join("\n")}`
    : actionDesc;

  const actionEmbed = buildMenuEmbed({ title: actionTitle, description: descWithMissing, user: ownerUser });
  const tutorialOnlyServeMenu = action === "serve" && isTutorialStep(p, "intro_serve");

  return {
    content: " ",
    embeds: [actionEmbed],
    components: [
      new ActionRowBuilder().addComponents(menu),
      ...(tutorialOnlyServeMenu
        ? []
        : [
            action === "serve"
              ? noodleOrdersActionRowWithBack(userId, {
                  highlightAccept: !hasAcceptedOrders,
                  disableServe: !hasAcceptedOrders,
                  showServeAll: true,
                  disableServeAll: !canServeAll
                })
              : noodleOrdersActionRow(userId, { highlightAccept: !hasAcceptedOrders, disableServe: !hasAcceptedOrders })
          ])
    ]
  };
}

function buildCookPickerPayload({ userId, p, s, ownerUser, page = 0 }) {
  const hasAcceptedOrders = Object.keys(p.orders?.accepted ?? {}).length > 0;
  const { availableCount } = getOrdersMeta(p);
  const remainingOrders = availableCount;
  const disableAccept = remainingOrders === 0;
  const highlightAccept = !hasAcceptedOrders && !disableAccept;
  const available = getAvailableRecipes(p);
  const activeSeason = s?.season ?? null;
  const activeEventId = s?.active_event_id ?? null;
  const seasonFiltered = available.filter((rid) => {
    const r = content.recipes?.[rid];
    if (!r) return true;
    if (r.is_event_recipe) {
      return !!activeEventId && r.event_id === activeEventId;
    }
    if (r.tier !== "seasonal") return true;
    return !!activeSeason && r.season === activeSeason;
  });

  const sortKey = (rid) => {
    const r = content.recipes?.[rid];
    return (r?.name ?? displayItemName(rid, content) ?? "").toLowerCase();
  };

  const sorted = [...seasonFiltered].sort((a, b) => sortKey(a).localeCompare(sortKey(b), "en", { sensitivity: "base" }));
  const totalPages = Math.max(1, Math.ceil(sorted.length / 25));
  const safePage = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);

  const opts = sorted
    .slice(safePage * 25, (safePage + 1) * 25)
    .map((rid) => {
    const r = content.recipes?.[rid];
    const labelRaw = r ? `${r.name} (${r.tier})` : displayItemName(rid, content);
    const label = labelRaw.length > 100 ? labelRaw.slice(0, 97) + "…" : labelRaw;

    // Show ingredient availability and max cookable for quick glance
    const ingTokens = (r?.ingredients ?? []).map((ing) => {
      const have = Math.max(0, p.inv_ingredients?.[ing.item_id] ?? 0);
      const name = displayItemName(ing.item_id);
      const base = `${name}:${have}`;
      return ing.optional ? `${base} (opt)` : base;
    });

    const maxCookable = (r?.ingredients ?? [])
      .filter((ing) => !ing.optional && (ing?.qty ?? 0) > 0)
      .map((ing) => Math.floor((p.inv_ingredients?.[ing.item_id] ?? 0) / (ing.qty ?? 1)))
      .reduce((min, cur) => Math.min(min, cur), Infinity);
    const cookable = Number.isFinite(maxCookable) ? Math.max(0, maxCookable) : 0;

    const descRaw = ingTokens.length
      ? `${ingTokens.join(" · ")} | Max ${cookable}`
      : `Max ${cookable}`;
    const description = descRaw.length > 100 ? descRaw.slice(0, 97) + "…" : descRaw;

    const option = { label, value: rid, description };
    if (cookable > 0) {
      const emoji = getButtonEmoji("status_complete");
      if (emoji) option.emoji = emoji;
    }

    return option;
  });

  if (!opts.length) {
    const msg = available.length > 0
      ? "You don’t have any recipes available to cook this season."
      : "You don’t know any recipes yet.";
    return { content: msg, ephemeral: true };
  }

  // Show what needs to be cooked for accepted orders
  const neededByRecipe = {};
  Object.values(p.orders?.accepted ?? {}).forEach((entry) => {
    const recipeId = entry?.order?.recipe_id;
    if (!recipeId) return;
    neededByRecipe[recipeId] = (neededByRecipe[recipeId] ?? 0) + 1;
  });

  const cookNeedLines = Object.entries(neededByRecipe)
    .map(([recipeId, need]) => {
      const ready = getTotalBowlsForRecipe(p, recipeId);
      const short = Math.max(0, need - ready);
      if (short <= 0) return null; // hide recipes already ready
      const recipeName = content.recipes?.[recipeId]?.name ?? recipeId;
      const line = `• ${recipeName} — need **${need}**, ready **${ready}** (cook **${short}** more)`;
      return { short, line, recipeName };
    })
    .filter(Boolean);

  cookNeedLines.sort((a, b) => {
    if (b.short !== a.short) return b.short - a.short;
    return a.recipeName.localeCompare(b.recipeName);
  });

  const cookNeedsText = cookNeedLines.length
    ? `${getIcon("cook")} Accepted orders to cook:\n${cookNeedLines
        .slice(0, 6)
        .map((x) => x.line)
        .join("\n")}${cookNeedLines.length > 6 ? "\n…" : ""}`
    : "";

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`noodle:pick:cook_select:${userId}`)
    .setPlaceholder("Select a recipe to cook")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(opts);

  const cookEmbed = buildMenuEmbed({
    title: `${getIcon("cook")} Cook`,
    description: totalPages > 1
      ? `Select a recipe to cook:\n(page ${safePage + 1}/${totalPages})`
      : "Select a recipe to cook:",
    user: ownerUser
  });

  if (cookNeedsText) {
    const baseDesc = cookEmbed?.data?.description ?? cookEmbed?.description ?? "";
    const combined = baseDesc ? `${baseDesc}\n\n${cookNeedsText}` : cookNeedsText;
    cookEmbed.setDescription(combined);
  }

  const tutorialOnlyMenu = isTutorialStep(p, "intro_cook");
  const navRow = totalPages > 1
    ? new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`noodle:pick:cook:${userId}:${safePage - 1}`)
          .setLabel("Prev")
          .setEmoji(getButtonEmoji("back"))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage <= 0),
        new ButtonBuilder()
          .setCustomId(`noodle:pick:cook:${userId}:${safePage + 1}`)
          .setLabel("Next")
          .setEmoji(getButtonEmoji("next"))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage >= totalPages - 1)
      )
    : null;

  const components = [];
  components.push(new ActionRowBuilder().addComponents(menu));
  if (navRow) components.push(navRow);
  if (!tutorialOnlyMenu) {
    components.push(noodleOrdersActionRowWithBack(userId, {
      highlightAccept,
      disableAccept,
      disableServe: !hasAcceptedOrders
    }));
  }

  return {
    content: " ",
    embeds: [cookEmbed],
    components
  };
}

async function renderMultiBuyPicker({ interaction, userId, s, p }) {
  const payload = buildMultiBuyPickerPayload({
    userId,
    p,
    s,
    ownerUser: interaction.member ?? interaction.user
  });

  return componentCommit(interaction, payload);
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
flags: MessageFlags.Ephemeral,
ephemeral: true
});
}

const userId = interaction.user.id;

// Track the active player state for unlock notices so all replies can surface unlock banners wherever they happen.
let unlockNoticePlayer = null;

let seasonRolloverNotice = null;

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

const withSeasonNotice = (payload = {}) => {
  if (payload?.__seasonNoticeApplied) return payload;
  if (!seasonRolloverNotice?.message) return payload;
  const updated = { ...payload };
  const notice = seasonRolloverNotice.message;

  const noticeEmbed = buildMenuEmbed({
    title: `${getIcon("season")} Season Update`,
    description: notice,
    user: interaction.member ?? interaction.user
  });

  if (Array.isArray(updated.embeds) && updated.embeds.length > 0) {
    updated.embeds = [...updated.embeds, noticeEmbed];
  } else {
    updated.embeds = [noticeEmbed];
    if (updated.content === undefined) updated.content = " ";
  }

  Object.defineProperty(updated, "__seasonNoticeApplied", { value: true, enumerable: false });

  return updated;
};

const commit = async (payload) => {
  const unlockApplied = payload?.__unlockNoticeApplied;
  if (!unlockApplied) {
    payload = applyUnlockNoticeEmbeds(payload, unlockNoticePlayer, interaction.member ?? interaction.user);
  }
  payload = withSeasonNotice(payload);
// Slash: use editReply since we deferred at the start
if (interaction.isChatInputCommand?.()) {
const { ephemeral, ...rest } = payload ?? {};
const base = { ...rest };
if (base.embeds) {
  base.embeds = sanitizeEmbedsForDiscord(base.embeds);
}
if (base.embeds) {
  base.embeds = applyGreenButtonFooter(base.embeds, base.components);
}
// For ephemeral messages after a non-ephemeral defer, delete original and send ephemeral followUp
if (ephemeral && (interaction.deferred || interaction.replied)) {
  try {
    await interaction.deleteReply();
  } catch (e) {
    // Ignore errors if already deleted
  }
  return interaction.followUp({ ...base, ephemeral: true });
}
const options = ephemeral ? { ...base, ephemeral: true } : { ...base };
if (options.components) {
  options.components = normalizeComponents(options.components);
}
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
      const editPayload = { ...payload };
      if (editPayload.components) {
        editPayload.components = normalizeComponents(editPayload.components);
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
  const activeEventEffects = getActiveEventEffects(eventsContent, server);
  rollMarket({ serverId, content, serverState: server, eventEffects: activeEventEffects });

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
      content: `${getIcon("upgrades")} Complete reset for ${mention}.${tut ? `\n\n${tut}` : ""}`,
      ephemeral: true
    });
  });
}

if (group === "dev" && sub === "wipe_user") {
  if (!isDevAdmin(userId)) {
    return commit({ content: "You don’t have access to that command.", ephemeral: true });
  }
  const targetUser = opt.getUser("user");
  const targetUserId = targetUser?.id || opt.getString("user_id")?.trim();
  const targetServerId = opt.getString("server_id")?.trim() || serverId;
  if (!targetUserId) {
    return commit({ content: "Provide a user or user ID to wipe.", ephemeral: true });
  }
  if (!db) {
    return commit({ content: "Database unavailable in this environment.", ephemeral: true });
  }

  const lockKey = `lock:user:${targetServerId}:${targetUserId}`;
  return await withLock(db, lockKey, owner, 8000, async () => {
    const result = db.prepare("DELETE FROM players WHERE server_id=? AND user_id=?").run(targetServerId, targetUserId);
    const deleted = result?.changes ?? 0;
    const mention = `<@${targetUserId}>`;
    if (deleted === 0) {
      return commit({ content: `${getIcon("info")} No profile found for ${mention} on server ${targetServerId}.`, ephemeral: true });
    }
    return commit({ content: `${getIcon("upgrades")} Deleted ${deleted} profile(s) for ${mention} on server ${targetServerId}.`, ephemeral: true });
  });
}

const needsPlayer = group !== "dev" && !["help", "season", "event"].includes(sub);
const player = needsPlayer ? ensurePlayer(serverId, userId) : null;

if (player) {
  const touched = trackLastKitchen(player, serverId, interaction.channelId);
  if (touched && db) {
    upsertPlayer(db, serverId, userId, player, null, player.schema_version);
  }
}

seasonRolloverNotice = player ? applySeasonRolloverReward(player, server.season) : null;
if (seasonRolloverNotice?.cleared && db) {
  upsertPlayer(db, serverId, userId, player, null, player.schema_version);
}

/* ---------------- START ---------------- */
if (sub === "start") {
  if (!db) {
    return commit({ content: "Database unavailable in this environment.", ephemeral: true });
  }
  return await withLock(db, `lock:user:${userId}`, owner, 8000, async () => {
    const p = ensurePlayer(serverId, userId);
    const gardenUnlocked = isGardenUnlocked(p);
    const { unlocked: kitchenUnlocked, justUnlocked: kitchenJustUnlocked } = getKitchenUnlockState(p);
    const navRows = [
      noodleForageGardenRow(userId, { active: "forage", gardenLocked: !gardenUnlocked, includeKitchenButton: true, kitchenUnlocked, kitchenJustUnlocked }),
      noodleMainMenuRow(userId)
    ];

    const embed = buildMenuEmbed({
      title: `${getIcon("start")} Welcome to Noodle Story`,
      description: "Use the buttons below to play. If you need the tutorial again, run /noodle help.",
      user: interaction.member ?? interaction.user
    });

    return commitState({
      content: " ",
      embeds: [embed],
      components: navRows
    });

    const questsAvailable = hasDailyRewardAvailable(p, nowTs()) || hasClaimableQuests(p);
    return commit({
      content: " ",
      embeds: [tutorialEmbed],
      components: tutorialDone
        ? [noodleMainMenuRow(userId), noodleSecondaryMenuRow(userId, { questsAvailable })]
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
  const s = ensureServer(serverId);
  const selfPlayer = ensurePlayer(serverId, userId);
  const viewingSelf = u.id === userId;
  const questsAvailable = hasDailyRewardAvailable(selfPlayer, nowTs()) || hasClaimableQuests(selfPlayer);
  const specializationsAvailable = getSpecializationAlert(selfPlayer);
  const party = getUserActiveParty(db, u.id);
  
  const embed = renderProfileEmbed(p, u.displayName, party?.party_name, interaction.member ?? interaction.user);
  const marketStockKnown = p.market_stock && Object.keys(p.market_stock).length > 0;
  const hasMarketStock = marketStockKnown && Object.values(p.market_stock ?? {}).some((qty) => Number(qty) > 0);
  const { availableCount, totalCount } = getOrdersMeta(p);
  const ordersKnown = totalCount > 0;
  const remainingOrders = ordersKnown ? availableCount : null;
  if ((ordersKnown && remainingOrders === 0) || (marketStockKnown && !hasMarketStock)) {
    const marketRestockDay = p.market_stock_day ?? s.market_day ?? dayKeyUTC();
    const marketRestockMs = parseYYYYMMDD(marketRestockDay) + (24 * 60 * 60 * 1000);
    const existingFooter = embed?.footer?.text ?? embed?.data?.footer?.text ?? "";
    const footerText = buildMarketRefreshFooterText(existingFooter, marketRestockMs);
    embed.setFooter({ text: footerText });
  }
  const profileComponents = viewingSelf
    ? [noodleMainMenuRowNoProfile(userId), socialMainMenuRowNoProfile(userId, { questsAvailable, specializationsAvailable })]
    : [];
  const embedsWithFooter = applyGreenButtonFooter([embed], profileComponents);
  
  return commit({
    embeds: embedsWithFooter,
    components: profileComponents
  });
}

/* ---------------- PROFILE EDIT ---------------- */
if (sub === "profile_edit") {
  const p = ensurePlayer(serverId, userId);
  const specializationsAvailable = getSpecializationAlert(p);
  const embed = buildMenuEmbed({
    title: `${getIcon("customize")} Customize Profile`,
    description: "Once you unlock specializations based on your shop level, you can change the active specialization and that will update your shop's decor!",
    user: interaction.member ?? interaction.user
  });

  return commit({
    content: " ",
    embeds: [embed],
    components: [noodleProfileEditRow(userId, { specializationsAvailable }), noodleProfileEditBackRow(userId)]
  });
}

/* ---------------- PANTRY ---------------- */
if (sub === "pantry") {
  if (!db) {
    return commit({ content: "Database unavailable in this environment.", ephemeral: true });
  }

  return await withLock(db, `lock:user:${userId}`, owner, 8000, async () => {
    const p = ensurePlayer(serverId, userId);
    const s = ensureServer(serverId);
    unlockNoticePlayer = p;
    const rawPage = opt.getInteger("page") ?? overrides?.integers?.page ?? 0;
    const gardenUnlocked = isGardenUnlocked(p);
    const { unlocked: kitchenUnlocked, justUnlocked: kitchenJustUnlocked } = getKitchenUnlockState(p);
    const { unlocked: fishingUnlocked, justUnlocked: fishingJustUnlocked } = getFishingUnlockState(p);
    const now = nowTs();
    const combinedEffects = calculateCombinedEffects(p, upgradesContent, staffContent, calculateStaffEffects);
    const lastActiveAt = db ? (getLastActiveAt(db, serverId, userId) || now) : now;

    const set = buildSettingsMap(settingsCatalog, s.settings);
    s.season = computeActiveSeason(set);

    const timeCatchup = applyTimeCatchup(p, s, set, content, lastActiveAt, now, combinedEffects);
    const spoilageMessages = timeCatchup.spoilage?.messages ?? [];
    if (spoilageMessages.length > 0) {
      if (!p.notifications) {
        p.notifications = {
          pending_pantry_messages: [],
          dm_reminders_opt_out: false,
          last_daily_reminder_day: null,
          last_noodle_channel_id: null,
          last_noodle_guild_id: null
        };
      }
      if (!Array.isArray(p.notifications.pending_pantry_messages)) {
        p.notifications.pending_pantry_messages = [];
      }
      p.notifications.pending_pantry_messages.push(...spoilageMessages);
    }

    const grouped = new Map();
    for (const [id, qty] of Object.entries(p.inv_ingredients ?? {})) {
      if (!qty || qty <= 0) continue;
      const category = normalizeIngredientType(id);
      const name = displayItemName(id);
      const catMap = grouped.get(category) ?? new Map();
      const key = name.toLowerCase();
      const cur = catMap.get(key) ?? { name, qty: 0, id };
      cur.qty += qty;
      catMap.set(key, cur);
      grouped.set(category, catMap);
    }

    const perTypeCap = getIngredientCapacitiesByType(p, combinedEffects);
    const countsByType = getIngredientCountsByType(p);
    const typeOrder = ["broth", "noodles", "spice", "topping", "protein"];
    const typeLabels = {
      broth: "Broth",
      noodles: "Noodles",
      protein: "Protein",
      spice: "Spice",
      topping: "Topping"
    };

    const categoryBlocks = typeOrder
      .map((category) => {
        const items = grouped.get(category) ?? new Map();
        const lines = [...items.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(({ name, qty, id }) => {
            const starQty = category === "broth" ? Math.min(qty, getStarBrothCount(p, id)) : 0;
            const starPart = starQty > 0 ? ` ${getIcon("star", "⭐")} (${starQty})` : "";
            return `• ${name}: **${qty}**${starPart}`;
          })
          .join("\n");
        const have = countsByType[category] ?? 0;
        const cap = perTypeCap[category] ?? perTypeCap.topping ?? 0;
        const title = `${typeLabels[category]} (${have}/${cap})`;
        return lines ? `**${title}**\n${lines}` : `**${title}**\n_None yet._`;
      })
      .filter(Boolean);

    const brothBlock = categoryBlocks[0] || "No broths yet.";
    const noodleSpiceBlock = [categoryBlocks[1], categoryBlocks[2]].filter(Boolean).join("\n\n") || "No noodles or spices yet.";
    const toppingProteinBlock = [categoryBlocks[3], categoryBlocks[4]].filter(Boolean).join("\n\n") || "No toppings or proteins yet.";

    const brothChunks = chunkTextByLength(brothBlock, 900);
    const noodleSpiceChunks = chunkTextByLength(noodleSpiceBlock, 900);
    const toppingProteinChunks = chunkTextByLength(toppingProteinBlock, 900);
    if (!brothChunks.length) brothChunks.push("No broths yet.");
    if (!noodleSpiceChunks.length) noodleSpiceChunks.push("No noodles or spices yet.");
    if (!toppingProteinChunks.length) toppingProteinChunks.push("No toppings or proteins yet.");
    const ingredientPages = Math.max(brothChunks.length, noodleSpiceChunks.length, toppingProteinChunks.length);

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
    ? `**${getIcon("cook")} Cooked Bowls (${bowlCount}/${bowlCap})**\n${bowlLines}`
    : `**${getIcon("cook")} Cooked Bowls (${bowlCount}/${bowlCap})**\n_None yet._`;
    const bowlChunks = chunkTextByLength(bowlsBlock, 900);
    if (!bowlChunks.length) bowlChunks.push(`**${getIcon("cook")} Cooked Bowls (${bowlCount}/${bowlCap})**\n_None yet._`);
    const bowlPages = Math.max(1, bowlChunks.length);

    const totalPages = ingredientPages + bowlPages;
    const safePage = Math.min(Math.max(rawPage, 0), totalPages - 1);

    const pendingPantryMessages = p.notifications?.pending_pantry_messages ?? [];
    if (pendingPantryMessages.length > 0) {
      p.notifications.pending_pantry_messages = [];
    }

    if (db) {
      upsertPlayer(db, serverId, userId, p, null, p.schema_version);
      upsertServer(db, serverId, s, null);
    }

    const kitchenLine = !kitchenUnlocked
      ? `${getIcon("lock")} Kitchen unlocks at shop level ${KITCHEN_UNLOCK_LEVEL}.`
      : (kitchenJustUnlocked ? `${getIcon("cook")} Kitchen unlocked! Simmer broths with forageables in the Kitchen.` : null);

    const gardenLine = !gardenUnlocked
      ? `${getIcon("tree")} Garden unlocks at shop level ${GARDEN_UNLOCK_LEVEL}.`
      : null;

    const fishingLine = !fishingUnlocked
      ? `${getIcon("fishing")} Fishing unlocks at shop level ${FISHING_UNLOCK_LEVEL}.`
      : (fishingJustUnlocked ? `${getIcon("fishing")} Fishing unlocked! Cast lines from the Pantry.` : null);

    const unlockMessages = [gardenLine, kitchenLine, fishingLine].filter(Boolean);
    const unlockLine = unlockMessages.length ? unlockMessages.join("\n") : null;

    const viewingIngredients = safePage < ingredientPages;
    const spoilageNotice = viewingIngredients
      ? (combinedEffects.spoilage_reduction > 0
        ? null
        : "Forageables & seafood spoil over time.\nTip: Cold Cellar upgrades reduce spoilage.")
      : null;

    const pantryDescription = [
      pendingPantryMessages.length ? pendingPantryMessages.join("\n") : null,
      unlockLine,
      spoilageNotice
    ].filter(Boolean).join("\n\n");

    const pantryEmbed = buildMenuEmbed({
      title: `${getIcon("basket")} Pantry`,
      description: pantryDescription,
      user: interaction.member ?? interaction.user
    });

    if (safePage < ingredientPages) {
      const ingredientPage = Math.min(safePage, ingredientPages - 1);
      const brothValue = brothChunks[Math.min(ingredientPage, brothChunks.length - 1)] ?? "No broths yet.";
      const noodleSpiceValue = noodleSpiceChunks[Math.min(ingredientPage, noodleSpiceChunks.length - 1)] ?? "No noodles or spices yet.";
      const toppingProteinValue = toppingProteinChunks[Math.min(ingredientPage, toppingProteinChunks.length - 1)] ?? "No toppings or proteins yet.";
      pantryEmbed.addFields(
        {
          name: " ",
          value: ["· · · · · · ·", brothValue].join("\n"),
          inline: true
        },
        {
          name: " ",
          value: ["· · · · · · ·", noodleSpiceValue].join("\n"),
          inline: true
        },
        {
          name: " ",
          value: ["· · · · · · ·", toppingProteinValue].join("\n"),
          inline: true
        }
      );
      const pageLabel = `Ingredients ${ingredientPage + 1}/${ingredientPages}`;
      const existingFooter = pantryEmbed?.data?.footer?.text ?? pantryEmbed?.footer?.text ?? "";
      pantryEmbed.setFooter({ text: existingFooter ? `${pageLabel} • ${existingFooter}` : pageLabel });
    } else {
      const bowlPage = Math.min(safePage - ingredientPages, bowlPages - 1);
      const bowlsValue = bowlChunks[Math.min(bowlPage, bowlChunks.length - 1)] ?? bowlsBlock;
      pantryEmbed.addFields(
        {
          name: " ",
          value: bowlsValue,
          inline: false
        },
        {
          name: "Bowl Quality",
          value: `${formatQualityLabel("salvage")}:Salvage, ${formatQualityLabel("standard")}:Standard, ${formatQualityLabel("good")}:Good, ${formatQualityLabel("excellent")}:Excellent`,
          inline: false
        }
      );
      const pageLabel = `Cooked Bowls ${bowlPage + 1}/${bowlPages}`;
      const existingFooter = pantryEmbed?.data?.footer?.text ?? pantryEmbed?.footer?.text ?? "";
      pantryEmbed.setFooter({ text: existingFooter ? `${pageLabel} • ${existingFooter}` : pageLabel });
    }

    return commit({
      content: " ",
      embeds: [pantryEmbed],
      components: [
        pantryPageRow(userId, safePage, totalPages, ingredientPages),
        noodleForageGardenRow(userId, {
          active: "forage",
          gardenLocked: !gardenUnlocked,
          includeFishingButton: true,
          fishingUnlocked,
          fishingJustUnlocked,
          fishingStyleOverride: ButtonStyle.Primary
        }),
        noodleMainMenuRowNoPantry(userId),
        noodleRecipesMenuRow(userId, { kitchenUnlocked, kitchenJustUnlocked })
      ]
    });
  });
}

/* ---------------- KITCHEN ---------------- */
if (sub === "kitchen" || sub === "kitchen_start" || sub === "kitchen_collect") {
  if (!db) {
    return commit({ content: "Database unavailable in this environment.", ephemeral: true });
  }

  return await withLock(db, `lock:user:${userId}`, owner, 8000, async () => {
    const p = ensurePlayer(serverId, userId);
    const s = ensureServer(serverId);
    unlockNoticePlayer = p;
    const now = nowTs();
    const page = opt.getInteger("page") ?? 0;
    const combinedEffects = calculateCombinedEffects(p, upgradesContent, staffContent, calculateStaffEffects);
    const lastActiveAt = db ? (getLastActiveAt(db, serverId, userId) || now) : now;

    const set = buildSettingsMap(settingsCatalog, s.settings);
    s.season = computeActiveSeason(set);

    const timeCatchup = applyTimeCatchup(p, s, set, content, lastActiveAt, now, combinedEffects);
    const spoilageMessages = timeCatchup.spoilage?.messages ?? [];
    if (spoilageMessages.length > 0) {
      if (!p.notifications) {
        p.notifications = {
          pending_pantry_messages: [],
          dm_reminders_opt_out: false,
          last_daily_reminder_day: null,
          last_noodle_channel_id: null,
          last_noodle_guild_id: null
        };
      }
      if (!Array.isArray(p.notifications.pending_pantry_messages)) {
        p.notifications.pending_pantry_messages = [];
      }
      p.notifications.pending_pantry_messages.push(...spoilageMessages);
    }

    const { unlocked: kitchenUnlocked, justUnlocked: kitchenJustUnlocked } = getKitchenUnlockState(p);
    const capacity = getKitchenCapacity(p, combinedEffects);
    const pendingMessages = p.notifications?.pending_pantry_messages ?? [];
    if (pendingMessages.length > 0) {
      p.notifications.pending_pantry_messages = [];
    }
    const finalize = (payload) => {
      if (db) {
        upsertPlayer(db, serverId, userId, p, null, p.schema_version);
        upsertServer(db, serverId, s, null);
      }
      return commit({ ...payload });
    };

    const kitchenView = (overrides = {}) => buildKitchenViewPayload({
      player: p,
      user: interaction.member ?? interaction.user,
      userId,
      server: s,
      pendingMessages,
      now,
      kitchenUnlocked,
      kitchenJustUnlocked,
      effects: combinedEffects,
      page,
      ...overrides
    });

    if (!kitchenUnlocked && sub !== "kitchen") {
      const viewLocked = kitchenView();
      return finalize({ ...viewLocked, content: `${getIcon("lock")} Kitchen unlocks at shop level ${KITCHEN_UNLOCK_LEVEL}.`, ephemeral: true });
    }

    if (sub === "kitchen_start") {
      const brothIdRaw = opt.getString("broth_id") || opt.getString("broth") || opt.getString("item") || "";
      const brothId = String(brothIdRaw || "").trim();
      const batches = getKitchenBatches(p, now);
      if (!brothId || brothId === "none") {
        const view = kitchenView({
          banner: `${getIcon("cook")} Select a broth to start simmering.`
        });
        return finalize({ ...view, ephemeral: true });
      }

      const brothItem = content.items?.[brothId];
      if (!brothItem || String(brothItem.category).toLowerCase() !== "broth") {
        const view = kitchenView({
          banner: `${getIcon("warning")} That isn't a broth you can simmer.`
        });
        return finalize({ ...view, ephemeral: true });
      }

      if (batches.length >= capacity) {
        const view = kitchenView({
          banner: `${getIcon("hourglass")} All ${capacity} kitchen slot${capacity === 1 ? "" : "s"} are simmering.`
        });
        return finalize({ ...view, ephemeral: true });
      }

      const plan = planKitchenIngredients(p, brothId);
      if (!plan.ok) {
        const missingLine = Object.entries(plan.missing ?? {})
          .map(([id, qty]) => `${displayItemName(id)} x${qty}`)
          .join(" · ");
        const view = kitchenView({
          banner: `${getIcon("warning")} Not enough forageables for ${displayItemName(brothId)}.${missingLine ? ` Missing: ${missingLine}.` : ""}`
        });
        return finalize({ ...view, ephemeral: true });
      }

      const removal = removeIngredientsFromInventory(p, plan.used);
      if (!removal.success) {
        const view = kitchenView({
          banner: `${getIcon("warning")} Pantry changed — not enough forageables right now.`
        });
        return finalize({ ...view, ephemeral: true });
      }

      const kitchen = ensureKitchenState(p);
      const batchId = `kb_${now}_${Math.floor(Math.random() * 10000)}`;
      if (!Array.isArray(kitchen.active_batches)) kitchen.active_batches = [];
      kitchen.active_batches.push({
        id: batchId,
        broth_id: brothId,
        started_at: now,
        ready_at: now + getKitchenSimmerDurationMs(combinedEffects),
        ingredients: plan.used
      });

      const usedLine = Object.entries(plan.used)
        .map(([id, qty]) => `${displayItemName(id)} x${qty}`)
        .join(" · ");

      const view = kitchenView({
        banner: `${getIcon("cook")} Now simmering **${displayItemName(brothId)}**. Used: ${usedLine || "pantry"}.`
      });
      return finalize(view);
    }

    if (sub === "kitchen_collect") {
      const kitchen = ensureKitchenState(p);
      const batches = getKitchenBatches(p, now);
      const readyBatches = batches.filter((b) => b.ready);
      if (readyBatches.length === 0) {
        const view = kitchenView({
          banner: `${getIcon("help")} Nothing is simmering right now.`
        });
        return finalize({ ...view, ephemeral: true });
      }

      const drops = readyBatches.reduce((acc, batch) => {
        acc[batch.broth_id] = (acc[batch.broth_id] ?? 0) + 1;
        return acc;
      }, {});

      const capacityResult = applyIngredientCapacityToDrops(drops, p, combinedEffects);
      const accepted = capacityResult.accepted ?? {};
      const acceptedTotal = Object.values(accepted).reduce((sum, qty) => sum + qty, 0);
      if (acceptedTotal < 1) {
        const view = kitchenView({
          banner: `${getIcon("basket")} Pantry full — free broth capacity to collect.`
        });
        return finalize({ ...view, ephemeral: true });
      }

      addIngredientsToInventory(p, accepted, "block");
      addStarBroths(p, accepted);

      const totalBroths = Object.values(accepted).reduce((sum, qty) => sum + (qty || 0), 0);
      if (totalBroths > 0) {
        if (!p.lifetime) p.lifetime = {};
        p.lifetime.broths_collected = (p.lifetime.broths_collected || 0) + totalBroths;
        applyQuestProgress(p, questsContent, userId, { type: "broth_collect", amount: totalBroths }, now);
      }

      const remainingToRemove = { ...accepted };
      kitchen.active_batches = (kitchen.active_batches ?? []).filter((batch) => {
        const remaining = remainingToRemove[batch.broth_id] ?? 0;
        const isReady = (batch.ready_at ?? 0) <= now;
        if (isReady && remaining > 0) {
          remainingToRemove[batch.broth_id] = remaining - 1;
          return false;
        }
        return true;
      });

      const collectedLines = Object.entries(accepted)
        .map(([id, qty]) => `**${qty}× ${displayItemName(id)}**`)
        .join(" and ");
      const rejectedLines = Object.entries(capacityResult.rejected ?? {})
        .map(([id, qty]) => `${displayItemName(id)} x${qty}`)
        .join(" · ");
      const bannerParts = [`${getIcon("status_complete")} Collected ${collectedLines}!`];
      if (rejectedLines) {
        bannerParts.push(`${getIcon("basket")} Pantry full for ${rejectedLines}.`);
      }

      const view = kitchenView({
        banner: bannerParts.join(" ")
      });
      return finalize(view);
    }

    const view = kitchenView();
    return finalize(view);
  });
}

/* ---------------- RECIPES ---------------- */
if (sub === "recipes") {
  const p = ensurePlayer(serverId, userId);
  const allRecipeIds = new Set(Object.keys(content.recipes ?? {}));
  for (const rid of FISHING_RECIPE_IDS) allRecipeIds.add(rid);
  const totalRecipes = allRecipeIds.size;
  const allRecipes = [...allRecipeIds]
    .map((id) => content.recipes?.[id])
    .filter(Boolean);

  const knownIds = getAvailableRecipes(p);
  const knownSet = new Set(knownIds);
  const unlockedTotal = (p.known_recipes || []).filter((id) => allRecipeIds.has(id)).length;
  const rarityOrder = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
  const knownRecipes = knownIds
    .map((id) => content.recipes?.[id])
    .filter(Boolean)
    .sort((a, b) => {
      const aTier = rarityOrder[a.tier] ?? 999;
      const bTier = rarityOrder[b.tier] ?? 999;
      if (aTier !== bTier) return aTier - bTier;
      return String(a.name).localeCompare(String(b.name));
    });

  const knownLines = knownRecipes.map((r) => {
    const tier = r.tier ? ` (${r.tier})` : "";
    let eventTag = "";
    if (r.event_id) {
      const evt = eventsContent?.events?.find((e) => e.event_id === r.event_id);
      const badgeIcon = evt?.badge_id ? getIcon(evt.badge_id, getIcon("event")) : getIcon("event");
      const seasonLabel = evt?.season ? ` ${evt.season.charAt(0).toUpperCase() + evt.season.slice(1)}` : "Event";
      eventTag = ` ${badgeIcon} ${seasonLabel}`;
    }
    const ingredients = (r.ingredients ?? [])
      .map((ing) => formatIngredientLabel(ing))
      .join(", ");
    const ingredientLine = ingredients ? ingredients : "_No ingredients listed._";
    return `• **${r.name}**${tier}${eventTag}\n  ${ingredientLine}`;
  });

  const cluesMap = p.clues_owned ?? {};
  const clueEntries = Object.values(cluesMap).filter(Boolean);
  const clueLines = clueEntries
    .map((entry) => {
      const recipeId = entry.recipe_id;
      const recipe = content.recipes?.[recipeId];
      const name = recipe?.name ?? recipeId ?? "Unknown recipe";
      const tier = recipe?.tier ? ` (${recipe.tier})` : "";
      const eventTag = recipe?.event_id ? ` ${getIcon("event")} Event` : "";
      const count = entry.count ?? 0;
      const revealed = entry.revealed_ingredients ?? [];
      const revealedNames = revealed.length
        ? revealed.map((id) => displayItemName(id)).join(", ")
        : "_No ingredients revealed yet._";
      return `• **${name}**${tier}${eventTag}\n **${count}/${CLUES_TO_UNLOCK_RECIPE}** Clues revealed: ${revealedNames}`;
    })
    .sort((a, b) => a.localeCompare(b));

  const baseRecipeCount = allRecipes.filter((recipe) => !recipe?.event_id).length;
  const unlockedEventRecipeCount = (p.known_recipes || []).filter((id) => content.recipes?.[id]?.event_id).length;

  const recipesPerPage = 5;
  const recipePages = Math.max(1, Math.ceil((knownLines.length || 0) / recipesPerPage));
  const totalPages = recipePages + 1; // recipe pages + clues page

  const rawPageInput = opt.getInteger("page");
  const navParts = interaction.customId?.split?.(":") ?? [];
  const rawPageParam = navParts[4];
  const isClueNav = rawPageParam === "clues";
  const rawPage = Number.isInteger(rawPageInput) ? rawPageInput : Number(rawPageParam);
  const page = isClueNav
    ? totalPages - 1
    : Math.min(Math.max(Number.isFinite(rawPage) ? rawPage : 0, 0), totalPages - 1);

  const isCluePage = page >= recipePages;
  const recipePageIndex = Math.min(page, recipePages - 1);
  const recipeStart = recipePageIndex * recipesPerPage;
  const recipeSlice = knownLines.slice(recipeStart, recipeStart + recipesPerPage);

  const pageTitle = !isCluePage
    ? `**Unlocked Recipes (${unlockedTotal}/${totalRecipes})**${recipePages > 1 ? ` — Page ${recipePageIndex + 1}/${recipePages}` : ""}`
    : `**Clues Collected (${clueEntries.length})**`;

  const pageBody = !isCluePage
    ? (recipeSlice.length ? recipeSlice.join("\n\n") : "_None yet._")
    : (clueLines.length ? clueLines.join("\n\n") : "_No clues yet._");

  const section = `${pageTitle}\n${pageBody}`;

  const recipesEmbed = buildMenuEmbed({
    title: `${getIcon("recipes")} **Recipes**`,
    description: section,
    user: interaction.member ?? interaction.user
  });

  const pageLabel = `Page ${page + 1}/${totalPages}`;
  const existingFooter = recipesEmbed?.data?.footer?.text ?? recipesEmbed?.footer?.text ?? "";
  const footerText = existingFooter ? `${pageLabel} • ${existingFooter}` : pageLabel;
  recipesEmbed.setFooter({ text: footerText });

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:nav:recipes:${userId}:${page - 1}`)
      .setLabel("Prev")
      .setEmoji(getButtonEmoji("back"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:recipes:${userId}:${page + 1}`)
      .setLabel("Next")
      .setEmoji(getButtonEmoji("next"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:recipes:${userId}:clues`)
      .setLabel("Clues")
      .setEmoji(getButtonEmoji("scroll"))
      .setStyle(isCluePage ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  return commit({
    content: " ",
    embeds: [recipesEmbed],
    components: [noodleMainMenuRow(userId), navRow]
  });
}

/* ---------------- REGULARS ---------------- */
if (sub === "regulars") {
  const rarityOrder = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
  const npcs = Object.values(content.npcs ?? {})
    .filter(Boolean)
    .sort((a, b) => {
      const aTier = rarityOrder[a.rarity] ?? 999;
      const bTier = rarityOrder[b.rarity] ?? 999;
      if (aTier !== bTier) return aTier - bTier;
      return String(a.name).localeCompare(String(b.name));
    });

  const pageSize = 5;
  const totalPages = Math.max(1, Math.ceil(npcs.length / pageSize));
  const rawPage = opt.getInteger("page") ?? 0;
  const page = Math.min(Math.max(rawPage, 0), totalPages - 1);
  const pageItems = npcs.slice(page * pageSize, (page + 1) * pageSize);

  const lines = pageItems.map((npc) => {
    const rarity = npc.rarity ? ` (${npc.rarity})` : "";
    const flavor = npc.flavor ? `_${npc.flavor}_` : "_No flavor text._";
    const bonusLines = npc.bonuses && Object.keys(npc.bonuses).length
      ? Object.entries(npc.bonuses)
          .map(([key, value]) => `• ${formatBonusLabel(key)}: **${formatBonusValue(key, value)}**`)
          .join("\n")
      : null;

    return [
      `**${npc.name}**${rarity}`,
      flavor,
      bonusLines
    ].filter(Boolean).join("\n");
  });

  const regularsEmbed = buildMenuEmbed({
    title: `${getIcon("chef")} Regulars`,
    description: lines.length
      ? lines.join("\n\n")
      : "No regulars found.",
    user: interaction.member ?? interaction.user
  });

  if (lines.length) {
    const pageLabel = `Page ${page + 1}/${totalPages}`;
    const existingFooter = regularsEmbed?.data?.footer?.text ?? regularsEmbed?.footer?.text ?? "";
    const footerText = existingFooter ? `${pageLabel} • ${existingFooter}` : pageLabel;
    regularsEmbed.setFooter({ text: footerText });
  }

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:nav:regulars:${userId}:${page - 1}`)
      .setLabel("Prev")
      .setEmoji(getButtonEmoji("back"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:regulars:${userId}:${page + 1}`)
      .setLabel("Next")
      .setEmoji(getButtonEmoji("next"))
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

  const seasonFlavor = {
    spring: "Your shop smells of fresh herbs and rain-kissed broth.",
    summer: "Your shop hums with bright, citrusy steam and lively crowds.",
    autumn: "Your shop glows with warm spices and crackling lantern light.",
    winter: "Your shop is a cozy haven of rich broth and drifting snow."
  }[server.season] ?? null;

  const seasonEmbed = buildMenuEmbed({
    title: `${getIcon("season")} Season`,
    description: [
      `The world is currently in **${server.season}**.`,
      seasonFlavor,
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
      .setLabel("Daily Reward").setEmoji(getButtonEmoji("daily_reward"))
      .setStyle(dailyAvailable ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!dailyAvailable),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:quests:${userId}`)
      .setLabel("Quests").setEmoji(getButtonEmoji("quests"))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:event:${userId}`)
      .setLabel("Event").setEmoji(getButtonEmoji("event"))
      .setStyle(ButtonStyle.Secondary)
  );

  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`noodle:nav:profile:${userId}`).setLabel("Back").setEmoji(getButtonEmoji("back")).setStyle(ButtonStyle.Secondary)
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

  const guildCount = interaction.client?.guilds?.cache?.size ?? 0;
  const shardId = interaction.guild?.shardId ?? null;
  const shardCount = interaction.client?.shard?.count ?? null;
  const shardText = Number.isFinite(shardId) && Number.isFinite(shardCount)
    ? `${shardId + 1}/${shardCount}`
    : "n/a";
  const mem = process.memoryUsage();
  const rssMb = (mem.rss / (1024 * 1024)).toFixed(1);
  const heapMb = (mem.heapUsed / (1024 * 1024)).toFixed(1);

  const backupDir = process.env.NOODLE_BACKUP_DIR || path.join(process.cwd(), "data", "backups");
  let lastBackup = "unknown";
  try {
    const latestPath = path.join(backupDir, "latest.sqlite");
    if (fs.existsSync(latestPath)) {
      const stat = fs.statSync(latestPath);
      lastBackup = `<t:${Math.floor(stat.mtimeMs / 1000)}:f>`;
    } else if (fs.existsSync(backupDir)) {
      const entries = fs.readdirSync(backupDir)
        .filter((name) => name.startsWith("noodlestory-") && name.endsWith(".sqlite"));
      if (entries.length) {
        const newest = entries
          .map((name) => ({ name, stat: fs.statSync(path.join(backupDir, name)) }))
          .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0];
        lastBackup = `<t:${Math.floor(newest.stat.mtimeMs / 1000)}:f>`;
      }
    }
  } catch {
    // Ignore backup stat errors.
  }
  
  const statusInfo = [
    `${getIcon("calendar")} Orders last reset: ${ordersStr}`,
    `${getIcon("cart")} Market last rolled: ${marketStr}`,
    `${getIcon("group")} Guilds: ${guildCount}`,
    `${getIcon("stats")} Memory: ${rssMb} MB RSS / ${heapMb} MB heap`,
    `${getIcon("leaderboard")} Shard: ${shardText}`,
    `${getIcon("refresh")} Last backup: ${lastBackup}`
  ].join("\n");
  
  // Defer as ephemeral, then editReply with the info
  if (!interaction.deferred && !interaction.replied) {
    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (e) {
      // ignore
    }
  }
  
  const statusEmbed = buildMenuEmbed({
    title: `${getIcon("stats")} Status`,
    description: statusInfo,
    user: interaction.member ?? interaction.user
  });

  return await interaction.editReply({
    content: " ",
    embeds: [statusEmbed]
  });
}

/* ---------------- EVENT ---------------- */
if (sub === "event") {
  const player = ensurePlayer(serverId, userId);
  const knownRecipeIds = new Set(getAvailableRecipes(player));
  const dailyAvailable = hasDailyRewardAvailable(player, nowTs());
  const eventRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:action:quests_daily:${userId}`)
      .setLabel("Daily Reward").setEmoji(getButtonEmoji("daily_reward"))
      .setStyle(dailyAvailable ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!dailyAvailable),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:quests:${userId}`)
      .setLabel("Quests").setEmoji(getButtonEmoji("quests"))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:season:${userId}`)
      .setLabel("Season").setEmoji(getButtonEmoji("season"))
      .setStyle(ButtonStyle.Secondary)
  );

  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`noodle:nav:profile:${userId}`).setLabel("Back").setEmoji(getButtonEmoji("back")).setStyle(ButtonStyle.Secondary)
  );

  const activeEvent = getActiveEvent(eventsContent, server);
  const activeEventName = activeEvent?.name ?? server.active_event_id;
  const activeEventTagline = activeEvent?.tagline ? `_${activeEvent.tagline}_` : null;
  const activeEventDetails = activeEvent?.description ?? null;
  const eventWindow = activeEvent ? getEventWindow(activeEvent) : { start: null, end: null };
  const startStamp = Number.isFinite(eventWindow.start) ? `<t:${Math.floor(eventWindow.start / 1000)}:f>` : null;
  const endStamp = Number.isFinite(eventWindow.end) ? `<t:${Math.floor(eventWindow.end / 1000)}:f>` : null;
  const activeEventWindow = startStamp && endStamp
    ? `${startStamp} - ${endStamp}`
    : startStamp
      ? `${startStamp} - ?`
      : endStamp
        ? `? - ${endStamp}`
        : null;
  const activeEventLines = [
    `Event active: **${activeEventName}**`,
    activeEventTagline,
    activeEventWindow,
    activeEventDetails,
    "Rewards apply to any order served during the event & unlocking an event scroll grants a badge!"
  ].filter(Boolean);

  const rewardEffects = activeEvent?.effects?.rewards ?? {};
  const rewardEntries = [];
  const rewardMultiplierLabels = [
    { key: "coins_mult", label: "Coins" },
    { key: "sxp_mult", label: "SXP" },
    { key: "rep_mult", label: "REP" }
  ];
  for (const { key, label } of rewardMultiplierLabels) {
    const mult = Number(rewardEffects[key]);
    if (!Number.isFinite(mult) || mult === 1) continue;
    const pct = Math.round((mult - 1) * 100);
    const sign = pct >= 0 ? "+" : "";
    rewardEntries.push(`${label}: ${sign}${pct}%`);
  }
  const rewardBonusLabels = [
    { key: "coins_bonus", label: "Coins" },
    { key: "sxp_bonus", label: "SXP" },
    { key: "rep_bonus", label: "REP" }
  ];
  for (const { key, label } of rewardBonusLabels) {
    const bonus = Number(rewardEffects[key]);
    if (!Number.isFinite(bonus) || bonus === 0) continue;
    const sign = bonus >= 0 ? "+" : "";
    rewardEntries.push(`${label}: ${sign}${bonus}`);
  }
  const rewardsSection = rewardEntries.length
    ? `**Rewards**\n${rewardEntries.map((entry) => `• ${entry}`).join("\n")}`
    : "**Rewards**\n_No event rewards listed._";

  const eventRecipes = activeEvent?.event_recipes ?? [];
  const recipesSection = eventRecipes.length
    ? `**Special Event Recipes**\n${eventRecipes
        .map((recipe) => {
          const tier = recipe?.tier ? ` (${recipe.tier})` : "";
          const recipeId = recipe?.recipe_id ?? recipe?.id ?? null;
          const collected = recipeId && knownRecipeIds.has(recipeId);
          const collectedIcon = collected ? `${getIcon("status_complete")} ` : "";
          return `• ${collectedIcon}**${recipe?.name ?? recipeId ?? "Unknown"}**${tier}`;
        })
        .join("\n")}`
    : "**Special Event Recipes**\n_No special event recipes listed._";

  const eventEmbed = buildMenuEmbed({
    title: `${getIcon("event")} Event`,
    description: server.active_event_id
      ? `${activeEventLines.join("\n")}\n\n${rewardsSection}\n\n${recipesSection}`
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
  unlockNoticePlayer = p;

  const now = nowTs();
  const combinedEffects = calculateCombinedEffects(p, upgradesContent, staffContent, calculateStaffEffects);
  
  // C: Apply time catch-up BEFORE any state changes
  // Get last_active_at from database (before it's updated by upsertPlayer)
  const lastActiveAt = db ? (getLastActiveAt(db, serverId, userId) || now) : now;
  
  const set = buildSettingsMap(settingsCatalog, s.settings);
  s.season = computeActiveSeason(set);
  const activeEventEffects = getActiveEventEffects(eventsContent, s);
  const activeEventId = s.active_event_id ?? null;
  const baseOrders = Math.max(1, Number(set.ORDERS_BASE_COUNT ?? 100));
  const totalOrders = computeOrderCount(set, combinedEffects);
  
  // Apply time catch-up (spoilage, inactivity messages, cooldown checks)
  const timeCatchup = applyTimeCatchup(p, s, set, content, lastActiveAt, now, combinedEffects);
  
  const sweep = sweepExpiredAcceptedOrders(p, s, content, now);

  rollMarket({ serverId, content, serverState: s, eventEffects: activeEventEffects });
  if (!s.market_prices) s.market_prices = {};
  
  // Roll per-player market stock daily
  rollPlayerMarketStock({
    userId,
    serverId,
    content,
    playerState: p,
    eventEffects: activeEventEffects,
    orderCountHint: totalOrders,
    baseOrders
  });
  if (!p.market_stock) p.market_stock = {};

  const prevOrdersDay = p.orders_day;
  ensureDailyOrdersForPlayer(p, set, content, s.season, serverId, userId, activeEventId);
  ensureQuests(p, questsContent, userId, now);

  // Force market stock refresh to align with daily order reset
  const dayChanged = prevOrdersDay !== p.orders_day;
  if (dayChanged) {
    p.market_stock_day = null;
    p.market_stock = null;
    const orderCountForStock = Math.max(totalOrders, Number(p.orders_total_count ?? 0));
    rollPlayerMarketStock({
      userId,
      serverId,
      content,
      playerState: p,
      eventEffects: activeEventEffects,
      orderCountHint: orderCountForStock,
      baseOrders
    });
  }

  // Apply resilience mechanics (B1-B9)
  const resilience = applyResilienceMechanics(p, s, content);

  // If resilience granted temporary recipes, regenerate order board to include them
  if (resilience.applied && p.resilience?.temp_recipes?.length > 0) {
    p.orders_day = null; // Force regeneration
    ensureDailyOrdersForPlayer(p, set, content, s.season, serverId, userId, activeEventId);
  }

  const commitState = async (replyObj) => {

    const replyWithUnlock = applyUnlockNoticeEmbeds(replyObj ?? {}, unlockNoticePlayer, interaction.member ?? interaction.user);
    if (replyWithUnlock && typeof replyWithUnlock === "object") {
      Object.defineProperty(replyWithUnlock, "__unlockNoticeApplied", { value: true, enumerable: false });
    }

    // Clear temporary recipes if player has coins again (B2)
    const hadTempRecipes = (p.resilience?.temp_recipes?.length || 0) > 0;
    clearTemporaryRecipes(p);
    const clearedTempRecipes = hadTempRecipes && (p.resilience?.temp_recipes?.length || 0) === 0;
    if (clearedTempRecipes) {
      // Regenerate orders for normal play after recovery
      p.orders_day = null;
      ensureDailyOrdersForPlayer(p, set, content, s.season, serverId, userId, activeEventId);
    }
    
    const spoilageMessages = timeCatchup.spoilage?.messages ?? [];
    if (spoilageMessages.length > 0) {
      if (!p.notifications) {
        p.notifications = {
          pending_pantry_messages: [],
          dm_reminders_opt_out: false,
          last_daily_reminder_day: null,
          last_noodle_channel_id: null,
          last_noodle_guild_id: null
        };
      }
      if (!Array.isArray(p.notifications.pending_pantry_messages)) {
        p.notifications.pending_pantry_messages = [];
      }
      p.notifications.pending_pantry_messages.push(...spoilageMessages);
    }

    if (db) {
      upsertPlayer(db, serverId, userId, p, null, p.schema_version);
      upsertServer(db, serverId, s, null);
    }

    // Prepend time catch-up and resilience messages
    let finalContent = replyWithUnlock.content || "";
    let finalEmbeds = replyWithUnlock.embeds ? [...replyWithUnlock.embeds] : [];

    const spoilageSet = new Set(spoilageMessages);
    const catchupMsgs = timeCatchup.messages.filter((msg) => !spoilageSet.has(msg));
    const catchupMsg = catchupMsgs.length > 0
      ? catchupMsgs.join("\n\n")
      : "";

    const banner = [catchupMsg].filter(Boolean).join("\n\n");

    if (banner) {
      const bannerEmbed = buildMenuEmbed({
        title: `${getIcon("time")} Update`,
        description: banner,
        user: interaction.member ?? interaction.user
      });
      finalEmbeds = [bannerEmbed, ...(finalEmbeds ?? [])];
    }

    const rescueEmbeds = [];
    if (resilience.messages.length > 0) {
      rescueEmbeds.push(buildMenuEmbed({
        title: `${getIcon("rescue")} Rescue Mode`,
        description: resilience.messages.join("\n\n"),
        user: interaction.member ?? interaction.user
      }));
    }
    if (clearedTempRecipes) {
      rescueEmbeds.push(buildMenuEmbed({
        title: `${getIcon("status_complete")} Recovery Complete`,
        description: "You’re back to normal play and your full recipe pool is restored.",
        user: interaction.member ?? interaction.user
      }));
    }
    if (rescueEmbeds.length > 0) {
      finalEmbeds = [...rescueEmbeds, ...(finalEmbeds ?? [])];
    }

    if (!finalEmbeds || finalEmbeds.length === 0) {
      finalEmbeds = undefined;
    }

    const noticeApplied = withSeasonNotice({ ...replyWithUnlock, content: finalContent, embeds: finalEmbeds ?? replyWithUnlock.embeds });

    const out = {
      ...noticeApplied,
      content: noticeApplied.content,
      embeds: noticeApplied.embeds,
      ephemeral: noticeApplied.ephemeral ?? false,
      components: noticeApplied.ephemeral
        ? (noticeApplied.components ?? [])
        : (noticeApplied.components ?? [noodleMainMenuRow(userId)])
    };
    if (out.embeds) {
      out.embeds = sanitizeEmbedsForDiscord(out.embeds);
    }
    if (out.embeds) {
      out.embeds = applyGreenButtonFooter(out.embeds, out.components);
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
            const status = q.completed_at ? getIcon("status_complete") : getIcon("status_pending");
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
      title: `${getIcon("quests")} Quests`,
      description: lines.join("\n"),
      user: interaction.member ?? interaction.user
    });
    const ownerText = ownerFooterText(interaction.member ?? interaction.user);
    questsEmbed.setFooter({
      text: `${ownerText}`
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
    const prevShopLevel = p.shop_level ?? 1;
    const result = claimDailyReward(p, dailyRewards, now);
    if (!result.ok) {
      const embed = buildMenuEmbed({
        title: `${getIcon("daily_reward")} Daily Reward`,
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
    if (result.reward.coins) rewardLines.push(`${getIcon("coins")} **${result.reward.coins}c**`);
    if (result.reward.sxp) rewardLines.push(`${getIcon("sxp")} **${result.reward.sxp} SXP**`);
    if (result.reward.rep) rewardLines.push(`${getIcon("rep")} **${result.reward.rep} REP**`);

    const levelLine = result.leveledUp > 0 ? `\n${getIcon("level_up")} Level up! **+${result.leveledUp}**` : "";
    const gardenLine = gardenUnlockLine(prevShopLevel, p.shop_level);
    const fishingLine = fishingUnlockLine(prevShopLevel, p.shop_level);
    const embed = buildMenuEmbed({
      title: `${getIcon("daily_reward")} Daily Reward`,
      description: `Streak: **${result.streak}** day(s)\nRewards: ${rewardLines.join(" · ")} ${levelLine}${gardenLine}${fishingLine}`,
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
    const prevShopLevel = p.shop_level ?? 1;
    const result = claimCompletedQuests(p);
    const lines = result.claimed.length
      ? result.claimed.map((entry) => {
          const rewardParts = [];
          if (entry.reward?.coins) rewardParts.push(`${entry.reward.coins}c`);
          if (entry.reward?.sxp) rewardParts.push(`${entry.reward.sxp} SXP`);
          if (entry.reward?.rep) rewardParts.push(`${entry.reward.rep} REP`);
          return `${getIcon("status_complete")} **${entry.quest.name}** — ${rewardParts.join(" · ")}`;
        })
      : ["_No completed quests to claim._"]; 

    const levelLine = result.leveledUp > 0 ? `\n${getIcon("level_up")} Level up! **+${result.leveledUp}**` : "";
    const gardenLine = gardenUnlockLine(prevShopLevel, p.shop_level);
    const fishingLine = fishingUnlockLine(prevShopLevel, p.shop_level);
    const embed = buildMenuEmbed({
      title: `${getIcon("status_complete")} Quest Rewards`,
      description: `${lines.join("\n")}${levelLine}${gardenLine}${fishingLine}`,
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
    markSpecializationShopLevelSeen(p, specializationsContent);
    const specializationsAvailable = getSpecializationAlert(p);

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
            .setEmoji(getButtonEmoji("back"))
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page <= 0),
          new ButtonBuilder()
            .setCustomId(`noodle:nav:specialize:${userId}:${page + 1}`)
            .setLabel("Next")
            .setEmoji(getButtonEmoji("next"))
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1)
        ));
      }
      components.push(
        noodleSpecializeSelectRow(userId),
        noodleProfileEditRow(userId, { specializationsAvailable }),
        noodleProfileEditBackRow(userId)
      );
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
        title: `${getIcon("sparkle")} Confirm Specialization`,
        description: `You're about to switch to **${spec.name}**. Re-run with confirm=true to proceed.`,
        user: interaction.member ?? interaction.user
      });
      return commitState({
        content: " ",
        embeds: [embed],
        components: [
          noodleSpecializeSelectRow(userId),
          noodleProfileEditRow(userId, { specializationsAvailable }),
          noodleProfileEditBackRow(userId)
        ]
      });
    }

    const result = selectSpecialization(p, specializationsContent, specId, now);
    if (!result.ok) return commitState({ content: result.reason, ephemeral: true });

    applyDecorSetForSpecialization(p, specId);

    if (db) {
      upsertPlayer(db, serverId, userId, p, null, p.schema_version);
    }

    const embed = buildMenuEmbed({
      title: `${getIcon("sparkle")} Specialization Updated`,
      description: `Active specialization: **${result.specialization?.name ?? specId}**.`,
      user: interaction.member ?? interaction.user
    });
    return commitState({
      content: " ",
      embeds: [embed],
      components: [
        noodleSpecializeSelectRow(userId),
        noodleProfileEditRow(userId, { specializationsAvailable }),
        noodleProfileEditBackRow(userId)
      ]
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
          .setEmoji(getButtonEmoji("back"))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page <= 0),
        new ButtonBuilder()
          .setCustomId(`noodle:nav:decor:${userId}:${page + 1}`)
          .setLabel("Next")
          .setEmoji(getButtonEmoji("next"))
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
      const progress = ensureCollectionProgress(p.collections, collection.collection_id);
      const entries = resolveCollectionEntries(collection, content);
      const totalEntries = entries.length;
      const completed = progress.completed_entries?.length ?? 0;
      const percent = totalEntries > 0 ? Math.floor((completed / totalEntries) * 100) : 0;
      const status = percent >= 100 ? getIcon("status_complete") : getIcon("status_incomplete");
      const description = collection.description ? `\n_${collection.description}_` : "";
      return `\n${status} **${collection.name}** — ${completed}/${totalEntries} (${percent}%)${description}`;
    });

    const embed = buildMenuEmbed({
      title: `${getIcon("collections")} Collections`,
      description: lines.length ? lines.join("\n") : "_No collections defined yet._",
      user: interaction.member ?? interaction.user
    });

    return commitState({
      content: " ",
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`noodle-social:nav:stats:${userId}`)
          .setLabel("Back")
          .setEmoji(getButtonEmoji("back"))
          .setStyle(ButtonStyle.Secondary)
      )]
    });
  }

  /* ---------------- FORAGE ---------------- */
  if (sub === "forage") {
    const gardenUnlocked = isGardenUnlocked(p);
    const { unlocked: kitchenUnlocked, justUnlocked: kitchenJustUnlocked } = getKitchenUnlockState(p);
    ensureGardenState(p);
    if (combinedEffects.garden_autoharvest) {
      autoHarvestReadyPlots(p, content, combinedEffects, {
        capacityLimiter: (drops) => applyIngredientCapacityToDrops(drops, p, combinedEffects)
      });
    }
    const gardenState = getGardenActionState(p, combinedEffects);
    const navRows = [
      noodleForageGardenRow(userId, {
        active: "forage",
        gardenLocked: !gardenUnlocked,
        showGardenActions: false,
        includeKitchenButton: true,
        kitchenUnlocked,
        kitchenJustUnlocked
      }),
      noodleMainMenuRow(userId)
    ];

    const baseCooldownMs = 2 * 60 * 1000;
    const cooldownMs = applyCooldownReduction(baseCooldownMs, combinedEffects);
    const chk = canForage(p, now, cooldownMs);

    if (!chk.ok) {
      const nextAtTs = Math.floor(chk.nextAt / 1000);
      const cooldownEmbed = buildMenuEmbed({
        title: `${getIcon("cooldown")} Forage Cooldown`,
        description: `You’ve foraged recently. Try again at <t:${nextAtTs}:t>, <t:${nextAtTs}:R>.`,
        user: interaction.member ?? interaction.user,
        color: theme.colors.success
      });
      return commitState({
        content: " ",
        embeds: [cooldownEmbed],
        components: navRows
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
        content: "You can only forage ingredients used by recipes you’ve unlocked.",
        components: navRows
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
          content: `${getIcon("forage")} You haven’t unlocked any forageable ingredients yet. Unlock a recipe first!`,
          components: navRows
        });
      }

      const suggestions = unlockedForageIds
        .map((id) => `\`${displayItemName(id)}\``)
        .join(", ");

      return commitState({
        content: `That isn't a valid forage item for your unlocked recipes. Try one of: ${suggestions}`,
        components: navRows
      });
    }

    if (itemId && bonusItems > 0) {
      drops[itemId] = (drops[itemId] ?? 0) + bonusItems;
    }

    // Pity: guarantee a rare forage after 10 forages without any rare drop
    const allowedRare = RARE_FORAGE_ITEM_IDS.filter((id) => allowedForage.has(id));
    if (allowedRare.length) {
      const hasRareDrop = Object.keys(drops).some((id) => allowedRare.includes(id));
      if (hasRareDrop) {
        p.forage_pity_rare_count = 0;
      } else {
        p.forage_pity_rare_count = (p.forage_pity_rare_count || 0) + 1;
        if (p.forage_pity_rare_count >= 10) {
          const pityRng = makeStreamRng({
            mode: "seeded",
            seed: 98765,
            streamName: "forage_pity",
            serverId,
            dayKey: dayKeyUTC(),
            userId: interaction.user.id
          });
          const pickIdx = Math.floor(pityRng() * allowedRare.length);
          const pityItem = allowedRare[Math.max(0, Math.min(allowedRare.length - 1, pickIdx))];
          drops[pityItem] = (drops[pityItem] ?? 0) + 1;
          p.forage_pity_rare_count = 0;
        }
      }
    }
    const capacityResult = applyIngredientCapacityToDrops(drops, p, combinedEffects, { allowDisplacingInventory: true });
    const { accepted, rejected, evicted } = capacityResult;

    if (evicted && Object.keys(evicted).length) {
      removeIngredientsFromInventory(p, evicted);
    }

    if (!Object.keys(accepted).length) {
      setForageCooldown(p, now);
      const forageFullEmbed = buildMenuEmbed({
        title: `${getIcon("forage")} Forage`,
        description: `${getIcon("basket")} Your pantry is full. Upgrade storage or use ingredients to make room.`,
        user: interaction.member ?? interaction.user,
        color: theme.colors.success
      });
      return commitState({
        content: " ",
        embeds: [forageFullEmbed],
        components: navRows
      });
    }

    const inventoryResult = applyDropsToInventory(p, accepted);
    setForageCooldown(p, now);
    if (!Object.keys(inventoryResult.added).length) {
      const blockedLines = Object.entries(inventoryResult.blocked ?? {}).map(
        ([id, q]) => `**${q}×** ${displayItemName(id)}`
      );
      const blockedText = blockedLines.length
        ? ` Could not collect: ${blockedLines.join(", ")}.`
        : "";
      const forageFullEmbed = buildMenuEmbed({
        title: `${getIcon("forage")} Forage`,
        description: `${getIcon("basket")} Your pantry is full. Upgrade storage or use ingredients to make room.${blockedText}`,
        user: interaction.member ?? interaction.user,
        color: theme.colors.success
      });
      return commitState({
        content: " ",
        embeds: [forageFullEmbed],
        components: navRows
      });
    }
    advanceTutorial(p, "forage");
    applyQuestProgress(p, questsContent, userId, { type: "forage", amount: 1 }, now);

    const fishLines = [];
    const seafoodLines = [];
    const otherLines = [];

    for (const [id, q] of Object.entries(inventoryResult.added)) {
      const name = displayItemName(id);
      const tags = Array.isArray(content.items?.[id]?.tags)
        ? content.items[id].tags.map((t) => String(t).toLowerCase())
        : [];
      const line = `• **${q}×** ${name}`;
      if (tags.includes("fish")) {
        fishLines.push(line);
      } else if (tags.includes("seafood")) {
        seafoodLines.push(line);
      } else {
        otherLines.push(line);
      }
    }

    const groupedLines = [
      fishLines.length ? `**Fish**\n${fishLines.join("\n")}` : null,
      seafoodLines.length ? `**Seafood**\n${seafoodLines.join("\n")}` : null,
      otherLines.length ? `${otherLines.join("\n")}` : null
    ].filter(Boolean);

    const header = itemId
      ? `You search carefully and gather:\n`
      : `You wander into the nearby grove and return with:\n`;

    const bodyLines = groupedLines.length ? groupedLines : ["_Nothing found._"];
    let description = `${header}${bodyLines.join("\n\n")}`;

    const seedDrops = {};
    if (gardenUnlocked) {
      const seedChanceBase = 0.05 + (combinedEffects.garden_seed_chance || 0);
      const seedChance = Math.min(0.5, seedChanceBase + (combinedEffects.forage_seed_chance || 0));

      for (const [id, qty] of Object.entries(inventoryResult.added)) {
        const rolls = Math.min(Math.max(1, qty), 3);
        let found = 0;
        for (let i = 0; i < rolls; i++) {
          if (Math.random() < seedChance) found += 1;
        }
        if (found > 0) {
          const seedId = getSeedIdForIngredient(id);
          seedDrops[seedId] = (seedDrops[seedId] || 0) + found;
        }
      }

      if (Object.keys(seedDrops).length) {
        addSeeds(p, seedDrops);
        const seedLines = Object.entries(seedDrops)
          .map(([id, q]) => `• **${q}×** ${getSeedDisplayName(id, content)}`)
          .join("\n");
        description += `\n\n${getIcon("tree")} Seeds collected:\n${seedLines}`;
      } else {
        description += `\n\n${getIcon("tree")} Small chance to find seeds from forageables (unlocked at level 25).`;
      }
    }

    if (!inventoryResult.success && Object.keys(inventoryResult.blocked).length > 0) {
      const blockedLines = Object.entries(inventoryResult.blocked).map(
        ([id, q]) => `**${q}×** ${displayItemName(id)}`
      );
      description += `\n\n${getIcon("warning")} **Pantry Full!** Could not collect: ${blockedLines.join(", ")}\n_Upgrade your Pantry to increase capacity._`;
    }

    description += tutorialSuffix(p);

    const rejectedText = Object.keys(rejected).length
      ? `\n\n${getIcon("basket")} Pantry full — left behind ${Object.entries(rejected)
        .map(([id, q]) => `**${q}×** ${displayItemName(id)}`)
        .join(", ")}.`
      : "";
    if (rejectedText) description += rejectedText;
    const forageEmbed = buildMenuEmbed({
      title: `${getIcon("forage")} Forage`,
      description: `${header}${bodyLines.join("\n\n")}${rejectedText}${tutorialSuffix(p)}`,
      user: interaction.member ?? interaction.user,
      color: theme.colors.success
    });
    forageEmbed.setDescription(description);
    const components = isTutorialStep(p, "intro_cook")
      ? [...navRows, noodleTutorialCookRow(userId)]
      : navRows;
    return commitState({
      content: " ",
      embeds: [forageEmbed],
      components
    });
  }

  /* ---------------- FISHING ---------------- */
  if (sub === "fishing") {
    ensureFishingState(p);
    unlockNoticePlayer = p;
    const { unlocked: fishingUnlocked, justUnlocked: fishingJustUnlocked } = getFishingUnlockState(p);
    const gardenUnlocked = isGardenUnlocked(p);
    const { unlocked: kitchenUnlocked, justUnlocked: kitchenJustUnlocked } = getKitchenUnlockState(p);
    const now = nowTs();

    const navRows = [
      noodleForageGardenRow(userId, {
        active: "fishing",
        gardenLocked: !gardenUnlocked,
        includeKitchenButton: true,
        kitchenUnlocked,
        kitchenJustUnlocked,
        includeFishingButton: true,
        fishingUnlocked,
        fishingJustUnlocked,
        gardenStyleOverride: ButtonStyle.Secondary,
        fishingStyleOverride: ButtonStyle.Primary
      }),
      noodleMainMenuRow(userId)
    ];

    if (fishingUnlocked && !p.fishing.first_visit_ack) {
      p.fishing.first_visit_ack = true;
    }

    if (!fishingUnlocked) {
      const lockedEmbed = buildMenuEmbed({
        title: `${getIcon("fishing")} Fishing`,
        description: `${getIcon("lock")} Reach shop level ${FISHING_UNLOCK_LEVEL} to unlock fishing and reel in fresh catches.`,
        user: interaction.member ?? interaction.user,
        color: theme.colors.success
      });
      return commitState({ content: " ", embeds: [lockedEmbed], components: navRows });
    }

    const baseCooldownMs = applyCooldownReduction(FISHING_BASE_COOLDOWN_MS, combinedEffects);
    const fishingCooldownMs = Math.floor(
      baseCooldownMs * (1 - Math.min(0.8, Math.max(0, combinedEffects.fishing_cooldown_reduction || 0)))
    );
    const chk = canFish(p, now, fishingCooldownMs);
    if (!chk.ok) {
      const nextAtTs = Math.floor(chk.nextAt / 1000);
      const cooldownEmbed = buildMenuEmbed({
        title: `${getIcon("cooldown")} Fishing Cooldown`,
        description: `You just finished fishing. Try again at <t:${nextAtTs}:t>, <t:${nextAtTs}:R>.`,
        user: interaction.member ?? interaction.user,
        color: theme.colors.success
      });
      return commitState({ content: " ", embeds: [cooldownEmbed], components: navRows });
    }

    const bonusItems = Math.max(0, Math.floor(combinedEffects.fishing_bonus_items || 0));
    let drops;
    try {
      drops = rollFishingDrops({
        serverId,
        userId: interaction.user.id,
        picks: 2 + bonusItems,
        effects: combinedEffects
      });
    } catch (err) {
      return commitState({
        content: `${getIcon("error")} Fishing isn’t available right now.`,
        components: navRows,
        ephemeral: true
      });
    }

    if (bonusItems > 0) {
      const ids = Object.keys(drops);
      if (ids.length) {
        const first = ids[0];
        drops[first] = (drops[first] ?? 0) + bonusItems;
      }
    }

    const allowedRare = RARE_FISHING_ITEM_IDS ?? [];
    if (allowedRare.length) {
      const hasRareDrop = Object.keys(drops).some((id) => allowedRare.includes(id));
      if (hasRareDrop) {
        p.fishing_pity_rare_count = 0;
      } else {
        p.fishing_pity_rare_count = (p.fishing_pity_rare_count || 0) + 1;
        if (p.fishing_pity_rare_count >= 10) {
          const pityRng = makeStreamRng({
            mode: "seeded",
            seed: 13579,
            streamName: "fishing_pity",
            serverId,
            dayKey: dayKeyUTC(),
            userId: interaction.user.id
          });
          const pickIdx = Math.floor(pityRng() * allowedRare.length);
          const pityItem = allowedRare[Math.max(0, Math.min(allowedRare.length - 1, pickIdx))];
          drops[pityItem] = (drops[pityItem] ?? 0) + 1;
          p.fishing_pity_rare_count = 0;
        }
      }
    }

    const capacityResult = applyIngredientCapacityToDrops(drops, p, combinedEffects);
    const { accepted, rejected } = capacityResult;

    if (!Object.keys(accepted).length) {
      setFishingCooldown(p, now);
      const fullEmbed = buildMenuEmbed({
        title: `${getIcon("fishing")} Fishing`,
        description: `${getIcon("basket")} Your pantry is full. Upgrade storage or use ingredients to make room.`,
        user: interaction.member ?? interaction.user,
        color: theme.colors.success
      });
      return commitState({ content: " ", embeds: [fullEmbed], components: navRows });
    }

    const inventoryResult = applyFishingDrops(p, accepted);
    const newlyUnlockedRecipes = unlockFishingRecipesFromDrops(p, inventoryResult.added);
    setFishingCooldown(p, now);

    if (!Object.keys(inventoryResult.added).length) {
      const blockedLines = Object.entries(inventoryResult.blocked ?? {}).map(
        ([id, q]) => `**${q}×** ${displayItemName(id)}`
      );
      const blockedText = blockedLines.length
        ? ` Could not collect: ${blockedLines.join(", ")}.`
        : "";
      const fullEmbed = buildMenuEmbed({
        title: `${getIcon("fishing")} Fishing`,
        description: `${getIcon("basket")} Your pantry is full. Upgrade storage or use ingredients to make room.${blockedText}`,
        user: interaction.member ?? interaction.user,
        color: theme.colors.success
      });
      return commitState({ content: " ", embeds: [fullEmbed], components: navRows });
    }

    const totalCaught = Object.values(inventoryResult.added).reduce((sum, qty) => sum + (qty || 0), 0);
    if (totalCaught > 0) {
      if (!p.lifetime) p.lifetime = {};
      p.lifetime.fish_caught = (p.lifetime.fish_caught || 0) + totalCaught;
      applyQuestProgress(p, questsContent, userId, { type: "fishing_catch", amount: totalCaught }, now);
    }

    const catchLines = Object.entries(inventoryResult.added).map(([id, q]) => `• **${q}×** ${displayItemName(id)}`);
    const groupedLinesText = catchLines.length ? catchLines.join("\n") : "_Nothing caught._";

    const unlockLines = [];
    if (newlyUnlockedRecipes.length) {
      const recipeNames = newlyUnlockedRecipes.map((rid) => content.recipes?.[rid]?.name ?? rid).join(" · ");
      unlockLines.push(`${getIcon("sparkle")} New recipes unlocked: ${recipeNames}.`);
      const activeEventId = s.active_event_id ?? null;
      ensureDailyOrdersForPlayer(p, set, content, s.season, serverId, userId, activeEventId);
    }

    const rejectedText = Object.keys(rejected || {}).length
      ? `\n\n${getIcon("basket")} Pantry full — left behind ${Object.entries(rejected)
        .map(([id, q]) => `**${q}×** ${displayItemName(id)}`)
        .join(", ")}.`
      : "";

    const fishingEmbed = buildMenuEmbed({
      title: `${getIcon("fishing")} Fishing`,
      description: [`You cast your line and reel in:\n${groupedLinesText}${rejectedText}`, unlockLines.join("\n")].filter(Boolean).join("\n\n"),
      user: interaction.member ?? interaction.user,
      color: theme.colors.success
    });

    return commitState({ content: " ", embeds: [fishingEmbed], components: navRows });
  }

  /* ---------------- GARDEN ---------------- */
  if (sub === "garden") {
    const page = Math.max(0, Math.min(1, opt.getInteger("page") ?? 0));
    const gardenUnlocked = isGardenUnlocked(p);
    const { unlocked: kitchenUnlocked, justUnlocked: kitchenJustUnlocked } = getKitchenUnlockState(p);
    if (combinedEffects.garden_autoharvest) {
      autoHarvestReadyPlots(p, content, combinedEffects, {
        capacityLimiter: (drops) => applyIngredientCapacityToDrops(drops, p, combinedEffects)
      });
    }

    if (!gardenUnlocked) {
      const lockedEmbed = buildMenuEmbed({
        title: `${getIcon("tree")} Garden`,
        description: `${getIcon("lock")} Reach shop level 25 to unlock your garden and start collecting seeds.`,
        user: interaction.member ?? interaction.user,
        color: theme.colors.success
      });
      const navRows = [
        noodleForageGardenRow(userId, { active: "garden", gardenLocked: !gardenUnlocked, includeKitchenButton: true, kitchenUnlocked, kitchenJustUnlocked }),
        noodleMainMenuRow(userId)
      ];
      return commitState({ content: " ", embeds: [lockedEmbed], components: navRows });
    }

    const view = buildGardenView({
      player: p,
      combinedEffects,
      user: interaction.member ?? interaction.user,
      userId,
      kitchenUnlocked,
      kitchenJustUnlocked,
      page
    });

    return commitState({
      content: " ",
      embeds: [view.embed],
      components: [view.rows.navRow, view.rows.pageRow, view.rows.plantRow, view.rows.harvestSelectRow, noodleMainMenuRow(userId)]
    });
  }

  /* ---------------- COMPOST ---------------- */
  if (sub === "compost") {
    const gardenUnlocked = isGardenUnlocked(p);
    const { unlocked: kitchenUnlocked, justUnlocked: kitchenJustUnlocked } = getKitchenUnlockState(p);
    if (combinedEffects.garden_autoharvest) {
      autoHarvestReadyPlots(p, content, combinedEffects, {
        capacityLimiter: (drops) => applyIngredientCapacityToDrops(drops, p, combinedEffects)
      });
    }
    const gardenState = getGardenActionState(p, combinedEffects);
    const navRows = [
      noodleForageGardenRow(userId, {
        active: "compost",
        gardenLocked: !gardenUnlocked,
        includeGardenButton: false,
        includeKitchenButton: true,
        kitchenUnlocked,
        kitchenJustUnlocked,
        showGardenActions: true,
        canCompost: gardenState.canCraft,
        canHarvest: gardenState.hasHarvestable
      }),
      noodleMainMenuRow(userId)
    ];

    if (!gardenUnlocked) {
      return commitState({
        content: `${getIcon("lock")} Garden unlocks at shop level 25.`,
        components: navRows
      });
    }

    const compostCap = getCompostCap(p, combinedEffects);
    const garden = ensureGardenState(p);
    const compostCount = garden.compost_bags || 0;
    const roomBags = Math.max(0, compostCap - compostCount);

    const spoiledPool = { ...garden.spoiled };
    const spoiledTotal = Object.values(spoiledPool).reduce((sum, v) => sum + (v || 0), 0);
    const pantryPool = getCompostableForageables(p, content);
    const pantryTotal = Object.values(pantryPool).reduce((sum, v) => sum + (v || 0), 0);

    const maxCraftable = Math.min(roomBags, Math.floor((spoiledTotal + pantryTotal) / COMPOST_PER_BAG));
    const requestedBags = Math.max(0, opt.getInteger("bags") || 0);
    const bagsToMake = Math.max(0, Math.min(requestedBags || maxCraftable, maxCraftable));
    const sourceRaw = (opt.getString("source") || "mix").toLowerCase();
    const source = ["fresh", "spoiled", "mix"].includes(sourceRaw) ? sourceRaw : "mix";

    if (maxCraftable <= 0) {
      const description = roomBags <= 0
        ? `${getIcon("basket")} Compost storage is full (${compostCount}/${compostCap}).`
        : `${getIcon("warning")} Not enough compostable items. (${COMPOST_PER_BAG} needed per bag.)`;
      const embed = buildMenuEmbed({ title: `${getIcon("tree")} Compost`, description, user: interaction.member ?? interaction.user, color: theme.colors.success });
      return commitState({ content: " ", embeds: [embed], components: navRows });
    }

    if (bagsToMake <= 0) {
      const embed = buildMenuEmbed({
        title: `${getIcon("tree")} Compost`,
        description: `${getIcon("help")} Enter at least 1 bag (max ${maxCraftable}).`,
        user: interaction.member ?? interaction.user,
        color: theme.colors.success
      });
      return commitState({ content: " ", embeds: [embed], components: navRows, ephemeral: true });
    }

    const unitsNeeded = bagsToMake * COMPOST_PER_BAG;

    const takeFromPool = (poolObj, allowedKeys, units) => {
      let remaining = units;
      const used = {};
      for (const [id, qty] of Object.entries(allowedKeys)) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, qty || 0);
        if (take <= 0) continue;
        poolObj[id] = Math.max(0, (poolObj[id] || 0) - take);
        if (poolObj[id] <= 0) delete poolObj[id];
        used[id] = (used[id] || 0) + take;
        remaining -= take;
      }
      return { remaining, used };
    };

    let spoiledUsed = {};
    let freshUsed = {};
    let remaining = unitsNeeded;

    if (source === "fresh") {
      const { remaining: rem, used } = takeFromPool(p.inv_ingredients || {}, pantryPool, remaining);
      remaining = rem;
      freshUsed = used;
    } else if (source === "spoiled") {
      const { remaining: rem, used } = takeFromPool(garden.spoiled, spoiledPool, remaining);
      remaining = rem;
      spoiledUsed = used;
    } else {
      const spoiledTake = takeFromPool(garden.spoiled, spoiledPool, remaining);
      spoiledUsed = spoiledTake.used;
      remaining = spoiledTake.remaining;
      if (remaining > 0) {
        const freshTake = takeFromPool(p.inv_ingredients || {}, pantryPool, remaining);
        freshUsed = freshTake.used;
        remaining = freshTake.remaining;
      }
    }

    if (remaining > 0) {
      const description = `${getIcon("warning")} Not enough ${source === "fresh" ? "fresh forageables" : source === "spoiled" ? "spoiled items" : "items"} to craft ${bagsToMake} bag(s).`;
      const embed = buildMenuEmbed({ title: `${getIcon("tree")} Garden`, description, user: interaction.member ?? interaction.user, color: theme.colors.success });
      return commitState({ content: " ", embeds: [embed], components: navRows, ephemeral: true });
    }

    garden.compost_bags = (garden.compost_bags || 0) + bagsToMake;
    if (bagsToMake > 0) {
      applyQuestProgress(p, questsContent, userId, { type: "garden_compost", amount: bagsToMake }, now);
    }

    const formatUsage = (label, usedMap) => {
      const entries = Object.entries(usedMap || {}).filter(([, qty]) => qty > 0);
      if (!entries.length) return null;
      return `${label} used:\n${entries.map(([id, qty]) => `• **${qty}×** ${displayItemName(id)}`).join("\n")}`;
    };

    const usageBlocks = [formatUsage("Saved spoilage", spoiledUsed), formatUsage("Fresh forageables", freshUsed)].filter(Boolean).join("\n\n");

    const description = [`${getIcon("basket")} Packed **${bagsToMake}** compost bag(s).`,
      `Compost now: **${garden.compost_bags}/${compostCap}**.`,
      usageBlocks].filter(Boolean).join("\n\n");

    const embed = buildMenuEmbed({
      title: `${getIcon("tree")} Compost`,
      description,
      user: interaction.member ?? interaction.user,
      color: theme.colors.success
    });

    return commitState({
      content: " ",
      embeds: [embed],
      components: navRows
    });
  }

  if (sub === "plant") {
    const gardenUnlocked = isGardenUnlocked(p);
    const { unlocked: kitchenUnlocked, justUnlocked: kitchenJustUnlocked } = getKitchenUnlockState(p);
    if (combinedEffects.garden_autoharvest) {
      autoHarvestReadyPlots(p, content, combinedEffects, {
        capacityLimiter: (drops) => applyIngredientCapacityToDrops(drops, p, combinedEffects)
      });
    }
    const gardenState = getGardenActionState(p, combinedEffects);
    const navRows = [
      noodleForageGardenRow(userId, {
        active: "garden",
        gardenLocked: !gardenUnlocked,
        includeGardenButton: false,
        includeKitchenButton: true,
        kitchenUnlocked,
        kitchenJustUnlocked,
        showGardenActions: true,
        canCompost: gardenState.canCraft,
        canHarvest: gardenState.hasHarvestable
      }),
      noodleMainMenuRow(userId)
    ];

    if (!gardenUnlocked) {
      return commitState({
        content: `${getIcon("lock")} Garden unlocks at shop level 25.`,
        components: navRows
      });
    }

    const seedId = opt.getString("seed");
    if (!seedId || seedId === "no_seed") {
      return commitState({
        content: `${getIcon("tree")} Pick a seed to plant.`,
        components: navRows,
        ephemeral: true
      });
    }

    const allowedIngredients = getUnlockedIngredientIds(p, content);
    const result = plantSeedInPlot(p, seedId, content, combinedEffects, { allowedIngredients });
    if (!result.ok) {
      const reasons = {
        no_seeds: "You don't have that seed anymore.",
        no_compost: "You need 1 compost bag to plant.",
        no_empty_plot: "All plots are busy. Harvest before planting again.",
        no_seed: "Pick a seed to plant."
      };
      const reasonText = reasons[result.reason] || "Unable to plant right now.";
      return commitState({ content: reasonText, components: navRows, ephemeral: true });
    }

    applyQuestProgress(p, questsContent, userId, { type: "garden_plant", amount: 1 }, now);

    const view = buildGardenView({
      player: p,
      combinedEffects,
      user: interaction.member ?? interaction.user,
      userId
    });

    const summary = `${getIcon("tree")} Planted **${getSeedDisplayName(seedId, content)}** in plot #${result.plotIndex + 1}.`;
    const baseDesc = view.embed?.data?.description ?? view.embed?.description ?? "";
    view.embed.setDescription(`${summary}\n\n${baseDesc}`);

    return commitState({
      content: " ",
      embeds: [view.embed],
      components: [view.rows.navRow, view.rows.pageRow, view.rows.plantRow, view.rows.harvestSelectRow, noodleMainMenuRow(userId)]
    });
  }

  if (sub === "harvest") {
    const gardenUnlocked = isGardenUnlocked(p);
    if (combinedEffects.garden_autoharvest) {
      autoHarvestReadyPlots(p, content, combinedEffects, {
        capacityLimiter: (drops) => applyIngredientCapacityToDrops(drops, p, combinedEffects)
      });
    }
    const gardenState = getGardenActionState(p, combinedEffects);
    const navRows = [
      noodleForageGardenRow(userId, {
        active: "garden",
        gardenLocked: !gardenUnlocked,
        includeGardenButton: false,
        showGardenActions: true,
        canCompost: gardenState.canCraft,
        canHarvest: gardenState.hasHarvestable
      }),
      noodleMainMenuRow(userId)
    ];

    if (!gardenUnlocked) {
      return commitState({
        content: `${getIcon("lock")} Garden unlocks at shop level 25.`,
        components: navRows
      });
    }

    const plotIndex = opt.getInteger("plot_index");
    const capacityLimiter = (drops) => applyIngredientCapacityToDrops(drops, p, combinedEffects);
    const harvestResult = harvestGardenPlots(p, content, combinedEffects, {
      plotIndex: Number.isInteger(plotIndex) ? plotIndex : null,
      onlyReady: true,
      capacityLimiter
    });
    const view = buildGardenView({
      player: p,
      combinedEffects,
      user: interaction.member ?? interaction.user,
      userId
    });

    let summary;
    if (!harvestResult.anyHarvestable) {
      summary = `${getIcon("help")} Nothing ready to harvest yet.`;
    } else if (!harvestResult.results.length) {
      summary = `${getIcon("warning")} Pantry is full; nothing harvested.`;
    } else {
      const lines = harvestResult.results.map((r) => {
        const addedText = describeYieldMap(r.addedItems || {}, content);
        const leftoverText = describeYieldMap(r.leftoverItems || {}, content);
        if (r.added > 0 && r.leftover > 0) {
          return `Plot #${r.plotIndex + 1}: +${addedText}, **${leftoverText}** left (pantry full).`;
        }
        if (r.added > 0) return `Plot #${r.plotIndex + 1}: +${addedText}.`;
        return `Plot #${r.plotIndex + 1}: pantry full, **${leftoverText}** left to harvest.`;
      });
      summary = `${getIcon("basket")} Harvested.
${lines.join("\n")}`;
    }

    const harvestedPlots = harvestResult.harvestedPlots ?? 0;
    if (harvestedPlots > 0) {
      applyQuestProgress(p, questsContent, userId, { type: "garden_harvest", amount: harvestedPlots }, now);
    }

    const baseDesc = view.embed?.data?.description ?? view.embed?.description ?? "";
    view.embed.setDescription(`${summary}\n\n${baseDesc}`);

    return commitState({
      content: " ",
      embeds: [view.embed],
      components: [view.rows.navRow, view.rows.pageRow, view.rows.plantRow, view.rows.harvestSelectRow, noodleMainMenuRow(userId)]
    });
  }

  /* ---------------- BUY ---------------- */
  if (sub === "buy") {
    const itemId = opt.getString("item");
    const qty = opt.getInteger("quantity");
    const page = opt.getInteger("page") ?? 0;

    // Multi-buy entry
    if (!itemId) {
      const payload = buildMultiBuyPickerPayload({
        userId,
        p,
        s,
        ownerUser: interaction.member ?? interaction.user,
        page
      });

      return commit(payload);
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
    const perTypeCap = getIngredientCapacitiesByType(p, combinedEffects);
    const remaining = (perTypeCap[type] ?? perTypeCap.topping ?? 0) - getIngredientCountForType(p, type);
    if (remaining <= 0) {
      const label = type.charAt(0).toUpperCase() + type.slice(1);
      return commitState({
        content: `${getIcon("basket")} Your ${label} storage is full. Upgrade storage or use ingredients to make room.`,
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
        content: `${getIcon("warning")} **Pantry Full!** Cannot store ${qty}× **${friendly}**.\nUpgrade your Pantry to increase capacity.`,
        ephemeral: true
      });
    }

    p.coins -= cost;
    p.inv_ingredients[itemId] = (p.inv_ingredients[itemId] ?? 0) + qtyToBuy;
    p.market_stock[itemId] = stock - qtyToBuy;

    applyQuestProgress(p, questsContent, userId, { type: "buy", amount: qtyToBuy }, now);

    advanceTutorial(p, "buy");
    const tutorialOnlyForage = isTutorialStep(p, "intro_forage");

    const capacityNote = qtyToBuy < qty ? `\n${getIcon("basket")} Pantry capacity limited your purchase to **${qtyToBuy}**.` : "";
    const buyEmbed = buildMenuEmbed({
      title: `${getIcon("cart")} Purchase Complete`,
      description: `${getIcon("cart")} Bought **${qtyToBuy}× ${item.name}** for **${cost}c**.${capacityNote}${tutorialSuffix(p)}`,
      user: interaction.member ?? interaction.user
    });
    return commitState({
      content: " ",
      embeds: [buyEmbed],
      components: tutorialOnlyForage ? [noodleTutorialForageRow(userId)] : undefined
    });
  }

  /* ---------------- SELL ---------------- */
  if (sub === "sell") {
    const itemId = opt.getString("item");
    const qty = opt.getInteger("quantity");
    const page = opt.getInteger("page") ?? 0;

    if (!itemId) {
      const payload = buildSellPickerPayload({
        userId,
        p,
        s,
        ownerUser: interaction.member ?? interaction.user,
        page
      });

      return commit(payload);
    }

    if (!SELLABLE_ITEM_IDS.has(itemId)) {
      return commitState({ content: "You can only sell market items or fresh catches.", ephemeral: true });
    }

    const item = content.items[itemId];
    if (!item) return commitState({ content: "That item doesn’t exist.", ephemeral: true });
    if (!qty || qty <= 0) return commitState({ content: "Pick a positive quantity.", ephemeral: true });

    const owned = p.inv_ingredients?.[itemId] ?? 0;
    if (owned < qty) return commitState({ content: `You only have ${owned}.`, ephemeral: true });

    const unit = sellPrice(s, itemId);
    if (unit <= 0) return commitState({ content: "That item can’t be sold right now.", ephemeral: true });
    const gain = unit * qty;

    if (normalizeIngredientType(itemId) === "broth") {
      consumeStarBroth(p, itemId, qty);
    }
    p.inv_ingredients[itemId] = owned - qty;
    p.coins += gain;
    p.lifetime.coins_earned += gain;

    applyQuestProgress(p, questsContent, userId, { type: "earn_coins", amount: gain }, now);

    const sellEmbed = buildMenuEmbed({
      title: `${getIcon("coins")} Sale Complete`,
      description: `${getIcon("coins")} Sold **${qty}× ${item.name}** for **${gain}c**.`,
      user: interaction.member ?? interaction.user
    });
    return commitState({ content: " ", embeds: [sellEmbed] });
  }

  /* ---------------- COOK ---------------- */
  if (sub === "cook") {
    const recipeId = opt.getString("recipe");
    const qty = opt.getInteger("quantity");
    const page = opt.getInteger("page") ?? 0;

    if (!recipeId) {
      const payload = buildCookPickerPayload({
        userId,
        p,
        s,
        ownerUser: interaction.member ?? interaction.user,
        page
      });

      return commit(payload);
    }

    const r = content.recipes[recipeId];
    if (!r) return commitState({ content: "That recipe doesn’t exist.", ephemeral: true });
    // Use getAvailableRecipes to include temporary recipes (B2)
    const availableRecipes = getAvailableRecipes(p);
    if (!availableRecipes.includes(recipeId)) {
      return commitState({ content: "You don't know that recipe yet.", ephemeral: true });
    }
    if (r.is_event_recipe) {
      const activeEventId = s?.active_event_id ?? null;
      if (!activeEventId || r.event_id !== activeEventId) {
        return commitState({
          content: "That recipe is only available during the active event.",
          ephemeral: true
        });
      }
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
        content: `${getIcon("basket")} Your cooked bowls storage is full. Serve bowls or upgrade storage to make room.`,
        ephemeral: true
      });
    }

    const now = nowTs();

    const qtyToCook = Math.min(qty, remainingBowls);
    const batchOutput = Math.min(getCookBatchOutput(qtyToCook, p, combinedEffects), remainingBowls);

    const ingredientsToUse = [];
    let starBrothUsed = 0;
    let brothUnitsPerBowl = null;
    for (const ing of r.ingredients) {
      const need = (ing.qty ?? 0) * qtyToCook;
      if (need <= 0) continue;
      const isBroth = normalizeIngredientType(ing.item_id) === "broth";
      if (isBroth && !ing.optional && brothUnitsPerBowl == null) {
        brothUnitsPerBowl = Math.max(1, ing.qty ?? 1);
      }
      const haveIng = p.inv_ingredients?.[ing.item_id] ?? 0;
      if (ing.optional) {
        if (haveIng >= need) {
          ingredientsToUse.push({ ...ing, need, isBroth });
        }
        continue;
      }
      if (haveIng < need) {
        const missing = need - haveIng;
        return commitState({
          content: `You’re missing **${displayItemName(ing.item_id)}** — need **${missing}** more (have ${haveIng}/${need}).`,
          ephemeral: true
        });
      }
      ingredientsToUse.push({ ...ing, need, isBroth });
    }

    const cookRng = makeStreamRng({ mode: "secure", streamName: "cook", serverId, userId });
    const savedLines = [];
    const consumedByItem = {};
    for (const ing of ingredientsToUse) {
      const need = ing.need;
      let saved = 0;
      if (combinedEffects.ingredient_save_chance > 0) {
        for (let i = 0; i < need; i += 1) {
          if (rollIngredientSave(combinedEffects, cookRng)) saved += 1;
        }
      }
      const consume = Math.max(0, need - saved);
      let consumeRemaining = consume;
      if (consume > 0 && ing.isBroth) {
        const starUsed = consumeStarBroth(p, ing.item_id, consume);
        starBrothUsed += starUsed;
        consumeRemaining -= starUsed;
      }

      p.inv_ingredients[ing.item_id] -= consume;
      if (consumeRemaining > 0) {
        consumedByItem[ing.item_id] = (consumedByItem[ing.item_id] ?? 0) + consumeRemaining;
      }
      if (saved > 0) {
        savedLines.push(`${getIcon("ingredient_save")} Saved **${saved}× ${displayItemName(ing.item_id)}**`);
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
        const quality = rollCookQuality(cookRng, p, combinedEffects, blessing, r.tier);
        outcome.qualityCounts[quality] = (outcome.qualityCounts[quality] ?? 0) + 1;
      }
    }

    const qualityCounts = outcome.qualityCounts ?? {};
    const totalCooked = batchOutput + extra;
    const perBowl = Math.max(1, brothUnitsPerBowl ?? 1);
    const guaranteedExcellent = Math.min(totalCooked, Math.floor(starBrothUsed / perBowl));
    const successTotal = Object.entries(qualityCounts)
      .filter(([q]) => q !== "salvage")
      .reduce((sum, [, c]) => sum + (c ?? 0), 0);
    applyGuaranteedExcellent(qualityCounts, guaranteedExcellent, successTotal);
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

    const lostLine = ingredientsToUse
      .map((ing) => {
        const lostQty = (ing.qty ?? 0) * outcome.failed;
        return lostQty > 0 ? `**${lostQty}× ${displayItemName(ing.item_id)}**` : null;
      })
      .filter(Boolean)
      .join(" · ");
    const salvageLine = outcome.salvage > 0 ? ` Salvaged **${outcome.salvage}** bowl(s).` : "";
    const failInfo = outcome.failed > 0
      ? `${getIcon("warning")} **Cook failure**: ${outcome.failed} bowl(s) failed. Lost: ${lostLine}. Cause: recipe tier risk.${salvageLine}`
      : null;

    const cookEmbed = buildMenuEmbed({
      title: `${getIcon("cook")} Cooked`,
      description: [
        `You cooked **${batchOutput}× ${r.name}**.`,
        qtyToCook < qty ? `${getIcon("basket")} Bowl storage limited this cook to **${qtyToCook}**.` : null,
        batchOutput > qtyToCook ? `${getIcon("bowl")} Prep bonus: **+${batchOutput - qtyToCook}** bowl(s).` : null,
        failInfo,
        doubleCrafted ? `${getIcon("sparkle")} Double craft! **+${extra}** extra bowl(s).` : null,
        savedLines.length ? savedLines.join("\n") : null,
        `You now have **${have}** bowl(s) ready.`,
        tutorialSuffix(p)
      ].filter(Boolean).join("\n"),
      user: interaction.member ?? interaction.user
    });

    const tutorialOnlyServe = isTutorialStep(p, "intro_serve");
    const hasAcceptedOrders = Object.keys(p.orders?.accepted ?? {}).length > 0;

    return commitState({
      content: " ",
      embeds: [cookEmbed],
      components: tutorialOnlyServe
        ? [noodleTutorialServeRow(userId)]
        : [noodleOrdersActionRow(userId, { highlightAccept: !hasAcceptedOrders, disableServe: !hasAcceptedOrders })]
    });
  }

  /* ---------------- ORDERS ---------------- */
  if (sub === "orders") {
    const now2 = nowTs();
    const sweep2 = sweepExpiredAcceptedOrders(p, s, content, now2);

    const acceptedEntries = Object.entries(p.orders?.accepted ?? {});

    // Aggregate ingredients needed across all accepted orders, subtracting bowls already cooked
    const neededCountsByRecipe = {};
    acceptedEntries.forEach(([, a]) => {
      const recipeId = a?.order?.recipe_id;
      if (!recipeId) return;
      neededCountsByRecipe[recipeId] = (neededCountsByRecipe[recipeId] ?? 0) + 1;
    });

    const allNeeded = {};
    for (const [recipeId, neededOrders] of Object.entries(neededCountsByRecipe)) {
      const recipe = content.recipes[recipeId];
      if (!recipe?.ingredients) continue;
      const ready = getTotalBowlsForRecipe(p, recipeId);
      const remainingOrders = Math.max(0, neededOrders - ready);
      if (remainingOrders <= 0) continue;
      for (const ing of recipe.ingredients) {
        allNeeded[ing.item_id] = (allNeeded[ing.item_id] ?? 0) + (ing.qty * remainingOrders);
      }
    }

    // Calculate shortages (only for orders that still need cooking)
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
      const order = snap;
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
      statusParts.push(`${getIcon("cook")} **Bowls Ready**\n${readyBowls.join("\n")}`);
    }

    if (shortages.length) {
      statusParts.push(
        `${getIcon("basket")} **Ingredients Needed**\n${shortages.map((s) => {
          const iName = displayItemName(s.itemId, content);
          return `• ${iName} - You have: **${s.have}**, you need **${s.needed}**`;
        }).join("\n")}`
      );
    } else {
      statusParts.push(`${getIcon("basket")} **Ingredients Needed**\n_All ingredients ready to cook!_`);
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

      const order = snap;

      if (!order) return `${getIcon("status_complete")} \`${shortOrderId(fullId)}\`${timeLeft}`;

      const npcName = content.npcs[order.npc_archetype]?.name ?? "a customer";
      const rName = content.recipes[order.recipe_id]?.name ?? "a dish";
      const lt = order.is_limited_time ? getIcon("hourglass") : "•";

      return `${getIcon("status_complete")} \`${shortOrderId(fullId)}\` ${lt} **${rName}** — *${npcName}* (${order.tier})${timeLeft}`;
    });

    const parts = [];
    if (sweep2.warning) parts.push(sweep2.warning, "");

    const { availableCount } = getOrdersMeta(p);
    const remaining = availableCount;
    const marketRestockDay = p.market_stock_day ?? s.market_day ?? dayKeyUTC(now2);
    const marketRestockMs = parseYYYYMMDD(marketRestockDay) + (24 * 60 * 60 * 1000);
    const hasMarketStock = Object.values(p.market_stock ?? {}).some((qty) => Number(qty) > 0);
    const ordersDayKey = p.orders_day ?? dayKeyUTC(now2);
    const nextOrdersResetMs = parseYYYYMMDD(ordersDayKey) + (24 * 60 * 60 * 1000);
    const nextOrdersResetTs = Math.floor(nextOrdersResetMs / 1000);
    const nextOrdersResetText = `<t:${nextOrdersResetTs}:f> (<t:${nextOrdersResetTs}:R>)`;
    if (remaining > 0) {
      parts.push(
        "**Today’s Orders**",
        `There are **${remaining}** orders available. Tap **Accept** below to start serving customers.`
      );
    } else if (acceptedLines.length) {
      parts.push(
        `${getIcon("orders")} **Today’s Orders**`,
        `No new orders left today. Finish your accepted ones and come back ${nextOrdersResetText}.`
      );
    } else {
      parts.push(`${getIcon("confetti")} You’ve completed all of today’s orders! New orders arrive ${nextOrdersResetText}.`);
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
    const highlightAccept = acceptedEntries.length === 0 && remaining > 0;
    const disableAccept = remaining <= 0;
    const menuEmbed = buildMenuEmbed({
      title: `${getIcon("orders")} Orders`,
      description: parts.join("\n"),
      user: interaction.member ?? interaction.user
    });
    if (remaining === 0 || !hasMarketStock) {
      const existingFooter = menuEmbed?.footer?.text ?? menuEmbed?.data?.footer?.text ?? "";
      const footerText = buildMarketRefreshFooterText(existingFooter, marketRestockMs);
      menuEmbed.setFooter({ text: footerText });
    }
    const tutorialOnlyAccept = isTutorialStep(p, "intro_order");
    return commitState({
      content: " ",
      embeds: [menuEmbed],
      components: tutorialOnlyAccept
        ? [noodleOrdersAcceptOnlyRow(userId, { highlightAccept, disableAccept })]
        : [
            noodleOrdersMenuActionRow(userId, { showCancel, highlightAccept, disableAccept, disableServe: acceptedEntries.length === 0 }),
            noodleMainMenuRowNoOrders(userId)
          ]
    });
  }

  /* ---------------- ACCEPT -------- */
  if (sub === "accept") {
    const rawInput = String(opt.getString("order_id") ?? "").trim();
    if (!rawInput) {
      const payload = buildAcceptPickerPayload({
        userId,
        serverId,
        p,
        s,
        ownerUser: interaction.member ?? interaction.user
      });

      return commit(payload);
    }
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

    const results = [];
    const unlockedRecipeNames = [];
    const readyBowlsByRecipe = new Map();
    const acceptedOrdersNow = [];
    let acceptedNow = 0;

    for (const tok of tokens) {
      if (acceptedNow >= available) {
        results.push(`${getIcon("warning")} Reached active order cap.`);
        break;
      }

      const order = findOrderByToken({
        playerState: p,
        settings: set,
        content,
        activeSeason: s.season,
        serverId,
        userId,
        activeEventId,
        token: tok
      });

      if (!order) {
        results.push(`${getIcon("question")} Order \`${tok}\` not found on today's board.`);
        continue;
      }

      if (p.orders.accepted[order.order_id]) {
        results.push(`${getIcon("skip")} Already accepted \`${shortOrderId(order.order_id)}\`.`);
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
          order_index: order.order_index,
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
        ? `${getIcon("hourglass")} <t:${Math.floor(expiresAt / 1000)}:R> to serve.`
        : `${getIcon("forage")} No rush.`;

      const extendedNote = order.is_limited_time && speedWindowSeconds !== baseSpeedWindowSeconds
        ? ` ${getIcon("sparkle")} Extended to ${Math.ceil(speedWindowSeconds / 60)} min.`
        : "";

      results.push(`Accepted \`${shortOrderId(order.order_id)}\` — **${rName}** (${timeNote})${extendedNote}`);

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
      const perTypeCap = getIngredientCapacitiesByType(p, combinedEffects);
      const countsByType = getIngredientCountsByType(p);
      const remainingByType = {
        broth: Math.max(0, (perTypeCap.broth ?? 0) - (countsByType.broth ?? 0)),
        noodles: Math.max(0, (perTypeCap.noodles ?? 0) - (countsByType.noodles ?? 0)),
        spice: Math.max(0, (perTypeCap.spice ?? 0) - (countsByType.spice ?? 0)),
        topping: Math.max(0, (perTypeCap.topping ?? 0) - (countsByType.topping ?? 0)),
        protein: Math.max(0, (perTypeCap.protein ?? 0) - (countsByType.protein ?? 0))
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
      let needsForageOnlyItems = false;
      let blockedByCapacity = false;
      let blockedByStock = false;
      let blockedByCoins = false;
      let missingMarketItems = false;
      let allOrdersAlreadyReady = true;

      for (const order of acceptedOrdersNow.slice(0, autoOrderCap)) {
        const recipe = content.recipes?.[order.recipe_id];
        if (!recipe?.ingredients) continue;

        if ((bowlsRemaining[order.recipe_id] ?? 0) > 0) {
          bowlsRemaining[order.recipe_id] -= 1;
          ordersCovered += 1;
          continue;
        }

        allOrdersAlreadyReady = false;

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

          const acqRaw = item?.acquisition;
          const acqType = typeof acqRaw === "string" ? acqRaw : acqRaw?.type;
          const isMarketItem = MARKET_ITEM_IDS.includes(itemId) || acqType === "market";
          const type = normalizeIngredientType(itemId);
          allItems.push({ itemId, need, have, missing, type, name: item.name });

          if (missing > 0) {
            if (!isMarketItem) {
              needsForageOnlyItems = true;
              continue;
            }

            missingMarketItems = true;

            const remaining = remainingByType[type] ?? 0;
            if (remaining < missing) {
              blockedByCapacity = true;
              orderOk = false;
              break;
            }

            const stock = stockRemaining[itemId] ?? 0;
            if (stock < missing) {
              blockedByStock = true;
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
          if (coinsRemaining < orderCost) {
            blockedByCoins = true;
          }
          continue;
        }

        // Reserve inventory and apply purchases for this order
        for (const item of allItems) {
          const usedFromInventory = Math.min(item.need, item.have);
          inventoryAvailable[item.itemId] = Math.max(0, (inventoryAvailable[item.itemId] || 0) - usedFromInventory);
          // Free capacity for this type when we consume from inventory so capacity checks stay accurate for later orders
          if (usedFromInventory > 0) {
            const t = item.type;
            remainingByType[t] = (remainingByType[t] ?? 0) + usedFromInventory;
          }
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
        results.push(`${getIcon("chef")} Prep Chef auto-bought: ${purchasedItems} (Total **${totalAutoCost}c**).`);
      } else if (blockedByCoins) {
        results.push(`${getIcon("chef")} Prep Chef could not auto-buy: not enough coins.`);
      }
    }

    if (acceptedNow > 0) advanceTutorial(p, "accept");

    // Build summary for accepted orders
    const acceptedEntries = Object.entries(p.orders?.accepted ?? {});
    const neededByItem = {};
    const neededByRecipe = {};

    acceptedEntries.forEach(([fullId, a]) => {
      const snap = a?.order ?? null;
      const order = snap;

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
      statusParts.push(`${getIcon("cook")} **Bowls Ready**\n${readyBowls.join("\n")}`);
    }

    if (shortages.length) {
      statusParts.push(
        `\n${getIcon("basket")} **Ingredients Needed**\n${shortages.map((s) => {
          const iName = displayItemName(s.itemId, content);
          return `• ${iName} - You have: **${s.have}**, you need **${s.needed}**`;
        }).join("\n")}`
      );
    } else {
      statusParts.push(`\n${getIcon("basket")} **Ingredients Needed**\n_All ingredients ready to cook!_`);
    }

    if (statusParts.length) {
      results.push("", ...statusParts, "");
    }

    const acceptEmbed = buildMenuEmbed({
      title: `${getIcon("status_complete")} Orders Accepted`,
      description: `${results.join("\n")}${tutorialSuffix(p) ? `\n\n${tutorialSuffix(p)}` : ""}`,
      user: interaction.member ?? interaction.user
    });
    const hasAcceptedOrders = Object.keys(p.orders?.accepted ?? {}).length > 0;
    const tutorialOnlyBuy = isTutorialStep(p, "intro_market");
    return commitState({
      content: " ",
      embeds: [acceptEmbed],
      components: tutorialOnlyBuy
        ? [noodleTutorialBuyRow(userId)]
        : [
            noodleOrdersActionRow(userId, { highlightAccept: !hasAcceptedOrders, disableServe: !hasAcceptedOrders }),
            noodleMainMenuRow(userId)
          ]
    });
  }

  /* ---------------- CANCEL ---------------- */
  if (sub === "cancel") {
    const input = String(opt.getString("order_id") ?? "").trim().toUpperCase();
    if (!input) {
      const payload = buildCancelServePickerPayload({
        action: "cancel",
        userId,
        p,
        ownerUser: interaction.member ?? interaction.user
      });

      return commit(payload);
    }

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

    const cancelMsg = `${getIcon("cancel")} Canceled order \`${shortOrderId(fullId)}\`${rName ? ` — **${rName}**` : ""}${npcName ? ` for *${npcName}*` : ""}.`;
    const cancelEmbed = buildMenuEmbed({
      title: `${getIcon("cancel")} Order Canceled`,
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

    if (!tokens.length) {
      const payload = buildCancelServePickerPayload({
        action: "serve",
        userId,
        p,
        ownerUser: interaction.member ?? interaction.user
      });

      return commit(payload);
    }

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
    const missingByRecipe = {};
    const prevShopLevel = p.shop_level ?? 1;
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
        results.push(`${getIcon("question")} Order \`${shortOrderId(tok)}\` isn't accepted.`);
        continue;
      }

      const [fullOrderId, accepted] = matchEntry;
      const now3 = nowTs();
      if (accepted.expires_at && now3 > accepted.expires_at) {
        delete acceptedMap[fullOrderId];
        // Track fail streak for manually expired order (B4)
        updateFailStreak(p, false); // failure
        results.push(`${getIcon("hourglass")} Order \`${shortOrderId(fullOrderId)}\` expired.`);
        continue;
      }

      const order = accepted.order ?? findOrderByToken({
        playerState: p,
        settings: set,
        content,
        activeSeason: s.season,
        serverId,
        userId,
        activeEventId,
        token: fullOrderId
      });
      if (!order) {
        delete acceptedMap[fullOrderId];
        results.push(`${getIcon("warning")} Order \`${shortOrderId(fullOrderId)}\` can't be found anymore.`);
        continue;
      }

      const pickedKey = bowlKey ?? null;
      const selectedEntry = pickedKey && p.inv_bowls?.[pickedKey]
        ? { key: pickedKey, bowl: p.inv_bowls[pickedKey] }
        : getBestBowlEntry(p, order.recipe_id);
      const bowl = selectedEntry?.bowl ?? null;
      if (!bowl || (bowl.qty ?? 0) <= 0) {
        const recipeName = content.recipes?.[order.recipe_id]?.name ?? "that recipe";
        missingByRecipe[order.recipe_id] = (missingByRecipe[order.recipe_id] ?? 0) + 1;
        results.push(`${getIcon("basket")} You don't have a bowl ready for **${recipeName}**.`);
        continue;
      }
      if (bowl.recipe_id !== order.recipe_id) {
        missingByRecipe[order.recipe_id] = (missingByRecipe[order.recipe_id] ?? 0) + 1;
        results.push(`${getIcon("warning")} Bowl doesn't match recipe for order \`${shortOrderId(fullOrderId)}\`.`);
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
        effects: combinedEffects,
        eventEffects: activeEventEffects
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
      markOrderConsumed(p, order.order_index);

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
          activeSeason: s.season,
          activeEventId: s.active_event_id ?? null
        });
        
        for (const discovery of discoveries ?? []) {
          const result = applyDiscovery(p, discovery, content, discoveryRng, { badgesContent });
          if (result.message) {
            discoveryMessages.push(result.message);
          } else if (result.isDuplicate && result.reward) {
            discoveryMessages.push(`${getIcon("sparkle")} ${result.reward}`);
          }
          
          // Track if a new recipe was unlocked
          if (result.recipeUnlocked) {
            recipeUnlocked = true;
            const unlockedName = result.unlockedRecipeName || result.unlockedRecipeId || discovery.recipeName || discovery.recipeId;
            if (unlockedName) unlockedRecipeNames.push(unlockedName);
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
      if (rewards.npcModifier === "coins_courier") serveMsg += ` ${getIcon("rain")} +25% coins`;
      if (rewards.npcModifier === "coins_bard") serveMsg += ` ${getIcon("music")} +10% coins`;
      if (rewards.npcModifier === "coins_festival") serveMsg += ` ${getIcon("confetti")} +25% coins`;
      if (rewards.npcModifier === "speed") serveMsg += ` ${getIcon("moon")} Doubled speed bonus`;
      if (rewards.npcModifier === "sxp_forest") serveMsg += ` ${getIcon("tree")} +10% SXP`;
      if (rewards.npcModifier === "sxp_captain") serveMsg += ` ${getIcon("boat")} +10 SXP`;
      if (rewards.npcModifier === "rep_inspector") serveMsg += ` ${getIcon("list")} +10 REP`;
      if (rewards.npcModifier === "rep_sleepy") serveMsg += ` ${getIcon("sleepy")} +5 REP`;
      if (rewards.npcModifier === "rep_moonlit") serveMsg += ` ${getIcon("moon")} +15 REP`;

      if (allowDiscovery) {
        if (order.npc_archetype === "wandering_scholar") {
          serveMsg += ` ${getIcon("search")} +1% clue chance`;
        }
        if (order.npc_archetype === "moonlit_spirit" && order.tier === "epic") {
          serveMsg += ` ${getIcon("scroll")} +1% scroll chance`;
        }
        if (order.npc_archetype === "curious_apprentice") {
          serveMsg += ` ${getIcon("idea")} +1% discovery chance next serve`;
        }
        if (order.npc_archetype === "child_big_scarf") {
          serveMsg += ` ${getIcon("search")} +1% clue chance`;
        }
      }
      
      if (rewards.repAuraGranted || rewards.repAuraAlreadyActive) {
        const auraExpiry = rewards.repAuraExpiresAt ?? p.buffs?.rep_aura_expires_at ?? 0;
        const now3_aura = nowTs();
        if (auraExpiry > now3_aura) {
          const minsLeft = Math.ceil((auraExpiry - now3_aura) / 1000 / 60);
          const ts = Math.floor(auraExpiry / 1000);
          if (rewards.repAuraAlreadyActive) {
            serveMsg += ` ${getIcon("sparkle")} Aura buff already active (<t:${ts}:R>)`;
          } else {
            serveMsg += ` ${getIcon("sparkle")} +2 REP for 15 min (<t:${ts}:R>)`;
          }
        } else if (rewards.repAuraGranted) {
          serveMsg += ` ${getIcon("sparkle")} +2 REP for 15 min`;
        }
      }
      
      results.push(serveMsg);

      const recipeTier = recipe?.tier ?? order.tier;
      const recipeSeason = recipe?.season ?? order.season ?? null;
      const isSeasonalHeraldServe =
        order.npc_archetype === "seasonal_herald" &&
        recipeTier === "seasonal" &&
        (!recipeSeason || recipeSeason === s.season);

      if (isSeasonalHeraldServe) {
        const badgeResult = grantTemporaryBadge(p, badgesContent, HERALD_BADGE_ID, HERALD_BADGE_DURATION_MS);
        if (badgeResult.status === "granted" || badgeResult.status === "refreshed") {
          const badge = getBadgeById(badgesContent, HERALD_BADGE_ID);
          const icon = resolveIcon(badge?.icon, getIcon("sparkle"));
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

    const { availableCount: availableAfterServe } = getOrdersMeta(p);
    if (servedCount > 0 && availableAfterServe === 0) {
      p.orders_depleted_day = dayKeyUTC();
    }

    const missingLines = Object.entries(missingByRecipe).map(([recipeId, count]) => {
      const rName = content.recipes?.[recipeId]?.name ?? recipeId;
      const suffix = count === 1 ? "" : "s";
      return `• ${rName} — missing **${count}** bowl${suffix}`;
    });
    const missingBlock = missingLines.length ? `${getIcon("basket")} Missing bowls\n${missingLines.join("\n")}` : "";

    if (!servedCount) {
      const failLines = [results.join("\n") || "Nothing served."];
      if (missingBlock) failLines.push("", missingBlock);

      const failEmbed = buildMenuEmbed({
        title: `${getIcon("serve")} Orders Served`,
        description: failLines.join("\n"),
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
        const icon = resolveIcon(spec.icon, getIcon("sparkle"));
        return `${icon} **Specialization unlocked:** ${spec.name}`;
      });
      results.push(...unlockLines);
    }
    
    // If a recipe was unlocked, refresh order pool and let regulars know they can order it now
    if (recipeUnlocked) {
      const activeEventId = s.active_event_id ?? null;
      ensureDailyOrdersForPlayer(p, set, content, s.season, serverId, userId, activeEventId);
      const friendlyNames = unlockedRecipeNames.length
        ? unlockedRecipeNames.length === 1
          ? unlockedRecipeNames[0]
          : `${unlockedRecipeNames.slice(0, -1).join(", ")} & ${unlockedRecipeNames.at(-1)}`
        : "your new recipe";
      results.push(`${getIcon("orders")} Regulars are already asking for **${friendlyNames}**.`);
    }

    const summary = `Rewards total: **+${totalCoins}c**, **+${totalSxp} SXP**, **+${totalRep} REP**.`;
    const levelLine = leveledUp ? `\n${getIcon("level_up")} Level up! You're now **Level ${p.shop_level}**.` : "";
    const gardenLine = gardenUnlockLine(prevShopLevel, p.shop_level);
    const fishingLine = fishingUnlockLine(prevShopLevel, p.shop_level);
    const discoveryLine = discoveryMessages.length > 0 ? `\n\n${discoveryMessages.join("\n")}` : "";
    const tut = advanceTutorial(p, "serve");
    const suffix = tut.finished ? `\n\n${formatTutorialCompletionMessage()}` : `${tutorialSuffix(p)}`;

    const hasAcceptedOrders = Object.keys(p.orders?.accepted ?? {}).length > 0;
    const components = tut.finished
      ? [noodleMainMenuRow(userId)]
      : [
          noodleOrdersActionRow(userId, { highlightAccept: !hasAcceptedOrders, disableServe: !hasAcceptedOrders }),
          noodleMainMenuRow(userId)
        ];
    const embeds = [];

    const serveLines = [results.join("\n")];
    if (missingBlock) serveLines.push("", missingBlock);
  serveLines.push("", `${summary}${levelLine}${gardenLine}${fishingLine}${discoveryLine}${suffix}`);

    const serveEmbed = buildMenuEmbed({
      title: `${getIcon("serve")} Orders Served`,
      description: serveLines.join("\n"),
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
      last_daily_reminder_day: null,
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
    title: `${getIcon("mail")} Daily Rewards Reminder`,
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

const componentPlayer = ensurePlayer(serverId, userId);
const componentTouched = trackLastKitchen(componentPlayer, serverId, interaction.channelId);
if (componentTouched && db) {
  upsertPlayer(db, serverId, userId, componentPlayer, null, componentPlayer.schema_version);
}

// lock UI to owner when ownerId is present
if (ownerId && ownerId !== userId && (kind === "nav" || kind === "pick" || kind === "multibuy" || kind === "profile" || kind === "decor")) {
return componentCommit(interaction, { content: "That menu isn’t for you.", ephemeral: true });
}

if (interaction.isSelectMenu?.() && kind === "garden" && action === "plant_select") {
  if (ownerId && ownerId !== userId) {
    return componentCommit(interaction, { content: "That garden isn’t yours.", ephemeral: true });
  }
  const seedId = interaction.values?.[0];
  if (!seedId || seedId === "no_seed") {
    return componentCommit(interaction, { content: `${getIcon("tree")} Pick a seed to plant.`, ephemeral: true });
  }
  const sourceMessageId = interaction.message?.id ?? null;
  return runNoodle(interaction, {
    sub: "plant",
    overrides: { strings: { seed: seedId }, messageId: sourceMessageId }
  });
}

if (interaction.isSelectMenu?.() && kind === "garden" && action === "harvest_select") {
  if (ownerId && ownerId !== userId) {
    return componentCommit(interaction, { content: "That garden isn’t yours.", ephemeral: true });
  }
  const value = interaction.values?.[0];
  if (!value || value === "none") {
    return componentCommit(interaction, { content: `${getIcon("help")} No plots are ready.`, ephemeral: true });
  }
  const plotIndex = Number(value);
  if (!Number.isInteger(plotIndex)) {
    return componentCommit(interaction, { content: `${getIcon("warning")} Unable to harvest that plot.`, ephemeral: true });
  }
  const sourceMessageId = interaction.message?.id ?? null;
  return runNoodle(interaction, {
    sub: "harvest",
    overrides: { integers: { plot_index: plotIndex }, messageId: sourceMessageId }
  });
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
      content: `${getIcon("warning")} Discord couldn't show the edit modal. Try again.`,
      ephemeral: true
    });
  }
}

if (kind === "profile" && action === "specialize_select") {
  const p = ensurePlayer(serverId, userId);
  markSpecializationShopLevelSeen(p, specializationsContent);
  const now = nowTs();
  const specializationsAvailable = getSpecializationAlert(p);
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
    title: `${getIcon("sparkle")} Choose Specialization`,
    description: "Pick a specialization to preview and confirm.",
    user: interaction.member ?? interaction.user
  });

  return componentCommit(interaction, {
    content: " ",
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(menu),
      noodleProfileEditRow(userId, { specializationsAvailable }),
      noodleProfileEditBackRow(userId)
    ],
    targetMessageId: interaction.message?.id
  });
}

/* ---------------- PROFILE BADGE BUTTONS ---------------- */

if (kind === "profile" && action === "specialize_cancel") {
  const p = ensurePlayer(serverId, userId);
  markSpecializationShopLevelSeen(p, specializationsContent);
  const specializationsAvailable = getSpecializationAlert(p);
  const { embed, page, totalPages } = buildSpecializationListEmbed(p, interaction.member ?? interaction.user, nowTs(), 0, 5);
  const components = [];
  if (totalPages > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:nav:specialize:${userId}:${page - 1}`)
        .setLabel("Prev")
        .setEmoji(getButtonEmoji("back"))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(`noodle:nav:specialize:${userId}:${page + 1}`)
        .setLabel("Next")
        .setEmoji(getButtonEmoji("next"))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    ));
  }
  components.push(
    noodleSpecializeSelectRow(userId),
    noodleProfileEditRow(userId, { specializationsAvailable }),
    noodleProfileEditBackRow(userId)
  );
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
  markSpecializationShopLevelSeen(p, specializationsContent);
  const now = nowTs();
  const specializationsAvailable = getSpecializationAlert(p);
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
    title: `${getIcon("sparkle")} Specialization Updated`,
    description: `Active specialization: **${result.specialization?.name ?? specId}**.`,
    user: interaction.member ?? interaction.user
  });

  return componentCommit(interaction, {
    content: " ",
    embeds: [embed],
    components: [
      noodleSpecializeSelectRow(userId),
      noodleProfileEditRow(userId, { specializationsAvailable }),
      noodleProfileEditBackRow(userId)
    ],
    targetMessageId: interaction.message?.id
  });
}

/* -------- SPECIAL SELL NAV HANDLER -------- */
if (kind === "nav" && action === "sell") {
  const s = ensureServer(serverId);
  const p = ensurePlayer(serverId, userId);
  const targetMessageId = interaction.message?.id ?? null;
  const page = Number(parts[4] ?? 0);

  const payload = buildSellPickerPayload({
    userId,
    p,
    s,
    ownerUser: interaction.member ?? interaction.user,
    page
  });

  return componentCommit(interaction, {
    ...payload,
    targetMessageId
  });
}

/* ---------------- NAV BUTTONS ---------------- */
// Compost button shows picker of compostable items
function buildCompostSelectOptions(player) {
  const garden = ensureGardenState(player);
  const spoiledCount = Object.values(garden.spoiled || {}).reduce((sum, v) => sum + (v || 0), 0);
  const freshPool = Object.entries(getCompostableForageables(player, content) || {})
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({ id, qty, source: "fresh" }));

  const options = [];
  if (spoiledCount > 0) {
    options.push({
      label: `Spoiled ingredients (${spoiledCount})`.slice(0, 100),
      value: `spoiled:${SPOILED_STASH_KEY}`,
      description: `${spoiledCount} unit(s) available`.slice(0, 100)
    });
  }

  const freshOptions = freshPool
    .sort((a, b) => displayItemName(a.id).localeCompare(displayItemName(b.id)))
    .slice(0, 25 - options.length)
    .map((entry) => ({
      label: `${displayItemName(entry.id)} (${entry.qty})`.slice(0, 100),
      value: `${entry.source}:${entry.id}`,
      description: `${entry.qty} unit(s) available`.slice(0, 100)
    }));

  options.push(...freshOptions);

  return { options };
}

if (kind === "action" && action === "compost" && interaction.isButton?.()) {
  if (ownerId && ownerId !== userId) {
    return componentCommit(interaction, { content: "That garden isn’t yours.", ephemeral: true });
  }
  const p = ensurePlayer(serverId, userId);
  const garden = ensureGardenState(p);
  const combinedEffects = calculateCombinedEffects(p, upgradesContent, staffContent, calculateStaffEffects);
  const gardenState = getGardenActionState(p, combinedEffects);
  const compostCap = getCompostCap(p, combinedEffects);
  const compostCount = garden.compost_bags || 0;
  const room = Math.max(0, compostCap - compostCount);
  const compostDescription = [
    `${getIcon("basket")} Compost: **${compostCount}/${compostCap}** bags${room <= 0 ? " (capacity reached)" : ""}`,
    `Spoiled saved: **${gardenState.spoiledTotal}**`,
    `Fresh forageables: **${gardenState.pantryTotal}**`,
    `Recipe: ${COMPOST_PER_BAG} spoiled or fresh forageables = 1 bag`
  ].join("\n");

  const compostEmbed = buildMenuEmbed({
    title: `${getIcon("tree")} Compost`,
    description: compostDescription,
    user: interaction.member ?? interaction.user,
    color: theme.colors.success
  });

  const { options } = buildCompostSelectOptions(p);

  if (!options.length) {
    return componentCommit(interaction, { content: `${getIcon("basket")} No compostable items available.`, ephemeral: true });
  }

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`noodle:garden:compost_select:${userId}`)
      .setPlaceholder("Select items to compost")
      .setMinValues(1)
      .setMaxValues(Math.min(options.length, 25))
      .addOptions(options)
  );

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:garden:compost_add:${userId}:5`)
      .setLabel("Add 5")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`noodle:garden:compost_add:${userId}:10`)
      .setLabel("Add 10")
      .setStyle(ButtonStyle.Primary)
  );

  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:nav:garden:${userId}`)
      .setLabel("Back")
      .setEmoji(getButtonEmoji("back"))
      .setStyle(ButtonStyle.Secondary)
  );

  const navRow = noodleForageGardenRow(userId, {
    active: "compost",
    includeGardenButton: false,
    includeKitchenButton: true,
    kitchenUnlocked: getKitchenUnlockState(p).unlocked,
    kitchenJustUnlocked: getKitchenUnlockState(p).justUnlocked,
    showGardenActions: true,
    canCompost: gardenState.canCraft,
    canHarvest: gardenState.hasHarvestable
  });

  const components = [navRow, selectRow, actionRow, backRow];
  return componentCommit(interaction, {
    content: " ",
    embeds: [compostEmbed],
    components,
    targetMessageId: interaction.message?.id
  });
}

// Kitchen select to start simmering
if (kind === "kitchen" && action === "start" && interaction.isSelectMenu?.()) {
  if (ownerId && ownerId !== userId) {
    return componentCommit(interaction, { content: "That kitchen isn’t yours.", ephemeral: true });
  }
  const brothId = interaction.values?.[0] ?? null;
  const sourceMessageId = interaction.message?.id ?? null;
  return runNoodle(interaction, {
    sub: "kitchen_start",
    overrides: { strings: { broth_id: brothId }, messageId: sourceMessageId }
  });
}

// Kitchen collect button
if (kind === "kitchen" && action === "collect" && interaction.isButton?.()) {
  if (ownerId && ownerId !== userId) {
    return componentCommit(interaction, { content: "That kitchen isn’t yours.", ephemeral: true });
  }
  const sourceMessageId = interaction.message?.id ?? null;
  return runNoodle(interaction, {
    sub: "kitchen_collect",
    overrides: { messageId: sourceMessageId }
  });
}

// Compost select menu crafts using chosen items
if (interaction.isSelectMenu?.() && kind === "garden" && action === "compost_select") {
  if (ownerId && ownerId !== userId) {
    return componentCommit(interaction, { content: "That garden isn’t yours.", ephemeral: true });
  }
  const selections = interaction.values ?? [];
  if (!selections.length) {
    return componentCommit(interaction, { content: `${getIcon("help")} Pick at least one item to compost.`, ephemeral: true });
  }
  const p = ensurePlayer(serverId, userId);
  const combinedEffects = calculateCombinedEffects(p, upgradesContent, staffContent, calculateStaffEffects);
  const gardenState = getGardenActionState(p, combinedEffects);

  const now = Date.now();
  const messageId = interaction.message?.id ?? `compost:${interaction.id}`;
  compostSelectionCache.set(messageId, { userId, selections: [...selections], ts: now });
  for (const [key, entry] of compostSelectionCache.entries()) {
    if (now - (entry?.ts ?? 0) > 5 * 60 * 1000) {
      compostSelectionCache.delete(key);
    }
  }

  const { options } = buildCompostSelectOptions(p);
  if (!options.length) {
    return componentCommit(interaction, { content: `${getIcon("basket")} No compostable items available.`, ephemeral: true });
  }

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`noodle:garden:compost_select:${userId}`)
      .setPlaceholder("Select items to compost")
      .setMinValues(1)
      .setMaxValues(Math.min(options.length, 25))
      .addOptions(options)
  );

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:garden:compost_add:${userId}:5`)
      .setLabel("Add 5")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`noodle:garden:compost_add:${userId}:10`)
      .setLabel("Add 10")
      .setStyle(ButtonStyle.Primary)
  );

  const selectionList = selections
    .map((raw) => {
      const [src, ...idParts] = String(raw).split(":");
      const id = idParts.join(":");
      if (!src || !id) return null;
      const name = src === "spoiled" ? "Spoiled ingredients" : displayItemName(id);
      return `${src === "spoiled" ? "Spoiled" : "Fresh"} — ${name}`;
    })
    .filter(Boolean)
    .join("\n");
  const header = selectionList
    ? `${getIcon("basket")} Selected sources:\n${selectionList}\n\nAdd 5/10 pulls that many units from each selected source.`
    : `${getIcon("basket")} No items selected. Add 5/10 pulls that many units from each selected source.`;
  const compostCap = gardenState.compostCap;
  const compostCount = gardenState.compostCount;
  const room = Math.max(0, compostCap - compostCount);
  const compostDescription = [
    `${getIcon("basket")} Compost: **${compostCount}/${compostCap}** bags${room <= 0 ? " (capacity reached)" : ""}`,
    header
  ].join("\n\n");

  const compostEmbed = buildMenuEmbed({
    title: `${getIcon("tree")} Compost`,
    description: compostDescription,
    user: interaction.member ?? interaction.user,
    color: theme.colors.success
  });

  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:nav:garden:${userId}`)
      .setLabel("Back")
      .setEmoji(getButtonEmoji("back"))
      .setStyle(ButtonStyle.Secondary)
  );

  const navRow = noodleForageGardenRow(userId, {
    active: "compost",
    includeGardenButton: false,
    includeKitchenButton: true,
    kitchenUnlocked: getKitchenUnlockState(p).unlocked,
    kitchenJustUnlocked: getKitchenUnlockState(p).justUnlocked,
    showGardenActions: true,
    canCompost: gardenState.canCraft,
    canHarvest: gardenState.hasHarvestable
  });

  const components = [navRow, selectRow, actionRow, backRow];
  return componentCommit(interaction, {
    content: " ",
    embeds: [compostEmbed],
    components,
    targetMessageId: interaction.message?.id
  });
}

// Compost add buttons craft using cached selections
if (interaction.isButton?.() && kind === "garden" && action === "compost_add") {
  if (ownerId && ownerId !== userId) {
    return componentCommit(interaction, { content: "That garden isn’t yours.", ephemeral: true });
  }
  const amountRequested = Math.max(1, Number(parts[4] ?? 0) || 0);
  const messageId = interaction.message?.id ?? null;
  const cached = messageId ? compostSelectionCache.get(messageId) : null;
  if (!cached || cached.userId !== userId) {
    return componentCommit(interaction, { content: `${getIcon("help")} Select items to compost first.`, ephemeral: true });
  }
  if (Date.now() - (cached.ts ?? 0) > 5 * 60 * 1000) {
    compostSelectionCache.delete(messageId);
    return componentCommit(interaction, { content: `${getIcon("help")} Selection expired. Choose items again.`, ephemeral: true });
  }

  const selections = cached.selections ?? [];
  const parsedSelections = selections
    .map((raw) => {
      const [source, ...idParts] = String(raw).split(":");
      const itemId = idParts.join(":");
      if (!source || !itemId) return null;
      return { source, itemId };
    })
    .filter(Boolean);

  if (!parsedSelections.length) {
    compostSelectionCache.delete(messageId);
    return componentCommit(interaction, { content: `${getIcon("help")} Select items to compost first.`, ephemeral: true });
  }

  const p = ensurePlayer(serverId, userId);
  const garden = ensureGardenState(p);
  if (!p.inv_ingredients) p.inv_ingredients = {};
  const combinedEffects = calculateCombinedEffects(p, upgradesContent, staffContent, calculateStaffEffects);
  const gardenState = getGardenActionState(p, combinedEffects);
  const compostCap = getCompostCap(p, combinedEffects);
  const compostCount = garden.compost_bags || 0;
  const roomBags = Math.max(0, compostCap - compostCount);
  if (roomBags <= 0) {
    return componentCommit(interaction, { content: `${getIcon("basket")} Compost storage is full (${compostCount}/${compostCap}).`, ephemeral: true });
  }

  let spoiledUsed = {};
  let freshUsed = {};
  let totalUnitsUsed = 0;
  const maxUnitsByStorage = roomBags * COMPOST_PER_BAG;

  for (const { source, itemId } of parsedSelections) {
    if (totalUnitsUsed >= maxUnitsByStorage) break;

    if (source === "spoiled") {
      const spoiledEntries = Object.entries(garden.spoiled || {}).filter(([, qty]) => qty > 0);
      const availableUnits = spoiledEntries.reduce((sum, [, qty]) => sum + qty, 0);
      const unitsToUse = Math.min(amountRequested, availableUnits, maxUnitsByStorage - totalUnitsUsed);
      if (unitsToUse <= 0) continue;

      let remainingUse = unitsToUse;
      for (const [sid, qty] of spoiledEntries) {
        if (remainingUse <= 0) break;
        const take = Math.min(qty, remainingUse);
        garden.spoiled[sid] = Math.max(0, qty - take);
        if (garden.spoiled[sid] <= 0) delete garden.spoiled[sid];
        remainingUse -= take;
      }

      spoiledUsed[SPOILED_STASH_KEY] = (spoiledUsed[SPOILED_STASH_KEY] || 0) + unitsToUse;
      totalUnitsUsed += unitsToUse;
      continue;
    }

    const pool = p.inv_ingredients;
    const availableUnits = Math.max(0, pool?.[itemId] || 0);
    if (availableUnits <= 0) continue;

    const unitsToUse = Math.min(amountRequested, availableUnits, maxUnitsByStorage - totalUnitsUsed);
    if (unitsToUse <= 0) continue;

    pool[itemId] = Math.max(0, availableUnits - unitsToUse);
    if (pool[itemId] <= 0) delete pool[itemId];

    freshUsed[itemId] = (freshUsed[itemId] || 0) + unitsToUse;
    totalUnitsUsed += unitsToUse;
  }

  const bagsMade = Math.min(roomBags, Math.floor(totalUnitsUsed / COMPOST_PER_BAG));
  if (bagsMade <= 0) {
    compostSelectionCache.delete(messageId);
    return componentCommit(interaction, { content: `${getIcon("warning")} Not enough of the selected items to craft any compost bags.`, ephemeral: true });
  }

  const requestedUnits = amountRequested * parsedSelections.length;
  const partialNote = totalUnitsUsed < requestedUnits
    ? totalUnitsUsed >= maxUnitsByStorage
      ? `${getIcon("help")} Compost storage capped this batch.`
      : `${getIcon("help")} Not enough of the selected items for the full amount.`
    : null;

  garden.compost_bags = (garden.compost_bags || 0) + bagsMade;
  cached.ts = Date.now();
  compostSelectionCache.set(messageId, cached);

  if (db) {
    upsertPlayer(db, serverId, userId, p, null, p.schema_version);
  }

  const formatUsage = (label, usedMap) => {
    const entries = Object.entries(usedMap || {}).filter(([, qty]) => qty > 0);
    if (!entries.length) return null;
    return `${label} used:\n${entries.map(([id, qty]) => {
      const name = id === SPOILED_STASH_KEY ? "Spoiled ingredients" : displayItemName(id);
      return `• **${qty}×** ${name}`;
    }).join("\n")}`;
  };

  const usageBlocks = [formatUsage("Saved spoilage", spoiledUsed), formatUsage("Fresh forageables", freshUsed)].filter(Boolean).join("\n\n");
  const summaryParts = [
    `${getIcon("basket")} Packed **${bagsMade}** compost bag(s).`,
    `Compost now: **${garden.compost_bags}/${compostCap}**.`,
    usageBlocks,
    partialNote
  ];
  const summary = summaryParts.filter(Boolean).join("\n\n");

  const { options } = buildCompostSelectOptions(p);
  const selectRow = options.length
    ? new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`noodle:garden:compost_select:${userId}`)
          .setPlaceholder("Select items to compost")
          .setMinValues(1)
          .setMaxValues(Math.min(options.length, 25))
          .addOptions(options)
      )
    : null;

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:garden:compost_add:${userId}:5`)
      .setLabel("Add 5")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`noodle:garden:compost_add:${userId}:10`)
      .setLabel("Add 10")
      .setStyle(ButtonStyle.Primary)
  );

  const compostDescription = summary;

  const compostEmbed = buildMenuEmbed({
    title: `${getIcon("tree")} Compost`,
    description: compostDescription,
    user: interaction.member ?? interaction.user,
    color: theme.colors.success
  });

  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:nav:garden:${userId}`)
      .setLabel("Back")
      .setEmoji(getButtonEmoji("back"))
      .setStyle(ButtonStyle.Secondary)
  );

  const navRow = noodleForageGardenRow(userId, {
    active: "compost",
    includeGardenButton: false,
    includeKitchenButton: true,
    kitchenUnlocked: getKitchenUnlockState(p).unlocked,
    kitchenJustUnlocked: getKitchenUnlockState(p).justUnlocked,
    showGardenActions: true,
    canCompost: gardenState.canCraft,
    canHarvest: gardenState.hasHarvestable
  });

  const components = [navRow];
  if (selectRow) components.push(selectRow);
  components.push(actionRow, backRow);

  return componentCommit(interaction, {
    content: " ",
    embeds: [compostEmbed],
    components,
    targetMessageId: interaction.message?.id
  });
}

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
  const rawPage = Number(parts[4] ?? 0);
  const payload = buildAcceptPickerPayload({
    userId,
    serverId,
    p,
    s,
    ownerUser: interaction.member ?? interaction.user,
    page: rawPage
  });

  return componentCommit(interaction, payload);
}

if (action === "serveall") {
  if (ownerId && ownerId !== userId) {
    return componentCommit(interaction, { content: "That menu isn't for you.", ephemeral: true });
  }

  const p = ensurePlayer(serverId, userId);
  if (!canServeAllOrders(p)) {
    const neededByRecipe = {};
    Object.values(p.orders?.accepted ?? {}).forEach((entry) => {
      const recipeId = entry?.order?.recipe_id;
      if (!recipeId) return;
      neededByRecipe[recipeId] = (neededByRecipe[recipeId] ?? 0) + 1;
    });

    const missingLines = Object.entries(neededByRecipe)
      .map(([recipeId, need]) => {
        const ready = getTotalBowlsForRecipe(p, recipeId);
        if (ready >= need) return null;
        const rName = content.recipes?.[recipeId]?.name ?? recipeId;
        const short = need - ready;
        return `• ${rName} — need **${need}**, ready **${ready}** (cook **${short}** more)`;
      })
      .filter(Boolean);

    const payload = buildCancelServePickerPayload({
      action: "serve",
      userId,
      p,
      ownerUser: interaction.member ?? interaction.user
    });

    return componentCommit(interaction, {
      ...payload,
      content: missingLines.length
        ? `${getIcon("warning")} Not all accepted orders are ready to serve.\n${missingLines.join("\n")}`
        : `${getIcon("warning")} Not all accepted orders are ready to serve.`,
      ephemeral: payload.ephemeral ?? false
    });
  }

  const orderTokens = Object.keys(p.orders?.accepted ?? {}).map((oid) => shortOrderId(oid)).join(",");

  return runNoodle(interaction, {
    sub: "serve",
    overrides: {
      strings: { order_id: orderTokens },
      messageId: interaction.message?.id ?? null
    }
  });
}

if (action === "cancel" || action === "serve") {
  const p = ensurePlayer(serverId, userId);
  const payload = buildCancelServePickerPayload({
    action,
    userId,
    p,
    ownerUser: interaction.member ?? interaction.user
  });

  return componentCommit(interaction, payload);
}

if (action === "cook") {
  // select a recipe from known_recipes, then modal for qty
  const p = ensurePlayer(serverId, userId);
  const s = ensureServer(serverId);
  const rawPage = Number(parts[4] ?? 0);
  const payload = buildCookPickerPayload({
    userId,
    p,
    s,
    ownerUser: interaction.member ?? interaction.user,
    page: Number.isFinite(rawPage) ? rawPage : 0
  });

  return componentCommit(interaction, payload);
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
      content: `${getIcon("warning")} Discord couldn't show the modal. Try using "/noodle cook" directly instead.`,
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
    const specializationsAvailable = getSpecializationAlert(p);
    if (!p.profile) p.profile = { shop_name: "My Noodle Shop", tagline: PROFILE_DEFAULT_TAGLINE };
    p.profile.shop_name = trimmed;

    if (db) {
      upsertPlayer(db, serverId, userId, p, null, p.schema_version);
    }

    const embed = buildMenuEmbed({
      title: `${getIcon("status_complete")} Shop Name Updated`,
      description: `Your shop is now **${trimmed}**.`,
      user: interaction.member ?? interaction.user
    });

    return componentCommit(interaction, {
      content: " ",
      embeds: [embed],
      components: [noodleProfileEditRow(userId, { specializationsAvailable }), noodleProfileEditBackRow(userId)],
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
    const specializationsAvailable = getSpecializationAlert(p);
    if (!p.profile) p.profile = { shop_name: "My Noodle Shop", tagline: PROFILE_DEFAULT_TAGLINE };
    p.profile.tagline = trimmed;

    if (db) {
      upsertPlayer(db, serverId, userId, p, null, p.schema_version);
    }

    const embed = buildMenuEmbed({
      title: `${getIcon("status_complete")} Tagline Updated`,
      description: `Your tagline is now: *${trimmed}*`,
      user: interaction.member ?? interaction.user
    });

    return componentCommit(interaction, {
      content: " ",
      embeds: [embed],
      components: [noodleProfileEditRow(userId, { specializationsAvailable }), noodleProfileEditBackRow(userId)],
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
        .setLabel("Sell Items").setEmoji(getButtonEmoji("coins"))
        .setStyle(ButtonStyle.Secondary)
    );

    const selectionEmbed = buildMenuEmbed({
      title: `${getIcon("cart")} Multi-buy`,
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
    const specializationsAvailable = getSpecializationAlert(p);
    const spec = getSpecializationById(specializationsContent, specId);
    if (!spec) return componentCommit(interaction, { content: "Specialization not found.", ephemeral: true });

    const check = canSelectSpecialization(p, specializationsContent, specId, now);
    const description = spec.description ? `\n_${spec.description}_` : "";

    if (!check.ok) {
      const embed = buildMenuEmbed({
        title: `${getIcon("sparkle")} Specialization Locked`,
        description: `You can't select **${spec.name}** yet.\nReason: ${check.reason}${description}`,
        user: interaction.member ?? interaction.user
      });

      return componentCommit(interaction, {
        content: " ",
        embeds: [embed],
        components: [
          noodleSpecializeSelectRow(userId),
          noodleProfileEditRow(userId, { specializationsAvailable }),
          noodleProfileEditBackRow(userId)
        ],
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
      title: `${getIcon("sparkle")} Confirm Specialization`,
      description: `You're about to switch to **${spec.name}**.${description}\n\nPress **Confirm** to apply.`,
      user: interaction.member ?? interaction.user
    });

    return componentCommit(interaction, {
      content: " ",
      embeds: [embed],
      components: [confirmRow, noodleProfileEditRow(userId, { specializationsAvailable }), noodleProfileEditBackRow(userId)],
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
      return componentCommit(interaction, { content: `${getIcon("warning")} Selection expired. Please try again.`, ephemeral: true });
    }

    if (cacheEntry.expiresAt < Date.now()) {
      multibuyCacheV2.delete(cacheKey);
      return componentCommit(interaction, { content: `${getIcon("warning")} Selection expired. Please try again.`, ephemeral: true });
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
          .setLabel("Sell Items").setEmoji(getButtonEmoji("coins"))
          .setStyle(ButtonStyle.Secondary)
      );
      const selectionEmbed = buildMenuEmbed({
        title: `${getIcon("cart")} Multi-buy`,
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
    const activeEventEffects = getActiveEventEffects(eventsContent, serverState);
    rollMarket({ serverId, content, serverState, eventEffects: activeEventEffects });

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
        const perTypeCap = getIngredientCapacitiesByType(p2, combinedEffects);
        const countsByType = getIngredientCountsByType(p2);
        const remainingByType = {
          broth: Math.max(0, (perTypeCap.broth ?? 0) - (countsByType.broth ?? 0)),
          noodles: Math.max(0, (perTypeCap.noodles ?? 0) - (countsByType.noodles ?? 0)),
          spice: Math.max(0, (perTypeCap.spice ?? 0) - (countsByType.spice ?? 0)),
          topping: Math.max(0, (perTypeCap.topping ?? 0) - (countsByType.topping ?? 0)),
          protein: Math.max(0, (perTypeCap.protein ?? 0) - (countsByType.protein ?? 0))
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
            content: `${getIcon("basket")} Your pantry is full. Upgrade storage or use ingredients to make room.`,
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
            content: `${getIcon("warning")} **Pantry Full!** Cannot store: ${blockedItems}\nUpgrade your Pantry to increase capacity.`,
            ephemeral: true
          });
        }

        // Apply purchase
        p2.coins -= totalCost;

        for (const x of buyLines) {
          p2.market_stock[x.id] = (p2.market_stock[x.id] ?? 0) - x.qty;
        }

        const totalBought = buyLines.reduce((sum, entry) => sum + entry.qty, 0);
        if (totalBought > 0) {
          applyQuestProgress(p2, questsContent, userId, { type: "buy", amount: totalBought }, nowTs());
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
          title: `${getIcon("cart")} Purchase Complete`,
          description: `Bought:\n${pretty}\n\nTotal: **${totalCost}c**.${capacityReduced ? `\n${getIcon("basket")} Pantry capacity limited this purchase.` : ""}${tutorialSuffix(p2)}`,
          user: interaction.member ?? interaction.user
        });
        buyEmbed.setFooter({
          text: `Coins: ${p2.coins || 0}c\n${ownerFooterText(interaction.member ?? interaction.user)}`
        });

        const tutorialOnlyForage = isTutorialStep(p2, "intro_forage");
        const tutorialActive = Boolean(p2.tutorial?.active && getCurrentTutorialStep(p2));

        let components;
        if (tutorialActive) {
          const questsAvailable = hasDailyRewardAvailable(p2, nowTs()) || hasClaimableQuests(p2);
          components = tutorialOnlyForage
            ? [noodleTutorialForageRow(userId)]
            : [noodleMainMenuRow(userId), noodleSecondaryMenuRow(userId, { questsAvailable })];
        } else {
          const { btnRow } = buildMultiBuyButtonsRow(interaction.user.id, selectedIds, sourceMessageId, { limitToBuy1: false });
          const sellRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`noodle:nav:sell:${interaction.user.id}`)
              .setLabel("Sell Items").setEmoji(getButtonEmoji("coins"))
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
    const idParts = interaction.customId.split(":");
    const owner = idParts[3];
    const page = Number(idParts[4] ?? 0);
    if (owner && owner !== interaction.user.id) {
      return componentCommit(interaction, { content: "That menu isn't for you.", ephemeral: true });
    }

    const picked = (interaction.values ?? []).slice(0, 5);
    if (!picked.length) {
      return componentCommit(interaction, { content: "Pick at least one item.", ephemeral: true });
    }

    const pickedNames = picked.map((id) => displayItemName(id));
    
    const sourceMessageId = interaction.message?.id ?? "none";
    const btnRow = buildSellQuantityRow(interaction.user.id, picked, page);

    const sellEmbed = buildMenuEmbed({
      title: `${getIcon("coins")} Sell Items`,
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
    const maybePage = Number(parts2[4]);
    const hasPage = Number.isFinite(maybePage);
    const page = hasPage ? maybePage : 0;
    const idsPart = parts2.slice(hasPage ? 5 : 4).join(":");
    const selectedIds = idsPart.split(",").filter(Boolean).slice(0, 5);

    if (owner && owner !== interaction.user.id) {
      return componentCommit(interaction, { content: "That menu isn't for you.", ephemeral: true });
    }

    if (!selectedIds.length) {
      return componentCommit(interaction, { content: "No items selected.", ephemeral: true });
    }

    if (mode === "qty") {
      const pickedNames = selectedIds.map((id) => displayItemName(id));
      const btnRow = buildSellQuantityRow(interaction.user.id, selectedIds, page);

      const sellEmbed = buildMenuEmbed({
        title: `${getIcon("coins")} Sell Items`,
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
          if (unit <= 0) continue;
          const gain = unit * qtyEach;

          if (normalizeIngredientType(id) === "broth") {
            consumeStarBroth(p2, id, qtyEach);
          }
          p2.inv_ingredients[id] = owned - qtyEach;
          p2.coins += gain;
          p2.lifetime.coins_earned += gain;
          totalGain += gain;

          sellLines.push({ id, name: it.name, qty: qtyEach, price: unit });
        }

        if (!sellLines.length) {
          return componentCommit(interaction, {
            content: `${getIcon("cancel")} You don't have any of those items to sell.`,
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

        const pickerPayload = buildSellPickerPayload({
          userId,
          p: p2,
          s,
          ownerUser: interaction.member ?? interaction.user,
          page
        });

        const baseEmbed = pickerPayload.embeds?.[0] ?? null;
        const saleSummary = `Sold:\n${pretty}\n\nTotal: **${totalGain}c**.`;

        let sellEmbed;
        if (baseEmbed) {
          const baseDescription = baseEmbed?.data?.description ?? baseEmbed?.description ?? "";
          const combinedDescription = [saleSummary, baseDescription].filter(Boolean).join("\n\n");
          baseEmbed.setTitle(`${getIcon("coins")} Sell Items`);
          baseEmbed.setDescription(combinedDescription);
          sellEmbed = baseEmbed;
        } else {
          sellEmbed = buildMenuEmbed({
            title: `${getIcon("coins")} Sold Items`,
            description: saleSummary,
            user: interaction.member ?? interaction.user
          });
        }

        const replyObj = {
          content: pickerPayload.content ?? " ",
          embeds: [sellEmbed],
          components: pickerPayload.ephemeral
            ? (pickerPayload.components ?? [])
            : [buildSellQuantityRow(userId, selectedIds, page), ...(pickerPayload.components ?? [noodleMainMenuRow(userId)])],
          targetMessageId: pickerPayload.ephemeral ? undefined : (interaction.message?.id ?? null),
          ephemeral: pickerPayload.ephemeral
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

const includeDevCommands = process.env.NODE_ENV === "development" && Boolean(process.env.DISCORD_GUILD_ID);

const noodleCommandData = new SlashCommandBuilder()
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
  .addSubcommand((sc) => sc.setName("fishing").setDescription("Cast a line for fresh catches."))
  .addSubcommand((sc) => sc.setName("recipes").setDescription("View your unlocked recipes and clues."))
  .addSubcommand((sc) => sc.setName("regulars").setDescription("View regular NPCs and their bonuses."))
  .addSubcommand((sc) => sc.setName("event").setDescription("Show the current event (if any)."))
  .addSubcommand((sc) => sc.setName("quests").setDescription("View active quests."))
  .addSubcommand((sc) => sc.setName("quests_daily").setDescription("Claim your daily reward."))
  .addSubcommand((sc) => sc.setName("quests_claim").setDescription("Claim completed quest rewards."))
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
      .setDescription("Sell a market item or fresh catch.")
      .addStringOption((o) => o.setName("item").setDescription("Market item (type to search)").setRequired(false).setAutocomplete(true))
      .addIntegerOption((o) => o.setName("quantity").setDescription("Qty").setRequired(false).setMinValue(1))
  )
  .addSubcommand((sc) => sc.setName("orders").setDescription("View today’s orders."))
  .addSubcommand((sc) =>
    sc
      .setName("accept")
      .setDescription("Accept an order.")
      .addStringOption((o) => o.setName("order_id").setDescription("Order ID").setRequired(false))
  )
  .addSubcommand((sc) =>
    sc
      .setName("cancel")
      .setDescription("Cancel an accepted order.")
      .addStringOption((o) => o.setName("order_id").setDescription("Order ID").setRequired(false))
  )
  .addSubcommand((sc) =>
    sc
      .setName("cook")
      .setDescription("Cook a noodle recipe.")
      .addStringOption((o) => o.setName("recipe").setDescription("Recipe (type to search)").setRequired(false).setAutocomplete(true))
      .addIntegerOption((o) => o.setName("quantity").setDescription("Qty").setRequired(false).setMinValue(1))
  )
  .addSubcommand((sc) =>
    sc
      .setName("serve")
      .setDescription("Serve your accepted order.")
      .addStringOption((o) => o.setName("order_id").setDescription("Order ID").setRequired(false))
      .addStringOption((o) => o.setName("bowl_key").setDescription("Bowl key (optional; defaults to recipe)").setRequired(false))
  )
  .addSubcommand((sc) =>
    sc
      .setName("garden")
      .setDescription("Tend your garden, seeds, and compost.")
  )
  .addSubcommand((sc) =>
    sc
      .setName("forage")
      .setDescription("Forage for fresh ingredients.")
      .addStringOption((o) => o.setName("item").setDescription("What to forage for (type to search)").setRequired(false).setAutocomplete(true))
      .addIntegerOption((o) => o.setName("quantity").setDescription("Quantity (1-5)").setRequired(false).setMinValue(1).setMaxValue(5))
  );

if (includeDevCommands) {
  noodleCommandData
    .addSubcommand((sc) => sc.setName("status").setDescription("Show reset timestamps (debug info)."))
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
        .addSubcommand((sc) =>
          sc
            .setName("wipe_user")
            .setDescription("Delete a user’s profile from the DB.")
            .addUserOption((o) => o.setName("user").setDescription("User to wipe").setRequired(true))
            .addStringOption((o) =>
              o
                .setName("user_id")
                .setDescription("User ID (use if the user left the server)")
                .setRequired(false)
            )
            .addStringOption((o) =>
              o
                .setName("server_id")
                .setDescription("Override server ID (defaults to current guild)")
                .setRequired(false)
            )
        )
    );
}

export const noodleCommand = {
  data: noodleCommandData,

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
