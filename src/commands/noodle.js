import fs from "fs";
import path from "path";
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  canForage,
  rollForageDrops,
  applyDropsToInventory,
  applyForagePityCounter,
  setForageCooldown,
  FORAGE_ITEM_IDS,
  RARE_FORAGE_ITEM_IDS
} from "../game/forage.js";
import { addIngredientsToInventory, removeIngredientsFromInventory, checkIngredientCapacity } from "../game/inventory.js";
import {
  advanceTutorial,
  ensureTutorial,
  getCurrentTutorialStep,
  formatTutorialMessage,
  formatTutorialCompletionMessage,
  resetTutorialProgress
} from "../game/tutorial.js";
import {
  resolveTutorialGateValue,
  isTutorialStep as isTutorialStepFromRouting,
  resolveTutorialProgressRowKey,
  resolveTutorialRecoverySub,
  resolveForageNavSub,
  resolveTutorialOrdersActionKey
} from "../game/tutorialRouting.js";
import { resolveComponentNavSub } from "./navDispatch.js";
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
  loadEventsContent,
  loadNewsContent
} from "../content/index.js";
import { buildSettingsMap } from "../settings/resolve.js";
import {
  openDb,
  getPlayer,
  upsertPlayer,
  deletePlayerProfiles,
  getServer,
  upsertServer,
  getLastActiveAt,
  getLatestServerIdForUser,
  getPlayerStorageServerId,
  repairGlobalPlayerProfileFromLegacy
} from "../db/index.js";
import { withLock } from "../infra/locks.js";
import { emitTelemetry } from "../infra/telemetry.js";
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
import {
  formatNewsVersion,
  getVisibleSortedNewsEntries,
  hasUnreadNewsUpdate,
  markNewsAsSeen,
  normalizeNewsClassification,
} from "../util/news.js";
import { socialMainMenuRow, socialMainMenuRowNoProfile } from "./noodleSocial.js";
import { getUserActiveParty, getActiveBlessing, clearExpiredBlessings, BLESSING_EFFECTS, repairPartyRecord } from "../game/social.js";
import {
  applySubscriptionEntitlementEvent,
  applyMonthlySubscriptionCoinGrant,
  SUBSCRIPTION_MONTHLY_COIN_GRANT,
  SUBSCRIPTION_PERKS,
  ensureSubscriptionState,
  getOrderAcceptCap,
  hasActivePerk,
  hasUnlimitedMarketStock
} from "../game/subscriptions.js";
import { grantStoreCoinPack, getStoreCoinPack, STORE_COIN_PACKS } from "../game/storeCoinPacks.js";
import {
  TAKEOUT_SHIFT_DURATION_HOURS,
  TAKEOUT_MENU_MAX_RECIPES,
  ensureTakeoutState,
  getTakeoutMenuLimits,
  setTakeoutMenu,
  isTakeoutShiftActive,
  claimTakeoutEarnings,
  openTakeoutShift,
  startTakeoutShiftWithCoverage,
  processTakeoutCatchup
} from "../game/takeout.js";
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
import { applySeasonRolloverReward } from "../game/seasonRollover.js";
import { getActiveEvent, getActiveEventEffects, getEventWindow, getActiveEventRecipes, withEventRecipes, buildEventRecipeSeasonMap } from "../game/events.js";
import { rollRecipeDiscovery, applyDiscovery, applyNpcDiscoveryBuff, getTakeoutDiscoveryAttemptLimit } from "../game/discovery.js";
import { makeStreamRng } from "../util/rng.js";
import { applyQuestProgress, ensureQuests, claimCompletedQuests, getQuestSummary } from "../game/quests.js";
import { claimDailyReward, hasDailyRewardAvailable } from "../game/daily.js";
import { getVoteRewardStatus, claimVoteRewards, getVotePlatformStatusLines, getDisplayVotePlatformPages } from "../game/voteRewards.js";
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
import {
  buildComponentsV2MenuPayload,
  buildComponentsV2PayloadWithNoticeCards,
  isComponentsV2Enabled,
  MESSAGE_FLAG_IS_COMPONENTS_V2,
  replyOrEditInteraction
} from "../ui/componentsV2.js";
import { isV2OwnerMismatch, parseV2CustomId } from "../ui/sceneRoutingV2.js";
import { getSceneState, putSceneState } from "../ui/sceneStateV2.js";
import { buildOrdersBoardV2Message } from "../ui/ordersBoardV2.js";
import {
  buildAcceptConfirmV2Message,
  buildAcceptPickerV2Message,
  buildAcceptResultV2Message,
  deriveAcceptOutcome
} from "../ui/acceptFlowV2.js";
import {
  buildCookMinigameTargetActions,
  buildCookMinigameV2Message,
  createCookRunToken,
  evaluateCookMinigameTurn,
  buildCookRecipePickerV2Message,
  buildCookResultV2Message,
  deriveCookMinigameTotalTurns,
  deriveCookMinigamePerformance,
  resolveCookOutcomeForFlow
} from "../ui/cookFlowV2.js";
import {
  buildServePickerV2Message
} from "../ui/serveFlowV2.js";
import {
  buildCancelPickerV2Message,
  deriveCancelOutcome
} from "../ui/cancelFlowV2.js";
import {
  buildProfileHomeV2Message,
  buildProfileEditV2Message,
  buildSpecializationListV2Message,
  buildSpecializationPickerV2Message,
  buildSpecializationConfirmV2Message,
  buildSpecializationUpdatedV2Message,
  buildDecorSetsV2Message
} from "../ui/profileFlowV2.js";
import discordPkg from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";

const {
MessageActionRow,
MessageSelectMenu,
MessageButton,
MessageFlags,
Modal,
TextInputComponent,
Constants
} = discordPkg;

// Temporary cache for multibuy selections to avoid custom ID length limits
const multibuyCacheV2 = new Map();
// Temporary cache for sell selections to avoid custom ID length limits
const sellSelectionCacheV2 = new Map();
// Temporary cache for compost selections keyed by message id
const compostSelectionCache = new Map();
// Temporary cache for takeout menu draft selections across paginated picker pages
const takeoutMenuSelectionCache = new Map();
// Temporary cache for accept-order draft selections across paginated picker pages
const acceptOrderSelectionCache = new Map();
// Temporary cache for cancel-order draft selections across paginated picker pages
const cancelOrderSelectionCache = new Map();
const v2LoopTracker = new Map();

const SELECTION_CACHE_TTL_MS = 5 * 60 * 1000;
const TAKEOUT_MENU_SELECTION_CACHE_TTL_MS = 30 * 60 * 1000;
const ACCEPT_ORDER_SELECTION_CACHE_TTL_MS = 15 * 60 * 1000;
const CANCEL_ORDER_SELECTION_CACHE_TTL_MS = 15 * 60 * 1000;

function makeSelectionToken() {
  return `${Date.now().toString(36)}${randomBytes(6).toString("hex")}`;
}

function purgeExpiredSelectionCache(cache) {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if ((entry?.expiresAt ?? 0) < now) cache.delete(key);
  }
}

function getTakeoutMenuSelectionCacheKey(serverId, userId) {
  return `${String(serverId || "")}:${String(userId || "")}`;
}

function normalizeTakeoutDraftSelection(ids = [], availableRecipeIds = []) {
  const availableSet = new Set((availableRecipeIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const out = [];
  const seen = new Set();
  for (const rawId of ids || []) {
    const id = String(rawId || "").trim();
    if (!id || seen.has(id) || !availableSet.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function readTakeoutMenuDraftSelection({ serverId, userId, availableRecipeIds = [], fallbackRecipeIds = [] } = {}) {
  purgeExpiredSelectionCache(takeoutMenuSelectionCache);
  const key = getTakeoutMenuSelectionCacheKey(serverId, userId);
  const cached = takeoutMenuSelectionCache.get(key);
  const cachedIds = Array.isArray(cached?.selectedRecipeIds) ? cached.selectedRecipeIds : [];
  const source = cachedIds.length ? cachedIds : (Array.isArray(fallbackRecipeIds) ? fallbackRecipeIds : []);
  return normalizeTakeoutDraftSelection(source, availableRecipeIds);
}

function writeTakeoutMenuDraftSelection({ serverId, userId, selectedRecipeIds = [] } = {}) {
  const key = getTakeoutMenuSelectionCacheKey(serverId, userId);
  takeoutMenuSelectionCache.set(key, {
    selectedRecipeIds: [...selectedRecipeIds],
    expiresAt: Date.now() + TAKEOUT_MENU_SELECTION_CACHE_TTL_MS
  });
}

function clearTakeoutMenuDraftSelection({ serverId, userId } = {}) {
  const key = getTakeoutMenuSelectionCacheKey(serverId, userId);
  takeoutMenuSelectionCache.delete(key);
}

function getAcceptOrderSelectionCacheKey(serverId, userId) {
  return `${String(serverId || "")}:${String(userId || "")}`;
}

function normalizeAcceptOrderDraftSelection(ids = [], availableOrderIds = []) {
  const availableSet = new Set((availableOrderIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const out = [];
  const seen = new Set();
  for (const rawId of ids || []) {
    const id = String(rawId || "").trim();
    if (!id || seen.has(id) || !availableSet.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function readAcceptOrderDraftSelection({ serverId, userId, availableOrderIds = [] } = {}) {
  purgeExpiredSelectionCache(acceptOrderSelectionCache);
  const key = getAcceptOrderSelectionCacheKey(serverId, userId);
  const cached = acceptOrderSelectionCache.get(key);
  const cachedIds = Array.isArray(cached?.selectedOrderIds) ? cached.selectedOrderIds : [];
  if (!Array.isArray(availableOrderIds) || availableOrderIds.length === 0) {
    return [...new Set(cachedIds.map((id) => String(id || "").trim()).filter(Boolean))];
  }
  return normalizeAcceptOrderDraftSelection(cachedIds, availableOrderIds);
}

function writeAcceptOrderDraftSelection({ serverId, userId, selectedOrderIds = [] } = {}) {
  const key = getAcceptOrderSelectionCacheKey(serverId, userId);
  acceptOrderSelectionCache.set(key, {
    selectedOrderIds: [...selectedOrderIds],
    expiresAt: Date.now() + ACCEPT_ORDER_SELECTION_CACHE_TTL_MS
  });
}

function clearAcceptOrderDraftSelection({ serverId, userId } = {}) {
  const key = getAcceptOrderSelectionCacheKey(serverId, userId);
  acceptOrderSelectionCache.delete(key);
}

function mergeAcceptOrderPageSelection({ availableOrderIds = [], currentSelectedOrderIds = [], pageOrderIds = [], pageSelectedOrderIds = [] } = {}) {
  const availableSet = new Set((availableOrderIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const pageSet = new Set((pageOrderIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const pageSelectedSet = new Set((pageSelectedOrderIds || []).map((id) => String(id || "").trim()).filter(Boolean));

  const merged = [];
  const seen = new Set();

  for (const rawId of currentSelectedOrderIds || []) {
    const id = String(rawId || "").trim();
    if (!id || seen.has(id)) continue;
    if (!availableSet.has(id)) continue;
    if (pageSet.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }

  for (const rawId of pageSelectedSet) {
    const id = String(rawId || "").trim();
    if (!id || seen.has(id)) continue;
    if (!availableSet.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }

  return merged;
}

function getCancelOrderSelectionCacheKey(serverId, userId) {
  return `${String(serverId || "")}:${String(userId || "")}`;
}

function normalizeCancelOrderDraftSelection(ids = [], availableOrderIds = []) {
  const availableSet = new Set((availableOrderIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const out = [];
  const seen = new Set();
  for (const rawId of ids || []) {
    const id = String(rawId || "").trim();
    if (!id || seen.has(id) || !availableSet.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function readCancelOrderDraftSelection({ serverId, userId, availableOrderIds = [] } = {}) {
  purgeExpiredSelectionCache(cancelOrderSelectionCache);
  const key = getCancelOrderSelectionCacheKey(serverId, userId);
  const cached = cancelOrderSelectionCache.get(key);
  const cachedIds = Array.isArray(cached?.selectedOrderIds) ? cached.selectedOrderIds : [];
  if (!Array.isArray(availableOrderIds) || availableOrderIds.length === 0) {
    return [...new Set(cachedIds.map((id) => String(id || "").trim()).filter(Boolean))];
  }
  return normalizeCancelOrderDraftSelection(cachedIds, availableOrderIds);
}

function writeCancelOrderDraftSelection({ serverId, userId, selectedOrderIds = [] } = {}) {
  const key = getCancelOrderSelectionCacheKey(serverId, userId);
  cancelOrderSelectionCache.set(key, {
    selectedOrderIds: [...selectedOrderIds],
    expiresAt: Date.now() + CANCEL_ORDER_SELECTION_CACHE_TTL_MS
  });
}

function clearCancelOrderDraftSelection({ serverId, userId } = {}) {
  const key = getCancelOrderSelectionCacheKey(serverId, userId);
  cancelOrderSelectionCache.delete(key);
}

function mergeCancelOrderPageSelection({ availableOrderIds = [], currentSelectedOrderIds = [], pageOrderIds = [], pageSelectedOrderIds = [] } = {}) {
  const availableSet = new Set((availableOrderIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const pageSet = new Set((pageOrderIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const pageSelectedSet = new Set((pageSelectedOrderIds || []).map((id) => String(id || "").trim()).filter(Boolean));

  const merged = [];
  const seen = new Set();

  for (const rawId of currentSelectedOrderIds || []) {
    const id = String(rawId || "").trim();
    if (!id || seen.has(id)) continue;
    if (!availableSet.has(id)) continue;
    if (pageSet.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }

  for (const rawId of pageSelectedSet) {
    const id = String(rawId || "").trim();
    if (!id || seen.has(id)) continue;
    if (!availableSet.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }

  return merged;
}

function formatSelectedItemNames(selectedIds, { maxNames = 3, maxChars = 80 } = {}) {
  const names = (selectedIds ?? []).map((id) => displayItemName(id)).filter(Boolean);
  if (!names.length) return "None";

  const visible = names.slice(0, Math.max(1, maxNames));
  const remainingCount = Math.max(0, names.length - visible.length);
  const suffix = remainingCount > 0 ? `, …and **${remainingCount}** more` : "";

  const joinedVisible = visible.join(", ");
  const availableForVisible = Math.max(1, maxChars - suffix.length);
  const truncatedVisible = joinedVisible.length > availableForVisible
    ? `${joinedVisible.slice(0, Math.max(1, availableForVisible - 1))}…`
    : joinedVisible;

  return `${truncatedVisible}${suffix}`;
}

function getHouse247Label() {
  return `${getIcon("perk_house_247", getIcon("sparkle"))} 24/7 House`;
}

function getTakeoutCounterLabel() {
  return `${getIcon("perk_takeout_counter", getIcon("orders"))} Take Out Counter`;
}

function applyUnlockNoticeEmbeds(payload = {}, player, user, { consumeSeatingNotice = false, consumeSubscriptionNotice = false } = {}) {
  if (!player) return payload;
  void user;

  const garden = getGardenUnlockState(player);
  const kitchen = getKitchenUnlockState(player);
  const fishing = getFishingUnlockState(player);

  const notices = [];
  if (garden?.justUnlocked) {
    notices.push({
      title: `${getIcon("garden")} Garden Unlocked`,
      details: ["Plant seeds and harvest ingredients with `/noodle garden` (or find it through your Pantry)."],
      tone: "success"
    });
  }
  if (kitchen?.justUnlocked) {
    notices.push({
      title: `${getIcon("kitchen")} Kitchen Unlocked`,
      details: ["Simmer gold-star broths with `/noodle kitchen` (or find it through your Pantry)."],
      tone: "success"
    });
  }
  if (fishing?.justUnlocked) {
    notices.push({
      title: `${getIcon("fishing")} Fishing Unlocked`,
      details: ["Catch fish and seafood with `/noodle fishing` (or find it through your Pantry)."],
      tone: "success"
    });
  }

  const seatingUpgrade = upgradesContent?.upgrades?.u_seating;
  const seatingLevel = Math.max(0, Number(player?.upgrades?.u_seating || 0));
  const seatingRepRequirements = Array.isArray(seatingUpgrade?.requirements?.rep)
    ? seatingUpgrade.requirements.rep
    : (typeof seatingUpgrade?.requirements?.rep === "number" ? [seatingUpgrade.requirements.rep] : []);
  const firstSeatingRepThreshold = seatingRepRequirements.length
    ? Math.max(0, Number(seatingRepRequirements[0]) || 0)
    : 0;
  const playerRep = Math.max(0, Number(player?.rep || 0));
  const seatingNoticeAlreadySeen = Boolean(player?.notifications?.seating_unlock_notice_seen);
  const shouldShowSeatingNotice = seatingLevel <= 0
    && firstSeatingRepThreshold > 0
    && playerRep >= firstSeatingRepThreshold
    && !seatingNoticeAlreadySeen;

  if (shouldShowSeatingNotice) {
    notices.push({
      title: `${getIcon("orders")} More Orders Available`,
      details: [
        `${getIcon("rep")} You have enough REP to unlock more seating & **Daily Orders**.`,
        "Open **/noodle-upgrades** and unlock **Seating** in the **Service** category using your earned REP."
      ],
      tone: "info"
    });
    if (consumeSeatingNotice) {
      ensurePersistentV2NoticeState(player);
      player.notifications.seating_unlock_notice_seen = true;
    }
  }

  const subscriptionPerkMeta = {
    [SUBSCRIPTION_PERKS.HOUSE_247]: {
      name: getHouse247Label(),
      tryLine: "Try it in **/noodle orders** and **/noodle market**."
    },
    [SUBSCRIPTION_PERKS.TAKEOUT_COUNTER]: {
      name: getTakeoutCounterLabel(),
      tryLine: "Try it in **/noodle takeout** from your orders menu."
    }
  };

  const toNoticeKey = (state = {}) => [
    String(state?.entitlement_id ?? "-"),
    String(state?.period_start_at ?? "-"),
    String(state?.period_end_at ?? "-"),
    String(state?.last_coin_grant_period ?? "-")
  ].join("|");

  const getNoticeCoinGrantPeriod = (noticeKey) => {
    const key = String(noticeKey ?? "");
    if (!key) return "-";
    const parts = key.split("|");
    return String(parts[3] ?? "-");
  };

  const subscriptions = ensureSubscriptionState(player);
  const existingNoticeKeys = (player?.notifications?.subscription_perk_notice_keys
    && typeof player.notifications.subscription_perk_notice_keys === "object"
    && !Array.isArray(player.notifications.subscription_perk_notice_keys))
    ? player.notifications.subscription_perk_notice_keys
    : {};

  const grantedPerkLines = [];
  let totalCoinReward = 0;
  let sawCoinGrant = false;
  const perkIds = [SUBSCRIPTION_PERKS.HOUSE_247, SUBSCRIPTION_PERKS.TAKEOUT_COUNTER];
  for (const perkId of perkIds) {
    const state = subscriptions?.perks?.[perkId] ?? {};
    const activeNow = hasActivePerk(player, perkId, nowTs());
    if (!activeNow) continue;

    const noticeKey = toNoticeKey(state);
    const seenNoticeKey = String(existingNoticeKeys?.[perkId] ?? "");
    if (!noticeKey || noticeKey === seenNoticeKey) continue;

    const meta = subscriptionPerkMeta[perkId] ?? { name: perkId, tryLine: "" };
    grantedPerkLines.push(`• **${meta.name}** unlocked. ${meta.tryLine}`);

    const currentCoinGrantPeriod = String(state?.last_coin_grant_period ?? "-");
    const previousCoinGrantPeriod = getNoticeCoinGrantPeriod(seenNoticeKey);
    if (currentCoinGrantPeriod !== "-" && currentCoinGrantPeriod !== previousCoinGrantPeriod) {
      totalCoinReward += SUBSCRIPTION_MONTHLY_COIN_GRANT;
      sawCoinGrant = true;
    }

    if (consumeSubscriptionNotice) {
      if (!player.notifications) {
        player.notifications = {
          pending_pantry_messages: [],
          dm_reminders_opt_out: false,
          last_daily_reminder_day: null,
          last_noodle_channel_id: null,
          last_noodle_guild_id: null
        };
      }
      if (!player.notifications.subscription_perk_notice_keys
        || typeof player.notifications.subscription_perk_notice_keys !== "object"
        || Array.isArray(player.notifications.subscription_perk_notice_keys)) {
        player.notifications.subscription_perk_notice_keys = {};
      }
      player.notifications.subscription_perk_notice_keys[perkId] = noticeKey;
    }
  }

  if (grantedPerkLines.length > 0) {
    const coinLine = sawCoinGrant
      ? `${getIcon("coins")} Subscription coin reward credited: **${totalCoinReward}c**`
      : `${getIcon("coins")} Subscription coin reward credited this cycle: **0c**`;
    notices.push({
      title: `${getIcon("sparkle")} Subscription Perks Unlocked`,
      details: [...grantedPerkLines, coinLine],
      tone: "success"
    });
  }

  if (!notices.length) return payload;

  const updated = { ...(payload ?? {}) };
  const existingNotices = Array.isArray(updated.notices) ? [...updated.notices] : [];

  for (const notice of notices) {
    if (!notice || typeof notice !== "object") continue;
    const signature = JSON.stringify({
      title: String(notice.title || "").trim(),
      details: Array.isArray(notice.details) ? notice.details : [],
      tone: String(notice.tone || "info").trim()
    });
    const alreadyPresent = existingNotices.some((entry) => {
      const existingSignature = JSON.stringify({
        title: String(entry?.title || "").trim(),
        details: Array.isArray(entry?.details) ? entry.details : [],
        tone: String(entry?.tone || "info").trim()
      });
      return signature === existingSignature;
    });
    if (!alreadyPresent) existingNotices.push(notice);
  }

  if (existingNotices.length) {
    updated.notices = existingNotices;
    if (updated.content === undefined) updated.content = " ";
  }

  Object.defineProperty(updated, "__unlockNoticeApplied", { value: true, enumerable: false });
  return updated;
}

const MAX_PERSISTENT_V2_NOTICE_CARDS = 10;

function ensurePersistentV2NoticeState(player) {
  if (!player || typeof player !== "object") return null;
  if (!player.notifications || typeof player.notifications !== "object" || Array.isArray(player.notifications)) {
    player.notifications = {
      pending_pantry_messages: [],
      pending_v2_notice_cards: [],
      active_v2_notice_cards: [],
      active_v2_notice_menu_key: null,
      dm_reminders_opt_out: false,
      last_daily_reminder_day: null,
      last_noodle_channel_id: null,
      last_noodle_guild_id: null
    };
  }
  if (!Array.isArray(player.notifications.pending_v2_notice_cards)) {
    player.notifications.pending_v2_notice_cards = [];
  }
  if (!Array.isArray(player.notifications.active_v2_notice_cards)) {
    player.notifications.active_v2_notice_cards = [];
  }
  if (typeof player.notifications.active_v2_notice_menu_key !== "string") {
    player.notifications.active_v2_notice_menu_key = null;
  }
  return player.notifications;
}

function normalizePersistentV2NoticeCard(card) {
  if (!card || typeof card !== "object") return null;
  const title = String(card.title || "Notification").trim() || "Notification";
  const toneRaw = String(card.tone || "info").trim().toLowerCase();
  const tone = ["info", "success", "warning", "error"].includes(toneRaw) ? toneRaw : "info";
  const details = (Array.isArray(card.details) ? card.details : [card.details])
    .map((line) => String(line ?? "").trim())
    .filter(Boolean)
    .slice(0, 8);
  if (!details.length) return null;
  return { title, details, tone };
}

function resolvePersistentV2NoticeCards(player, menuKey) {
  const notifications = ensurePersistentV2NoticeState(player);
  if (!notifications) return { notices: [], changed: false };

  let changed = false;
  const normalizedMenuKey = String(menuKey || "menu:unknown").trim() || "menu:unknown";
  const pending = notifications.pending_v2_notice_cards
    .map((card) => normalizePersistentV2NoticeCard(card))
    .filter(Boolean)
    .slice(0, MAX_PERSISTENT_V2_NOTICE_CARDS);
  if (pending.length !== notifications.pending_v2_notice_cards.length) changed = true;
  notifications.pending_v2_notice_cards = pending;

  const active = notifications.active_v2_notice_cards
    .map((card) => normalizePersistentV2NoticeCard(card))
    .filter(Boolean)
    .slice(0, MAX_PERSISTENT_V2_NOTICE_CARDS);
  if (active.length !== notifications.active_v2_notice_cards.length) changed = true;
  notifications.active_v2_notice_cards = active;

  if (active.length > 0 && notifications.active_v2_notice_menu_key && notifications.active_v2_notice_menu_key !== normalizedMenuKey) {
    notifications.active_v2_notice_cards = [];
    notifications.active_v2_notice_menu_key = null;
    changed = true;
  }

  if (notifications.active_v2_notice_cards.length <= 0 && notifications.pending_v2_notice_cards.length > 0) {
    notifications.active_v2_notice_cards = notifications.pending_v2_notice_cards.slice(0, MAX_PERSISTENT_V2_NOTICE_CARDS);
    notifications.pending_v2_notice_cards = [];
    notifications.active_v2_notice_menu_key = normalizedMenuKey;
    changed = true;
  }

  return {
    notices: notifications.active_v2_notice_cards,
    changed
  };
}

function applyPersistentNoticeCards(payload = {}, notices = []) {
  const cards = (notices || []).map((notice) => normalizePersistentV2NoticeCard(notice)).filter(Boolean);
  if (!cards.length) return payload;

  let updated = { ...(payload ?? {}) };
  const hasSourceNativeNoticeShape = Array.isArray(updated.mainComponents) || Array.isArray(updated.notices);

  if (hasSourceNativeNoticeShape) {
    const existing = Array.isArray(updated.notices) ? [...updated.notices] : [];
    updated.notices = [...existing, ...cards];
    return updated;
  }

  if (Array.isArray(updated.embeds) && updated.embeds.length > 0) {
    const composed = composeV2FromLegacyEmbeds(updated.embeds);
    const { embeds, ...rest } = updated;
    updated = {
      ...rest,
      ...composed,
      notices: [...(Array.isArray(composed.notices) ? composed.notices : []), ...cards]
    };
    return updated;
  }

  updated.notices = cards;
  if (updated.content === undefined) updated.content = " ";
  return updated;
}

// Aliases for v14+ compatibility in code
const ActionRowBuilder = MessageActionRow;
const StringSelectMenuBuilder = MessageSelectMenu;
const ModalBuilder = Modal;
const TextInputBuilder = TextInputComponent;
const ButtonBuilder = MessageButton;
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

const LEGACY_RECIPE_ID_ALIASES = {
  sweet_soy_broth: "sweet_soy_bowl",
  spring_blossoms_garden_broth: "spring_blossoms_garden_bowl"
};

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
const newsContent = loadNewsContent();
const content = withEventRecipes(baseContent, eventsContent);
const eventRecipeSeasonIndex = buildEventRecipeSeasonMap(eventsContent);
const db = openDb();

const HERALD_BADGE_ID = "seasonal_herald";
const HERALD_BADGE_DURATION_MS = 24 * 60 * 60 * 1000;
const DEV_ADMIN_USER_ID = "705521883335885031";
const OFFICIAL_DEV_GUILD_ID = process.env.NOODLE_DEV_GUILD_ID || process.env.NOODLE_OFFICIAL_GUILD_ID || process.env.DISCORD_GUILD_ID || "";
const DISCORD_STORE_URL = "https://noodlestory.lol/home/store/";
const DEFAULT_SUPPORT_SERVER_URL = "https://discord.gg/uue7K92pwj";
const SUPPORT_SERVER_URL_ALLOWED_HOSTS = new Set([
  "discord.gg",
  "www.discord.gg",
  "discord.com",
  "www.discord.com",
  "discordapp.com",
  "www.discordapp.com"
]);
// Look a bit over a year ahead so annual event windows still resolve a future start date.
const NEXT_EVENT_LOOKAHEAD_MS = 370 * 24 * 60 * 60 * 1000;
const ABOUT_SHOP_COUNT_CACHE_TTL_MS = 5 * 60 * 1000;
let aboutShopCountCache = { value: null, fetchedAt: 0 };

function resolveSupportServerUrl(rawValue) {
  const candidate = String(rawValue ?? "").trim();
  if (!candidate) return DEFAULT_SUPPORT_SERVER_URL;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:") return DEFAULT_SUPPORT_SERVER_URL;
    const host = String(parsed.hostname ?? "").toLowerCase();
    if (!SUPPORT_SERVER_URL_ALLOWED_HOSTS.has(host)) {
      return DEFAULT_SUPPORT_SERVER_URL;
    }
    return parsed.toString();
  } catch {
    return DEFAULT_SUPPORT_SERVER_URL;
  }
}

const SUPPORT_SERVER_URL = resolveSupportServerUrl(process.env.NOODLE_SUPPORT_SERVER_URL);

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
  sakura_sweetheart_noodle_atelier: "sakura_sweetheart_noodle_atelier",
  midnight_noodle_atelier: "midnight_noodle_atelier",
  rainy_alley_ramen: "rainy_alley_ramen",
  ironclad_noodle_foundry: "ironclad_noodle_foundry",
  playful_panda_snack_stand: "playful_panda_snack_stand",
  alchemists_broth_lab: "alchemists_broth_lab",
  backstreet_brick_noodle_bar: "backstreet_brick_noodle_bar"
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

function getCachedDistinctShopCount(dbHandle) {
  if (!dbHandle) return null;

  const nowMs = Date.now();
  if (
    aboutShopCountCache.value !== null
    && Number.isFinite(aboutShopCountCache.fetchedAt)
    && nowMs - aboutShopCountCache.fetchedAt < ABOUT_SHOP_COUNT_CACHE_TTL_MS
  ) {
    return aboutShopCountCache.value;
  }

  const row = dbHandle.prepare("SELECT COUNT(DISTINCT user_id) AS count FROM players").get();
  const count = Number(row?.count ?? 0);
  if (!Number.isFinite(count)) {
    return null;
  }

  aboutShopCountCache = { value: count, fetchedAt: nowMs };
  return count;
}

function applyOwnerFooter(embed, user) {
  if (!embed || !user) return embed;
  const text = ownerFooterText(user);

  if (typeof embed.setFooter === "function") {
    embed.setFooter({ text });
    return embed;
  }

  if (embed.data && typeof embed.data === "object") {
    embed.data.footer = { ...(embed.data.footer ?? {}), text };
    return embed;
  }

  embed.footer = { ...(embed.footer ?? {}), text };
  return embed;
}

function attachLegacyEmbedCompatMethods(embed) {
  if (!embed || typeof embed !== "object") return embed;

  if (typeof embed.setFooter !== "function") {
    Object.defineProperty(embed, "setFooter", {
      enumerable: false,
      value(footer = {}) {
        const text = String(footer?.text ?? "").trim();
        if (this.data && typeof this.data === "object") {
          this.data.footer = { ...(this.data.footer ?? {}), ...(footer ?? {}), text };
        } else {
          this.footer = { ...(this.footer ?? {}), ...(footer ?? {}), text };
        }
        return this;
      }
    });
  }

  if (typeof embed.addFields !== "function") {
    Object.defineProperty(embed, "addFields", {
      enumerable: false,
      value(...fields) {
        const flat = fields.flat().filter(Boolean);
        this.fields = [...(Array.isArray(this.fields) ? this.fields : []), ...flat];
        return this;
      }
    });
  }

  if (typeof embed.setFields !== "function") {
    Object.defineProperty(embed, "setFields", {
      enumerable: false,
      value(...fields) {
        const flat = fields.flat().filter(Boolean);
        this.fields = flat;
        return this;
      }
    });
  }

  if (typeof embed.setURL !== "function") {
    Object.defineProperty(embed, "setURL", {
      enumerable: false,
      value(url = "") {
        this.url = String(url ?? "").trim();
        return this;
      }
    });
  }

  return embed;
}

function buildMenuEmbed({ title, description, user, color = theme.colors.primary } = {}) {
  const embed = {
    title: String(title ?? ""),
    description: String(description ?? ""),
    color,
    fields: []
  };
  applyOwnerFooter(embed, user);
  return attachLegacyEmbedCompatMethods(embed);
}

function chunkLinesIntoEmbedFields(lines, {
  firstFieldName = "Items",
  continuationFieldName = "Items (cont.)",
  maxFieldLength = 1000,
  maxFields = 10
} = {}) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return [{ name: firstFieldName, value: "No items available.", inline: false }];
  }

  const fields = [];
  let buffer = [];
  let currentLength = 0;

  const flush = () => {
    if (!buffer.length || fields.length >= maxFields) return;
    fields.push({
      name: fields.length === 0 ? firstFieldName : continuationFieldName,
      value: buffer.join("\n"),
      inline: false
    });
    buffer = [];
    currentLength = 0;
  };

  for (const rawLine of lines) {
    if (fields.length >= maxFields) break;
    const line = String(rawLine ?? "").trim();
    if (!line) continue;
    const lineLengthWithSeparator = line.length + (buffer.length ? 1 : 0);

    if (currentLength + lineLengthWithSeparator > maxFieldLength) {
      flush();
      if (fields.length >= maxFields) break;
    }

    buffer.push(line);
    currentLength += line.length + (buffer.length > 1 ? 1 : 0);
  }

  flush();
  return fields.length ? fields : [{ name: firstFieldName, value: "No items available.", inline: false }];
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

  const marketText = `New Orders Arrive: ${dateText}`;
  return existingFooterText ? `${existingFooterText} • ${marketText}` : marketText;
}

function isDevAdmin(userId) {
  return String(userId ?? "") === DEV_ADMIN_USER_ID;
}

function hasHouse247Perk(player) {
  return hasUnlimitedMarketStock(player, nowTs());
}

function applyHouse247OrderBoardOverride(player) {
  if (!hasHouse247Perk(player)) return;

  const orderCap = Math.max(0, Math.floor(Number(getOrderAcceptCap(player, nowTs()) || 0) || 0));
  const currentTotal = Math.max(0, Math.floor(Number(player?.orders_total_count || 0) || 0));
  const consumedCount = Array.isArray(player?.orders_consumed_indices)
    ? player.orders_consumed_indices.length
    : 0;

  // Keep a rolling board chunk available while preserving stable order IDs within a day.
  // This makes 24/7 House effectively unlimited without allocating a giant board upfront.
  const boardChunk = Math.max(1, orderCap || 500);
  const minimumTotal = Math.max(currentTotal, boardChunk);
  const consumedChunks = Math.floor(consumedCount / boardChunk);
  const desiredTotal = Math.max(minimumTotal, (consumedChunks + 1) * boardChunk);
  if (desiredTotal <= currentTotal) return;

  player.orders_total_count = desiredTotal;
  if (consumedCount < desiredTotal) {
    player.orders_depleted_day = null;
  }
}

function buildHelpPage({ page, userId, user }) {
  const pages = [
    {
      title: `${getIcon("help")} Help`,
      description: [
        "**Hello chef! Begin the tutorial with `/noodle start`, you can play exclusively with buttons.**",
        "\n**When you've completed the tutorial, you will only need to use `/noodle orders` any time you want to access all play commands.**",
        "",
        `Error messages are sent only to you.\n${getIcon("help")} If you need further help, screenshot your error & head over to the ⁠support server! [Join here](https://discord.gg/uue7K92pwj)\n\nTip: Copy/paste the \`\`/noodle start\`\` or \`\`/noodle orders\`\` slash command into a message on this channel and send!`
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
            "• `/noodle cancel` — Cancel an accepted order.",
            `• \`/noodle takeout\` — Run your takeout counter. ${getIcon("lock")} Unlocks with the **${getTakeoutCounterLabel()}** perk.`
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
            "• `/noodle quests_vote` — View and claim bot-list vote rewards.",
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
        "• `/noodle-social global_leaderboard` — View global leaderboards.",
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

  const hasMultiplePages = pages.length > 1;
  const prevPage = safePage <= 0 ? pages.length - 1 : safePage - 1;
  const nextPage = safePage >= pages.length - 1 ? 0 : safePage + 1;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:help:page:${userId}:${prevPage}`)
      .setLabel("Prev")
      .setEmoji(getButtonEmoji("back"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasMultiplePages),
    new ButtonBuilder()
      .setCustomId(`noodle:help:page:${userId}:${nextPage}`)
      .setLabel("Next")
      .setEmoji(getButtonEmoji("next"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasMultiplePages)
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

function buildDecorSetsViewData({ player, view = "specialization", page = 0, pageSize = 5 }) {
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
  const entries = pageSets.map((set) => {
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
    const imageUrl = getIconUrl(`decor_set_${set.set_id}`)
      ?? (specId ? getIconUrl(`decor_set_${specId}`) : null)
      ?? getIconUrl("decor_set_placeholder");

    if (showSpecialization) {
      return {
        setId: set.set_id,
        name: set.name,
        statusLine: status,
        piecesLine: piecesList,
        description,
        imageUrl
      };
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
    return {
      setId: set.set_id,
      name: set.name,
      statusLine: status,
      piecesLine: `${piecesList}\n${countLine}`,
      description: `${description}\n${missingBlock}`,
      imageUrl
    };
  });

  return {
    entries,
    page: safePage,
    totalPages,
    showSpecialization
  };
}

function renderDecorSetsEmbedLocal({ player, ownerUser, view = "specialization", page = 0, pageSize = 5 }) {
  const {
    entries,
    page: safePage,
    totalPages,
    showSpecialization
  } = buildDecorSetsViewData({ player, view, page, pageSize });

  const lines = entries.map((entry) => `${entry.statusLine} **${entry.name}**\n${entry.piecesLine}\n${entry.description}`);

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
new ButtonBuilder().setCustomId(`noodle:nav:pantry:${userId}`).setLabel("Pantry").setEmoji(getButtonEmoji("pantry")).setStyle(ButtonStyle.Secondary),
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
  allowLockedFeatureInfo = false,
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
    const gardenStyle = gardenPrimary
      ? (gardenUnlocked ? (gardenStyleOverride ?? ButtonStyle.Success) : ButtonStyle.Secondary)
      : gardenStyleBase;
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:nav:garden:${userId}`)
        .setLabel("Garden").setEmoji(getButtonEmoji("garden"))
        .setStyle(gardenStyle)
        .setDisabled(gardenLocked && !allowLockedFeatureInfo)
    );
  }

  if (includeFishingButton) {
    const fishingPrimary = active === "fishing";
    const fishingStyleBase = fishingStyleOverride ?? (!fishingUnlocked
      ? ButtonStyle.Secondary
      : (fishingJustUnlocked ? ButtonStyle.Success : ButtonStyle.Secondary));
    const fishingStyle = fishingPrimary
      ? (fishingUnlocked ? (fishingStyleOverride ?? ButtonStyle.Success) : ButtonStyle.Secondary)
      : fishingStyleBase;
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:nav:fishing:${userId}`)
        .setLabel("Fishing")
        .setEmoji(getButtonEmoji("fishing"))
        .setStyle(fishingStyle)
        .setDisabled(!fishingUnlocked && !allowLockedFeatureInfo)
    );
  }

  if (includeKitchenButton) {
    const kitchenPrimary = active === "kitchen";
    const kitchenStyleBase = !kitchenUnlocked
      ? ButtonStyle.Secondary
      : (kitchenJustUnlocked ? ButtonStyle.Success : ButtonStyle.Secondary);
    const kitchenStyle = kitchenPrimary
      ? (kitchenUnlocked ? ButtonStyle.Success : ButtonStyle.Secondary)
      : kitchenStyleBase;
    const kitchenEmoji = kitchenPrimary && kitchenUnlocked ? getButtonEmoji("refresh") : getButtonEmoji("kitchen");
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:nav:kitchen:${userId}`)
        .setLabel("Kitchen")
        .setEmoji(kitchenEmoji)
        .setStyle(kitchenStyle)
        .setDisabled(!kitchenUnlocked && !allowLockedFeatureInfo)
    );
  }

  if (showGardenActions) {
    const compostPrimary = active === "compost";
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:action:compost:${userId}`)
        .setLabel("Make Compost")
        .setEmoji(getButtonEmoji("compost_bag"))
        .setStyle(compostPrimary ? ButtonStyle.Success : ButtonStyle.Primary)
        .setDisabled(!canCompost),
      new ButtonBuilder()
        .setCustomId(`noodle:action:harvest:${userId}`)
        .setLabel("Harvest All")
        .setEmoji(getButtonEmoji("harvest"))
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

  const compostCount = garden.compost_bags || 0;
  const spoiledTotal = Object.values(garden.spoiled || {}).reduce((sum, v) => sum + (v || 0), 0);
  const pantryForageables = getCompostableForageables(player, content);
  const pantryTotal = Object.values(pantryForageables).reduce((sum, v) => sum + (v || 0), 0);
  const craftableBags = Math.floor((spoiledTotal + pantryTotal) / COMPOST_PER_BAG);
  const canCraft = craftableBags > 0;

  const readyPlots = plots
    .map((plot, idx) => ({ plot, idx, remainingTotal: getYieldTotal(getPlotYieldRemaining(plot)) }))
    .filter(({ plot, remainingTotal }) => plot?.seed_id && remainingTotal > 0 && (!plot.harvest_ready_at || plot.harvest_ready_at <= now))
    .map(({ plot, idx, remainingTotal }) => ({ ...plot, idx, remainingTotal }));

  return {
    canCraft,
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

function formatAutoHarvestNote(autoHarvestResult, content) {
  if (!autoHarvestResult?.harvested?.length) return null;
  const totalAdded = autoHarvestResult.added || {};
  const seeded = Object.entries(autoHarvestResult.seedBonus || {}).filter(([, qty]) => qty > 0);
  const hasIngredients = getYieldTotal(totalAdded) > 0;
  if (!hasIngredients && !seeded.length) return null;
  const plotCount = autoHarvestResult.harvested.length;
  const plotDescriptor = plotCount === 1 ? "the ready plot" : "each ready plot";
  const harvestLine = hasIngredients
    ? `${getIcon("garden")} The gardener lovingly tended ${plotDescriptor} and gathered ${describeYieldMap(totalAdded, content)}.`
    : `${getIcon("garden")} The gardener lovingly tended ${plotDescriptor} to keep the beds full of life.`;
  const seedLine = seeded.length
    ? `${getIcon("seeds")} Seeds tucked away while tending:\n${seeded.map(([seedId, qty]) => `• **${qty}×** ${getSeedDisplayName(seedId, content)}`).join("\n")}`
    : null;
  return [harvestLine, seedLine].filter(Boolean).join("\n");
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

function getChunkPageByLines(lines, targetPage = 0, maxLen = 900) {
  const safeTarget = Math.max(0, Number.isFinite(targetPage) ? Math.floor(targetPage) : 0);
  const sourceLines = Array.isArray(lines) && lines.length ? lines : ["_None yet._"];

  let page = 0;
  let totalPages = 1;
  let selected = null;
  let buffer = "";

  const flush = () => {
    if (!buffer) return;
    if (page === safeTarget) selected = buffer;
    page += 1;
    totalPages = Math.max(totalPages, page);
    buffer = "";
  };

  for (const line of sourceLines) {
    const text = String(line ?? "");
    const next = buffer ? `${buffer}\n${text}` : text;
    if (next.length <= maxLen) {
      buffer = next;
      continue;
    }

    if (buffer) flush();

    if (text.length <= maxLen) {
      buffer = text;
      continue;
    }

    let start = 0;
    while (start < text.length) {
      const part = text.slice(start, start + maxLen);
      if (page === safeTarget && selected == null) selected = part;
      page += 1;
      totalPages = Math.max(totalPages, page);
      start += maxLen;
    }
    buffer = "";
  }

  if (buffer) flush();
  if (selected == null) {
    selected = sourceLines.join("\n").slice(0, maxLen) || "_None yet._";
  }

  return {
    text: selected,
    totalPages: Math.max(1, totalPages)
  };
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
    const safe = embed?.toJSON ? embed.toJSON() : { ...(embed ?? {}) };
    const fields = safe?.fields || safe?.data?.fields || [];
    if (fields.length) {
      const newFields = fields.flatMap((f) => chunkField(f));
      safe.fields = newFields;
    }

    const desc = safe?.description ?? safe?.data?.description ?? "";
    if (desc && desc.length > MAX_DESC) {
      const truncated = desc.slice(0, MAX_DESC);
      safe.description = `${truncated}\n\n(Description truncated)`;
    }

    return safe;
  });
}

function pantryPageRow(userId, page = 0, totalPages = 1, ingredientPages = 1) {
  const clampedTotal = Math.max(1, totalPages);
  const safePage = Math.min(Math.max(page, 0), clampedTotal - 1);
  const prevPage = safePage <= 0 ? clampedTotal - 1 : safePage - 1;
  const nextPage = safePage >= clampedTotal - 1 ? 0 : safePage + 1;
  const ingredientsPageCount = Math.max(1, ingredientPages);
  const bowlsStartPage = ingredientsPageCount;
  const viewingIngredients = safePage < ingredientsPageCount;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:nav:pantry:${userId}:${prevPage}`)
      .setLabel("Prev")
      .setEmoji(getButtonEmoji("back"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedTotal <= 1),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:pantry:${userId}:0`)
      .setLabel("Ingredients")
      .setEmoji(getButtonEmoji("pantry"))
      .setStyle(viewingIngredients ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:pantry:${userId}:${bowlsStartPage}`)
      .setLabel("Cooked Bowls")
      .setEmoji(getButtonEmoji("cook"))
      .setStyle(viewingIngredients ? ButtonStyle.Secondary : ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:pantry:${userId}:${nextPage}`)
      .setLabel("Next")
      .setEmoji(getButtonEmoji("next"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clampedTotal <= 1)
  );
}

function buildGardenView({ player, combinedEffects, user, userId, kitchenUnlocked = false, kitchenJustUnlocked = false, page = 0, autoHarvestResult = null }) {
  const garden = ensureGardenState(player);
  const plots = ensureGardenPlots(player, combinedEffects);
  const gardenState = getGardenActionState(player, combinedEffects);
  const allowedIngredients = getUnlockedIngredientIds(player, content);
  const compostCount = gardenState.compostCount;
  const spoiledTotal = gardenState.spoiledTotal;
  const pantryTotal = gardenState.pantryTotal;
  const canCraft = gardenState.canCraft;
  const readyPlots = gardenState.readyPlots;

  const seedSection = formatSeedLines(garden.seeds, content);
  const spoiledSection = formatSpoiledLines(garden.spoiled, content);
  const plotsSection = formatPlotLines(player, content, combinedEffects);

  const hasHarvestable = readyPlots.length > 0;
  const hasEmptyPlot = plots.some((plot) => !plot?.seed_id || getYieldTotal(getPlotYieldRemaining(plot)) <= 0);
  const totalSeeds = Object.values(garden.seeds || {}).reduce((sum, qty) => sum + Math.max(0, Number(qty) || 0), 0);
  const hasNoSeedsNoCompost = totalSeeds <= 0 && compostCount <= 0 && !canCraft;
  const hasSeedsNoCompost = totalSeeds > 0 && compostCount <= 0;

  const plotSummary = `${getIcon("plot")} Plots available: **${getGardenPlotCount(player, combinedEffects)}**`;
  const gardenStarterHelp = hasNoSeedsNoCompost
    ? `${getIcon("forage")} No seeds or compost bags yet. Use \`/noodle forage\` for a chance to find seeds, then forage extras (or spoiled items) to craft compost bags.`
    : (hasSeedsNoCompost
      ? (canCraft
        ? `${getIcon("compost_bag")} You have seeds ready to plant, but no compost bags. Tap **Make Compost** to craft bags and start planting.`
        : `${getIcon("compost_bag")} You have seeds ready to plant, but no compost bags. Forage extras (or collect spoiled items) to craft compost bags.`)
      : null);
  const plotsLinesRaw = plotsSection ? plotsSection.split("\n").filter(Boolean) : [];
  const plotsLines = plotsLinesRaw.length ? plotsLinesRaw : ["_No plots available yet._"];

  const autoHarvestNote = formatAutoHarvestNote(autoHarvestResult, content);
  const gardenOverview = `Plant seeds, craft compost from extras, and harvest ready plots for ingredients.`;
  const descriptionParts = [gardenOverview, autoHarvestNote, [plotSummary, gardenStarterHelp].filter(Boolean).join("\n")].filter(Boolean);
  const description = descriptionParts.join("\n\n");

  const seedsValue = [
    "· · · · · · ·",
    `${getIcon("seeds")} **Seeds (unlimited)**`,
    seedSection
  ].join("\n");

  const compostValue = [
    "· · · · · · ·",
    `${getIcon("compost_bag")} **Compost: ${compostCount} bags (unlimited)**`,
    `**Compost Inputs:**`,
    `Spoiled saved: **${spoiledTotal}**`,
    `Fresh forageables: **${pantryTotal}**`,
    `*Recipe: ${COMPOST_PER_BAG} spoiled or fresh forageables = 1 bag*`
  ].join("\n");

  const seedOptions = Object.entries(garden.seeds || {})
    .filter(([, qty]) => qty > 0)
    .map(([seedId, qty]) => ({
      label: `${getSeedDisplayName(seedId, content)} (${qty} seeds)`?.slice(0, 100),
      value: seedId,
      description: `Uses 1 compost bag — yields ${describeYieldMap(getSeedYieldMap(seedId, { allowedIngredients }), content)}`.slice(0, 100)
    }))
    .sort((a, b) => String(a.label || "").localeCompare(String(b.label || ""), undefined, { sensitivity: "base" }))
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
  }))
    .sort((a, b) => String(a.label || "").localeCompare(String(b.label || ""), undefined, { sensitivity: "base" }))
    .slice(0, 25);

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
    title: `${getIcon("garden")} Garden`,
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

function getTutorialProgressRows(player, userId, { highlightAccept = false, disableAccept = false } = {}) {
  const rowKey = resolveTutorialProgressRowKey(player);
  if (!rowKey) return null;

  if (rowKey === "accept_only") {
    return [noodleOrdersAcceptOnlyRow(userId, { highlightAccept, disableAccept })];
  }
  if (rowKey === "buy") return [noodleTutorialBuyRow(userId)];
  if (rowKey === "forage") return [noodleTutorialForageRow(userId)];
  if (rowKey === "cook") return [noodleTutorialCookRow(userId)];
  if (rowKey === "serve") return [noodleTutorialServeRow(userId)];
  return null;
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

function noodleMainMenuRowNoProfile(userId, { newsAvailable = false, showTakeout = false } = {}) {
  const buttons = [
    new ButtonBuilder().setCustomId(`noodle:nav:orders:${userId}`).setLabel("Orders").setEmoji(getButtonEmoji("orders")).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`noodle:nav:buy:${userId}`).setLabel("Buy").setEmoji(getButtonEmoji("cart")).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`noodle:nav:pantry:${userId}`).setLabel("Pantry").setEmoji(getButtonEmoji("pantry")).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`noodle:nav:news:${userId}`).setLabel("News").setEmoji(getButtonEmoji("new")).setStyle(newsAvailable ? ButtonStyle.Success : ButtonStyle.Secondary)
  ];
  if (showTakeout) {
    buttons.splice(
      1,
      0,
      new ButtonBuilder()
        .setCustomId(`noodle:nav:takeout:${userId}`)
        .setLabel("Takeout")
        .setEmoji(getButtonEmoji("orders"))
        .setStyle(ButtonStyle.Success)
    );
  }
  return new ActionRowBuilder().addComponents(...buttons);
}

function noodleRecipesMenuRow(userId, { kitchenUnlocked = false, kitchenJustUnlocked = false, active = null, allowLockedKitchenInfo = false } = {}) {
  const kitchenStyle = !kitchenUnlocked
    ? ButtonStyle.Secondary
    : (kitchenJustUnlocked ? ButtonStyle.Success : ButtonStyle.Secondary);
  const kitchenEmoji = active === "kitchen" && kitchenUnlocked ? getButtonEmoji("refresh") : getButtonEmoji("kitchen");
  const recipesStyle = active === "recipes" ? ButtonStyle.Primary : ButtonStyle.Secondary;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`noodle:nav:recipes:${userId}`).setLabel("Recipes").setEmoji(getButtonEmoji("recipes")).setStyle(recipesStyle),
    new ButtonBuilder().setCustomId(`noodle:nav:regulars:${userId}`).setLabel("Regulars").setEmoji(getButtonEmoji("regulars")).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:kitchen:${userId}`)
      .setLabel("Kitchen")
      .setEmoji(kitchenEmoji)
      .setStyle(kitchenStyle)
      .setDisabled(!kitchenUnlocked && !allowLockedKitchenInfo)
  );
}

function noodleFeatureInfoRow(userId, {
  active = null,
  gardenUnlocked = false,
  kitchenUnlocked = false,
  kitchenJustUnlocked = false,
  fishingUnlocked = false,
  fishingJustUnlocked = false
} = {}) {
  const gardenStyle = gardenUnlocked ? ButtonStyle.Success : ButtonStyle.Secondary;
  const kitchenStyle = kitchenUnlocked
    ? (kitchenJustUnlocked ? ButtonStyle.Success : ButtonStyle.Secondary)
    : ButtonStyle.Secondary;
  const fishingStyle = fishingUnlocked
    ? (fishingJustUnlocked ? ButtonStyle.Success : ButtonStyle.Secondary)
    : ButtonStyle.Secondary;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:nav:garden:${userId}`)
      .setLabel("Garden")
      .setEmoji(getButtonEmoji("garden"))
      .setStyle(active === "garden" && gardenUnlocked ? ButtonStyle.Success : gardenStyle),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:kitchen:${userId}`)
      .setLabel("Kitchen")
      .setEmoji(active === "kitchen" && kitchenUnlocked ? getButtonEmoji("refresh") : getButtonEmoji("kitchen"))
      .setStyle(active === "kitchen" && kitchenUnlocked ? ButtonStyle.Success : kitchenStyle),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:fishing:${userId}`)
      .setLabel("Fishing")
      .setEmoji(getButtonEmoji("fishing"))
      .setStyle(active === "fishing" && fishingUnlocked ? ButtonStyle.Success : fishingStyle)
  );
}

function noodleSecondaryMenuRow(userId, { questsAvailable = false } = {}) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:quests:${userId}`).setLabel("Quests").setEmoji(getButtonEmoji("quests")).setStyle(questsAvailable ? ButtonStyle.Success : ButtonStyle.Secondary)
);
}

function noodleProfileEditRow(userId, { specializationsAvailable = false } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`noodle:profile:edit_shop_name:${userId}`).setLabel("Shop Name").setEmoji(getButtonEmoji("note")).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`noodle:profile:edit_tagline:${userId}`).setLabel("Tagline").setEmoji(getButtonEmoji("tag")).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`noodle:nav:specialize:${userId}`).setLabel("Specializations").setEmoji(getButtonEmoji("sparkle")).setStyle(specializationsAvailable ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`noodle:action:store:${userId}`).setLabel("Store").setEmoji(getButtonEmoji("cart")).setStyle(ButtonStyle.Success)
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
  new ButtonBuilder().setCustomId(`noodle:action:quests_vote:${userId}`).setLabel("Vote Rewards").setEmoji(getButtonEmoji("quests")).setStyle(ButtonStyle.Secondary)
);

return row;
}

function noodleQuestsBackRow(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:profile:${userId}`).setLabel("Back").setEmoji(getButtonEmoji("back")).setStyle(ButtonStyle.Secondary)
);
}

function noodleAboutNewsNavRow(userId, { active = "news" } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:nav:news:${userId}`)
      .setLabel("News")
      .setEmoji(getButtonEmoji("new"))
      .setStyle(active === "news" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:about:${userId}`)
      .setLabel("About")
      .setEmoji(getButtonEmoji("sparkle"))
      .setStyle(active === "about" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:season:${userId}`)
      .setLabel("Season")
      .setEmoji(getButtonEmoji("season"))
      .setStyle(active === "season" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:event:${userId}`)
      .setLabel("Event")
      .setEmoji(getButtonEmoji("event"))
      .setStyle(active === "event" ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );
}

function noodleAboutNewsBackRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:nav:profile:${userId}`)
      .setLabel("Back")
      .setEmoji(getButtonEmoji("back"))
      .setStyle(ButtonStyle.Secondary)
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
new ButtonBuilder().setCustomId(`noodle:nav:pantry:${userId}`).setLabel("Pantry").setEmoji(getButtonEmoji("pantry")).setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:profile:${userId}`).setLabel("Profile").setEmoji(getButtonEmoji("profile")).setStyle(ButtonStyle.Secondary)
);
}

function noodleMainMenuRowNoOrdersWithBack(userId) {
return new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:nav:buy:${userId}`).setLabel("Buy").setEmoji(getButtonEmoji("cart")).setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:pantry:${userId}`).setLabel("Pantry").setEmoji(getButtonEmoji("pantry")).setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:profile:${userId}`).setLabel("Profile").setEmoji(getButtonEmoji("profile")).setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(`noodle:nav:orders:${userId}`).setLabel("Back").setEmoji(getButtonEmoji("back")).setStyle(ButtonStyle.Secondary)
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

function noodleOrdersMenuActionRow(userId, {
  showCancel = false,
  highlightAccept = true,
  disableAccept = false,
  disableCook = false,
  disableServe = false,
  showTakeout = false
} = {}) {
const acceptStyle = disableAccept ? ButtonStyle.Secondary : (highlightAccept ? ButtonStyle.Success : ButtonStyle.Secondary);
const row = new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`noodle:pick:accept:${userId}`).setLabel("Accept").setEmoji(getButtonEmoji("status_complete")).setStyle(acceptStyle).setDisabled(disableAccept),
new ButtonBuilder().setCustomId(`noodle:pick:cook:${userId}`).setLabel("Cook").setEmoji(getButtonEmoji("cook")).setStyle(disableCook ? ButtonStyle.Secondary : ButtonStyle.Primary).setDisabled(disableCook),
new ButtonBuilder().setCustomId(`noodle:pick:serve:${userId}`).setLabel("Serve").setEmoji(getButtonEmoji("serve")).setStyle(disableServe ? ButtonStyle.Secondary : ButtonStyle.Primary).setDisabled(disableServe)
);

if (showCancel) {
  row.addComponents(
    new ButtonBuilder().setCustomId(`noodle:pick:cancel:${userId}`).setLabel("Cancel").setEmoji(getButtonEmoji("cancel")).setStyle(ButtonStyle.Danger)
  );
}

if (showTakeout) {
  row.addComponents(
    new ButtonBuilder().setCustomId(`noodle:nav:takeout:${userId}`).setLabel("Takeout").setEmoji(getButtonEmoji("orders")).setStyle(ButtonStyle.Success)
  );
}

return row;
}

function noodleTakeoutActionRow(userId, { activeShift = false, disableOpen = false, disableClaim = false, disableServe = false } = {}) {
  if (activeShift) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:nav:takeout:${userId}`)
        .setLabel("Counter")
        .setEmoji(getButtonEmoji("orders"))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`noodle:nav:takeout_needs:${userId}`)
        .setLabel("Ingredients")
        .setEmoji(getButtonEmoji("basket"))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`noodle:pick:takeout_cook:${userId}`)
        .setLabel("Counter Cook")
        .setEmoji(getButtonEmoji("cook"))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`noodle:pick:takeout_serve:${userId}`)
        .setLabel("Counter Serve")
        .setEmoji(getButtonEmoji("serve"))
        .setStyle(disableServe ? ButtonStyle.Secondary : ButtonStyle.Success)
        .setDisabled(disableServe),
      new ButtonBuilder()
        .setCustomId(`noodle:nav:takeout_claim:${userId}`)
        .setLabel("Claim")
        .setEmoji(getButtonEmoji("coins"))
        .setStyle(disableClaim ? ButtonStyle.Secondary : ButtonStyle.Primary)
        .setDisabled(disableClaim)
    );
  }

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:nav:takeout:${userId}`)
      .setLabel("Counter")
      .setEmoji(getButtonEmoji("orders"))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:takeout_menu:${userId}`)
      .setLabel("Menu")
      .setEmoji(getButtonEmoji("recipes"))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:takeout_open:${userId}`)
      .setLabel("Start Shift")
      .setEmoji(getButtonEmoji("status_complete"))
      .setStyle(disableOpen ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(disableOpen),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:takeout_claim:${userId}`)
      .setLabel("Claim")
      .setEmoji(getButtonEmoji("coins"))
      .setStyle(disableClaim ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(disableClaim)
  );
}

function buildTakeoutMenuPickerRows(userId, {
  availableRecipeIds = [],
  selectedRecipeIds = [],
  minRequired: _minRequired = 1,
  maxAllowed = 1,
  page = 0
} = {}) {
  const pageSize = 25;
  const sortedRecipeIds = [...availableRecipeIds]
    .sort((a, b) => displayRecipeName(a).localeCompare(displayRecipeName(b), undefined, { sensitivity: "base" }))
    .filter(Boolean);

  if (!sortedRecipeIds.length) return null;

  const totalPages = Math.max(1, Math.ceil(sortedRecipeIds.length / pageSize));
  const rawPage = Number.isFinite(page) ? page : 0;
  const safePage = Math.max(0, Math.min(rawPage, totalPages - 1));
  const pageRecipeIds = sortedRecipeIds.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const options = pageRecipeIds
    .map((recipeId) => ({
      label: displayRecipeName(recipeId).slice(0, 100),
      value: recipeId,
      default: selectedRecipeIds.includes(recipeId)
    }));

  const safeMax = Math.max(1, Math.min(maxAllowed, options.length));

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`noodle:takeout:menu_select:${userId}:${safePage}`)
    .setPlaceholder("Pick recipes for your takeout menu")
    .setMinValues(0)
    .setMaxValues(safeMax)
    .addOptions(options);

  const rows = [new ActionRowBuilder().addComponents(menu)];
  if (totalPages > 1) {
    const prevPage = safePage <= 0 ? totalPages - 1 : safePage - 1;
    const nextPage = safePage >= totalPages - 1 ? 0 : safePage + 1;
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`noodle:nav:takeout_menu:${userId}:${prevPage}`)
          .setLabel("Prev")
          .setEmoji(getButtonEmoji("back"))
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`noodle:nav:takeout_menu:${userId}:${nextPage}`)
          .setLabel("Next")
          .setEmoji(getButtonEmoji("next"))
          .setStyle(ButtonStyle.Secondary)
      )
    );
  }

  return { rows, safePage, totalPages };
}

function mergeTakeoutMenuPageSelection({
  availableRecipeIds = [],
  currentSelectedRecipeIds = [],
  pageSelectedRecipeIds = [],
  page = 0,
  maxAllowed = TAKEOUT_MENU_MAX_RECIPES
} = {}) {
  const pageSize = 25;
  const normalizedAvailable = [...availableRecipeIds]
    .map((id) => String(id || "").trim())
    .filter(Boolean)
    .sort((a, b) => displayRecipeName(a).localeCompare(displayRecipeName(b), undefined, { sensitivity: "base" }));
  const availableSet = new Set(normalizedAvailable);

  const totalPages = Math.max(1, Math.ceil(normalizedAvailable.length / pageSize));
  const safePage = Math.max(0, Math.min(Number.isFinite(page) ? page : 0, totalPages - 1));
  const pageRecipeIds = new Set(normalizedAvailable.slice(safePage * pageSize, (safePage + 1) * pageSize));

  const dedupeOrdered = (ids = []) => {
    const out = [];
    const seen = new Set();
    for (const rawId of ids) {
      const id = String(rawId || "").trim();
      if (!id || seen.has(id) || !availableSet.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  };

  const current = dedupeOrdered(currentSelectedRecipeIds);
  const pageSelected = dedupeOrdered(pageSelectedRecipeIds).filter((id) => pageRecipeIds.has(id));
  const keepFromOtherPages = current.filter((id) => !pageRecipeIds.has(id));

  const resolvedMax = Number.isFinite(Number(maxAllowed))
    ? Math.max(0, Math.floor(Number(maxAllowed)))
    : TAKEOUT_MENU_MAX_RECIPES;
  const merged = [...keepFromOtherPages, ...pageSelected].slice(0, resolvedMax);
  return merged;
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

function runPrepChefAutoBuy({
  p,
  s,
  acceptedOrdersNow = [],
  acceptedNow = 0,
  triggerOnOrdersBoard = false,
  includeFailureMessages = true
} = {}) {
  const messages = [];
  const prepChefLevel = Math.max(0, Number(p?.staff_levels?.prep_chef || 0));
  if (prepChefLevel <= 0) return { messages, purchased: false };

  const acceptedOrdersForAutoBuy = (() => {
    const seen = new Set();
    const merged = [];
    const addOrder = (order) => {
      const id = String(order?.order_id || "").trim();
      if (!id || seen.has(id)) return;
      seen.add(id);
      merged.push(order);
    };
    for (const order of acceptedOrdersNow || []) addOrder(order);
    for (const entry of Object.values(p?.orders?.accepted ?? {})) {
      addOrder(entry?.order ?? null);
    }
    return merged;
  })();

  const shouldRun = triggerOnOrdersBoard ? acceptedOrdersForAutoBuy.length > 0 : acceptedNow > 0;
  if (!shouldRun || acceptedOrdersForAutoBuy.length <= 0) {
    return { messages, purchased: false };
  }

  const acceptCap = Math.max(0, Number(getOrderAcceptCap(p, nowTs()) || 0));
  const autoOrderCap = Math.min(acceptedOrdersForAutoBuy.length, prepChefLevel, acceptCap || prepChefLevel);
  if (autoOrderCap <= 0) return { messages, purchased: false };

  const inventoryAvailable = { ...(p.inv_ingredients ?? {}) };
  const stockRemaining = { ...(p.market_stock ?? {}) };
  const unlimitedMarketStock = hasUnlimitedMarketStock(p, nowTs());
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

  for (const order of acceptedOrdersForAutoBuy) {
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

  let autoBuyTargetsProcessed = 0;
  for (const order of acceptedOrdersForAutoBuy) {
    if (autoBuyTargetsProcessed >= autoOrderCap) break;
    const recipe = content.recipes?.[order.recipe_id];
    if (!recipe?.ingredients) continue;

    if ((bowlsRemaining[order.recipe_id] ?? 0) > 0) {
      bowlsRemaining[order.recipe_id] -= 1;
      ordersCovered += 1;
      continue;
    }

    allOrdersAlreadyReady = false;
    autoBuyTargetsProcessed += 1;

    const allItems = [];
    const neededItems = [];
    let orderCost = 0;
    let orderOk = true;

    for (const ing of getRelevantRecipeIngredients(p, recipe)) {
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
        if (!unlimitedMarketStock && stock < missing) {
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

    for (const item of allItems) {
      const usedFromInventory = Math.min(item.need, item.have);
      inventoryAvailable[item.itemId] = Math.max(0, (inventoryAvailable[item.itemId] || 0) - usedFromInventory);
      if (usedFromInventory > 0) {
        const t = item.type;
        remainingByType[t] = (remainingByType[t] ?? 0) + usedFromInventory;
      }
    }

    for (const needItem of neededItems) {
      remainingByType[needItem.type] = Math.max(0, (remainingByType[needItem.type] ?? 0) - needItem.qty);
      if (!unlimitedMarketStock) {
        stockRemaining[needItem.itemId] = Math.max(0, (stockRemaining[needItem.itemId] ?? 0) - needItem.qty);
      }
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
      if (!unlimitedMarketStock) {
        p.market_stock[id] = (p.market_stock[id] ?? 0) - qty;
      }
    }
    p.coins = coinsRemaining;
    messages.push(`${getIcon("chef")} Prep Chef auto-bought: ${purchasedItems} (Total **${totalAutoCost}c**).`);
    return { messages, purchased: true };
  }

  if (!includeFailureMessages) {
    return { messages, purchased: false };
  }

  if (allOrdersAlreadyReady) {
    messages.push(`${getIcon("chef")} Prep Chef skipped auto-buy: accepted orders already have ready bowls.`);
  } else if (blockedByCoins) {
    messages.push(`${getIcon("chef")} Prep Chef could not auto-buy: not enough coins.`);
  } else if (blockedByStock) {
    messages.push(`${getIcon("chef")} Prep Chef could not auto-buy: market stock is sold out for one or more needed items.`);
  } else if (blockedByCapacity) {
    messages.push(`${getIcon("chef")} Prep Chef could not auto-buy: pantry storage is full for one or more ingredient types.`);
  } else if (needsForageOnlyItems && !missingMarketItems) {
    messages.push(`${getIcon("chef")} Prep Chef found only forage/fishing ingredients missing (no market ingredients to auto-buy).`);
  } else {
    messages.push(`${getIcon("chef")} Prep Chef found no market purchases to make for the selected accepted orders.`);
  }

  return { messages, purchased: false };
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
  const availableRecipes = getValidAvailableRecipeIds(player);
  const activeSeason = server?.season ?? null;
  const activeEventId = server?.active_event_id ?? null;
  const seasonFilteredRecipes = availableRecipes.filter((rid) => {
    const r = content.recipes?.[rid];
    if (!r) return false;
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
    const summaryLine = `${getIcon("simmering_pot")} Simmering **${batches.length}/${capacity}** broths${readyBatches.length ? ` — ${readyBatches.length} ready` : ""}${!readyBatches.length && nextReadyMs != null ? ` — next ready ${nextReadyTs ? `<t:${nextReadyTs}:R>` : `in ${formatDurationShort(nextReadyMs)}`}` : ""}`;
    kitchenLines.push(summaryLine);

    if (showNewBrothNotice && unlockedBrothLabels.length > 0) {
      const list = unlockedBrothLabels.join(" · ");
      const suffix = unlockedBrothIds.size > unlockedBrothLabels.length ? " …" : "";
      kitchenLines.push(`${getIcon("sparkle")} New broths unlocked from recipes: ${list}${suffix}`);
    }

    if (batches.length === 0) {
      if (!recipePlans.length) {
        kitchenLines.push(`${getIcon("pot")} No broths are available to simmer yet — unlock broth recipes by progressing and discovering more dishes.`);
      } else {
        kitchenLines.push(`${getIcon("pot")} Select a broth below to start.`);
        if (craftableMax === 0) {
          kitchenLines.push(`${getIcon("pot")} No broths are ready to simmer — forage for ingredients or catch fish to begin.`);
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
        ? `${batchLines.join("\n")}\n${getIcon("simmering_pot")} …and ${extra} more batch${extra === 1 ? "" : "es"}.`
        : batchLines.join("\n");
      kitchenLines.push(`**What’s simmering (by broth)**\n${batchBlock}`);
    }
  }

  if (!player.kitchen) player.kitchen = {};
  player.kitchen.broth_notice_key = unlockedBrothKey;

  if (kitchenUnlocked && batches.length === 0 && craftableMax === 0) {
    const hasEmptyMessage = kitchenLines.some((line) => typeof line === "string" && line.toLowerCase().includes("no broths"));
    if (!hasEmptyMessage) {
      kitchenLines.push(`${getIcon("pot")} No broths are ready to simmer — forage for ingredients or catch fish to begin.`);
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
  const forageIcon = getIcon("forageables");
  const proteinIcon = getIcon("protein");
  const forageValue = [
    "· · · · · · ·",
    `${forageIcon} **${totalForage}** in pantry`,
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
    `${proteinIcon} **${totalProtein}** in pantry`,
    `${proteinList}${proteinFooter}`
  ].filter(Boolean).join("\n");

  const kitchenStatusValue = kitchenLines.join("\n\n") || `${getIcon("pot")} Select a broth below to start.`;
  const descriptionParts = [banner, pendingMessages.length ? pendingMessages.join("\n") : null].filter(Boolean);
  const embed = buildMenuEmbed({
    title: `${getIcon("kitchen")} Kitchen`,
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
        ? `${getIcon("simmering_pot")} All simmer slots are full — collect broths to open space.`
        : `${getIcon("pot")} No broths are ready to simmer — forage for ingredients or catch fish to begin.`;
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
    const prevPage = safePage <= 0 ? totalPages - 1 : safePage - 1;
    const nextPage = safePage >= totalPages - 1 ? 0 : safePage + 1;
    const navRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:nav:kitchen:${userId}:${prevPage}`)
        .setLabel("Prev")
        .setEmoji(getButtonEmoji("back"))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false),
      new ButtonBuilder()
        .setCustomId(`noodle:nav:kitchen:${userId}:${nextPage}`)
        .setLabel("Next")
        .setEmoji(getButtonEmoji("next"))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false)
    );
    components.push(navRow);
  }

  if (readyBatches.length > 0) {
    const collectRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:kitchen:collect:${userId}`)
        .setLabel(`Collect ${readyBatches.length} Ready`)
        .setEmoji(getButtonEmoji("kitchen"))
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

  return { content: " ", ...composeV2FromLegacyEmbeds([embed]), components };
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

function isMissingAccessError(err) {
  if (!err) return false;
  if (Number(err?.code) === 50001) return true;
  const message = String(err?.message || "").toLowerCase();
  return message.includes("missing access");
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

function resolveCanonicalRecipeId(recipeId) {
  const id = String(recipeId ?? "").trim();
  if (!id) return null;
  if (content.recipes?.[id]) return id;

  const aliased = LEGACY_RECIPE_ID_ALIASES[id];
  if (aliased && content.recipes?.[aliased]) return aliased;

  if (id.endsWith("_broth")) {
    const bowlCandidate = `${id.slice(0, -6)}_bowl`;
    if (content.recipes?.[bowlCandidate]) return bowlCandidate;
  }

  return id;
}

function displayRecipeName(recipeId) {
  const canonicalId = resolveCanonicalRecipeId(recipeId);
  const known = canonicalId ? content.recipes?.[canonicalId]?.name : null;
  if (known) return known;
  return String(recipeId ?? "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || "Unknown recipe";
}

function getValidAvailableRecipeIds(player) {
  const seen = new Set();
  const valid = [];

  for (const recipeId of getAvailableRecipes(player)) {
    const canonical = resolveCanonicalRecipeId(recipeId);
    if (!canonical || !content.recipes?.[canonical] || seen.has(canonical)) continue;
    seen.add(canonical);
    valid.push(canonical);
  }

  return valid;
}

function filterRecipeIdsByActiveSeasonEvent(recipeIds, server) {
  const activeSeason = server?.season ?? null;
  const activeEventId = server?.active_event_id ?? null;
  return (recipeIds ?? []).filter((rid) => {
    const recipe = content.recipes?.[rid];
    if (!recipe) return false;
    if (recipe.is_event_recipe) {
      return !!activeEventId && recipe.event_id === activeEventId;
    }
    if (recipe.tier !== "seasonal") return true;
    return !!activeSeason && recipe.season === activeSeason;
  });
}

function migrateLegacyRecipeIds(player) {
  if (!player || typeof player !== "object") return false;
  let changed = false;

  if (Array.isArray(player.known_recipes)) {
    const deduped = [];
    const seen = new Set();

    for (const recipeId of player.known_recipes) {
      const canonical = resolveCanonicalRecipeId(recipeId) ?? recipeId;
      if (canonical !== recipeId) changed = true;
      if (seen.has(canonical)) {
        changed = true;
        continue;
      }
      seen.add(canonical);
      deduped.push(canonical);
    }

    if (changed) {
      player.known_recipes = deduped;
    }
  }

  if (!player.inv_bowls || typeof player.inv_bowls !== "object") return changed;

  const migratedBowls = {};
  for (const [key, bowl] of Object.entries(player.inv_bowls)) {
    if (!bowl || typeof bowl !== "object") {
      migratedBowls[key] = bowl;
      continue;
    }

    const sourceRecipeId = bowl.recipe_id ?? String(key).split(":")[0];
    const canonicalRecipeId = resolveCanonicalRecipeId(sourceRecipeId) ?? sourceRecipeId;
    const canonicalQuality = normalizeQuality(bowl.quality);
    const targetKey = canonicalQuality === "standard"
      ? canonicalRecipeId
      : `${canonicalRecipeId}:${canonicalQuality}`;

    const qty = Math.max(0, Number(bowl.qty || 0));
    if (!qty) {
      changed = true;
      continue;
    }

    const existing = migratedBowls[targetKey];
    if (!existing) {
      migratedBowls[targetKey] = {
        ...bowl,
        recipe_id: canonicalRecipeId,
        quality: canonicalQuality,
        tier: bowl.tier ?? content.recipes?.[canonicalRecipeId]?.tier ?? "common",
        qty
      };
    } else {
      existing.qty = Math.max(0, Number(existing.qty || 0)) + qty;
      const existingCookedAt = Number(existing.cooked_at || 0);
      const nextCookedAt = Number(bowl.cooked_at || 0);
      if (nextCookedAt > existingCookedAt) {
        existing.cooked_at = nextCookedAt;
      }
    }

    if (targetKey !== key || canonicalRecipeId !== sourceRecipeId || canonicalQuality !== normalizeQuality(bowl.quality)) {
      changed = true;
    }
  }

  if (changed) {
    player.inv_bowls = migratedBowls;
  }

  return changed;
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
  migrateLegacyRecipeIds(p);
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
  ensureTakeoutState(p);
  return p;
}

function isTutorialStep(player, stepId) {
  return isTutorialStepFromRouting(player, stepId);
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

  const activePerkTitleIcons = [];
  if (hasUnlimitedMarketStock(player, nowTs())) {
    activePerkTitleIcons.push(getIcon("perk_house_247", getIcon("sparkle")));
  }
  if (hasActivePerk(player, SUBSCRIPTION_PERKS.TAKEOUT_COUNTER, nowTs())) {
    activePerkTitleIcons.push(getIcon("perk_takeout_counter", getIcon("sparkle")));
  }
  const titlePrefix = activePerkTitleIcons.length ? `${activePerkTitleIcons.join(" ")} ` : "";

  const embed = {
    title: `${titlePrefix}${getIcon("profile")} ${player.profile.shop_name}`,
    description,
    color: theme.colors.primary,
    fields: [
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
    ]
  };

  if (decorSetImageUrl) {
    embed.image = { url: decorSetImageUrl };
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

function getSpecializationThumbnailUrl(spec = null) {
  if (!spec) return getIconUrl("decor_set_placeholder");
  const decorSetId = getDecorSetIdForSpec(spec.spec_id);
  return (decorSetId ? getIconUrl(`decor_set_${decorSetId}`) : null)
    ?? getIconUrl(`decor_set_${spec.spec_id}`)
    ?? getIconUrl(`decor_set_${spec.icon}`)
    ?? getIconUrl("decor_set_placeholder");
}

function buildSpecializationListData(player, now = nowTs(), page = 0, pageSize = 5) {
  const state = ensureSpecializationState(player);
  const specs = (specializationsContent?.specializations ?? [])
    .filter((spec) => isSpecializationVisible(player, spec));
  const totalPages = Math.max(1, Math.ceil(specs.length / pageSize));
  const safePage = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);
  const pageSpecs = specs.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const entries = pageSpecs.map((spec) => {
    const isActive = state.active_spec_id === spec.spec_id;
    const check = canSelectSpecialization(player, specializationsContent, spec.spec_id, now);
    const statusLine = isActive
      ? `${getIcon("status_complete")} Equipped`
      : check.ok
        ? "Available"
        : `${getIcon("lock")} ${check.reason}`;

    return {
      specId: spec.spec_id,
      name: spec.name,
      icon: resolveIcon(spec.icon, getIcon("sparkle")),
      description: spec.description ? `_${spec.description}_` : "",
      statusLine,
      thumbnailUrl: getSpecializationThumbnailUrl(spec)
    };
  });

  if (state?.active_spec_id && !specs.some((s) => s.spec_id === state.active_spec_id)) {
    entries.unshift({
      specId: state.active_spec_id,
      name: state.active_spec_id,
      icon: getIcon("sparkle"),
      description: "",
      statusLine: `${getIcon("status_complete")} Equipped`,
      thumbnailUrl: getIconUrl("decor_set_placeholder")
    });
  }

  const selectOptions = specs.slice(0, 25).map((spec) => ({
    label: spec.name?.slice(0, 100) ?? spec.spec_id,
    description: (spec.description ?? "").slice(0, 100) || "No description yet.",
    value: spec.spec_id
  }));

  return {
    entries,
    page: safePage,
    totalPages,
    selectOptions,
    visibleSpecs: specs
  };
}

function buildSpecializationListEmbed(player, ownerUser, now = nowTs(), page = 0, pageSize = 5) {
  const { entries, page: safePage, totalPages } = buildSpecializationListData(player, now, page, pageSize);
  const lines = entries.map((entry) => `${entry.icon} **${entry.name}** — ${entry.statusLine}${entry.description ? `\n${entry.description}` : ""}`);

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

function getProfileV2ButtonEmoji() {
  return {
    orders: getButtonEmoji("orders"),
    cart: getButtonEmoji("cart"),
    pantry: getButtonEmoji("pantry"),
    new: getButtonEmoji("new"),
    party: getButtonEmoji("party"),
    upgrades: getButtonEmoji("upgrades"),
    stats: getButtonEmoji("stats"),
    quests: getButtonEmoji("quests"),
    customize: getButtonEmoji("customize"),
    note: getButtonEmoji("note"),
    tag: getButtonEmoji("tag"),
    sparkle: getButtonEmoji("sparkle"),
    back: getButtonEmoji("back"),
    next: getButtonEmoji("next")
  };
}

function resetTutorialState(player) {
  resetTutorialProgress(player);
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
  if (!knownSet.size) {
    for (const recipeId of STARTER_PROFILE.known_recipes ?? []) {
      knownSet.add(recipeId);
    }
  }
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

function isIngredientOptionalForPlayer(player, ingredient) {
  return Boolean(ingredient?.optional) || isFishingIngredientLocked(player, ingredient?.item_id);
}

function getRelevantRecipeIngredients(player, recipe) {
  return (recipe?.ingredients ?? []).filter((ing) => ing?.item_id && !isFishingIngredientLocked(player, ing.item_id));
}

function formatRecipeNeeds({ recipeId, content: contentBundle, player }) {
const r = contentBundle.recipes?.[recipeId];
if (!r) return "";

  const relevantIngredients = getRelevantRecipeIngredients(player, r);

  const missing = relevantIngredients
    .filter((ing) => !isIngredientOptionalForPlayer(player, ing))
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

function normalizeComponents(rows, flags = 0) {
  if (!Array.isArray(rows)) return rows;
  const isComponentsV2Payload = (Number(flags) & MESSAGE_FLAG_IS_COMPONENTS_V2) !== 0;

  if (isComponentsV2Payload) {
    const normalizeV2Node = (node) => {
      const baseNode = node?.toJSON?.() ?? node;
      if (!baseNode || typeof baseNode !== "object") return null;

      if (!Array.isArray(baseNode.components)) return { ...baseNode };

      const childNodes = baseNode.components
        .map((child) => normalizeV2Node(child))
        .filter(Boolean);
      return { ...baseNode, components: childNodes };
    };

    return rows
      .map((row) => normalizeV2Node(row))
      .filter(Boolean);
  }

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

function normalizePayloadContent(payload = {}) {
  if (!payload || typeof payload !== "object") return payload;
  if (typeof payload.content !== "string") return payload;

  if (payload.content.trim().length > 0) return payload;

  const hasEmbeds = Array.isArray(payload.embeds)
    ? payload.embeds.length > 0
    : Boolean(payload.embeds);
  const hasComponents = Array.isArray(payload.components)
    ? payload.components.length > 0
    : Boolean(payload.components);

  if (hasEmbeds || hasComponents) {
    const { content, ...rest } = payload;
    return rest;
  }

  return { ...payload, content: "\u200b" };
}

function normalizeComponentsV2Payload(payload = {}) {
  if (!payload || typeof payload !== "object") return payload;
  let isV2Payload = (Number(payload.flags) & MESSAGE_FLAG_IS_COMPONENTS_V2) !== 0;
  if (!isV2Payload) {
    const stack = Array.isArray(payload.components) ? [...payload.components] : [];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      const type = Number(node.type);
      if (type === 9 || type === 10 || type === 17) {
        isV2Payload = true;
        break;
      }
      if (Array.isArray(node.components)) stack.push(...node.components);
    }
  }
  if (!isV2Payload) return payload;
  if (!payload.embeds) return payload;

  // Discord rejects embeds when MessageFlags.IS_COMPONENTS_V2 is set.
  const { embeds, ...rest } = payload;
  return rest;
}

function splitTextToV2Chunks(text, maxLen = 3800) {
  const raw = String(text ?? "");
  if (!raw) return [];
  const chunks = [];
  let remaining = raw;
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf("\n", maxLen);
    if (cut <= 0) cut = maxLen;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.trim()) chunks.push(remaining.trim());
  return chunks.filter(Boolean);
}

function normalizeEmbedFieldName(name = "") {
  return String(name ?? "")
    .toLowerCase()
    .replace(/:[a-z0-9_+-]+:/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildProfileEmbedV2Components(raw = {}) {
  const title = String(raw?.title ?? "").trim();
  const description = String(raw?.description ?? "").trim();
  const fields = Array.isArray(raw?.fields) ? raw.fields : [];
  const footerText = sanitizeLegacyFooterForV2(raw?.footer?.text ?? "");
  const imageUrl = String(raw?.image?.url ?? "").trim();
  const thumbnailUrl = String(raw?.thumbnail?.url ?? "").trim();

  const components = [];
  if (title) components.push({ type: 10, content: `## ${title}` });
  if (description) components.push({ type: 10, content: description });

  const fieldMap = new Map();
  for (const field of fields) {
    const normalized = normalizeEmbedFieldName(field?.name);
    const value = String(field?.value ?? "").trim();
    if (!normalized || !value) continue;
    fieldMap.set(normalized, value);
  }

  const bowlsServed = fieldMap.get("bowls served") ?? "-";
  const level = fieldMap.get("level") ?? "-";
  const rep = fieldMap.get("rep") ?? "-";
  const coins = fieldMap.get("coins") ?? "-";

  const statRows = [
    { leftLabel: "Bowls Served", leftValue: bowlsServed, rightLabel: "Level", rightValue: level },
    { leftLabel: "REP", leftValue: rep, rightLabel: "Coins", rightValue: coins }
  ];
  const leftColWidth = Math.max(14, ...statRows.map((row) => Math.max(
    String(row.leftLabel).length,
    String(row.leftValue).length
  )));
  const rightColWidth = Math.max(10, ...statRows.map((row) => Math.max(
    String(row.rightLabel).length,
    String(row.rightValue).length
  )));
  const divider = "  |  ";
  const separator = `${"-".repeat(leftColWidth)}${divider}${"-".repeat(rightColWidth)}`;
  const statLines = [];
  for (let idx = 0; idx < statRows.length; idx += 1) {
    const row = statRows[idx];
    const leftLabel = String(row.leftLabel).padEnd(leftColWidth, " ");
    const rightLabel = String(row.rightLabel).padEnd(rightColWidth, " ");
    const leftValue = String(row.leftValue).padEnd(leftColWidth, " ");
    const rightValue = String(row.rightValue).padEnd(rightColWidth, " ");
    statLines.push(`${leftLabel}${divider}${rightLabel}`);
    statLines.push(`${leftValue}${divider}${rightValue}`);
    if (idx < statRows.length - 1) statLines.push(separator);
  }

  components.push({
    type: 10,
    content: ["```", ...statLines, "```"].join("\n")
  });

  for (const field of fields) {
    const name = String(field?.name ?? "").trim();
    const value = String(field?.value ?? "").trim();
    if (!name && !value) continue;

    const normalized = normalizeEmbedFieldName(name);
    if (normalized === "bowls served" || normalized === "level" || normalized === "rep" || normalized === "coins") {
      continue;
    }

    const block = [name ? `**${name}**` : "", value || "-"].filter(Boolean).join("\n");
    if (block) components.push({ type: 10, content: block });
  }

  if (imageUrl) {
    components.push({
      type: 12,
      items: [{ media: { url: imageUrl } }]
    });
  }
  if (thumbnailUrl) {
    components.push({
      type: 12,
      items: [{ media: { url: thumbnailUrl } }]
    });
  }

  if (footerText) {
    const compactFooter = footerText
      .split("\n")
      .map((line) => String(line ?? "").trim())
      .filter(Boolean)
      .join(" • ");
    if (compactFooter) components.push({ type: 10, content: `-# ${compactFooter}` });
  }

  return components;
}

function isProfileEmbedForV2(raw = {}) {
  const fields = Array.isArray(raw?.fields) ? raw.fields : [];
  if (fields.length < 4) return false;
  const normalized = new Set(fields.map((field) => normalizeEmbedFieldName(field?.name)).filter(Boolean));
  return normalized.has("bowls served")
    && normalized.has("level")
    && normalized.has("rep")
    && normalized.has("coins");
}

function sanitizeLegacyFooterForV2(footerText = "") {
  const raw = String(footerText ?? "").trim();
  if (!raw) return "";

  return raw
    .split("\n")
    .map((line) => String(line ?? "").trim())
    .map((line) => line
      .split("•")
      .map((segment) => String(segment ?? "").trim())
      .filter((segment) => segment && !/^owner\s*:/i.test(segment))
      .join(" • ")
      .trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function legacyEmbedsToV2TextComponents(embeds = []) {
  const out = [];
  for (const embed of embeds || []) {
    const raw = embed?.toJSON?.() ?? embed ?? {};
    if (isProfileEmbedForV2(raw)) {
      out.push(...buildProfileEmbedV2Components(raw));
      continue;
    }

    const title = String(raw?.title ?? "").trim();
    const description = String(raw?.description ?? "").trim();
    const fields = Array.isArray(raw?.fields) ? raw.fields : [];
    const footerText = sanitizeLegacyFooterForV2(raw?.footer?.text ?? "");
    const imageUrl = String(raw?.image?.url ?? "").trim();
    const thumbnailUrl = String(raw?.thumbnail?.url ?? "").trim();

    const blocks = [];
    if (title) blocks.push(`## ${title}`);
    if (description) blocks.push(description);

    for (const field of fields) {
      const name = String(field?.name ?? "").trim();
      const value = String(field?.value ?? "").trim();
      if (!name && !value) continue;
      const block = [name ? `**${name}**` : "", value || "-"].filter(Boolean).join("\n");
      if (block) blocks.push(block);
    }

    if (footerText) {
      const compactFooter = footerText
        .split("\n")
        .map((line) => String(line ?? "").trim())
        .filter(Boolean)
        .join(" • ");
      if (compactFooter) blocks.push(`-# ${compactFooter}`);
    }

    const compact = blocks.join("\n\n").trim();
    const chunks = splitTextToV2Chunks(compact);
    if (chunks.length > 0 && thumbnailUrl) {
      out.push({
        type: 9,
        components: [{ type: 10, content: chunks[0] }],
        accessory: { type: 11, media: { url: thumbnailUrl } }
      });
      for (const chunk of chunks.slice(1)) {
        out.push({ type: 10, content: chunk });
      }
    } else {
      for (const chunk of chunks) {
        out.push({ type: 10, content: chunk });
      }
    }

    if (imageUrl) {
      out.push({
        type: 12,
        items: [{ media: { url: imageUrl } }]
      });
    }
    if (thumbnailUrl && chunks.length === 0) {
      out.push({
        type: 12,
        items: [{ media: { url: thumbnailUrl } }]
      });
    }
  }
  return out;
}

function detectOwnerIdFromComponents(components = []) {
  const stack = Array.isArray(components) ? [...components] : [];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;

    const customId = String(node.custom_id ?? node.customId ?? "").trim();
    if (customId) {
      const match = customId.match(/(?:^|:)(\d{17,20})(?::|$)/);
      if (match?.[1]) return match[1];
    }

    if (Array.isArray(node.components) && node.components.length > 0) {
      stack.push(...node.components);
    }
  }
  return null;
}

function inferNoticeToneFromEmbed(raw = {}) {
  const title = String(raw?.title ?? "").trim().toLowerCase();
  const description = String(raw?.description ?? "").trim().toLowerCase();
  const haystack = `${title}\n${description}`;
  if (/warning|failed|error|lock|cooldown|missing/.test(haystack)) return "warning";
  if (/complete|unlocked|started|success|claimed/.test(haystack)) return "success";
  return "info";
}

function legacyEmbedToNoticeCardSpec(embed) {
  const raw = embed?.toJSON?.() ?? embed ?? {};
  const title = String(raw?.title ?? "").trim() || "Notification";
  const description = String(raw?.description ?? "").trim();
  const fields = Array.isArray(raw?.fields) ? raw.fields : [];
  const footerText = sanitizeLegacyFooterForV2(raw?.footer?.text ?? "");
  const imageUrl = String(raw?.image?.url ?? "").trim();
  const thumbnailUrl = String(raw?.thumbnail?.url ?? "").trim();

  const detailBlocks = [];
  if (description) detailBlocks.push(description);

  for (const field of fields) {
    const name = String(field?.name ?? "").trim();
    const value = String(field?.value ?? "").trim();
    if (!name && !value) continue;
    const block = [name ? `**${name}**` : "", value || "-"].filter(Boolean).join("\n");
    if (block) detailBlocks.push(block);
  }

  if (imageUrl) detailBlocks.push(`Image: ${imageUrl}`);
  if (thumbnailUrl) detailBlocks.push(`Thumbnail: ${thumbnailUrl}`);
  if (footerText) {
    const compactFooter = footerText
      .split("\n")
      .map((line) => String(line ?? "").trim())
      .filter(Boolean)
      .join(" • ");
    if (compactFooter) detailBlocks.push(`-# ${compactFooter}`);
  }

  const compact = detailBlocks.join("\n\n").trim();
  const details = splitTextToV2Chunks(compact);
  return {
    title,
    details,
    tone: inferNoticeToneFromEmbed(raw)
  };
}

function convertLegacyEmbedPayloadToComponentsV2(payload = {}) {
  if (!payload || typeof payload !== "object") return payload;
  const hasSourceNativeComponents = Array.isArray(payload.mainComponents) || Array.isArray(payload.notices);
  if (hasSourceNativeComponents) {
    const normalizedComponentRows = normalizeComponents(payload.components, payload.flags);
    const normalizedRows = (Array.isArray(normalizedComponentRows) ? normalizedComponentRows : [])
      .filter((row) => Number(row?.type) === 1);
    const isEphemeral = payload.ephemeral === true || ((Number(payload.flags) & MessageFlags.Ephemeral) !== 0);
    const ownerId = payload.ownerId || detectOwnerIdFromComponents(normalizedRows);

    const v2Payload = buildComponentsV2PayloadWithNoticeCards({
      mainComponents: [
        ...(Array.isArray(payload.mainComponents) ? payload.mainComponents : []),
        ...normalizedRows
      ],
      notices: Array.isArray(payload.notices) ? payload.notices : [],
      ownerId,
      ephemeral: isEphemeral,
      includeGreenButtonTip: payload.disableGreenButtonTip !== true
    });

    const {
      mainComponents: _mainComponents,
      notices: _notices,
      ownerId: _ownerId,
      components,
      flags,
      ephemeral,
      disableGreenButtonTip,
      ...rest
    } = payload;

    return {
      ...rest,
      ...v2Payload
    };
  }

  if (!Array.isArray(payload.embeds) || payload.embeds.length === 0) return payload;
  if (isComponentsV2Payload(payload)) return payload;

  const normalizedComponentRows = normalizeComponents(payload.components, payload.flags);
  const normalizedRows = (Array.isArray(normalizedComponentRows) ? normalizedComponentRows : [])
    .filter((row) => Number(row?.type) === 1);
  const isEphemeral = payload.ephemeral === true || ((Number(payload.flags) & MessageFlags.Ephemeral) !== 0);
  const ownerId = detectOwnerIdFromComponents(normalizedRows);

  const primaryEmbed = payload.embeds[0];
  const notificationEmbeds = payload.embeds.slice(1);
  const primaryTextComponents = legacyEmbedsToV2TextComponents(primaryEmbed ? [primaryEmbed] : []);
  const notices = notificationEmbeds
    .map((embed) => legacyEmbedToNoticeCardSpec(embed))
    .filter((notice) => (Array.isArray(notice?.details) && notice.details.length > 0) || notice?.title);

  const v2Payload = buildComponentsV2PayloadWithNoticeCards({
    mainComponents: [...primaryTextComponents, ...normalizedRows],
    notices,
    ownerId,
    ephemeral: isEphemeral,
    includeGreenButtonTip: payload.disableGreenButtonTip !== true
  });

  const { embeds, components, flags, ephemeral, disableGreenButtonTip, ...rest } = payload;
  return {
    ...rest,
    ...v2Payload
  };
}

function composeV2FromLegacyEmbeds(embeds = []) {
  const list = Array.isArray(embeds) ? embeds : [];
  const primaryEmbed = list[0] ?? null;
  const notificationEmbeds = list.slice(1);
  return {
    mainComponents: legacyEmbedsToV2TextComponents(primaryEmbed ? [primaryEmbed] : []),
    notices: notificationEmbeds
      .map((embed) => legacyEmbedToNoticeCardSpec(embed))
      .filter((notice) => (Array.isArray(notice?.details) && notice.details.length > 0) || notice?.title)
  };
}

const LEGACY_TO_V2_SUBS = new Set([
  "buy",
  "sell",
  "cook",
  "pantry",
  "help",
  "recipes",
  "regulars",
  "season",
  "event",
  "status",
  "dashboard",
  "giveaway_winner",
  "profile",
  "profile_edit",
  "specialize",
  "decor",
  "decor_sets_spec",
  "store",
  "about",
  "news",
  "takeout",
  "takeout_menu",
  "takeout_open",
  "takeout_claim",
  "takeout_cook",
  "takeout_serve",
  "takeout_needs",
  "forage",
  "forage_menu",
  "fishing",
  "fishing_menu",
  "garden",
  "compost",
  "plant",
  "harvest",
  "kitchen",
  "kitchen_start",
  "kitchen_collect"
]);

function shouldConvertLegacyPayloadToV2ForSub({ sub = "", navSource = "", rolloutEnabled = false, sourceMessageIsV2 = false } = {}) {
  if (sourceMessageIsV2) return true;
  const normalizedSub = String(sub || "").trim();
  const normalizedNavSource = String(navSource || "").trim();
  void rolloutEnabled;
  return LEGACY_TO_V2_SUBS.has(normalizedSub) || LEGACY_TO_V2_SUBS.has(normalizedNavSource) || true;
}

function shouldAutoConvertCommerceComponentPayload(interaction, payload = {}) {
  if (!interaction || !payload || typeof payload !== "object") return false;
  if (!Array.isArray(payload.embeds) || payload.embeds.length === 0) return false;
  if (isComponentsV2Payload(payload)) return false;

  const customId = String(interaction?.customId ?? "").trim();
  const isConvertibleComponent =
    /^noodle:(multibuy|sell):/.test(customId)
    || /^noodle:nav:(orders|buy|sell|pantry|cook|serve|cancel|help|recipes|regulars|season|event|profile|profile_edit|specialize|decor|about|news|takeout|takeout_menu|takeout_open|takeout_claim|takeout_needs|forage|fishing|garden|compost|kitchen):/.test(customId)
    || /^noodle:action:(store):/.test(customId)
    || /^noodle:profile:(edit_shop_name|edit_tagline|specialize_select|specialize_confirm|specialize_cancel):/.test(customId)
    || /^noodle:profile:specialize_pick:/.test(customId)
    || /^noodle:pick:(cook|cook_select|serve|serve_select|cancel|cancel_select|forage_|fishing_)/.test(customId)
    || /^noodle:pick:(takeout_cook|takeout_serve|takeout_cook_select|takeout_serve_select|takeout_cook_qty):/.test(customId)
    || /^noodle:garden:(plant_select|harvest_select):/.test(customId)
    || /^noodle:kitchen:(start|collect):/.test(customId);
  if (!isConvertibleComponent) return false;

  const guildId = interaction?.guildId;
  const userId = interaction?.user?.id;
  if (!guildId || !userId) return false;
  const player = ensurePlayer(guildId, userId);
  return isComponentsV2Enabled({ guildId, userId, player });
}

function buildInteractionFailureContext(interaction, messageId = null) {
  return {
    guildId: interaction?.guildId ?? null,
    channelId: interaction?.channelId ?? interaction?.channel?.id ?? null,
    messageId: messageId ?? interaction?.message?.id ?? null,
    customIdPrefix: getCustomIdPrefix(interaction?.customId ?? null)
  };
}

function isComponentsV2Payload(payload = {}) {
  if (!payload || typeof payload !== "object") return false;
  if ((Number(payload.flags) & MESSAGE_FLAG_IS_COMPONENTS_V2) !== 0) return true;
  const stack = Array.isArray(payload.components) ? [...payload.components] : [];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if ([9, 10, 17].includes(Number(node.type))) return true;
    if (Array.isArray(node.components)) stack.push(...node.components);
  }
  return false;
}

function isInvalidComponentTypeError(error) {
  const message = String(error?.message ?? "");
  return String(error?.code ?? "") === "INVALID_TYPE"
    || message.includes("valid MessageComponentType");
}

function isV2EmbedConflictError(error) {
  const message = String(error?.message ?? "");
  return Number(error?.code) === 50035
    && message.includes("embeds: The 'embeds' field cannot be used when using MessageFlags.IS_COMPONENTS_V2");
}

function toRawWebhookPayload(payload = {}) {
  const out = { ...payload };
  const hasEphemeralFlag = (Number(out.flags) & MessageFlags.Ephemeral) !== 0;
  if (out.ephemeral === true && !hasEphemeralFlag) {
    out.flags = Number(out.flags || 0) | MessageFlags.Ephemeral;
  }
  delete out.ephemeral;
  return out;
}

async function rawWebhookEditOriginal(interaction, payload) {
  const applicationId = interaction?.applicationId || interaction?.client?.user?.id;
  const token = interaction?.token;
  if (!interaction?.client?.api || !applicationId || !token) {
    throw new Error("Raw webhook edit unavailable: missing client api/applicationId/token");
  }
  return interaction.client.api
    .webhooks(applicationId, token)
    .messages("@original")
    .patch({ data: toRawWebhookPayload(payload) });
}

async function rawWebhookFollowUp(interaction, payload) {
  const applicationId = interaction?.applicationId || interaction?.client?.user?.id;
  const token = interaction?.token;
  if (!interaction?.client?.api || !applicationId || !token) {
    throw new Error("Raw webhook followUp unavailable: missing client api/applicationId/token");
  }
  return interaction.client.api
    .webhooks(applicationId, token)
    .post({ data: toRawWebhookPayload(payload) });
}

async function rawChannelEditMessage(interaction, channelId, messageId, payload) {
  if (!interaction?.client?.api || !channelId || !messageId) {
    throw new Error("Raw channel message edit unavailable: missing client api/channelId/messageId");
  }
  return interaction.client.api
    .channels(channelId)
    .messages(messageId)
    .patch({ data: toRawWebhookPayload(payload) });
}

async function componentCommit(interaction, payload) {
let sourcePayload = payload ?? {};
const sourceMessageFlags = Number(interaction?.message?.flags?.bitfield ?? interaction?.message?.flags ?? 0);
const sourceMessageIsV2 = (sourceMessageFlags & MESSAGE_FLAG_IS_COMPONENTS_V2) !== 0;

if (sourceMessageIsV2 && Array.isArray(sourcePayload?.embeds) && sourcePayload.embeds.length > 0) {
  sourcePayload = convertLegacyEmbedPayloadToComponentsV2(sourcePayload);
}

if (shouldAutoConvertCommerceComponentPayload(interaction, sourcePayload)) {
  sourcePayload = convertLegacyEmbedPayloadToComponentsV2(sourcePayload);
}

const { ephemeral, targetMessageId, ...rawRest } = sourcePayload;
let rest = normalizePayloadContent(rawRest);
rest = normalizeComponentsV2Payload(rest);

if (rest.embeds) {
  rest.embeds = sanitizeEmbedsForDiscord(rest.embeds);
}
rest = normalizePayloadContent(rest);
rest = normalizeComponentsV2Payload(rest);

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
      const targetFlags = Number(target?.flags?.bitfield ?? target?.flags ?? 0);
      const targetIsV2 = (targetFlags & MESSAGE_FLAG_IS_COMPONENTS_V2) !== 0;
      // Convert components to JSON if they're builder objects
      let editPayload = { ...rest };
      if (targetIsV2 && Array.isArray(editPayload.embeds) && editPayload.embeds.length > 0) {
        editPayload = convertLegacyEmbedPayloadToComponentsV2(editPayload);
      }
      if (editPayload.components) {
        editPayload.components = normalizeComponents(editPayload.components, editPayload.flags);
      }
      if (editPayload.embeds) {
        editPayload.embeds = sanitizeEmbedsForDiscord(editPayload.embeds);
      }
      editPayload = normalizePayloadContent(editPayload);
      editPayload = normalizeComponentsV2Payload(editPayload);
      // Dismiss the modal response only for modal submits
      if (interaction.isModalSubmit?.() && (interaction.deferred || interaction.replied)) {
        try {
          await interaction.deleteReply();
        } catch (e) {
          // Ignore if already deleted
        }
      }
      if (isComponentsV2Payload(editPayload)) {
        return await rawChannelEditMessage(interaction, target.channelId ?? interaction.channelId, targetMessageId, editPayload);
      }
      return await target.edit(editPayload);
    }
  } catch (e) {
    console.error("Failed to edit target message", {
      ...buildInteractionFailureContext(interaction, targetMessageId),
      errorCode: e?.code ?? null,
      errorMessage: e?.message ?? String(e)
    });
    // Fall through to normal response
  }
}

// Default: non-ephemeral UNLESS explicitly marked as ephemeral
// If payload has components (select menus, etc), don't make it ephemeral unless explicitly requested
const hasComponents = Array.isArray(rest.components) ? rest.components.length > 0 : Boolean(rest.components);
const shouldBeEphemeral = ephemeral === true && !hasComponents;
let options = shouldBeEphemeral ? { ...rest, flags: MessageFlags.Ephemeral, ephemeral: true } : { ...rest };
if (options.embeds) {
  options.embeds = sanitizeEmbedsForDiscord(options.embeds);
}
if (options.components) {
  options.components = normalizeComponents(options.components, options.flags);
}
options = normalizePayloadContent(options);
options = normalizeComponentsV2Payload(options);

if (shouldBeEphemeral) {
  try {
    if (interaction.deferred || interaction.replied) {
      return interaction.followUp(normalizePayloadContent({ ...rest, ephemeral: true }));
    }
    return interaction.reply(normalizePayloadContent({ ...rest, ephemeral: true }));
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
        return await interaction.followUp(normalizePayloadContent({ ...rest, ephemeral: true }));
      } catch (e) {
        console.log(`⚠️ Modal followUp failed:`, e?.message);
        return;
      }
    }
    try {
      return await interaction.reply(normalizePayloadContent({ ...rest, ephemeral: true }));
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
        return await interaction.followUp(normalizePayloadContent({ ...rest, ephemeral: true }));
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
  finalOptions.components = normalizeComponents(finalOptions.components, finalOptions.flags);
}

// Ensure embeds are included in finalOptions and converted to JSON
if (!finalOptions.embeds && rest.embeds) {
  finalOptions.embeds = rest.embeds;
}
if (finalOptions.embeds) {
  const isComponentsV2 = (Number(finalOptions.flags) & MESSAGE_FLAG_IS_COMPONENTS_V2) !== 0;
  if (!isComponentsV2) {
    finalOptions.embeds = applyGreenButtonFooter(finalOptions.embeds, finalOptions.components);
  }
}
// Convert EmbedBuilder objects to JSON
if (finalOptions.embeds) {
  finalOptions.embeds = finalOptions.embeds.map(embed => embed.toJSON?.() ?? embed);
}
finalOptions = normalizePayloadContent(finalOptions);
finalOptions = normalizeComponentsV2Payload(finalOptions);
if ((Number(finalOptions.flags) & MESSAGE_FLAG_IS_COMPONENTS_V2) !== 0 && finalOptions.embeds) {
  const { embeds, ...restFinal } = finalOptions;
  finalOptions = restFinal;
}

// Use editReply for components that were deferred  
if (interaction.deferred || interaction.replied) {
  if (isComponentsV2Payload(finalOptions)) {
    try {
      return await rawWebhookEditOriginal(interaction, finalOptions);
    } catch (rawEditError) {
      console.error("Component raw webhook edit failed", {
        ...buildInteractionFailureContext(interaction),
        errorCode: rawEditError?.code ?? null,
        errorMessage: rawEditError?.message ?? String(rawEditError)
      });
    }
  }
  try {
    return await interaction.editReply(finalOptions);
  } catch (e) {
    if (isV2EmbedConflictError(e) && Array.isArray(finalOptions?.embeds) && finalOptions.embeds.length > 0) {
      try {
        const recovered = normalizeComponentsV2Payload(convertLegacyEmbedPayloadToComponentsV2(finalOptions));
        return await rawWebhookEditOriginal(interaction, recovered);
      } catch (recoverError) {
        console.error("Component V2 embed-conflict recovery failed", {
          ...buildInteractionFailureContext(interaction),
          errorCode: recoverError?.code ?? null,
          errorMessage: recoverError?.message ?? String(recoverError)
        });
      }
    }
    if (isComponentsV2Payload(finalOptions) && isInvalidComponentTypeError(e)) {
      try {
        return await rawWebhookEditOriginal(interaction, finalOptions);
      } catch (rawError) {
        console.error("Component raw webhook edit fallback failed", {
          ...buildInteractionFailureContext(interaction),
          errorCode: rawError?.code ?? null,
          errorMessage: rawError?.message ?? String(rawError)
        });
      }
    }
    console.error("Component editReply failed", {
      ...buildInteractionFailureContext(interaction),
      errorCode: e?.code ?? null,
      errorMessage: e?.message ?? String(e)
    });
    // Try followUp as fallback
    try {
      return await interaction.followUp(normalizePayloadContent({ ...finalOptions, ephemeral: true }));
    } catch (e2) {
      if (isComponentsV2Payload(finalOptions) && isInvalidComponentTypeError(e2)) {
        try {
          return await rawWebhookFollowUp(interaction, normalizePayloadContent({ ...finalOptions, ephemeral: true }));
        } catch (rawError2) {
          console.error("Component raw webhook followUp fallback failed", {
            ...buildInteractionFailureContext(interaction),
            errorCode: rawError2?.code ?? null,
            errorMessage: rawError2?.message ?? String(rawError2)
          });
        }
      }
      console.error("Component followUp fallback also failed", {
        ...buildInteractionFailureContext(interaction),
        errorCode: e2?.code ?? null,
        errorMessage: e2?.message ?? String(e2)
      });
      return;
    }
  }
}

// Last resort fallback - not deferred/replied yet
try {
  return await interaction.update(finalOptions);
} catch (e) {
  console.error("Component update failed", {
    ...buildInteractionFailureContext(interaction),
    errorCode: e?.code ?? null,
    errorMessage: e?.message ?? String(e)
  });
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

function computeMarketShoppingShortages(player, _serverState) {
  const acceptedEntries = Object.entries(player.orders?.accepted ?? {});
  const allNeeded = {};
  let hasTakeoutOrders = false;

  const neededCountsByRecipe = {};
  acceptedEntries.forEach(([, entry]) => {
    const recipeId = entry?.order?.recipe_id;
    if (!recipeId) return;
    neededCountsByRecipe[recipeId] = (neededCountsByRecipe[recipeId] ?? 0) + 1;
  });

  for (const [recipeId, neededCount] of Object.entries(neededCountsByRecipe)) {
    const recipe = content.recipes[recipeId];
    if (!recipe?.ingredients) continue;

    const ready = getTotalBowlsForRecipe(player, recipeId);
    const remaining = Math.max(0, neededCount - ready);
    if (remaining <= 0) continue;

    getRelevantRecipeIngredients(player, recipe).forEach((ing) => {
      allNeeded[ing.item_id] = (allNeeded[ing.item_id] ?? 0) + (ing.qty * remaining);
    });
  }

  const takeoutState = ensureTakeoutState(player);
  const takeoutActive = isTakeoutShiftActive(player, nowTs());
  if (takeoutActive) {
    const takeoutAllNeedRows = getTakeoutRecipeNeedRows(player, takeoutState);
    hasTakeoutOrders = takeoutAllNeedRows.some((entry) => entry.need > 0);
    const takeoutNeedRows = takeoutAllNeedRows.filter((entry) => entry.short > 0);
    for (const entry of takeoutNeedRows) {
      const recipe = content.recipes?.[entry.recipeId];
      if (!recipe?.ingredients) continue;
      getRelevantRecipeIngredients(player, recipe).forEach((ing) => {
        if (isIngredientOptionalForPlayer(player, ing)) return;
        const qty = Math.max(0, Math.floor(Number(ing?.qty || 0) || 0));
        if (qty <= 0) return;
        allNeeded[ing.item_id] = (allNeeded[ing.item_id] ?? 0) + (qty * entry.short);
      });
    }
  }

  const shortages = Object.entries(allNeeded)
    .map(([id, needed]) => {
      const have = player.inv_ingredients?.[id] ?? 0;
      const short = Math.max(0, needed - have);
      return { id, needed, have, short };
    })
    .filter((s) => s.short > 0);

  const shoppingShortages = shortages.filter(
    (s) => MARKET_ITEM_IDS.includes(s.id) && !FORAGE_ITEM_IDS.includes(s.id)
  );

  return {
    acceptedEntries,
    shortages,
    shoppingShortages,
    takeoutActive,
    hasActiveOrders: acceptedEntries.length > 0 || hasTakeoutOrders
  };
}

function buildMultiBuyPickerPayload({ userId, p, s, ownerUser, page = 0, showSellButton = true }) {
  if (!s.market_prices) s.market_prices = {};
  if (!p.market_stock) p.market_stock = {};
  const unlimitedMarketStock = hasUnlimitedMarketStock(p, nowTs());

  const allowed = getUnlockedIngredientIds(p, content);

  const allOpts = (MARKET_ITEM_IDS ?? [])
    .map((id) => {
      if (!allowed.has(id)) return null;

      const it = content.items?.[id];
      if (!it) return null;

      const price = s.market_prices?.[id] ?? it.base_price ?? 0;
      const stock = unlimitedMarketStock ? "unlimited" : (p.market_stock?.[id] ?? 0);
      if (!unlimitedMarketStock && Number(stock) <= 0) return null;

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
  const marketRestockLine = unlimitedMarketStock
    ? ""
    : `\n${getIcon("refresh")} Market restocks <t:${marketRestockTs}:f> (<t:${marketRestockTs}:R>).`;

  if (!opts.length) {
    const emptyEmbed = buildMenuEmbed({
      title: `${getIcon("cart")} Multi-buy`,
      description: `${getIcon("cart")} No market items are available for your unlocked recipes right now.${marketRestockLine ? `\n\n${marketRestockLine}` : ""}`,
      user: ownerUser
    });
    if (marketRestockLine) {
      emptyEmbed.setTimestamp(new Date(marketRestockMs));
    }
    return {
      content: " ",
      ...composeV2FromLegacyEmbeds([emptyEmbed]),
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
          .setCustomId(`noodle:nav:buy:${userId}:${safePage <= 0 ? totalPages - 1 : safePage - 1}`)
          .setLabel("Prev")
          .setEmoji(getButtonEmoji("back"))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(false),
        new ButtonBuilder()
          .setCustomId(`noodle:nav:buy:${userId}:${safePage >= totalPages - 1 ? 0 : safePage + 1}`)
          .setLabel("Next")
          .setEmoji(getButtonEmoji("next"))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(false)
      )
    : null;

  const { acceptedEntries, shortages, shoppingShortages, takeoutActive } = computeMarketShoppingShortages(p, s);

  const showShoppingList = acceptedEntries.length > 0 || takeoutActive;
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
    unlimitedMarketStock ? `${getHouse247Label()} active: market stock is **unlimited**.` : null,
    shoppingList ? "" : null,
    shoppingList,
    marketRestockLine ? "" : null,
    marketRestockLine || null
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
  const footerButtons = [];
  if (showSellButton) {
    footerButtons.push(
      new ButtonBuilder()
        .setCustomId(`noodle:nav:sell:${userId}`)
        .setLabel("Sell Items").setEmoji(getButtonEmoji("coins"))
        .setStyle(ButtonStyle.Secondary)
    );
  }
  footerButtons.push(
    new ButtonBuilder()
      .setCustomId(`noodle:nav:profile:${userId}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  );
  rows.push(new ActionRowBuilder().addComponents(...footerButtons));

  return {
    content: " ",
    ...composeV2FromLegacyEmbeds([buyEmbed]),
    components: rows
  };
}

function buildSellQuantityRow(userId, selectedIds, page, selectionToken = null) {
  const ids = (selectedIds ?? []).filter(Boolean).slice(0, 5);
  const safePage = Number.isFinite(page) ? Number(page) : 0;
  const joined = ids.join(",");

  const legacySell1Id = `noodle:sell:sell1:${userId}:${safePage}:${joined}`;
  const legacySell5Id = `noodle:sell:sell5:${userId}:${safePage}:${joined}`;
  const legacySell10Id = `noodle:sell:sell10:${userId}:${safePage}:${joined}`;
  const canUseEmbeddedIds = [legacySell1Id, legacySell5Id, legacySell10Id].every((id) => id.length <= 100);

  let sell1Id = legacySell1Id;
  let sell5Id = legacySell5Id;
  let sell10Id = legacySell10Id;

  if (!canUseEmbeddedIds) {
    const token = selectionToken || makeSelectionToken();
    sellSelectionCacheV2.set(token, {
      userId,
      selectedIds: ids,
      page: safePage,
      expiresAt: Date.now() + SELECTION_CACHE_TTL_MS
    });

    sell1Id = `noodle:sell:sell1:${userId}:${token}`;
    sell5Id = `noodle:sell:sell5:${userId}:${token}`;
    sell10Id = `noodle:sell:sell10:${userId}:${token}`;
  }

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(sell1Id)
      .setLabel("Sell 1 each")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(sell5Id)
      .setLabel("Sell 5 each")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(sell10Id)
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
          .setCustomId(`noodle:nav:sell:${userId}:${safePage <= 0 ? totalPages - 1 : safePage - 1}`)
          .setLabel("Prev")
          .setEmoji(getButtonEmoji("back"))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(false),
        new ButtonBuilder()
          .setCustomId(`noodle:nav:sell:${userId}:${safePage >= totalPages - 1 ? 0 : safePage + 1}`)
          .setLabel("Next")
          .setEmoji(getButtonEmoji("next"))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(false)
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
    ...composeV2FromLegacyEmbeds([sellEmbed]),
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
  applyHouse247OrderBoardOverride(p);

  const pageSize = 25;
  const { totalCount, consumedSet, availableCount } = getOrdersMeta(p);
  const totalPages = Math.max(1, Math.ceil(Math.max(0, totalCount) / pageSize));
  const rawPage = Number.isFinite(page) ? page : 0;
  const requestedPage = rawPage < 0 ? totalPages - 1 : Math.max(0, rawPage);
  const boundedPage = Math.min(requestedPage, totalPages - 1);
  const availablePageSet = new Set();
  if (availableCount > 0) {
    for (let idx = 0; idx < totalCount; idx++) {
      if (consumedSet.has(idx)) continue;
      availablePageSet.add(Math.floor(idx / pageSize));
      if (availablePageSet.size >= totalPages) break;
    }
  }
  const availablePages = Array.from(availablePageSet).sort((a, b) => a - b);
  let safePage = boundedPage;
  if (availablePages.length > 0) {
    safePage = availablePageSet.has(boundedPage) ? boundedPage : availablePages[0];
  }

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

  // If the requested page is empty but there are still available orders, jump to a page with orders
  if (!pageData.orders.length && availableCount > 0) {
    let fallbackPage = null;
    if (availablePages.length > 0) {
      fallbackPage = availablePages[0];
    } else {
      for (let i = 0; i < totalCount; i++) {
        if (!consumedSet.has(i)) {
          fallbackPage = Math.floor(i / pageSize);
          break;
        }
      }
    }
    if (fallbackPage !== null && fallbackPage !== safePage) {
      safePage = fallbackPage;
      pageData = loadPage(safePage);
    }
  }

  if (!pageData.orders.length) {
    clearAcceptOrderDraftSelection({ serverId, userId });
    return { content: "No orders available to accept.", ephemeral: true };
  }

  const availableOrderIds = [];
  const pageOrderIdsByPage = new Map();
  const pagesToScan = availablePages.length > 0 ? availablePages : [safePage];
  for (const pg of pagesToScan) {
    const data = Number(pg) === safePage ? pageData : loadPage(pg);
    const pageOrderIds = (data?.orders ?? []).map((o) => String(o.order_id));
    pageOrderIdsByPage.set(Number(pg), pageOrderIds);
    availableOrderIds.push(...pageOrderIds);
  }

  const selectedOrderIds = readAcceptOrderDraftSelection({
    serverId,
    userId,
    availableOrderIds
  });
  const selectedSet = new Set(selectedOrderIds);

  const opts = pageData.orders.map((o) => {
    const rName = content.recipes[o.recipe_id]?.name ?? "a dish";
    const npcName = content.npcs[o.npc_archetype]?.name ?? "a customer";
    const readyBowls = getTotalBowlsForRecipe(p, o.recipe_id);
    const labelRaw = `${shortOrderId(o.order_id)} — ${readyBowls} ready — ${rName}`;
    const label = labelRaw.length > 100 ? labelRaw.slice(0, 97) + "…" : labelRaw;
    const descRaw = `${npcName}`;
    const description = descRaw.length > 100 ? descRaw.slice(0, 97) + "…" : descRaw;
    const option = { label, value: String(o.order_id), description, default: selectedSet.has(String(o.order_id)) };
    if (readyBowls > 0) {
      const emoji = getButtonEmoji("status_complete");
      if (emoji) option.emoji = emoji;
    }
    return option;
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`noodle:pick:accept_select:${userId}:${safePage}`)
    .setPlaceholder("Select orders to accept (up to 5)")
    .setMinValues(1)
    .setMaxValues(Math.min(5, opts.length))
    .addOptions(opts);

  const navigablePages = availablePages.length > 1 ? availablePages : null;
  let navRow = null;
  if (navigablePages) {
    const currentIndex = Math.max(0, navigablePages.indexOf(safePage));
    const prevIndex = (currentIndex - 1 + navigablePages.length) % navigablePages.length;
    const nextIndex = (currentIndex + 1) % navigablePages.length;
    const prevTarget = navigablePages[prevIndex];
    const nextTarget = navigablePages[nextIndex];
    navRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:pick:accept:${userId}:${prevTarget}`)
        .setLabel("Prev")
        .setEmoji(getButtonEmoji("back"))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`noodle:pick:accept:${userId}:${nextTarget}`)
        .setLabel("Next")
        .setEmoji(getButtonEmoji("next"))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false)
    );
  }

  const rows = [new ActionRowBuilder().addComponents(menu)];
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:pick:accept_commit:${userId}`)
        .setLabel(`Accept Selected (${selectedOrderIds.length})`)
        .setStyle(selectedOrderIds.length > 0 ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(selectedOrderIds.length === 0),
      new ButtonBuilder()
        .setCustomId(`noodle:pick:accept_clear:${userId}:${safePage}`)
        .setLabel("Clear Selection")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(selectedOrderIds.length === 0)
    )
  );
  if (navRow) rows.push(navRow);
  const showBackButton = resolveTutorialGateValue({
    player: p,
    gate: "acceptPickerShowBackButton",
    fallbackValue: true
  });
  if (showBackButton) {
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
    description: `Select orders across pages, then use **Accept Selected**.\nSelected now: **${selectedOrderIds.length}**.\nWhen you're done selecting, if on Desktop, press **Esc** to continue.`,
    user: ownerUser
  });

  const pageLabel = `Page ${safePage + 1}/${totalPages}`;
  const existingFooter = acceptEmbed?.data?.footer?.text ?? acceptEmbed?.footer?.text ?? "";
  const footerText = existingFooter ? `${pageLabel} • ${existingFooter}` : pageLabel;
  acceptEmbed.setFooter({ text: footerText });

  return {
    content: " ",
    ...composeV2FromLegacyEmbeds([acceptEmbed]),
    components: rows
  };
}

function buildCancelServePickerPayload({ action, userId, serverId, p, ownerUser, page = 0 }) {
  const accepted = Object.entries(p.orders?.accepted ?? {});
  const hasAcceptedOrders = accepted.length > 0;
  const canServeAll = action === "serve" ? canServeAllOrders(p) : false;
  const availableOrderIds = accepted.map(([oid]) => String(oid));

  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(Math.max(0, accepted.length) / pageSize));
  const safePage = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);
  const pagedAccepted = accepted.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const pageOrderIds = pagedAccepted.map(([oid]) => String(oid));
  const cancelSelectedOrderIds = action === "cancel"
    ? readCancelOrderDraftSelection({ serverId, userId, availableOrderIds })
    : [];
  const cancelSelectedSet = new Set(cancelSelectedOrderIds);

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
      const rName = displayRecipeName(recipeId);
      const short = need - ready;
      return `• ${rName} — need **${need}**, ready **${ready}** (cook **${short}** more)`;
    })
    .filter(Boolean);

  const opts = pagedAccepted.map(([oid, entry]) => {
    const snap = entry?.order ?? null;
    const rName = snap ? displayRecipeName(snap.recipe_id) : "Unknown Recipe";
    const npcName = snap ? (content.npcs[snap.npc_archetype]?.name ?? snap.npc_archetype) : "Unknown NPC";
    const labelRaw = `${shortOrderId(oid)} — ${rName}`;
    const label = labelRaw.length > 100 ? labelRaw.slice(0, 97) + "…" : labelRaw;
    const descRaw = `${npcName}`;
    const description = descRaw.length > 100 ? descRaw.slice(0, 97) + "…" : descRaw;
    const ready = entry?.order?.recipe_id ? getTotalBowlsForRecipe(p, entry.order.recipe_id) > 0 : false;
    const option = {
      label,
      value: oid,
      description,
      ...(action === "cancel" ? { default: cancelSelectedSet.has(String(oid)) } : {})
    };
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
    .setCustomId(`noodle:pick:${action}_select:${userId}:${safePage}`)
    .setPlaceholder(action === "serve" ? "Select orders to serve" : "Select orders to cancel")
    .setMinValues(1)
    .setMaxValues(action === "serve" ? Math.min(5, opts.length) : Math.min(25, opts.length))
    .addOptions(opts);

  const navRow = totalPages > 1
    ? new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`noodle:pick:${action}:${userId}:${safePage <= 0 ? totalPages - 1 : safePage - 1}`)
          .setLabel("Prev")
          .setEmoji(getButtonEmoji("back"))
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`noodle:pick:${action}:${userId}:${safePage >= totalPages - 1 ? 0 : safePage + 1}`)
          .setLabel("Next")
          .setEmoji(getButtonEmoji("next"))
          .setStyle(ButtonStyle.Secondary)
      )
    : null;

  const actionTitle = action === "serve"
    ? `${getIcon("bowl")} Serve Orders`
    : `${getIcon("cancel")} Cancel Order`;
  const actionDesc = action === "serve"
    ? "Select accepted orders to serve.\nWhen you're done selecting, if on Desktop, press **Esc** to continue."
    : "Select accepted orders to cancel.\nWhen you're done selecting, if on Desktop, press **Esc** to continue.";
  const descWithMissing = missingLines.length
    ? `${actionDesc}\n\n${getIcon("basket")} Missing bowls\n${missingLines.join("\n")}`
    : actionDesc;

  const actionEmbed = buildMenuEmbed({ title: actionTitle, description: descWithMissing, user: ownerUser });
  actionEmbed.setFooter({ text: `Page ${safePage + 1}/${totalPages}` });
  const showOrdersActions = action === "serve"
    ? resolveTutorialGateValue({ player: p, gate: "servePickerShowOrdersActions", fallbackValue: true })
    : true;

  const components = [new ActionRowBuilder().addComponents(menu)];
  if (action === "cancel") {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`noodle:pick:cancel_commit:${userId}`)
          .setLabel(`Cancel Selected (${cancelSelectedOrderIds.length})`)
          .setStyle(cancelSelectedOrderIds.length > 0 ? ButtonStyle.Danger : ButtonStyle.Secondary)
          .setDisabled(cancelSelectedOrderIds.length === 0),
        new ButtonBuilder()
          .setCustomId(`noodle:pick:cancel_clear:${userId}:${safePage}`)
          .setLabel("Clear Selection")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(cancelSelectedOrderIds.length === 0)
      )
    );
  }
  if (navRow) components.push(navRow);
  if (showOrdersActions) {
    components.push(
      action === "serve"
        ? noodleOrdersActionRowWithBack(userId, {
            highlightAccept: !hasAcceptedOrders,
            disableServe: !hasAcceptedOrders,
            showServeAll: true,
            disableServeAll: !canServeAll
          })
        : noodleOrdersActionRow(userId, { highlightAccept: !hasAcceptedOrders, disableServe: !hasAcceptedOrders })
    );
  }

  return {
    content: " ",
    ...composeV2FromLegacyEmbeds([actionEmbed]),
    components
  };
}

function buildAcceptPickerSceneEntries({ serverId, userId, p, s, page = 0, pageSize = 7 }) {
  const set = buildSettingsMap(settingsCatalog, s.settings);
  s.season = computeActiveSeason(set);
  const activeEventEffects = getActiveEventEffects(eventsContent, s);
  const activeEventId = s.active_event_id ?? null;
  rollMarket({ serverId, content, serverState: s, eventEffects: activeEventEffects });
  ensureDailyOrdersForPlayer(p, set, content, s.season, serverId, userId, activeEventId);
  applyHouse247OrderBoardOverride(p);

  const acceptedOrderIds = new Set(Object.keys(p.orders?.accepted ?? {}).map((id) => String(id || "").trim()).filter(Boolean));
  const { totalCount, consumedSet } = getOrdersMeta(p);
  const totalBoardPages = Math.max(1, Math.ceil(Math.max(0, totalCount) / 25));
  const availableBoardPages = [];
  for (let idx = 0; idx < totalCount; idx += 1) {
    if (consumedSet.has(idx)) continue;
    const pageIdx = Math.floor(idx / 25);
    if (!availableBoardPages.includes(pageIdx)) availableBoardPages.push(pageIdx);
  }

  const orderTokenByShortId = {};
  const allEntries = [];
  const pagesToScan = availableBoardPages.length > 0 ? availableBoardPages : Array.from({ length: totalBoardPages }, (_, idx) => idx);
  for (const boardPage of pagesToScan) {
    const pageData = generateOrderPageForPlayer({
      playerState: p,
      settings: set,
      content,
      activeSeason: s.season,
      serverId,
      userId,
      activeEventId,
      page: boardPage,
      pageSize: 25
    });
    for (const o of pageData?.orders ?? []) {
      const fullOrderId = String(o?.order_id || "").trim();
      if (!fullOrderId || acceptedOrderIds.has(fullOrderId)) continue;
      const shortId = shortOrderId(fullOrderId);
      orderTokenByShortId[shortId] = fullOrderId;
      const recipeName = content.recipes[o.recipe_id]?.name ?? "a dish";
      const npcName = content.npcs[o.npc_archetype]?.name ?? "a customer";
      const ready = getTotalBowlsForRecipe(p, o.recipe_id);
      allEntries.push({
        shortId,
        recipeId: String(o.recipe_id || "").trim(),
        line: `\`${shortId}\` • **${recipeName}** — *${npcName}* (${o.tier}) • ready bowls: **${ready}**`
      });
    }
  }

  allEntries.sort((a, b) => String(a.shortId).localeCompare(String(b.shortId)));
  const safePageSize = Math.max(1, Math.floor(Number(pageSize) || 10));
  const totalPages = Math.max(1, Math.ceil(allEntries.length / safePageSize));
  const safePage = Math.max(0, Math.min(Math.floor(Number(page) || 0), totalPages - 1));
  const entries = allEntries.slice(safePage * safePageSize, (safePage + 1) * safePageSize);

  return { entries, orderTokenByShortId, page: safePage, totalPages };
}

export function normalizeAcceptPickerSelectedShortIds({ selectedShortIds = [], orderTokenByShortId = {} } = {}) {
  const selectableShortIds = new Set(
    Object.keys(orderTokenByShortId || {})
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );
  return (selectedShortIds || [])
    .map((id) => String(id || "").trim())
    .filter((id, index, arr) => Boolean(id) && selectableShortIds.has(id) && arr.indexOf(id) === index);
}

function buildAcceptPickerScenePayload({ serverId, userId, p, s, selectedShortIds = [], statusLine = "", page = 0 }) {
  const tutorialSingleAcceptMode = isTutorialStepFromRouting(p, "intro_order");
  const { entries, orderTokenByShortId, page: safePage, totalPages } = buildAcceptPickerSceneEntries({ serverId, userId, p, s, page });
  const allSelectableShortIds = new Set(Object.keys(orderTokenByShortId).map((id) => String(id || "").trim()).filter(Boolean));

  const scopedEntries = (() => {
    if (!tutorialSingleAcceptMode) return entries;
    const preferred = entries.find((entry) => String(entry?.recipeId ?? "") === "classic_soy_ramen");
    if (preferred) return [preferred];
    return entries.slice(0, 1);
  })();

  const scopedOrderTokenByShortId = scopedEntries.reduce((acc, entry) => {
    const sid = String(entry?.shortId ?? "").trim();
    const full = String(orderTokenByShortId?.[sid] ?? "").trim();
    if (sid && full) acc[sid] = full;
    return acc;
  }, {});

  const normalizedSelected = normalizeAcceptPickerSelectedShortIds({
    selectedShortIds,
    orderTokenByShortId: tutorialSingleAcceptMode ? scopedOrderTokenByShortId : orderTokenByShortId
  });

  const sceneState = putSceneState({
    sceneKey: "orders.accept_picker",
    ownerId: userId,
    state: {
      entries,
      orderTokenByShortId: scopedOrderTokenByShortId,
      selectableOrderTokenByShortId: tutorialSingleAcceptMode ? scopedOrderTokenByShortId : orderTokenByShortId,
      selectedShortIds: normalizedSelected,
      page: safePage,
      totalPages,
      tutorialSingleAcceptMode
    }
  });

  return buildAcceptPickerV2Message({
    userId,
    token: sceneState.token,
    entries: scopedEntries,
    selectedShortIds: normalizedSelected,
    statusLine,
    currentPage: safePage,
    totalPages: tutorialSingleAcceptMode ? 1 : totalPages,
    directAcceptMode: tutorialSingleAcceptMode,
    tutorialSingleAcceptMode
  });
}

function resolveTutorialCookRecipeId(player) {
  const acceptedRecipeIds = Object.values(player?.orders?.accepted ?? {})
    .map((entry) => String(entry?.order?.recipe_id || "").trim())
    .filter(Boolean);

  if (acceptedRecipeIds.includes("classic_soy_ramen")) return "classic_soy_ramen";
  if (acceptedRecipeIds.length > 0) return acceptedRecipeIds[0];

  const knownRecipeIds = getValidAvailableRecipeIds(player)
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  if (knownRecipeIds.includes("classic_soy_ramen")) return "classic_soy_ramen";
  return knownRecipeIds[0] ?? "";
}

function buildCookRecipePickerSceneEntries({ p, s }) {
  const available = getValidAvailableRecipeIds(p);
  const seasonFiltered = filterRecipeIdsByActiveSeasonEvent(available, s);

  const sortKey = (rid) => {
    const r = content.recipes?.[rid];
    return (r?.name ?? displayItemName(rid, content) ?? "").toLowerCase();
  };

  const sorted = [...seasonFiltered].sort((a, b) => sortKey(a).localeCompare(sortKey(b), "en", { sensitivity: "base" }));

  const neededByRecipe = {};
  Object.values(p.orders?.accepted ?? {}).forEach((entry) => {
    const recipeId = String(entry?.order?.recipe_id || "").trim();
    if (!recipeId) return;
    neededByRecipe[recipeId] = (neededByRecipe[recipeId] ?? 0) + 1;
  });

  return sorted.map((rid) => {
    const recipeId = String(rid || "").trim();
    const recipe = content.recipes?.[recipeId] ?? null;
    const recipeName = recipe?.name ?? displayItemName(recipeId, content);
    const relevantIngredients = getRelevantRecipeIngredients(p, recipe);
    const maxCookable = relevantIngredients
      .filter((ing) => !isIngredientOptionalForPlayer(p, ing) && (ing?.qty ?? 0) > 0)
      .map((ing) => Math.floor((p.inv_ingredients?.[ing.item_id] ?? 0) / (ing.qty ?? 1)))
      .reduce((min, cur) => Math.min(min, cur), Infinity);
    const cookable = Number.isFinite(maxCookable) ? Math.max(0, maxCookable) : 0;
    const need = neededByRecipe[recipeId] ?? 0;
    const ready = getTotalBowlsForRecipe(p, recipeId);
    const short = Math.max(0, need - ready);
    const needLine = short > 0 ? ` • needs **${short}**` : "";

    return {
      recipeId,
      recipeName,
      tier: String(recipe?.tier ?? "standard"),
      need,
      ready,
      short,
      line: `**${recipeName}** (${recipe?.tier ?? "standard"}) • ready **${ready}** • max now **${cookable}**${needLine}`,
      cookable
    };
  });
}

function buildCookAllPlanForAcceptedOrders(p) {
  const neededByRecipe = {};
  Object.values(p.orders?.accepted ?? {}).forEach((entry) => {
    const recipeId = String(entry?.order?.recipe_id || "").trim();
    if (!recipeId) return;
    neededByRecipe[recipeId] = (neededByRecipe[recipeId] ?? 0) + 1;
  });

  const plan = Object.entries(neededByRecipe)
    .map(([recipeId, need]) => {
      const ready = getTotalBowlsForRecipe(p, recipeId);
      const quantity = Math.max(0, need - ready);
      return {
        recipeId,
        need,
        ready,
        quantity
      };
    })
    .filter((row) => row.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity || String(a.recipeId).localeCompare(String(b.recipeId)));

  const requiredByItem = {};
  for (const row of plan) {
    const recipe = content.recipes?.[row.recipeId] ?? null;
    const relevantIngredients = getRelevantRecipeIngredients(p, recipe)
      .filter((ing) => !isIngredientOptionalForPlayer(p, ing) && (ing?.qty ?? 0) > 0);
    for (const ing of relevantIngredients) {
      const perBowlQty = Math.max(0, Number(ing?.qty) || 0);
      if (perBowlQty <= 0) continue;
      requiredByItem[ing.item_id] = (requiredByItem[ing.item_id] ?? 0) + (perBowlQty * row.quantity);
    }
  }

  const shortages = Object.entries(requiredByItem)
    .map(([itemId, needed]) => {
      const have = Math.max(0, Math.floor(Number(p.inv_ingredients?.[itemId] || 0) || 0));
      const short = Math.max(0, needed - have);
      return {
        itemId,
        needed,
        have,
        short
      };
    })
    .filter((row) => row.short > 0)
    .sort((a, b) => b.short - a.short || String(a.itemId).localeCompare(String(b.itemId)));

  const combinedEffects = calculateCombinedEffects(p, upgradesContent, staffContent, calculateStaffEffects);
  const bowlCap = getBowlCapacity(p, combinedEffects);
  const bowlCount = getBowlCount(p);
  const remainingBowls = Math.max(0, bowlCap - bowlCount);
  const totalQuantity = plan.reduce((sum, row) => sum + row.quantity, 0);
  const hasIngredients = shortages.length === 0;
  const hasCapacity = remainingBowls >= totalQuantity;
  const canCookAll = totalQuantity > 0 && hasIngredients && hasCapacity;

  const summaryLines = plan.map((row) => {
    const recipeName = displayRecipeName(row.recipeId);
    return `• ${recipeName} — need **${row.need}**, ready **${row.ready}** (cook **${row.quantity}** more)`;
  });

  return {
    plan,
    totalQuantity,
    shortages,
    remainingBowls,
    canCookAll,
    summaryLines
  };
}

function allocateSuccessBowlsAcrossPlan(plan = [], totalSuccess = 0) {
  const safePlan = (plan || [])
    .map((row) => ({
      recipeId: String(row?.recipeId || "").trim(),
      quantity: Math.max(0, Math.floor(Number(row?.quantity) || 0))
    }))
    .filter((row) => row.recipeId && row.quantity > 0);
  const totalQuantity = safePlan.reduce((sum, row) => sum + row.quantity, 0);
  const cappedSuccess = Math.max(0, Math.min(totalQuantity, Math.floor(Number(totalSuccess) || 0)));
  if (safePlan.length <= 0 || totalQuantity <= 0 || cappedSuccess <= 0) {
    return Object.fromEntries(safePlan.map((row) => [row.recipeId, 0]));
  }

  const allocations = safePlan.map((row, idx) => {
    const exact = (row.quantity / totalQuantity) * cappedSuccess;
    const floorVal = Math.floor(exact);
    return {
      idx,
      recipeId: row.recipeId,
      quantity: row.quantity,
      value: floorVal,
      remainder: exact - floorVal
    };
  });

  let used = allocations.reduce((sum, row) => sum + row.value, 0);
  let remaining = Math.max(0, cappedSuccess - used);
  allocations.sort((a, b) => b.remainder - a.remainder || b.quantity - a.quantity || a.idx - b.idx);
  for (const row of allocations) {
    if (remaining <= 0) break;
    row.value += 1;
    remaining -= 1;
  }

  const byRecipe = {};
  for (const row of allocations) {
    byRecipe[row.recipeId] = Math.max(0, Math.min(row.quantity, row.value));
  }
  return byRecipe;
}

function buildCookRecipePickerScenePayload({ userId, p, s, selectedRecipeId, quantity = 1, page = null }) {
  const allEntries = buildCookRecipePickerSceneEntries({ p, s });
  const cookAllState = buildCookAllPlanForAcceptedOrders(p);
  const pageSize = 25;
  const selectedId = String(selectedRecipeId || "").trim();
  const selectedExists = allEntries.some((entry) => String(entry?.recipeId || "") === selectedId);
  const fallbackSelected = selectedExists
    ? selectedId
    : String(allEntries?.[0]?.recipeId || "").trim();
  const safeQuantity = Math.max(1, Math.min(99, Math.floor(Number(quantity) || 1)));
  const totalPages = Math.max(1, Math.ceil(Math.max(0, allEntries.length) / pageSize));
  const selectedIndex = fallbackSelected
    ? allEntries.findIndex((entry) => String(entry?.recipeId || "") === fallbackSelected)
    : -1;
  const selectedPage = selectedIndex >= 0 ? Math.floor(selectedIndex / pageSize) : 0;
  const requestedPage = Number.isFinite(Number(page)) ? Math.floor(Number(page)) : selectedPage;
  const safePage = Math.max(0, Math.min(requestedPage, totalPages - 1));
  const entries = allEntries.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const selectedOnPage = entries.some((entry) => String(entry?.recipeId || "") === fallbackSelected);
  const effectiveSelected = selectedOnPage
    ? fallbackSelected
    : String(entries?.[0]?.recipeId || "").trim();

  const needsByRecipe = allEntries
    .filter((entry) => Number(entry?.short) > 0)
    .sort((a, b) => Number(b?.short || 0) - Number(a?.short || 0));
  const needLines = needsByRecipe.map((entry) => {
    const recipeName = String(entry?.recipeName || entry?.recipeId || "Recipe");
    return `• ${recipeName} — need **${entry.need}**, ready **${entry.ready}** (cook **${entry.short}** more)`;
  });

  const sceneState = putSceneState({
    sceneKey: "cook.recipe_picker",
    ownerId: userId,
    state: {
      entries,
      cookAllPlan: cookAllState.plan,
      canCookAll: cookAllState.canCookAll,
      cookAllTotalQuantity: cookAllState.totalQuantity,
      selectedRecipeId: effectiveSelected || null,
      quantity: safeQuantity,
      page: safePage,
      totalPages
    }
  });

  return buildCookRecipePickerV2Message({
    userId,
    token: sceneState.token,
    entries,
    selectedRecipeId: effectiveSelected || null,
    quantity: safeQuantity,
    currentPage: safePage,
    totalPages,
    needLines,
    canCookAll: cookAllState.canCookAll,
    cookAllQuantity: cookAllState.totalQuantity
  });
}

function buildServePickerSceneEntries({ p, readyOnly = false }) {
  const now = nowTs();
  const acceptedEntries = Object.entries(p.orders?.accepted ?? {});
  const orderTokenByShortId = {};
  const onlyReady = Boolean(readyOnly);

  const mappedEntries = acceptedEntries.map(([fullOrderId, accepted]) => {
    const shortId = shortOrderId(fullOrderId);
    orderTokenByShortId[shortId] = String(fullOrderId);
    const order = accepted?.order ?? null;
    const recipeId = String(order?.recipe_id || "").trim();
    const recipeName = recipeId ? displayRecipeName(recipeId) : "Unknown recipe";
    const npcName = order?.npc_archetype
      ? (content.npcs?.[order.npc_archetype]?.name ?? order.npc_archetype)
      : "customer";
    const expired = Boolean(accepted?.expires_at && now > Number(accepted.expires_at));
    const ready = !expired && recipeId ? getTotalBowlsForRecipe(p, recipeId) > 0 : false;
    const status = expired ? "expired" : (ready ? "ready" : "missing bowl");

    return {
      shortId,
      fullOrderId: String(fullOrderId),
      recipeId,
      ready,
      expired,
      line: `\`${shortId}\` • **${recipeName}** — *${npcName}* • ${status}`
    };
  });

  const entries = onlyReady
    ? mappedEntries.filter((entry) => entry.ready && !entry.expired)
    : mappedEntries;

  entries.sort((a, b) => {
    if (a.ready !== b.ready) return a.ready ? -1 : 1;
    if (a.expired !== b.expired) return a.expired ? 1 : -1;
    return String(a.shortId).localeCompare(String(b.shortId));
  });

  return { entries, orderTokenByShortId };
}

function buildServePickerScenePayload({ userId, p, selectedShortIds = [], readyOnly = false, statusLine = "" } = {}) {
  const onlyReady = Boolean(readyOnly);
  const { entries, orderTokenByShortId } = buildServePickerSceneEntries({ p, readyOnly: onlyReady });
  const canServeAll = canServeAllOrders(p);
  const entryShortIds = new Set(entries.map((entry) => String(entry?.shortId || "").trim()).filter(Boolean));
  const normalizedSelected = (selectedShortIds || [])
    .map((id) => String(id || "").trim())
    .filter((id, index, arr) => Boolean(id) && entryShortIds.has(id) && arr.indexOf(id) === index);

  const sceneState = putSceneState({
    sceneKey: "serve.order_picker",
    ownerId: userId,
    state: {
      entries,
      orderTokenByShortId,
      selectedShortIds: normalizedSelected,
      readyOnly: onlyReady
    }
  });

  return buildServePickerV2Message({
    userId,
    token: sceneState.token,
    entries,
    selectedShortIds: normalizedSelected,
    readyOnly: onlyReady,
    statusLine,
    canServeAll
  });
}

function buildCancelPickerSceneEntries({ p }) {
  const acceptedEntries = Object.entries(p.orders?.accepted ?? {});
  const orderTokenByShortId = {};

  const entries = acceptedEntries.map(([fullOrderId, accepted]) => {
    const shortId = shortOrderId(fullOrderId);
    orderTokenByShortId[shortId] = String(fullOrderId);
    const order = accepted?.order ?? null;
    const recipeId = String(order?.recipe_id || "").trim();
    const recipeName = recipeId ? displayRecipeName(recipeId) : "Unknown recipe";
    const npcName = order?.npc_archetype
      ? (content.npcs?.[order.npc_archetype]?.name ?? order.npc_archetype)
      : "customer";

    return {
      shortId,
      fullOrderId: String(fullOrderId),
      line: `\`${shortId}\` • **${recipeName}** — *${npcName}*`
    };
  });

  entries.sort((a, b) => String(a.shortId).localeCompare(String(b.shortId)));

  return { entries, orderTokenByShortId };
}

function buildCancelPickerScenePayload({ userId, p, selectedShortIds = [], statusLine = "" } = {}) {
  const { entries, orderTokenByShortId } = buildCancelPickerSceneEntries({ p });
  const entryShortIds = new Set(entries.map((entry) => String(entry?.shortId || "").trim()).filter(Boolean));
  const normalizedSelected = (selectedShortIds || [])
    .map((id) => String(id || "").trim())
    .filter((id, index, arr) => Boolean(id) && entryShortIds.has(id) && arr.indexOf(id) === index);

  const sceneState = putSceneState({
    sceneKey: "orders.cancel_picker",
    ownerId: userId,
    state: {
      entries,
      orderTokenByShortId,
      selectedShortIds: normalizedSelected
    }
  });

  return buildCancelPickerV2Message({
    userId,
    token: sceneState.token,
    entries,
    selectedShortIds: normalizedSelected,
    statusLine
  });
}

function buildCookMinigameScenePayload({
  userId,
  recipeId,
  recipeNameOverride = "",
  quantity = 1,
  turnIndex = 0,
  totalTurns = 8,
  score = 0,
  misses = 0,
  targetActions = [],
  runToken = null,
  turnMs = 10000,
  graceMs = 0,
  turnStartedAt = null,
  lastTurnStatus = null,
  counterCook = false,
  returnSub = "orders",
  tutorialMode = false,
  coachingLine = "",
  cookAllPlan = [],
  nowMs = Date.now()
} = {}) {
  const safeRecipeId = String(recipeId || "").trim();
  const safeQuantity = Math.max(1, Math.min(99, Math.floor(Number(quantity) || 1)));
  const safeTotalTurns = Math.max(1, Math.min(20, Math.floor(Number(totalTurns) || 8)));
  const safeRunToken = String(runToken || "").trim() || createCookRunToken({
    userId,
    recipeId: safeRecipeId,
    quantity: safeQuantity,
    nowMs
  });
  const safeTurnMs = Math.max(250, Math.floor(Number(turnMs) || 10000));
  const safeGraceMs = Math.max(0, Math.floor(Number(graceMs) || 0));
  const normalizedTargets = Array.isArray(targetActions) && targetActions.length
    ? targetActions.map((action) => String(action || "").trim().toLowerCase()).filter(Boolean)
    : buildCookMinigameTargetActions({ recipeId: safeRecipeId, runToken: safeRunToken, totalTurns: safeTotalTurns });
  const targets = normalizedTargets.slice(0, safeTotalTurns);
  while (targets.length < safeTotalTurns) {
    targets.push("prep");
  }
  const safeTurnIndex = Math.max(0, Math.min(safeTotalTurns - 1, Math.floor(Number(turnIndex) || 0)));
  const safeScore = Math.max(0, Math.min(safeTotalTurns, Math.floor(Number(score) || 0)));
  const safeMisses = Math.max(0, Math.floor(Number(misses) || 0));
  const safeTurnStartedAt = Math.max(0, Math.floor(Number(turnStartedAt || nowMs) || nowMs));
  const safeLastTurnStatus = String(lastTurnStatus || "").trim().toLowerCase() || null;
  const safeCounterCook = Boolean(counterCook);
  const safeReturnSub = String(returnSub || "orders").trim() || "orders";
  const safeTutorialMode = Boolean(tutorialMode);
  const safeCoachingLine = String(coachingLine || "").trim();
  const safeRecipeNameOverride = String(recipeNameOverride || "").trim();
  const safeCookAllPlan = Array.isArray(cookAllPlan)
    ? cookAllPlan
      .map((row) => ({
        recipeId: String(row?.recipeId || "").trim(),
        quantity: Math.max(0, Math.floor(Number(row?.quantity) || 0))
      }))
      .filter((row) => row.recipeId && row.quantity > 0)
    : [];

  const sceneState = putSceneState({
    sceneKey: "cook.minigame",
    ownerId: userId,
    state: {
      recipeId: safeRecipeId,
      quantity: safeQuantity,
      turnIndex: safeTurnIndex,
      totalTurns: safeTotalTurns,
      score: safeScore,
      misses: safeMisses,
      targetActions: targets,
      runToken: safeRunToken,
      turnMs: safeTurnMs,
      graceMs: safeGraceMs,
      turnStartedAt: safeTurnStartedAt,
      lastTurnStatus: safeLastTurnStatus,
      counterCook: safeCounterCook,
      returnSub: safeReturnSub,
      tutorialMode: safeTutorialMode,
      coachingLine: safeCoachingLine,
      recipeNameOverride: safeRecipeNameOverride,
      cookAllPlan: safeCookAllPlan
    }
  });

  return buildCookMinigameV2Message({
    userId,
    token: sceneState.token,
    recipeName: safeRecipeNameOverride || displayRecipeName(safeRecipeId),
    quantity: safeQuantity,
    turnIndex: safeTurnIndex,
    totalTurns: safeTotalTurns,
    score: safeScore,
    misses: safeMisses,
    targetAction: targets[safeTurnIndex] ?? "prep",
    turnMs: safeTurnMs,
    graceMs: safeGraceMs,
    lastTurnStatus: safeLastTurnStatus,
    tutorialMode: safeTutorialMode,
    coachingLine: safeCoachingLine
  });
}

function buildCookPickerPayload({ userId, p, s, ownerUser, page = 0 }) {
  const hasAcceptedOrders = Object.keys(p.orders?.accepted ?? {}).length > 0;
  const { availableCount } = getOrdersMeta(p);
  const remainingOrders = availableCount;
  const disableAccept = remainingOrders === 0;
  const highlightAccept = !hasAcceptedOrders && !disableAccept;
  const available = getValidAvailableRecipeIds(p);
  const seasonFiltered = filterRecipeIdsByActiveSeasonEvent(available, s);

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
    const relevantIngredients = getRelevantRecipeIngredients(p, r);
    const labelRaw = r ? `${r.name} (${r.tier})` : displayItemName(rid, content);
    const label = labelRaw.length > 100 ? labelRaw.slice(0, 97) + "…" : labelRaw;

    // Show ingredient availability and max cookable for quick glance
    const ingTokens = relevantIngredients.map((ing) => {
      const have = Math.max(0, p.inv_ingredients?.[ing.item_id] ?? 0);
      const name = displayItemName(ing.item_id);
      const base = `${name}:${have}`;
      return isIngredientOptionalForPlayer(p, ing) ? `${base} (opt)` : base;
    });

    const maxCookable = relevantIngredients
      .filter((ing) => !isIngredientOptionalForPlayer(p, ing) && (ing?.qty ?? 0) > 0)
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
      const recipeName = displayRecipeName(recipeId);
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
    .setCustomId(`noodle:pick:cook_select:${userId}:${safePage}:${Date.now().toString(36)}`)
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

  const showOrdersActions = resolveTutorialGateValue({
    player: p,
    gate: "cookPickerShowOrdersActions",
    fallbackValue: true
  });
  const navRow = totalPages > 1
    ? new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`noodle:pick:cook:${userId}:${safePage <= 0 ? totalPages - 1 : safePage - 1}`)
          .setLabel("Prev")
          .setEmoji(getButtonEmoji("back"))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(false),
        new ButtonBuilder()
          .setCustomId(`noodle:pick:cook:${userId}:${safePage >= totalPages - 1 ? 0 : safePage + 1}`)
          .setLabel("Next")
          .setEmoji(getButtonEmoji("next"))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(false)
      )
    : null;

  const components = [];
  components.push(new ActionRowBuilder().addComponents(menu));
  if (navRow) components.push(navRow);
  if (showOrdersActions) {
    components.push(noodleOrdersActionRowWithBack(userId, {
      highlightAccept,
      disableAccept,
      disableServe: !hasAcceptedOrders
    }));
  }

  return {
    content: " ",
    ...composeV2FromLegacyEmbeds([cookEmbed]),
    components
  };
}

function getTakeoutRecipeNeedRows(player, takeoutState) {
  const menuRecipeIds = (takeoutState?.menu_recipe_ids ?? []).filter(Boolean);
  const menuSet = new Set(menuRecipeIds);
  const snapshot = Array.isArray(takeoutState?.shift?.idle_order_board_snapshot)
    ? takeoutState.shift.idle_order_board_snapshot
    : [];

  const neededByRecipe = {};
  for (const row of snapshot) {
    const recipeId = String(row?.recipe_id || "").trim();
    if (!recipeId) continue;
    if (menuSet.size > 0 && !menuSet.has(recipeId)) continue;
    const need = Math.max(0, Math.floor(Number(row?.visible_order_count || 0) || 0));
    neededByRecipe[recipeId] = (neededByRecipe[recipeId] ?? 0) + need;
  }

  return menuRecipeIds.map((recipeId) => {
    const need = Math.max(0, neededByRecipe[recipeId] ?? 0);
    const ready = getTotalBowlsForRecipe(player, recipeId);
    const short = Math.max(0, need - ready);
    return { recipeId, need, ready, short };
  });
}

function getTakeoutIngredientShortages(player, takeoutState) {
  const recipeNeeds = getTakeoutRecipeNeedRows(player, takeoutState).filter((entry) => entry.short > 0);
  const neededByIngredient = {};

  for (const entry of recipeNeeds) {
    const recipe = content.recipes?.[entry.recipeId];
    if (!recipe) continue;
    getRelevantRecipeIngredients(player, recipe).forEach((ing) => {
      if (isIngredientOptionalForPlayer(player, ing)) return;
      const qty = Math.max(0, Math.floor(Number(ing?.qty || 0) || 0));
      if (qty <= 0) return;
      neededByIngredient[ing.item_id] = (neededByIngredient[ing.item_id] ?? 0) + (qty * entry.short);
    });
  }

  return Object.entries(neededByIngredient)
    .map(([itemId, needed]) => {
      const have = Math.max(0, Math.floor(Number(player.inv_ingredients?.[itemId] || 0) || 0));
      const short = Math.max(0, needed - have);
      return { itemId, needed, have, short };
    })
    .filter((row) => row.short > 0)
    .sort((a, b) => displayItemName(a.itemId).localeCompare(displayItemName(b.itemId), "en", { sensitivity: "base" }));
}

function buildTakeoutCookPickerPayload({ userId, p, takeout, ownerUser, page = 0 }) {
  const menuRecipeIds = (takeout?.menu_recipe_ids ?? []).filter((rid) => content.recipes?.[rid]);
  if (!menuRecipeIds.length) {
    return { content: `${getIcon("warning")} Your takeout menu is empty. Set a menu first.`, ephemeral: true };
  }

  const sortKey = (rid) => {
    const r = content.recipes?.[rid];
    return (r?.name ?? displayItemName(rid, content) ?? "").toLowerCase();
  };
  const sorted = [...menuRecipeIds].sort((a, b) => sortKey(a).localeCompare(sortKey(b), "en", { sensitivity: "base" }));
  const totalPages = Math.max(1, Math.ceil(sorted.length / 25));
  const safePage = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);

  const opts = sorted
    .slice(safePage * 25, (safePage + 1) * 25)
    .map((rid) => {
      const r = content.recipes?.[rid];
      const relevantIngredients = getRelevantRecipeIngredients(p, r);
      const labelRaw = r ? `${r.name} (${r.tier})` : displayItemName(rid, content);
      const label = labelRaw.length > 100 ? labelRaw.slice(0, 97) + "…" : labelRaw;

      const ingTokens = relevantIngredients.map((ing) => {
        const have = Math.max(0, p.inv_ingredients?.[ing.item_id] ?? 0);
        const name = displayItemName(ing.item_id);
        const base = `${name}:${have}`;
        return isIngredientOptionalForPlayer(p, ing) ? `${base} (opt)` : base;
      });

      const maxCookable = relevantIngredients
        .filter((ing) => !isIngredientOptionalForPlayer(p, ing) && (ing?.qty ?? 0) > 0)
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

  const needRows = getTakeoutRecipeNeedRows(p, takeout)
    .filter((entry) => entry.need > 0)
    .map((entry) => {
      const line = `• ${displayRecipeName(entry.recipeId)} — need **${entry.need}**, ready **${entry.ready}** (cook **${entry.short}** more)`;
      return { ...entry, line };
    })
    .sort((a, b) => {
      if (b.short !== a.short) return b.short - a.short;
      return displayRecipeName(a.recipeId).localeCompare(displayRecipeName(b.recipeId), "en", { sensitivity: "base" });
    });

  const cookNeedsText = needRows.length
    ? `${getIcon("cook")} Counter orders to cook:\n${needRows.slice(0, 6).map((x) => x.line).join("\n")}${needRows.length > 6 ? "\n…" : ""}`
    : "";

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`noodle:pick:takeout_cook_select:${userId}:${safePage}:${Date.now().toString(36)}`)
    .setPlaceholder("Select a recipe to cook")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(opts);

  const cookEmbed = buildMenuEmbed({
    title: `${getIcon("cook")} Counter Cook`,
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

  const canCounterServe = needRows.some((entry) => entry.need > 0 && entry.ready > 0);
  const navRow = totalPages > 1
    ? new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`noodle:pick:takeout_cook:${userId}:${safePage <= 0 ? totalPages - 1 : safePage - 1}`)
          .setLabel("Prev")
          .setEmoji(getButtonEmoji("back"))
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`noodle:pick:takeout_cook:${userId}:${safePage >= totalPages - 1 ? 0 : safePage + 1}`)
          .setLabel("Next")
          .setEmoji(getButtonEmoji("next"))
          .setStyle(ButtonStyle.Secondary)
      )
    : null;

  const components = [new ActionRowBuilder().addComponents(menu)];
  if (navRow) components.push(navRow);
  components.push(
    noodleTakeoutActionRow(userId, {
      activeShift: true,
      disableClaim: Math.max(0, Math.floor(Number(takeout?.earned_unclaimed_coins || 0) || 0)) <= 0,
      disableServe: !canCounterServe
    }),
    noodleMainMenuRowNoOrdersWithBack(userId)
  );

  return { content: " ", ...composeV2FromLegacyEmbeds([cookEmbed]), components };
}

function buildTakeoutServePickerPayload({ userId, p, takeout, ownerUser }) {
  const needRows = getTakeoutRecipeNeedRows(p, takeout).filter((entry) => entry.need > 0);
  if (!needRows.length) {
    return { content: `${getIcon("help")} No counter orders remain to serve right now.`, ephemeral: true };
  }

  const opts = needRows
    .slice()
    .sort((a, b) => displayRecipeName(a.recipeId).localeCompare(displayRecipeName(b.recipeId), "en", { sensitivity: "base" }))
    .map((entry) => {
      const labelRaw = `${displayRecipeName(entry.recipeId)} — ${entry.ready} ready`;
      const label = labelRaw.length > 100 ? labelRaw.slice(0, 97) + "…" : labelRaw;
      const descRaw = `Remaining ${entry.need}`;
      const description = descRaw.length > 100 ? descRaw.slice(0, 97) + "…" : descRaw;
      const option = { label, value: entry.recipeId, description };
      if (entry.ready > 0) {
        const emoji = getButtonEmoji("status_complete");
        if (emoji) option.emoji = emoji;
      }
      return option;
    })
    .slice(0, 25);

  const missingLines = needRows
    .filter((entry) => entry.short > 0)
    .map((entry) => `• ${displayRecipeName(entry.recipeId)} — need **${entry.need}**, ready **${entry.ready}** (cook **${entry.short}** more)`);

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`noodle:pick:takeout_serve_select:${userId}`)
    .setPlaceholder("Select a recipe to serve")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(opts);

  const descBase = "Select counter orders to serve.\nWhen you're done selecting, if on Desktop, press **Esc** to continue.";
  const descWithMissing = missingLines.length
    ? `${descBase}\n\n${getIcon("basket")} Missing bowls\n${missingLines.join("\n")}`
    : descBase;

  const serveEmbed = buildMenuEmbed({
    title: `${getIcon("bowl")} Counter Serve`,
    description: descWithMissing,
    user: ownerUser
  });

  const canCounterServe = needRows.some((entry) => entry.ready > 0);
  return {
    content: " ",
    ...composeV2FromLegacyEmbeds([serveEmbed]),
    components: [
      new ActionRowBuilder().addComponents(menu),
      noodleTakeoutActionRow(userId, {
        activeShift: true,
        disableClaim: Math.max(0, Math.floor(Number(takeout?.earned_unclaimed_coins || 0) || 0)) <= 0,
        disableServe: !canCounterServe
      }),
      noodleMainMenuRowNoOrdersWithBack(userId)
    ]
  };
}

function buildTakeoutNeedsPayload({ userId, p, takeout, ownerUser, page = 0 }) {
  const needRows = getTakeoutRecipeNeedRows(p, takeout)
    .filter((entry) => entry.need > 0)
    .sort((a, b) => {
      if (b.short !== a.short) return b.short - a.short;
      return displayRecipeName(a.recipeId).localeCompare(displayRecipeName(b.recipeId), "en", { sensitivity: "base" });
    });
  const shortageRows = getTakeoutIngredientShortages(p, takeout);
  const perPage = 14;
  const totalPages = Math.max(1, Math.ceil(shortageRows.length / perPage));
  const safePage = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);
  const pageRows = shortageRows.slice(safePage * perPage, (safePage + 1) * perPage);

  const neededIngredientLines = pageRows.length
    ? pageRows
      .map((row) => `• ${displayItemName(row.itemId)} — need **${row.needed}**, have **${row.have}** (short **${row.short}**)`)
      .join("\n")
    : "_All ingredients currently ready for remaining counter orders._";

  const remainingOrderLines = needRows.length
    ? needRows
      .slice(0, 12)
      .map((entry) => `• ${displayRecipeName(entry.recipeId)} — need **${entry.need}**, ready **${entry.ready}** (cook **${entry.short}** more)`)
      .join("\n")
    : "_No remaining active counter orders._";
  const hiddenOrderCount = Math.max(0, needRows.length - 12);
  const hiddenOrderSuffix = hiddenOrderCount > 0 ? `\n…and **${hiddenOrderCount}** more order lines` : "";

  const description = [
    "Ingredients needed for your remaining active counter orders (after counting ready bowls).",
    "",
    "**Remaining Counter Orders**",
    `${remainingOrderLines}${hiddenOrderSuffix}`,
    "",
    `${getIcon("basket")} **Needed Ingredients**`,
    neededIngredientLines
  ].join("\n");

  const canCounterServe = needRows.some((entry) => entry.ready > 0);
  const embed = buildMenuEmbed({
    title: `${getIcon("basket")} Counter Order Ingredients`,
    description,
    user: ownerUser,
    color: theme.colors.success
  });
  if (shortageRows.length > 0) {
    const existingFooter = embed?.data?.footer?.text ?? embed?.footer?.text ?? "";
    const pageLabel = `Page ${safePage + 1}/${totalPages}`;
    embed.setFooter({ text: existingFooter ? `${pageLabel} • ${existingFooter}` : pageLabel });
  }

  return {
    content: " ",
    ...composeV2FromLegacyEmbeds([embed]),
    components: [
      ...(totalPages > 1
        ? [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`noodle:nav:takeout_needs:${userId}:${safePage <= 0 ? totalPages - 1 : safePage - 1}`)
                .setLabel("Prev")
                .setEmoji(getButtonEmoji("back"))
                .setStyle(ButtonStyle.Secondary),
              new ButtonBuilder()
                .setCustomId(`noodle:nav:takeout_needs:${userId}:${safePage >= totalPages - 1 ? 0 : safePage + 1}`)
                .setLabel("Next")
                .setEmoji(getButtonEmoji("next"))
                .setStyle(ButtonStyle.Secondary)
            )
          ]
        : []),
      noodleTakeoutActionRow(userId, {
        activeShift: true,
        disableClaim: Math.max(0, Math.floor(Number(takeout?.earned_unclaimed_coins || 0) || 0)) <= 0,
        disableServe: !canCounterServe
      }),
      noodleMainMenuRowNoOrdersWithBack(userId)
    ]
  };
}

function getAllowedForageIdsForPlayer(player) {
  const allowed = getUnlockedIngredientIds(player, content);
  return (FORAGE_ITEM_IDS ?? []).filter((id) => allowed.has(id));
}

function buildForagePickerRows({ userId, player, randomPrimary = true, page = 0 }) {
  const forageIds = getAllowedForageIdsForPlayer(player)
    .slice()
    .sort((a, b) => displayItemName(a).localeCompare(displayItemName(b), undefined, { sensitivity: "base" }));

  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(forageIds.length / pageSize));
  const safePage = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);
  const pageIds = forageIds.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const forageOptions = pageIds
    .map((id) => ({
      label: displayItemName(id).slice(0, 100),
      value: id
    }))
    .slice(0, 25);

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:pick:forage_random:${userId}:${safePage}`)
      .setLabel("Forage Stroll")
      .setEmoji(getButtonEmoji("forage"))
      .setStyle(randomPrimary ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  const pickerRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`noodle:pick:forage_item_select:${userId}:${safePage}`)
      .setPlaceholder(forageOptions.length ? "Pick an ingredient to forage" : "No forage ingredients unlocked yet")
      .setMinValues(1)
      .setMaxValues(1)
      .setDisabled(!forageOptions.length)
      .addOptions(forageOptions.length ? forageOptions : [{ label: "No forage ingredients unlocked yet", value: "none" }])
  );

  const pageRow = totalPages > 1
    ? new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`noodle:pick:forage_page:${userId}:${safePage <= 0 ? totalPages - 1 : safePage - 1}`)
          .setLabel("Prev")
          .setEmoji(getButtonEmoji("back"))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(false),
        new ButtonBuilder()
          .setCustomId(`noodle:pick:forage_page:${userId}:${safePage >= totalPages - 1 ? 0 : safePage + 1}`)
          .setLabel("Next")
          .setEmoji(getButtonEmoji("next"))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(false)
      )
    : null;

  return {
    actionRow,
    pickerRow,
    pageRow,
    forageCount: forageIds.length,
    safePage,
    totalPages
  };
}

function buildForageMenuPayload({
  userId,
  player,
  ownerUser,
  kitchenUnlocked,
  kitchenJustUnlocked,
  fishingUnlocked,
  fishingJustUnlocked,
  page = 0,
  selectedItemId = null
}) {
  const gardenUnlocked = isGardenUnlocked(player);
  const now = nowTs();
  const combinedEffects = calculateCombinedEffects(player, upgradesContent, staffContent, calculateStaffEffects);
  const forageBaseCooldownMs = 2 * 60 * 1000;
  const forageCooldownMs = applyCooldownReduction(forageBaseCooldownMs, combinedEffects);
  const forageCooldown = canForage(player, now, forageCooldownMs);
  const forageNextTs = Math.floor((forageCooldown.ok ? (now + forageCooldownMs) : forageCooldown.nextAt) / 1000);
  const forageReadyLine = forageCooldown.ok
    ? `${getIcon("forage")} You're ready to forage. Choose how you'd like to forage below.`
    : `${getIcon("cooldown")} You can forage again <t:${forageNextTs}:R>.`;
  if (combinedEffects.garden_autoharvest) {
    autoHarvestReadyPlots(player, content, combinedEffects, {
      capacityLimiter: (drops) => applyIngredientCapacityToDrops(drops, player, combinedEffects)
    });
  }

  const { actionRow, pickerRow, pageRow, forageCount, safePage, totalPages } = buildForagePickerRows({
    userId,
    player,
    randomPrimary: true,
    page
  });
  const normalizedSelectedItemId = String(selectedItemId || "").trim();
  const allowedForageIds = new Set(getAllowedForageIdsForPlayer(player));
  const selectedForageItemId = allowedForageIds.has(normalizedSelectedItemId) ? normalizedSelectedItemId : null;
  const forageQtyRow = selectedForageItemId
    ? new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`noodle:pick:forage_qty:${userId}:${selectedForageItemId}:1:${safePage}`).setLabel("x1").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`noodle:pick:forage_qty:${userId}:${selectedForageItemId}:2:${safePage}`).setLabel("x2").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`noodle:pick:forage_qty:${userId}:${selectedForageItemId}:3:${safePage}`).setLabel("x3").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`noodle:pick:forage_qty:${userId}:${selectedForageItemId}:4:${safePage}`).setLabel("x4").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`noodle:pick:forage_qty:${userId}:${selectedForageItemId}:5:${safePage}`).setLabel("x5").setStyle(ButtonStyle.Primary)
      )
    : null;
  const forageBaseDescription = forageCount > 0
    ? [
        "Choose how you want to forage:",
        `• Take a forage stroll for surprise finds`,
        `• **OR** Pick a specific ingredient, then tap a quantity button (**1-5**)\n\n**Final amount you receive is increased by your Forager's level*`
      ].join("\n")
    : "You haven’t unlocked any forageable ingredients yet. Unlock a recipe first.";

  const embed = buildMenuEmbed({
    title: `${getIcon("forage")} Forage`,
    description: `${forageBaseDescription}\n\n${forageReadyLine}`,
    user: ownerUser,
    color: theme.colors.success
  });
  if (forageCount > 0 && totalPages > 1) {
    const existingFooter = embed?.data?.footer?.text ?? embed?.footer?.text ?? "";
    const pageLabel = `Page ${safePage + 1}/${totalPages}`;
    embed.setFooter({ text: existingFooter ? `${pageLabel} • ${existingFooter}` : pageLabel });
  }

  return {
    content: " ",
    ...composeV2FromLegacyEmbeds([embed]),
    components: buildForageFishingNavRows({
      userId,
      active: "forage",
      gardenUnlocked,
      fishingUnlocked,
      fishingJustUnlocked,
      kitchenUnlocked,
      kitchenJustUnlocked,
      prependRows: [actionRow, pickerRow, ...(forageQtyRow ? [forageQtyRow] : []), ...(pageRow ? [pageRow] : [])]
    })
  };
}

function getAllowedFishingIdsForPlayer(_player) {
  return (FISHING_ITEM_IDS ?? []).filter((id) => !!content.items?.[id]);
}

function buildFishingPickerRows({ userId, player, randomPrimary = true, page = 0 }) {
  const fishingIds = getAllowedFishingIdsForPlayer(player)
    .slice()
    .sort((a, b) => displayItemName(a).localeCompare(displayItemName(b), undefined, { sensitivity: "base" }));

  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(fishingIds.length / pageSize));
  const safePage = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);
  const pageIds = fishingIds.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const fishingOptions = pageIds
    .map((id) => ({
      label: displayItemName(id).slice(0, 100),
      value: id
    }))
    .slice(0, 25);

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:pick:fishing_random:${userId}:${safePage}`)
      .setLabel("Casual Fishing")
      .setEmoji(getButtonEmoji("fishing"))
      .setStyle(randomPrimary ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  const pickerRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`noodle:pick:fishing_item_select:${userId}:${safePage}`)
      .setPlaceholder(fishingOptions.length ? "Pick the fish or seafood you're looking for" : "No fishing items available")
      .setMinValues(1)
      .setMaxValues(1)
      .setDisabled(!fishingOptions.length)
      .addOptions(fishingOptions.length ? fishingOptions : [{ label: "No fishing items available", value: "none" }])
  );

  const pageRow = totalPages > 1
    ? new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`noodle:pick:fishing_page:${userId}:${safePage <= 0 ? totalPages - 1 : safePage - 1}`)
          .setLabel("Prev")
          .setEmoji(getButtonEmoji("back"))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(false),
        new ButtonBuilder()
          .setCustomId(`noodle:pick:fishing_page:${userId}:${safePage >= totalPages - 1 ? 0 : safePage + 1}`)
          .setLabel("Next")
          .setEmoji(getButtonEmoji("next"))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(false)
      )
    : null;

  return {
    actionRow,
    pickerRow,
    pageRow,
    fishingCount: fishingIds.length,
    safePage,
    totalPages
  };
}

function buildFishingMenuPayload({
  userId,
  player,
  ownerUser,
  kitchenUnlocked,
  kitchenJustUnlocked,
  fishingUnlocked,
  fishingJustUnlocked,
  page = 0,
  selectedItemId = null
}) {
  const gardenUnlocked = isGardenUnlocked(player);
  const now = nowTs();
  const combinedEffects = calculateCombinedEffects(player, upgradesContent, staffContent, calculateStaffEffects);
  const fishingBaseCooldownMs = applyCooldownReduction(FISHING_BASE_COOLDOWN_MS, combinedEffects);
  const fishingCooldownMs = Math.floor(
    fishingBaseCooldownMs * (1 - Math.min(0.8, Math.max(0, combinedEffects.fishing_cooldown_reduction || 0)))
  );
  const fishingCooldown = canFish(player, now, fishingCooldownMs);
  const fishingNextTs = Math.floor((fishingCooldown.ok ? (now + fishingCooldownMs) : fishingCooldown.nextAt) / 1000);
  const fishingReadyLine = fishingCooldown.ok
    ? `${getIcon("fishing")} You're ready to fish. Choose how you'd like to fish below.`
    : `${getIcon("cooldown")} You can fish again at <t:${fishingNextTs}:t> (<t:${fishingNextTs}:R>).`;
  const { actionRow, pickerRow, pageRow, fishingCount, safePage, totalPages } = buildFishingPickerRows({
    userId,
    player,
    randomPrimary: true,
    page
  });
  const normalizedSelectedItemId = String(selectedItemId || "").trim();
  const allowedFishingIds = new Set(getAllowedFishingIdsForPlayer(player));
  const selectedFishingItemId = allowedFishingIds.has(normalizedSelectedItemId) ? normalizedSelectedItemId : null;
  const fishingQtyRow = selectedFishingItemId
    ? new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`noodle:pick:fishing_qty:${userId}:${selectedFishingItemId}:1:${safePage}`).setLabel("x1").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`noodle:pick:fishing_qty:${userId}:${selectedFishingItemId}:2:${safePage}`).setLabel("x2").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`noodle:pick:fishing_qty:${userId}:${selectedFishingItemId}:3:${safePage}`).setLabel("x3").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`noodle:pick:fishing_qty:${userId}:${selectedFishingItemId}:4:${safePage}`).setLabel("x4").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`noodle:pick:fishing_qty:${userId}:${selectedFishingItemId}:5:${safePage}`).setLabel("x5").setStyle(ButtonStyle.Primary)
      )
    : null;

  const fishingBaseDescription = fishingCount > 0
    ? [
        "Choose how you want to fish:",
        "• Enjoy a casual fishing trip for surprise catches",
        "• **OR** Pick a specific fish or seafood, then tap a quantity button (**1-5**)\n\n**Final amount you receive is increased by your Fisher Crew's level*"
      ].join("\n")
    : "No fishing items are available right now.";

  const embed = buildMenuEmbed({
    title: `${getIcon("fishing")} Fishing`,
    description: `${fishingBaseDescription}\n\n${fishingReadyLine}`,
    user: ownerUser,
    color: theme.colors.success
  });

  if (fishingCount > 0 && totalPages > 1) {
    const existingFooter = embed?.data?.footer?.text ?? embed?.footer?.text ?? "";
    const pageLabel = `Page ${safePage + 1}/${totalPages}`;
    embed.setFooter({ text: existingFooter ? `${pageLabel} • ${existingFooter}` : pageLabel });
  }

  return {
    content: " ",
    ...composeV2FromLegacyEmbeds([embed]),
    components: buildForageFishingNavRows({
      userId,
      active: "fishing",
      gardenUnlocked,
      fishingUnlocked,
      fishingJustUnlocked,
      kitchenUnlocked,
      kitchenJustUnlocked,
      prependRows: [actionRow, pickerRow, ...(fishingQtyRow ? [fishingQtyRow] : []), ...(pageRow ? [pageRow] : [])]
    })
  };
}

function buildForageFishingNavRows({
  userId,
  active,
  gardenUnlocked,
  fishingUnlocked,
  fishingJustUnlocked,
  kitchenUnlocked,
  kitchenJustUnlocked,
  prependRows = []
}) {
  const rowOptions = {
    active,
    gardenLocked: !gardenUnlocked,
    showGardenActions: false,
    includeFishingButton: true,
    fishingUnlocked,
    fishingJustUnlocked,
    includeKitchenButton: true,
    kitchenUnlocked,
    kitchenJustUnlocked
  };

  if (active === "fishing") {
    rowOptions.gardenStyleOverride = ButtonStyle.Secondary;
    rowOptions.fishingStyleOverride = ButtonStyle.Primary;
  }

  return [
    ...prependRows,
    noodleForageGardenRow(userId, rowOptions),
    noodleMainMenuRow(userId)
  ];
}

async function renderMultiBuyPicker({ interaction, userId, s, p }) {
  const showSellButton = resolveTutorialGateValue({
    player: p,
    gate: "buyMenuShowSellButton",
    fallbackValue: true
  });
  const payload = buildMultiBuyPickerPayload({
    userId,
    p,
    s,
    ownerUser: interaction.member ?? interaction.user,
    showSellButton
  });

  return componentCommit(interaction, payload);
}

function buildMultiBuyButtonsRow(userId, selectedIds, sourceMessageId, { limitToBuy1 = false, showBuyNeeded = true } = {}) {
const selectedNames = formatSelectedItemNames(selectedIds);
const msgId = sourceMessageId || "none";
const buyOneButton = new ButtonBuilder()
  .setCustomId(`noodle:multibuy:buy1:${userId}:${msgId}`)
  .setLabel("Buy 1 each")
  .setStyle(ButtonStyle.Success);

let btnRow = new ActionRowBuilder().addComponents(buyOneButton);

if (!limitToBuy1) {
  const components = [];
  if (showBuyNeeded) {
    components.push(
      new ButtonBuilder()
        .setCustomId(`noodle:multibuy:buyneed:${userId}:${msgId}`)
        .setLabel("Buy Needed")
        .setStyle(ButtonStyle.Success)
    );
  }
  components.push(
    buyOneButton,
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
  btnRow = new ActionRowBuilder().addComponents(...components);
}

return { selectedNames, btnRow };
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

// Check commands that should defer ephemerally before heavy work/permission gates
const subCmd = interaction.options?.getSubcommand?.();
const shouldDeferEphemeral = group === "dev" && !isDevAdmin(userId);

// Defer immediately for slash commands (chat input) to prevent timeout
// DON'T defer for components - they're already deferred in index.js
if ((interaction.isChatInputCommand?.() || interaction.isCommand?.()) && !interaction.deferred && !interaction.replied) {
  try {
    if (shouldDeferEphemeral) {
      await interaction.deferReply({ ephemeral: true });
    } else {
      await interaction.deferReply();
    }
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

const navSource = overrides?.navSource ? String(overrides.navSource) : null;
const navCustomIdPrefix = navSource ? `noodle:nav:${navSource}` : null;

const emitNavSubroutePhase = (subroute, phases = {}, extra = {}) => {
  if (!navSource) return;
  emitTelemetry("component_nav_subroute_phase", {
    route: "component:noodle",
    subroute,
    navSource,
    customIdPrefix: navCustomIdPrefix,
    ...phases,
    ...extra
  });
};

const withSeasonNotice = (payload = {}) => {
  if (payload?.__seasonNoticeApplied) return payload;
  if (!seasonRolloverNotice?.message) return payload;
  let updated = { ...payload };
  const notice = seasonRolloverNotice.message;

  const noticeCard = {
    title: `${getIcon("season")} Season Update`,
    details: splitTextToV2Chunks(String(notice ?? "").trim()),
    tone: "info"
  };

  const hasSourceNativeNoticeShape = Array.isArray(updated.mainComponents) || Array.isArray(updated.notices);

  if (hasSourceNativeNoticeShape) {
    updated.notices = [...(Array.isArray(updated.notices) ? updated.notices : []), noticeCard];
  } else if (Array.isArray(updated.embeds) && updated.embeds.length > 0) {
    const composed = composeV2FromLegacyEmbeds(updated.embeds);
    const { embeds, ...rest } = updated;
    updated = {
      ...rest,
      ...composed,
      notices: [...(Array.isArray(composed.notices) ? composed.notices : []), noticeCard]
    };
  } else {
    updated.notices = [noticeCard];
    if (updated.content === undefined) updated.content = " ";
  }

  Object.defineProperty(updated, "__seasonNoticeApplied", { value: true, enumerable: false });

  return updated;
};

const commit = async (payload) => {
  const unlockApplied = payload?.__unlockNoticeApplied;
  if (!unlockApplied) {
    payload = applyUnlockNoticeEmbeds(payload, unlockNoticePlayer, interaction.member ?? interaction.user, {
      consumeSeatingNotice: false,
      consumeSubscriptionNotice: false
    });
  }
  payload = withSeasonNotice(payload);

  const persistentNoticePlayer = ensurePlayer(serverId, userId);
  const persistentNoticeState = resolvePersistentV2NoticeCards(persistentNoticePlayer, `noodle:${sub}`);
  if (persistentNoticeState.notices.length > 0) {
    payload = applyPersistentNoticeCards(payload, persistentNoticeState.notices);
  }
  if (persistentNoticeState.changed && db) {
    upsertPlayer(db, serverId, userId, persistentNoticePlayer, null, persistentNoticePlayer.schema_version);
  }

  const rolloutEnabledForUser = isComponentsV2Enabled({
    guildId: serverId,
    userId,
    player: ensurePlayer(serverId, userId)
  });
  const sourceMessageFlags = Number(interaction?.message?.flags?.bitfield ?? interaction?.message?.flags ?? 0);
  const sourceMessageIsV2 = (sourceMessageFlags & MESSAGE_FLAG_IS_COMPONENTS_V2) !== 0;
  const shouldUseV2ContainerPayload = shouldConvertLegacyPayloadToV2ForSub({
    sub,
    navSource: overrides?.navSource,
    rolloutEnabled: rolloutEnabledForUser,
    sourceMessageIsV2
  });
  const forceContainerForDev = String(group || "").trim() === "dev";
  const hasSourceNativeNoticeShape = Array.isArray(payload?.mainComponents) || Array.isArray(payload?.notices);
  if (shouldUseV2ContainerPayload || forceContainerForDev || hasSourceNativeNoticeShape) {
    payload = convertLegacyEmbedPayloadToComponentsV2(payload);
  }

if (overrides?.silentResponse === true) {
  return payload;
}
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
// Ephemeral replies: if already deferred ephemerally, keep the normal editReply flow.
// Fallback to delete+followUp only when initial defer/reply was non-ephemeral.
if (ephemeral && (interaction.deferred || interaction.replied)) {
  if (interaction.ephemeral === true) {
    return interaction.editReply(base);
  }
  try {
    await interaction.deleteReply();
  } catch (e) {
    // Ignore errors if already deleted
  }
  return interaction.followUp({ ...base, flags: MessageFlags.Ephemeral, ephemeral: true });
}
const options = ephemeral ? { ...base, flags: MessageFlags.Ephemeral, ephemeral: true } : { ...base };
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
      const targetFlags = Number(target?.flags?.bitfield ?? target?.flags ?? 0);
      const targetIsV2 = (targetFlags & MESSAGE_FLAG_IS_COMPONENTS_V2) !== 0;
      // Convert components to JSON if they're builder objects
      let editPayload = { ...payload };
      if (targetIsV2 && Array.isArray(editPayload.embeds) && editPayload.embeds.length > 0) {
        editPayload = convertLegacyEmbedPayloadToComponentsV2(editPayload);
      }
      if (editPayload.components) {
        editPayload.components = normalizeComponents(editPayload.components, editPayload.flags);
      }
      if (editPayload.embeds) {
        editPayload.embeds = sanitizeEmbedsForDiscord(editPayload.embeds);
      }
      editPayload = normalizePayloadContent(editPayload);
      editPayload = normalizeComponentsV2Payload(editPayload);
      const result = isComponentsV2Payload(editPayload)
        ? await rawChannelEditMessage(interaction, target.channelId ?? interaction.channelId, target.id, editPayload)
        : await target.edit(editPayload);
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
    const context = {
      ...buildInteractionFailureContext(interaction, overrides.messageId),
      errorCode: e?.code ?? null,
      errorMessage: e?.message ?? String(e)
    };
    if (isMissingAccessError(e)) {
      // Expected in channels where the bot can't edit the referenced message.
      console.warn("Modal override target edit skipped (missing access)", context);
    } else {
      console.error("Modal override target edit failed", context);
    }
    // fall through to componentCommit
  }
}

// Components: editReply flow
payload = normalizeComponentsV2Payload(payload);
return componentCommit(interaction, payload);
};

try {
const owner = `discord:${interaction.id}`;
const isDevSubcommand = sub === "reset_tutorial" || sub === "wipe_user" || sub === "repair_profile" || sub === "repair_party" || sub === "subscriptions" || sub === "giveaway_winner" || sub === "dashboard";
const inDevPath = group === "dev" || isDevSubcommand;

const buildDevStatusEmbed = () => {
  const p = ensurePlayer(serverId, userId);
  const ordersDay = p.orders_day ?? "unknown";
  const marketDay = server.market_day ?? "unknown";
  const activeWindowHours = 24;
  const activeWindowMs = activeWindowHours * 60 * 60 * 1000;

  const ordersTimestamp = ordersDay !== "unknown" ? new Date(`${ordersDay}T00:00:00Z`).getTime() / 1000 : "unknown";
  const marketTimestamp = marketDay !== "unknown" ? new Date(`${marketDay}T00:00:00Z`).getTime() / 1000 : "unknown";

  const ordersStr = ordersTimestamp !== "unknown" ? `<t:${Math.floor(ordersTimestamp)}:f>` : "unknown";
  const marketStr = marketTimestamp !== "unknown" ? `<t:${Math.floor(marketTimestamp)}:f>` : "unknown";

  const guildCount = interaction.client?.guilds?.cache?.size ?? 0;
  const shardId = interaction.guild?.shardId ?? null;
  const shardCount = interaction.client?.shard?.count ?? null;
  const shardHealth = interaction.client?.noodleShardHealth ?? {};
  const recommendedShardCount = Number(shardHealth.recommendedShardCount);
  const shardThreshold = Number(shardHealth.threshold);
  const shardText = Number.isFinite(shardId) && Number.isFinite(shardCount)
    ? `${shardId + 1}/${shardCount}`
    : "n/a";
  const recommendedShardText = Number.isFinite(recommendedShardCount) && recommendedShardCount > 0
    ? recommendedShardCount.toLocaleString()
    : "unknown";
  const shardThresholdText = Number.isFinite(shardThreshold) && shardThreshold > 0
    ? shardThreshold.toLocaleString()
    : "2,500";
  const mem = process.memoryUsage();
  const rssMb = (mem.rss / (1024 * 1024)).toFixed(1);
  const heapMb = (mem.heapUsed / (1024 * 1024)).toFixed(1);
  let activeUsers = "unknown";
  if (db) {
    try {
      const cutoff = nowTs() - activeWindowMs;
      const row = db.prepare("SELECT COUNT(DISTINCT user_id) AS count FROM players WHERE last_active_at >= ?").get(cutoff);
      activeUsers = String(Number(row?.count ?? 0));
    } catch {
      // Ignore stats query errors.
    }
  }

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
    `${getIcon("profile")} Global active users (${activeWindowHours}h): ${activeUsers}`,
    `${getIcon("stats")} Memory: ${rssMb} MB RSS / ${heapMb} MB heap`,
    `${getIcon("leaderboard")} Shard: ${shardText}`,
    `${getIcon("leaderboard")} Recommended shards: ${recommendedShardText} (threshold ${shardThresholdText}/shard)`,
    `${getIcon("refresh")} Last backup: ${lastBackup}`
  ].join("\n");

  return buildMenuEmbed({
    title: `${getIcon("stats")} Status`,
    description: statusInfo,
    user: interaction.member ?? interaction.user
  });
};

const buildDevMessageEmbed = ({ message, isError = false, title = null }) =>
  buildMenuEmbed({
    title: String(title || "").trim() || (isError ? `${getIcon("error")} Dev Command` : `${getIcon("status_complete")} Dev Command`),
    description: message,
    user: interaction.member ?? interaction.user
  });

if (inDevPath) {
  if (!isDevAdmin(userId)) {
    return commit({
      content: " ",
      ...composeV2FromLegacyEmbeds([buildDevMessageEmbed({ message: "You don’t have access to that command.", isError: true })]),
      ephemeral: true
    });
  }
  if (OFFICIAL_DEV_GUILD_ID && serverId !== OFFICIAL_DEV_GUILD_ID) {
    return commit({
      content: " ",
      ...composeV2FromLegacyEmbeds([
        buildDevMessageEmbed({
          message: "Developer commands are only available in the official server.",
          isError: true
        })
      ]),
      ephemeral: true
    });
  }
}

  const server = ensureServer(serverId);
  const settings = buildSettingsMap(settingsCatalog, server.settings);
  server.season = computeActiveSeason(settings);
  const activeEventEffects = getActiveEventEffects(eventsContent, server);
  rollMarket({ serverId, content, serverState: server, eventEffects: activeEventEffects });

if (inDevPath && sub === "reset_tutorial") {
  const target = opt.getUser("user") ?? interaction.user;
  if (target?.bot || (interaction.client?.user?.id && target.id === interaction.client.user.id)) {
    return commit({
      content: " ",
      ...composeV2FromLegacyEmbeds([buildDevMessageEmbed({ message: "Pick a real player account (non-bot) to reset.", isError: true })]),
      ephemeral: true
    });
  }

  if (!db) {
    return commit({
      content: " ",
      ...composeV2FromLegacyEmbeds([buildDevMessageEmbed({ message: "Database unavailable in this environment.", isError: true })]),
      ephemeral: true
    });
  }
  return await withLock(db, `lock:user:${target.id}`, owner, 8000, async () => {
    const storageServerId = getPlayerStorageServerId(serverId);
    const rows = db.prepare("SELECT server_id, data_json, schema_version FROM players WHERE user_id=?").all(target.id);

    let resetCount = 0;
    for (const row of rows) {
      let parsed;
      try {
        parsed = row?.data_json ? JSON.parse(row.data_json) : null;
      } catch {
        parsed = null;
      }
      if (!parsed || typeof parsed !== "object") continue;
      resetTutorialState(parsed);
      db.prepare("UPDATE players SET state_rev=state_rev+1, last_active_at=?, data_json=? WHERE server_id=? AND user_id=?")
        .run(nowTs(), JSON.stringify(parsed), row.server_id, target.id);
      resetCount += 1;
    }

    // Ensure a canonical/global profile exists and is reset as well.
    const p = ensurePlayer(serverId, target.id);
    resetTutorialState(p);
    upsertPlayer(db, storageServerId, target.id, p, null, p.schema_version);

    const step = getCurrentTutorialStep(p);
    const tut = formatTutorialMessage(step);
    const mention = `<@${target.id}>`;

    return commit({
      content: " ",
      ...composeV2FromLegacyEmbeds([
        buildDevMessageEmbed({
          message: `${getIcon("status_complete")} Complete reset for ${mention} (${target.id}) (${Math.max(resetCount, 1)} profile row${Math.max(resetCount, 1) === 1 ? "" : "s"}).${tut ? `\n\n${tut}` : ""}`
        })
      ]),
      ephemeral: true
    });
  });
}

if (inDevPath && sub === "wipe_user") {
  const targetUser = opt.getUser("user");
  const targetUserId = targetUser?.id || opt.getString("user_id")?.trim();
  const targetServerId = opt.getString("server_id")?.trim() || serverId;
  if (!targetUserId) {
    return commit({
      content: " ",
      ...composeV2FromLegacyEmbeds([buildDevMessageEmbed({ message: "Provide a user or user ID to wipe.", isError: true })]),
      ephemeral: true
    });
  }
  if (!db) {
    return commit({
      content: " ",
      ...composeV2FromLegacyEmbeds([buildDevMessageEmbed({ message: "Database unavailable in this environment.", isError: true })]),
      ephemeral: true
    });
  }

  const lockKey = `lock:user:${targetUserId}`;
  return await withLock(db, lockKey, owner, 8000, async () => {
    const deleted = deletePlayerProfiles(db, targetUserId, { allServers: true });
    const mention = `<@${targetUserId}>`;
    if (deleted === 0) {
      return commit({
        content: " ",
        ...composeV2FromLegacyEmbeds([
          buildDevMessageEmbed({
            message: `${getIcon("error")} No profile found for ${mention}.`,
            isError: true
          })
        ]),
        ephemeral: true
      });
    }
    return commit({
      content: " ",
      ...composeV2FromLegacyEmbeds([
        buildDevMessageEmbed({
          message: `${getIcon("status_complete")} Deleted ${deleted} profile row(s) for ${mention} across all servers.`
        })
      ]),
      ephemeral: true
    });
  });
}

if (inDevPath && sub === "repair_profile") {
  const targetUser = opt.getUser("user");
  const targetUserId = targetUser?.id || opt.getString("user_id")?.trim() || userId;
  const force = opt.getBoolean("force") === true;
  if (!targetUserId) {
    return commit({
      content: " ",
      ...composeV2FromLegacyEmbeds([buildDevMessageEmbed({ message: "Provide a user or user ID to repair.", isError: true })]),
      ephemeral: true
    });
  }
  if (!db) {
    return commit({
      content: " ",
      ...composeV2FromLegacyEmbeds([buildDevMessageEmbed({ message: "Database unavailable in this environment.", isError: true })]),
      ephemeral: true
    });
  }

  const lockKey = `lock:user:${targetUserId}`;
  return await withLock(db, lockKey, owner, 8000, async () => {
    const result = repairGlobalPlayerProfileFromLegacy(db, targetUserId, { force });
    const mention = `<@${targetUserId}>`;

    if (!result.ok) {
      return commit({
        content: " ",
        ...composeV2FromLegacyEmbeds([
          buildDevMessageEmbed({
            message: `${getIcon("error")} Repair failed for ${mention}: ${result.reason}.`,
            isError: true
          })
        ]),
        ephemeral: true
      });
    }

    if (!result.repaired) {
      return commit({
        content: " ",
        ...composeV2FromLegacyEmbeds([
          buildDevMessageEmbed({
            message: `${getIcon("error")} No repair needed for ${mention} (${result.reason}).`,
            isError: true
          })
        ]),
        ephemeral: true
      });
    }

    return commit({
      content: " ",
      ...composeV2FromLegacyEmbeds([
        buildDevMessageEmbed({
          message:
            `${getIcon("status_complete")} Repaired ${mention} from legacy server ${result.sourceServerId}. ` +
            `(legacyScore=${result.legacyScore}, globalScore=${result.globalScore}).`
        })
      ]),
      ephemeral: true
    });
  });
}

if (inDevPath && sub === "repair_party") {
  const partyIdInput = opt.getString("party_id")?.trim();
  const serverOverride = opt.getString("server_id")?.trim() || "";
  const targetServerId = serverOverride || serverId;
  const scopedServerId = serverOverride || null;

  if (!partyIdInput) {
    return commit({
      content: " ",
      ...composeV2FromLegacyEmbeds([buildDevMessageEmbed({ message: "Provide a party ID or prefix to repair.", isError: true })]),
      ephemeral: true
    });
  }
  if (!db) {
    return commit({
      content: " ",
      ...composeV2FromLegacyEmbeds([buildDevMessageEmbed({ message: "Database unavailable in this environment.", isError: true })]),
      ephemeral: true
    });
  }

  const lockScope = scopedServerId || "global";
  const lockKey = `lock:party:${lockScope}:${partyIdInput}`;
  return await withLock(db, lockKey, owner, 8000, async () => {
    try {
      const result = repairPartyRecord(db, partyIdInput, scopedServerId);
      const summary = [
        `Party: ${result.partyId} (server ${result.serverId})`,
        `Status: ${result.statusBefore} -> ${result.statusAfter}`,
        `Leader: <@${result.leaderBefore}> -> <@${result.leaderAfter}>`,
        `Active members: ${result.activeMemberCount}`
      ];

      if (!scopedServerId && result.serverId !== serverId) {
        summary.push(`Note: repaired party was found in a different server (${result.serverId}).`);
      }

      if (result.repaired) {
        summary.push(`Applied fixes: ${result.changes.join(", ")}`);
        return commit({
          content: " ",
          ...composeV2FromLegacyEmbeds([buildDevMessageEmbed({ message: `${getIcon("status_complete")} ${summary.join("\n")}` })]),
          ephemeral: true
        });
      }

      summary.push("No repair needed.");
      return commit({
        content: " ",
        ...composeV2FromLegacyEmbeds([buildDevMessageEmbed({ message: `${getIcon("status_complete")} ${summary.join("\n")}` })]),
        ephemeral: true
      });
    } catch (err) {
      return commit({
        content: " ",
        ...composeV2FromLegacyEmbeds([
          buildDevMessageEmbed({
            message: `${getIcon("error")} Party repair failed: ${err?.message || "unknown error"}`,
            isError: true
          })
        ]),
        ephemeral: true
      });
    }
  });
}

if (inDevPath && sub === "subscriptions") {
  const targetUser = opt.getUser("user");
  const targetUserId = targetUser?.id || opt.getString("user_id")?.trim() || userId;
  const targetServerId = opt.getString("server_id")?.trim() || serverId;

  if (!targetUserId) {
    return commit({
      content: " ",
      ...composeV2FromLegacyEmbeds([buildDevMessageEmbed({ message: "Provide a user or user ID to inspect.", isError: true })]),
      ephemeral: true
    });
  }
  if (!db) {
    return commit({
      content: " ",
      ...composeV2FromLegacyEmbeds([buildDevMessageEmbed({ message: "Database unavailable in this environment.", isError: true })]),
      ephemeral: true
    });
  }

  const lockKey = `lock:user:${targetUserId}`;
  return await withLock(db, lockKey, owner, 8000, async () => {
    const targetPlayer = getPlayer(db, targetServerId, targetUserId);
    if (!targetPlayer) {
      return commit({
        content: " ",
        ...composeV2FromLegacyEmbeds([
          buildDevMessageEmbed({
            message: `${getIcon("error")} No profile found for <@${targetUserId}> on server ${targetServerId}.`,
            isError: true
          })
        ]),
        ephemeral: true
      });
    }

    const subscriptions = ensureSubscriptionState(targetPlayer);
    const perks = subscriptions.perks ?? {};
    const now = nowTs();

    const formatTime = (ts) => {
      const n = Number(ts);
      if (!Number.isFinite(n) || n <= 0) return "-";
      return `<t:${Math.floor(n / 1000)}:f> (<t:${Math.floor(n / 1000)}:R>)`;
    };

    const perkLines = Object.values(SUBSCRIPTION_PERKS).map((perkId) => {
      const state = perks[perkId] ?? {};
      const activeNow = hasActivePerk(targetPlayer, perkId, now);
      const name = perkId === SUBSCRIPTION_PERKS.HOUSE_247 ? getHouse247Label() : getTakeoutCounterLabel();
      const status = activeNow ? "ACTIVE" : "inactive";
      return [
        `**${name}** (${perkId})`,
        `• status: ${status}`,
        `• entitlement_id: ${state.entitlement_id ?? "-"}`,
        `• period_start_at: ${formatTime(state.period_start_at)}`,
        `• period_end_at: ${formatTime(state.period_end_at)}`,
        `• last_coin_grant_period: ${state.last_coin_grant_period ?? "-"}`,
        `• last_coin_grant_at: ${formatTime(state.last_coin_grant_at)}`,
        `• last_event_type: ${state.last_event_type ?? "-"}`,
        `• last_event_at: ${formatTime(state.last_event_at)}`
      ].join("\n");
    });

    const description = [
      `User: <@${targetUserId}> (${targetUserId})`,
      `Server: ${targetServerId}`,
      `Coins: ${Number(targetPlayer.coins || 0).toLocaleString()}`,
      "",
      ...perkLines
    ].join("\n\n");

    const embed = buildMenuEmbed({
      title: `${getIcon("stats")} Subscription State`,
      description,
      user: interaction.member ?? interaction.user
    });

    return commit({
      content: " ",
      ...composeV2FromLegacyEmbeds([embed]),
      ephemeral: true
    });
  });
}

if (inDevPath && sub === "giveaway_winner") {
  const targetUser = opt.getUser("user");
  const targetUserId = targetUser?.id || opt.getString("user_id")?.trim() || userId;
  const targetServerId = opt.getString("server_id")?.trim() || serverId;
  const rewardType = String(opt.getString("reward_type") || "").trim().toLowerCase();
  const perkSelection = String(opt.getString("perk") || "").trim().toLowerCase();
  const coinPackId = String(opt.getString("coin_pack") || "").trim().toLowerCase();
  const coinAmountRaw = Number(opt.getInteger("coins"));
  const coinAmount = Number.isFinite(coinAmountRaw) && coinAmountRaw > 0
    ? Math.floor(coinAmountRaw)
    : 0;
  const durationDaysRaw = Number(opt.getInteger("duration_days"));
  const durationDays = Number.isFinite(durationDaysRaw) && durationDaysRaw > 0
    ? Math.floor(durationDaysRaw)
    : 30;

  if (!targetUserId) {
    return commit({
      content: " ",
      ...composeV2FromLegacyEmbeds([buildDevMessageEmbed({ message: "Provide a user or user ID to update.", isError: true })]),
      ephemeral: true
    });
  }
  if (!db) {
    return commit({
      content: " ",
      ...composeV2FromLegacyEmbeds([buildDevMessageEmbed({ message: "Database unavailable in this environment.", isError: true })]),
      ephemeral: true
    });
  }

  if (rewardType !== "perk" && rewardType !== "coin_pack" && rewardType !== "coins") {
    return commit({
      content: " ",
      ...composeV2FromLegacyEmbeds([buildDevMessageEmbed({ message: "Invalid reward type. Use perk, coin_pack, or coins.", isError: true })]),
      ephemeral: true
    });
  }

  const lockKey = `lock:user:${targetUserId}`;
  return await withLock(db, lockKey, owner, 8000, async () => {
    const existingPlayer = getPlayer(db, targetServerId, targetUserId);
    const targetPlayer = existingPlayer || newPlayerProfile(targetUserId);
    const now = nowTs();
    const rewardSummaryLines = [];
    let publicWinnerLine = "";

    if (rewardType === "perk") {
      let selectedPerkIds;
      if (perkSelection === "both") {
        selectedPerkIds = [SUBSCRIPTION_PERKS.HOUSE_247, SUBSCRIPTION_PERKS.TAKEOUT_COUNTER];
      } else if (perkSelection === SUBSCRIPTION_PERKS.HOUSE_247 || perkSelection === SUBSCRIPTION_PERKS.TAKEOUT_COUNTER) {
        selectedPerkIds = [perkSelection];
      } else {
        return commit({
          content: " ",
          ...composeV2FromLegacyEmbeds([buildDevMessageEmbed({ message: "For perk rewards, choose house_247, takeout_counter, or both.", isError: true })]),
          ephemeral: true
        });
      }

      const periodEndAt = now + (durationDays * 24 * 60 * 60 * 1000);
      let totalGrant = 0;
      const perkNames = {
        [SUBSCRIPTION_PERKS.HOUSE_247]: getHouse247Label(),
        [SUBSCRIPTION_PERKS.TAKEOUT_COUNTER]: getTakeoutCounterLabel()
      };

      for (const perkId of selectedPerkIds) {
        applySubscriptionEntitlementEvent(targetPlayer, {
          perkId,
          eventType: "ENTITLEMENT_UPDATE",
          entitlementId: `dev_manual:giveaway:${perkId}:${targetUserId}`,
          periodStartAt: now,
          periodEndAt,
          now
        });

        const grantResult = applyMonthlySubscriptionCoinGrant(targetPlayer, {
          perkId,
          periodStartAt: now,
          periodEndAt,
          now
        });
        if (grantResult?.granted) {
          totalGrant += Math.max(0, Math.floor(Number(grantResult.amount || 0) || 0));
        }

        rewardSummaryLines.push(`• Granted perk: ${perkNames[perkId]} for ${durationDays} day${durationDays === 1 ? "" : "s"}.`);
      }

      rewardSummaryLines.push(`• Monthly subscription coins credited now: **${totalGrant}c**.`);
      const perkRewardIcon = selectedPerkIds.length === 1
        ? (selectedPerkIds[0] === SUBSCRIPTION_PERKS.HOUSE_247 ? getIcon("perk_house_247", getIcon("sparkle")) : getIcon("perk_takeout_counter", getIcon("orders")))
        : `${getIcon("perk_house_247", getIcon("sparkle"))} ${getIcon("perk_takeout_counter", getIcon("orders"))}`;
      publicWinnerLine = `${perkRewardIcon} Giveaway winner reward sent to <@${targetUserId}>: **${selectedPerkIds.length > 1 ? "Perks" : "Perk"}** (${durationDays} day${durationDays === 1 ? "" : "s"}).`;
    } else if (rewardType === "coin_pack") {
      const pack = getStoreCoinPack(coinPackId);
      if (!pack) {
        return commit({
          content: " ",
          ...composeV2FromLegacyEmbeds([buildDevMessageEmbed({ message: "For coin pack rewards, choose a valid coin_pack option.", isError: true })]),
          ephemeral: true
        });
      }

      const grantResult = grantStoreCoinPack({ player: targetPlayer, coinPackId });
      if (!grantResult?.ok) {
        return commit({
          content: " ",
          ...composeV2FromLegacyEmbeds([buildDevMessageEmbed({ message: `Failed to grant coin pack: ${grantResult?.reason || "unknown error"}.`, isError: true })]),
          ephemeral: true
        });
      }

      rewardSummaryLines.push(`• Granted coin pack: ${pack.priceLabel} (${pack.coins.toLocaleString()}c).`);
      publicWinnerLine = `${getIcon("coins")} Giveaway winner reward sent to <@${targetUserId}>: **${pack.coins.toLocaleString()}c** (${pack.priceLabel} pack).`;
    } else {
      if (coinAmount <= 0) {
        return commit({
          content: " ",
          ...composeV2FromLegacyEmbeds([buildDevMessageEmbed({ message: "For coin rewards, provide a coins value greater than 0.", isError: true })]),
          ephemeral: true
        });
      }

      targetPlayer.coins = (Number(targetPlayer.coins) || 0) + coinAmount;
      if (!targetPlayer.lifetime || typeof targetPlayer.lifetime !== "object") {
        targetPlayer.lifetime = {};
      }
      targetPlayer.lifetime.coins_earned = (Number(targetPlayer.lifetime.coins_earned) || 0) + coinAmount;

      rewardSummaryLines.push(`• Granted direct coins: **${coinAmount.toLocaleString()}c**.`);
      publicWinnerLine = `${getIcon("coins")} Giveaway winner reward sent to <@${targetUserId}>: **${coinAmount.toLocaleString()}c**.`;
    }

    upsertPlayer(db, targetServerId, targetUserId, targetPlayer, null, targetPlayer.schema_version);

    const conciseSummary = rewardSummaryLines.length > 0 ? rewardSummaryLines[0].replace(/^•\s*/, "") : "";
    const messageLines = [
      publicWinnerLine,
      conciseSummary ? `\n${conciseSummary}` : null
    ].filter(Boolean);

    return commit({
      content: " ",
      ...composeV2FromLegacyEmbeds([buildDevMessageEmbed({
        title: `${getIcon("status_complete")} Giveaway`,
        message: messageLines.join("\n")
      })]),
      ephemeral: false
    });
  });
}

if (inDevPath && sub === "dashboard") {
  const guilds = [...(interaction.client?.guilds?.cache?.values?.() ?? [])]
    .map((guild) => ({
      name: guild?.name ?? "Unknown Server",
      id: guild?.id ?? "unknown",
      members: Number.isFinite(guild?.memberCount) ? guild.memberCount : null
    }))
    .sort((a, b) => {
      const aMembers = Number.isFinite(a.members) ? a.members : -1;
      const bMembers = Number.isFinite(b.members) ? b.members : -1;
      if (bMembers !== aMembers) return bMembers - aMembers;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

  const headerLine = "Member count | Server ID | Server name";
  const maxDescriptionChars = 3800;
  const serverLines = guilds.map((guild) => `• ${guild.members ?? "unknown"} | ${guild.id} | ${guild.name}`);

  const serverPages = [];
  let currentPageLines = [];
  let currentUsed = `${headerLine}\n\n`.length;
  for (const line of serverLines) {
    const needed = line.length + 1;
    if (currentPageLines.length > 0 && currentUsed + needed > maxDescriptionChars) {
      serverPages.push(currentPageLines);
      currentPageLines = [line];
      currentUsed = `${headerLine}\n\n`.length + needed;
      continue;
    }
    currentPageLines.push(line);
    currentUsed += needed;
  }
  if (currentPageLines.length > 0 || serverPages.length === 0) {
    serverPages.push(currentPageLines);
  }

  const totalServerPages = Math.max(1, serverPages.length);
  const requestedServerPage = Number(opt.getInteger("dashboard_server_page") ?? 0);
  const clampedServerPage = Number.isFinite(requestedServerPage)
    ? Math.min(Math.max(Math.floor(requestedServerPage), 0), totalServerPages - 1)
    : 0;

  const shownCountBeforePage = serverPages
    .slice(0, clampedServerPage)
    .reduce((sum, pageLines) => sum + pageLines.length, 0);
  const shownCountThisPage = serverPages[clampedServerPage]?.length ?? 0;
  const shownStart = shownCountThisPage > 0 ? shownCountBeforePage + 1 : 0;
  const shownEnd = shownCountBeforePage + shownCountThisPage;

  const description = [
    headerLine,
    "",
    ...(serverPages[clampedServerPage] ?? [])
  ].filter(Boolean).join("\n");

  const paginationText = `Page ${clampedServerPage + 1}/${totalServerPages} • Showing ${shownStart}-${shownEnd} of ${guilds.length} servers`;
  const ownerText = ownerFooterText(interaction.member ?? interaction.user);
  const dashboardFooter = `${paginationText} • ${ownerText}`;

  const serversEmbed = buildMenuEmbed({
    title: `${getIcon("group")} Bot Servers (${guilds.length})`,
    description,
    user: interaction.member ?? interaction.user
  });
  serversEmbed.setFooter({ text: dashboardFooter.slice(0, 2048) });

  const statusEmbed = buildDevStatusEmbed();
  const pageRaw = Number(opt.getInteger("dashboard_page") ?? 0);
  const page = pageRaw === 1 ? 1 : 0;
  const prevServerPage = clampedServerPage <= 0 ? totalServerPages - 1 : clampedServerPage - 1;
  const nextServerPage = clampedServerPage >= totalServerPages - 1 ? 0 : clampedServerPage + 1;

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle-dev:dashboard:nav:${userId}:0:${clampedServerPage}`)
      .setLabel("Servers")
      .setStyle(page === 0 ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`noodle-dev:dashboard:nav:${userId}:1:${clampedServerPage}`)
      .setLabel("Status")
      .setStyle(page === 1 ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(page === 1),
    new ButtonBuilder()
      .setCustomId(`noodle-dev:dashboard:nav:${userId}:0:${prevServerPage}`)
      .setLabel("Prev")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page !== 0 || totalServerPages <= 1),
    new ButtonBuilder()
      .setCustomId(`noodle-dev:dashboard:nav:${userId}:0:${nextServerPage}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page !== 0 || totalServerPages <= 1)
  );

  return commit({
    content: " ",
    ...composeV2FromLegacyEmbeds([page === 0 ? serversEmbed : statusEmbed]),
    components: [navRow],
    ephemeral: false
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

seasonRolloverNotice = player
  ? applySeasonRolloverReward(player, server.season, {
      eventRecipeSeasonIndex,
      recipes: content?.recipes
    })
  : null;
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
    const step = getCurrentTutorialStep(p);
    const tut = formatTutorialMessage(step);
    const tutorialDone = !p.tutorial?.active || !step;
    const tutorialEmbed = buildMenuEmbed({
      title: tutorialDone ? `${getIcon("status_complete")} Tutorial Complete` : `${getIcon("orders")} Tutorial`,
      description: tutorialDone
        ? "You have already completed the tutorial. Use the menu below to play."
        : (tut ?? "Welcome to your Noodle Story."),
      user: interaction.member ?? interaction.user
    });

    const questsAvailable = hasDailyRewardAvailable(p, nowTs()) || hasClaimableQuests(p);

    return commit({
      content: " ",
      ...composeV2FromLegacyEmbeds([tutorialEmbed]),
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
    ...composeV2FromLegacyEmbeds([embed]),
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
  const newsAvailable = viewingSelf && hasUnreadNewsUpdate(selfPlayer, newsContent);
  const showTakeoutProfileButton = viewingSelf && hasActivePerk(selfPlayer, SUBSCRIPTION_PERKS.TAKEOUT_COUNTER, nowTs());
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
    ? [noodleMainMenuRowNoProfile(userId, { newsAvailable, showTakeout: showTakeoutProfileButton }), socialMainMenuRowNoProfile(userId, { questsAvailable, specializationsAvailable })]
    : [];

  if (isComponentsV2Enabled({ guildId: serverId, userId, player: selfPlayer })) {
    return commit(buildProfileHomeV2Message({
      userId,
      embed,
      viewingSelf,
      showTakeout: showTakeoutProfileButton,
      newsAvailable,
      questsAvailable,
      specializationsAvailable,
      ownerId: userId,
      buttonEmoji: getProfileV2ButtonEmoji()
    }));
  }

  return commit({
    ...composeV2FromLegacyEmbeds([embed]),
    components: profileComponents
  });
}

/* ---------------- ABOUT ---------------- */
if (sub === "about") {
  const liveServerCount = Number(interaction.client?.guilds?.cache?.size ?? 0);
  let liveShopCount = null;
  if (db) {
    try {
      liveShopCount = getCachedDistinctShopCount(db);
    } catch {
      // Ignore count query issues for About view.
    }
  }

  const aboutProfileImageUrl = getIconUrl("about_profile");
  const aboutEmbed = buildMenuEmbed({
    title: `${getIcon("sparkle")} About`,
    description:
      "**Creator:** *Erma Starling*\n\n" +
      "Noodle Story is a cozy passion project that began in Jan. 2026, lovingly solo-developed as Erma's first game. " +
      "It is built to feel warm, playful, and a little comforting after a long day.\n\n" +
      "And yes, she's obsessed with noodles... it's a problem.",
    user: interaction.member ?? interaction.user,
    color: theme.colors.info
  });

  aboutEmbed.addFields(
    {
      name: `${getIcon("group")} Servers`,
      value: `\`\`${liveServerCount.toLocaleString("en-US")}\`\``,
      inline: true
    },
    {
      name: `${getIcon("profile")} Noodle Shops`,
      value: `\`\`${liveShopCount === null ? "Unknown" : liveShopCount.toLocaleString("en-US")}\`\``,
      inline: true
    }
  );

  if (aboutProfileImageUrl) {
    aboutEmbed.setThumbnail(aboutProfileImageUrl);
  }

  const aboutSupportRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Join Support Server")
      .setStyle(ButtonStyle.Link)
      .setURL(SUPPORT_SERVER_URL),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:profile:${userId}`)
      .setLabel("Back")
      .setEmoji(getButtonEmoji("back"))
      .setStyle(ButtonStyle.Secondary)
  );

  return commit({
    content: " ",
    ...composeV2FromLegacyEmbeds([aboutEmbed]),
    components: [noodleAboutNewsNavRow(userId, { active: "about" }), aboutSupportRow]
  });
}

/* ---------------- NEWS ---------------- */
if (sub === "news") {
  const viewerPlayer = ensurePlayer(serverId, userId);
  if (db && markNewsAsSeen(viewerPlayer, newsContent)) {
    upsertPlayer(db, serverId, userId, viewerPlayer, null, viewerPlayer.schema_version);
  }

  const classificationLabel = (classification) => {
    if (classification === "internal_update") {
      return `${getIcon("customize")} Internal Update`;
    }
    return `${getIcon("sparkle")} Player Update`;
  };

  const showInternalUpdates = false;

  const sections = Array.isArray(newsContent?.sections) ? newsContent.sections : [];
  const pinned = newsContent?.pinned ?? {};
  const pinnedClassification = normalizeNewsClassification(pinned?.classification);
  const includePinned = showInternalUpdates || pinnedClassification !== "internal_update";

  const visibleEntries = getVisibleSortedNewsEntries(newsContent, { includeInternal: showInternalUpdates });

  const latest = visibleEntries[0] ?? null;
  const previous = visibleEntries[1] ?? null;

  const latestVersion = latest
    ? formatNewsVersion(latest.entry?.version, "v0.0.0")
    : (includePinned ? formatNewsVersion(pinned?.version, "v0.0.0") : "v0.0.0");
  const latestDate = latest
    ? (String(latest.entry?.date ?? "TBD").trim() || "TBD")
    : (includePinned ? (String(pinned?.date ?? "TBD").trim() || "TBD") : "TBD");
  const latestClassLabel = latest
    ? classificationLabel(normalizeNewsClassification(latest.entry?.classification))
    : classificationLabel(includePinned ? pinnedClassification : "player_update");
  const latestChanges = latest
    ? (Array.isArray(latest.entry?.changes) ? latest.entry.changes : [])
    : [];
  const latestSummary = latest
    ? (latestChanges.length
      ? latestChanges.map((change) => `• ${String(change ?? "").trim()}`).join("\n")
      : "• No changes listed.")
    : (includePinned
      ? (String(pinned?.summary ?? "No update summary yet.").trim() || "No update summary yet.")
      : "No player-facing updates yet.");
  const introText = String(newsContent?.intro ?? "*This feed is updated so players can quickly see what's changed.*").trim();
  const clampFieldValue = (text, maxLen = 1024) => {
    const value = String(text ?? "").trim();
    if (!value) return "-";
    if (value.length <= maxLen) return value;
    return `${value.slice(0, Math.max(1, maxLen - 3))}...`;
  };

  const newsEmbed = buildMenuEmbed({
    title: `${getIcon("new")} News`,
    description: `${getIcon("idea")} ${introText}`,
    user: interaction.member ?? interaction.user,
    color: theme.colors.success
  });

  let previousSectionText = "**Previous Update**\nNo previous update yet.";
  if (previous) {
    const previousVersion = formatNewsVersion(previous.entry?.version, "v0.0.0");
    const previousDate = String(previous.entry?.date ?? "TBD").trim() || "TBD";
    const previousClassLabel = classificationLabel(normalizeNewsClassification(previous.entry?.classification));
    const previousChanges = Array.isArray(previous.entry?.changes) ? previous.entry.changes : [];
    const previousText = previousChanges.length
      ? previousChanges.map((change) => `• ${String(change ?? "").trim()}`).join("\n")
      : "• No changes listed.";
    previousSectionText = [
      "**Previous Update**",
      `*${previousVersion} · ${previousDate} · ${previousClassLabel}*`,
      previousText
    ].join("\n");
  }

  let upcomingSectionText = "**Upcoming**\nNo upcoming notes yet.";
  const upcomingSection = sections.find((section) => {
    const title = String(section?.title ?? "").trim().toLowerCase();
    return title === "upcoming" || title === "upcoming updates" || title.startsWith("upcoming");
  });
  if (upcomingSection) {
    const upcomingItems = Array.isArray(upcomingSection?.items) ? upcomingSection.items : [];
    let upcomingText = "";
    if (upcomingItems.length) {
      upcomingText = upcomingItems.map((item) => `• ${String(item ?? "").trim()}`).join("\n");
    } else {
      const upcomingBody = String(upcomingSection?.body ?? "").trim();
      upcomingText = upcomingBody || "• No upcoming notes yet.";
    }
    upcomingSectionText = [
      "**Upcoming**",
      upcomingText
    ].join("\n");
  }

  const nowMs = nowTs();
  const allEvents = Array.isArray(eventsContent?.events) ? eventsContent.events : [];
  const activeSeasonalEvent = getActiveEvent(eventsContent, server);
  const activeWindow = activeSeasonalEvent ? getEventWindow(activeSeasonalEvent, nowMs) : { start: null, end: null };

  const nextEventCandidates = allEvents
    .map((event) => {
      const currentWindow = getEventWindow(event, nowMs);
      const nextCycleWindow = getEventWindow(event, nowMs + NEXT_EVENT_LOOKAHEAD_MS);
      const starts = [currentWindow?.start, nextCycleWindow?.start]
        .filter((start) => Number.isFinite(start) && start > nowMs)
        .sort((a, b) => a - b);
      return {
        event,
        start: starts[0] ?? null
      };
    })
    .filter(({ start }) => Number.isFinite(start))
    .sort((a, b) => a.start - b.start);

  const nextEvent = nextEventCandidates[0] ?? null;
  const activeEndText = Number.isFinite(activeWindow?.end)
    ? `<t:${Math.floor(activeWindow.end / 1000)}:R>`
    : "TBD";
  const nextStartText = Number.isFinite(nextEvent?.start)
    ? `<t:${Math.floor(nextEvent.start / 1000)}:R>`
    : "TBD";
  const activeEventLabel = activeSeasonalEvent?.name ?? "Current seasonal event";
  const nextEventLabel = nextEvent?.event?.name ?? "Next seasonal event";

  const seasonalNotice = [
    `**${activeEventLabel}** ends: ${activeEndText}, **${nextEventLabel}** begins: ${nextStartText}`,
    "*Try to discover one or all of this season's event recipes before the season ends so you can earn the event badge!*"
  ].join("\n");
  const dotColumnDivider = "· · · · · · ·";

  newsEmbed.addFields({
    name: `${getIcon("new")} Updates`,
    value: clampFieldValue([
      dotColumnDivider,
      "**Latest Update**",
      `*${latestVersion} · ${latestDate} · ${latestClassLabel}*`,
      latestSummary,
      "",
      previousSectionText
    ].join("\n")),
    inline: true
  });

  newsEmbed.addFields({
    name: `${getIcon("calendar")} Upcoming & Seasonal`,
    value: clampFieldValue([
      "\u200b",
      dotColumnDivider,
      upcomingSectionText,
      "",
      `**${getIcon("event")} Seasonal Event Reminder**`,
      seasonalNotice
    ].join("\n")),
    inline: true
  });

  return commit({
    content: " ",
    ...composeV2FromLegacyEmbeds([newsEmbed]),
    components: [noodleAboutNewsNavRow(userId, { active: "news" }), noodleAboutNewsBackRow(userId)]
  });
}

/* ---------------- PROFILE EDIT ---------------- */
if (sub === "profile_edit") {
  const p = ensurePlayer(serverId, userId);
  const specializationsAvailable = getSpecializationAlert(p);
  if (isComponentsV2Enabled({ guildId: serverId, userId, player: p })) {
    return commit(buildProfileEditV2Message({
      userId,
      specializationsAvailable,
      ownerId: userId,
      buttonEmoji: getProfileV2ButtonEmoji()
    }));
  }
  const embed = buildMenuEmbed({
    title: `${getIcon("customize")} Customize Profile`,
    description: [
      "• Change your shop name & give it a tagline here.",
      "",
      "• You unlock specializations as your shop levels up. Changing your active specialization updates your shop decor.",
      "",
      "• Check out the **Store** to browse all premium options:",
      "  - Premium Shop Specializations",
      "  - Coin Packs",
      `  - ${getTakeoutCounterLabel()} Subscription Perk`
    ].join("\n"),
    user: interaction.member ?? interaction.user
  });
  return commit({
    content: " ",
    ...composeV2FromLegacyEmbeds([embed]),
    components: [noodleProfileEditRow(userId, { specializationsAvailable }), noodleProfileEditBackRow(userId)]
  });
}

if (sub === "store") {
  const p = ensurePlayer(serverId, userId);
  const specializationsAvailable = getSpecializationAlert(p);
  const specState = ensureSpecializationState(p);
  const unlockedSpecIds = new Set(specState?.unlocked_spec_ids ?? []);
  const takeoutActive = hasActivePerk(p, SUBSCRIPTION_PERKS.TAKEOUT_COUNTER, nowTs());
  const purchasableSpecs = (specializationsContent?.specializations ?? [])
    .filter((spec) => spec?.requirements?.purchase_required)
    .sort((a, b) => String(a?.name ?? "").localeCompare(String(b?.name ?? "")));
  const purchasableLines = purchasableSpecs.map((spec) => {
    const isPurchased = unlockedSpecIds.has(spec.spec_id);
    const specIcon = resolveIcon(spec.icon, getIcon("sparkle"));
    return isPurchased
      ? `${getIcon("status_complete")} ${specIcon} ${spec.name} (Purchased)`
      : `${specIcon} ${spec.name}`;
  });

  const coinPackLines = Object.values(STORE_COIN_PACKS)
    .sort((a, b) => Number(a?.priceUsd || 0) - Number(b?.priceUsd || 0))
    .map((pack) => `${getIcon("coins")} ${pack.priceLabel} — **${Number(pack.coins || 0).toLocaleString()}c**`);

  const takeoutPerkLines = [
    `${takeoutActive ? getIcon("status_complete") : getIcon("status_pending")} ${getTakeoutCounterLabel()} — ${takeoutActive ? "Active" : "Not active"}`,
    `${getIcon("coins")} Includes **${SUBSCRIPTION_MONTHLY_COIN_GRANT.toLocaleString()}c** per month while subscription is active.`,
    `${getIcon("perk_takeout_counter")} Start 12-hour counter shifts where your main shop goes idle and you serve from your Take Out Counter menu, bank **massive extra coins** while you're away with this perk.`
  ];

  const storeEmbed = buildMenuEmbed({
    title: `${getIcon("cart")} Noodle Story Store`,
    description:
      "Browse premium content for your shop\n" +
      `• Premium Shop Specializations include **10,000c** each\n` +
      `• Coin Packs\n` +
      `• ${getTakeoutCounterLabel()} Subscription Perk\n\n` +
      `**[Open Store](${DISCORD_STORE_URL})**`,
    user: interaction.member ?? interaction.user
  });
  storeEmbed.setURL(DISCORD_STORE_URL);
  storeEmbed.setFields([
    ...chunkLinesIntoEmbedFields(purchasableLines, {
      firstFieldName: `${getIcon("sparkle")} Premium Specializations`,
      continuationFieldName: `${getIcon("sparkle")} Premium Specializations (cont.)`,
      maxFieldLength: 1000,
      maxFields: 8
    }),
    {
      name: `${getIcon("coins")} Coin Packs`,
      value: coinPackLines.join("\n") || "_No coin packs configured._",
      inline: false
    },
    {
      name: `${getIcon("perk_takeout_counter", getIcon("orders"))} Subscription Perk`,
      value: takeoutPerkLines.join("\n"),
      inline: false
    }
  ]);

  const storeLinkRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Open Store")
      .setEmoji(getButtonEmoji("cart"))
      .setStyle(ButtonStyle.Link)
      .setURL(DISCORD_STORE_URL)
  );

  return commit({
    content: " ",
    ...composeV2FromLegacyEmbeds([storeEmbed]),
    components: [storeLinkRow, noodleProfileEditRow(userId, { specializationsAvailable }), noodleProfileEditBackRow(userId)]
  });
}

/* ---------------- PANTRY ---------------- */
if (sub === "pantry") {
  if (!db) {
    return commit({ content: "Database unavailable in this environment.", ephemeral: true });
  }

  const lockedPayload = await withLock(db, `lock:user:${userId}`, owner, 8000, async () => {
    const p = ensurePlayer(serverId, userId);
    const s = ensureServer(serverId);
    unlockNoticePlayer = p;
    const rawPage = opt.getInteger("page") ?? overrides?.integers?.page ?? 0;
    const pantryStartMs = performance.now();
    const phaseMs = {};
    const gardenUnlocked = isGardenUnlocked(p);
    const { unlocked: kitchenUnlocked, justUnlocked: kitchenJustUnlocked } = getKitchenUnlockState(p);
    const { unlocked: fishingUnlocked, justUnlocked: fishingJustUnlocked } = getFishingUnlockState(p);
    const now = nowTs();
    const combinedEffects = calculateCombinedEffects(p, upgradesContent, staffContent, calculateStaffEffects);
    const lastActiveAt = db ? (getLastActiveAt(db, serverId, userId) || now) : now;

    const set = buildSettingsMap(settingsCatalog, s.settings);
    s.season = computeActiveSeason(set);

    const elapsedMs = Math.max(0, now - lastActiveAt);
    const spoilageTickHours = Number(set.SPOILAGE_TICK_HOURS ?? 1);
    const spoilageTickMs = Math.max(1, spoilageTickHours * 60 * 60 * 1000);
    const shouldRunCatchup = elapsedMs >= spoilageTickMs || elapsedMs >= (7 * 24 * 60 * 60 * 1000);
    const catchupStartMs = performance.now();
    const timeCatchup = shouldRunCatchup
      ? applyTimeCatchup(p, s, set, content, lastActiveAt, now, combinedEffects)
      : { applied: false, messages: [], spoilage: { messages: [] }, cooldownStatus: { expired: [], hasExpired: false } };
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
    phaseMs.catchupMs = performance.now() - catchupStartMs;

    const scanStartMs = performance.now();
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
    const itemNameCache = new Map();
    const recipeNameCache = new Map();
    const getItemNameCached = (itemId) => {
      if (itemNameCache.has(itemId)) return itemNameCache.get(itemId);
      const value = displayItemName(itemId);
      itemNameCache.set(itemId, value);
      return value;
    };
    const getRecipeNameCached = (recipeId) => {
      if (recipeNameCache.has(recipeId)) return recipeNameCache.get(recipeId);
      const value = displayRecipeName(recipeId);
      recipeNameCache.set(recipeId, value);
      return value;
    };

    const categoryLinesByType = new Map();
    const getCategoryLines = (category) => {
      if (categoryLinesByType.has(category)) return categoryLinesByType.get(category);
      const items = grouped.get(category) ?? new Map();
      const lines = [...items.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ qty, id }) => {
          const name = getItemNameCached(id);
          const starQty = category === "broth" ? Math.min(qty, getStarBrothCount(p, id)) : 0;
          const starPart = starQty > 0 ? ` ${getIcon("star", "⭐")} (${starQty})` : "";
          return `• ${name}: **${qty}**${starPart}`;
        });
      const have = countsByType[category] ?? 0;
      const cap = perTypeCap[category] ?? perTypeCap.topping ?? 0;
      const title = `**${typeLabels[category]} (${have}/${cap})**`;
      const value = [title, ...(lines.length ? lines : ["_None yet._"])];
      categoryLinesByType.set(category, value);
      return value;
    };

    const buildMergedCategoryLines = (categories) => {
      const merged = [];
      for (const category of categories) {
        if (merged.length) merged.push("");
        merged.push(...getCategoryLines(category));
      }
      return merged;
    };

    const brothBaseLines = getCategoryLines("broth");
    const noodleSpiceBaseLines = buildMergedCategoryLines(["noodles", "spice"]);
    const toppingProteinBaseLines = buildMergedCategoryLines(["topping", "protein"]);

    const brothProbe = getChunkPageByLines(brothBaseLines, 0, 900);
    const noodleSpiceProbe = getChunkPageByLines(noodleSpiceBaseLines, 0, 900);
    const toppingProteinProbe = getChunkPageByLines(toppingProteinBaseLines, 0, 900);
    const ingredientPages = Math.max(brothProbe.totalPages, noodleSpiceProbe.totalPages, toppingProteinProbe.totalPages);

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

    const bowlLineEntries = [...bowlGroups.entries()]
      .sort(([a], [b]) => {
        const nameA = getRecipeNameCached(a);
        const nameB = getRecipeNameCached(b);
        return String(nameA).localeCompare(String(nameB));
      })
      .map(([recipeId, entries]) => {
        const recipeName = getRecipeNameCached(recipeId);
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
      });
    const bowlCount = getBowlCount(p);
    const bowlCap = getBowlCapacity(p, combinedEffects);
    const bowlBaseLines = [
      `**${getIcon("cook")} Cooked Bowls (${bowlCount}/${bowlCap})**`,
      ...(bowlLineEntries.length ? bowlLineEntries : ["_None yet._"])
    ];
    const bowlProbe = getChunkPageByLines(bowlBaseLines, 0, 900);
    const bowlPages = Math.max(1, bowlProbe.totalPages);

    phaseMs.inventoryScanMs = performance.now() - scanStartMs;

    const totalPages = ingredientPages + bowlPages;
    const safePage = Math.min(Math.max(rawPage, 0), totalPages - 1);
    const ingredientPage = Math.min(safePage, ingredientPages - 1);
    const bowlPage = Math.min(Math.max(safePage - ingredientPages, 0), bowlPages - 1);

    const paginationStartMs = performance.now();
    const brothValue = getChunkPageByLines(brothBaseLines, ingredientPage, 900).text;
    const noodleSpiceValue = getChunkPageByLines(noodleSpiceBaseLines, ingredientPage, 900).text;
    const toppingProteinValue = getChunkPageByLines(toppingProteinBaseLines, ingredientPage, 900).text;
    const bowlsValue = getChunkPageByLines(bowlBaseLines, bowlPage, 900).text;
    phaseMs.paginationMs = performance.now() - paginationStartMs;

    const pendingPantryMessages = p.notifications?.pending_pantry_messages ?? [];
    if (pendingPantryMessages.length > 0) {
      p.notifications.pending_pantry_messages = [];
    }

    const persistStartMs = performance.now();
    if (db) {
      upsertPlayer(db, serverId, userId, p, null, p.schema_version);
      upsertServer(db, serverId, s, null);
    }
    phaseMs.persistMs = performance.now() - persistStartMs;

    const viewingIngredients = safePage < ingredientPages;
    const spoilageNotice = viewingIngredients
      ? (combinedEffects.spoilage_reduction > 0
        ? null
        : "Forageables & seafood spoil over time.\nTip: Cold Cellar upgrades reduce spoilage.")
      : null;

    const pantryDescription = [
      pendingPantryMessages.length ? pendingPantryMessages.join("\n") : null,
      spoilageNotice
    ].filter(Boolean).join("\n\n");

    const renderStartMs = performance.now();
    const pantryEmbed = buildMenuEmbed({
      title: `${getIcon("pantry")} Pantry`,
      description: pantryDescription,
      user: interaction.member ?? interaction.user
    });

    if (safePage < ingredientPages) {
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

    phaseMs.renderMs = performance.now() - renderStartMs;

    emitNavSubroutePhase("nav:pantry", phaseMs, {
      ingredientPages,
      bowlPages,
      safePage,
      totalMs: performance.now() - pantryStartMs
    });

    return {
      content: " ",
      ...composeV2FromLegacyEmbeds([pantryEmbed]),
      components: [
        pantryPageRow(userId, safePage, totalPages, ingredientPages),
        noodleForageGardenRow(userId, {
          active: "forage",
          gardenLocked: !gardenUnlocked,
          includeFishingButton: true,
          fishingUnlocked,
          fishingJustUnlocked,
          allowLockedFeatureInfo: true,
          fishingStyleOverride: fishingUnlocked ? ButtonStyle.Primary : null
        }),
        noodleRecipesMenuRow(userId, { kitchenUnlocked, kitchenJustUnlocked, allowLockedKitchenInfo: true }),
        noodleMainMenuRowNoPantry(userId)
      ]
    };
  });

  return commit(lockedPayload);
}

/* ---------------- KITCHEN ---------------- */
if (sub === "kitchen" || sub === "kitchen_start" || sub === "kitchen_collect") {
  if (!db) {
    return commit({ content: "Database unavailable in this environment.", ephemeral: true });
  }

  const lockedPayload = await withLock(db, `lock:user:${userId}`, owner, 8000, async () => {
    const p = ensurePlayer(serverId, userId);
    const s = ensureServer(serverId);
    unlockNoticePlayer = p;
    const now = nowTs();
    const page = opt.getInteger("page") ?? 0;
    const combinedEffects = calculateCombinedEffects(p, upgradesContent, staffContent, calculateStaffEffects);
    const gardenUnlocked = isGardenUnlocked(p);
    const { unlocked: fishingUnlocked, justUnlocked: fishingJustUnlocked } = getFishingUnlockState(p);
    const lastActiveAt = db ? (getLastActiveAt(db, serverId, userId) || now) : now;

    const set = buildSettingsMap(settingsCatalog, s.settings);
    s.season = computeActiveSeason(set);

    const elapsedMs = Math.max(0, now - lastActiveAt);
    const spoilageTickHours = Number(set.SPOILAGE_TICK_HOURS ?? 1);
    const spoilageTickMs = Math.max(1, spoilageTickHours * 60 * 60 * 1000);
    const shouldRunCatchup = elapsedMs >= spoilageTickMs || elapsedMs >= (7 * 24 * 60 * 60 * 1000);
    const timeCatchup = shouldRunCatchup
      ? applyTimeCatchup(p, s, set, content, lastActiveAt, now, combinedEffects)
      : { applied: false, messages: [], spoilage: { messages: [] }, cooldownStatus: { expired: [], hasExpired: false } };
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
      return { ...payload };
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

    if (!kitchenUnlocked && sub === "kitchen") {
      const lockedEmbed = buildMenuEmbed({
        title: `${getIcon("kitchen")} Kitchen`,
        description: [
          "Simmer gold-star broths with your forageables and proteins to cook higher quality bowls.",
          `${getIcon("lock")} Unlocks at shop level **${KITCHEN_UNLOCK_LEVEL}**.`
        ].join("\n\n"),
        user: interaction.member ?? interaction.user,
        color: theme.colors.success
      });
      return finalize({
        content: " ",
        ...composeV2FromLegacyEmbeds([lockedEmbed]),
        components: [
          noodleFeatureInfoRow(userId, {
            active: "kitchen",
            gardenUnlocked,
            kitchenUnlocked,
            kitchenJustUnlocked,
            fishingUnlocked,
            fishingJustUnlocked
          }),
          noodleMainMenuRow(userId)
        ]
      });
    }

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
          banner: `${getIcon("simmering_pot")} Select a broth to start simmering.`
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
        banner: `${getIcon("simmering_pot")} Now simmering **${displayItemName(brothId)}**. Used: ${usedLine || "pantry"}.`
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
          banner: `${getIcon("pantry")} Pantry full — free broth capacity to collect.`
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
        bannerParts.push(`${getIcon("pantry")} Pantry full for ${rejectedLines}.`);
      }

      const view = kitchenView({
        banner: bannerParts.join(" ")
      });
      return finalize(view);
    }

    const view = kitchenView();
    return finalize(view);
  });

  return commit(lockedPayload);
}

/* ---------------- RECIPES ---------------- */
if (sub === "takeout" || sub === "takeout_menu" || sub === "takeout_open" || sub === "takeout_claim" || sub === "takeout_cook" || sub === "takeout_serve" || sub === "takeout_needs") {
  if (!db) {
    const unavailableEmbed = buildMenuEmbed({
      title: getTakeoutCounterLabel(),
      description: `${getIcon("error")} Database unavailable in this environment.`,
      user: interaction.member ?? interaction.user,
      color: theme.colors.warning
    });
    return commit({ content: " ", ...composeV2FromLegacyEmbeds([unavailableEmbed]), ephemeral: true });
  }

  const lockedPayload = await withLock(db, `lock:user:${userId}`, owner, 8000, async () => {
    const p = ensurePlayer(serverId, userId);
    const s = ensureServer(serverId);
    unlockNoticePlayer = p;
    const now = nowTs();
    const takeout = ensureTakeoutState(p);
    const takeoutEnabled = hasActivePerk(p, SUBSCRIPTION_PERKS.TAKEOUT_COUNTER, now);

    const finalize = (payload) => {
      if (db) {
        upsertPlayer(db, serverId, userId, p, null, p.schema_version);
      }
      return payload;
    };

    const takeoutCatchup = processTakeoutCatchup(p, {
      now,
      recipes: content.recipes ?? {},
      marketPrices: s.market_prices ?? {},
      items: content.items ?? {}
    });
    if ((takeoutCatchup?.processedHours ?? 0) > 0) {
      emitTelemetry("takeout_shift_catchup", {
        userId,
        serverId,
        processedHours: takeoutCatchup.processedHours,
        earnedCoins: takeoutCatchup.earned,
        totalProcessedHours: takeoutCatchup.totalProcessedHours,
        completed: Boolean(takeoutCatchup.completed)
      });
    }

    const hasUnclaimedTakeoutCoins = Math.max(0, Math.floor(Number(takeout?.earned_unclaimed_coins || 0) || 0)) > 0;
    const hasActiveTakeoutShift = isTakeoutShiftActive(p, now);
    const isTakeoutStatusOrClaimRoute = sub === "takeout" || sub === "takeout_claim";
    const allowTakeoutGraceAccess = isTakeoutStatusOrClaimRoute && (hasActiveTakeoutShift || hasUnclaimedTakeoutCoins);

    if (!takeoutEnabled && !allowTakeoutGraceAccess) {
      const lockedEmbed = buildMenuEmbed({
        title: getTakeoutCounterLabel(),
        description: `${getIcon("lock")} ${getTakeoutCounterLabel()} requires an active subscription.`,
        user: interaction.member ?? interaction.user,
        color: theme.colors.warning
      });
      return finalize({
        content: " ",
        ...composeV2FromLegacyEmbeds([lockedEmbed]),
        ephemeral: true
      });
    }

    const availableRecipeIds = filterRecipeIdsByActiveSeasonEvent(getValidAvailableRecipeIds(p), s);
    const shiftActiveForMenu = isTakeoutShiftActive(p, now);
    if (!shiftActiveForMenu) {
      const availableRecipeSet = new Set(availableRecipeIds);
      const existingMenu = (takeout.menu_recipe_ids || []).filter((recipeId) => availableRecipeSet.has(recipeId));
      if (existingMenu.length !== (takeout.menu_recipe_ids || []).length) {
        takeout.menu_recipe_ids = existingMenu;
      }
    }

    const menuLimits = getTakeoutMenuLimits(availableRecipeIds.length);
    const requestedMenuPageRaw = Number(opt.getInteger("page") ?? 0);
    const requestedMenuPage = Number.isFinite(requestedMenuPageRaw) ? Math.max(0, requestedMenuPageRaw) : 0;
    const TAKEOUT_QUOTE_TTL_MS = 10 * 60 * 1000;
    const menuKey = (ids = []) => (Array.isArray(ids) ? ids.map((id) => String(id || "").trim()).filter(Boolean).join("|") : "");
    const currentMenuKey = menuKey(takeout.menu_recipe_ids || []);

    const clearTakeoutQuote = () => {
      takeout.next_shift_quote = null;
    };

    const readValidTakeoutQuote = ({ nowMs }) => {
      const quote = takeout?.next_shift_quote;
      if (!quote || typeof quote !== "object") return null;
      const quoteExpiresAt = Number(quote.expires_at || 0);
      const quoteCreatedAt = Number(quote.created_at || 0);
      const quoteMenuKey = String(quote.menu_key || "");
      const snapshot = Array.isArray(quote.snapshot) ? quote.snapshot : [];
      const requiredIngredients = (quote.required_ingredients && typeof quote.required_ingredients === "object")
        ? quote.required_ingredients
        : {};
      const snapshotOrderTotal = Math.max(0, Math.floor(Number(quote.snapshot_order_total || 0) || 0));
      const operatingCost = Math.max(0, Math.floor(Number(quote.operating_cost || 0) || 0));
      if (!Number.isFinite(quoteExpiresAt) || quoteExpiresAt <= nowMs) return null;
      if (!Number.isFinite(quoteCreatedAt) || quoteCreatedAt <= 0) return null;
      if (!quoteMenuKey || quoteMenuKey !== currentMenuKey) return null;
      if (!snapshot.length) return null;
      return {
        createdAt: quoteCreatedAt,
        expiresAt: quoteExpiresAt,
        menuKey: quoteMenuKey,
        snapshotOrderTotal,
        operatingCost,
        requiredIngredients,
        snapshot
      };
    };

    const buildAndStoreTakeoutQuote = ({ nowMs }) => {
      const set = buildSettingsMap(settingsCatalog, s.settings);
      s.season = computeActiveSeason(set);
      ensureDailyOrdersForPlayer(p, set, content, s.season, serverId, userId, s.active_event_id ?? null);
      applyHouse247OrderBoardOverride(p);

      const boardOrderTotal = Math.max(0, Math.floor(Number(p.orders_total_count || 0) || 0));
      const unlimitedOrders = hasHouse247Perk(p);
      const previewPlayer = {
        coins: Math.max(0, Math.floor(Number(p.coins || 0) || 0)),
        takeout: {
          menu_recipe_ids: Array.isArray(takeout?.menu_recipe_ids) ? [...takeout.menu_recipe_ids] : []
        }
      };
      const previewResult = startTakeoutShiftWithCoverage(previewPlayer, {
        now: nowMs,
        boardOrderTotal,
        unlimitedOrders,
        recipes: content.recipes ?? {},
        marketPrices: s.market_prices ?? {},
        items: content.items ?? {}
      });
      const previewSnapshot = Array.isArray(previewResult?.snapshot) ? previewResult.snapshot : [];
      const previewSnapshotOrderTotal = Math.max(
        0,
        Math.floor(
          Number(
            previewResult?.snapshotOrderTotal
            ?? previewSnapshot.reduce(
              (sum, row) => sum + Math.max(0, Math.floor(Number(row?.total_orders ?? row?.visible_order_count ?? 0) || 0)),
              0
            )
          ) || 0
        )
      );

      const quote = {
        created_at: nowMs,
        expires_at: nowMs + TAKEOUT_QUOTE_TTL_MS,
        menu_key: currentMenuKey,
        board_order_total: boardOrderTotal,
        unlimited_orders: unlimitedOrders,
        snapshot_order_total: previewSnapshotOrderTotal,
        operating_cost: Math.max(0, Math.floor(Number(previewResult?.operatingCost || 0) || 0)),
        required_ingredients: previewResult?.requiredIngredients ?? {},
        snapshot: previewSnapshot
      };

      if (!quote.snapshot.length || quote.snapshot_order_total <= 0) {
        return null;
      }

      takeout.next_shift_quote = quote;
      return readValidTakeoutQuote({ nowMs });
    };

    const renderStatus = (banner = null, { ephemeral = false, showMenuPicker = false, menuPage = requestedMenuPage } = {}) => {
      const active = isTakeoutShiftActive(p, nowTs());
      const shiftEndsAt = Number(takeout.shift?.ends_at || 0);
      const processedHours = Math.max(0, Math.floor(Number(takeout.shift?.last_processed_hour_index || 0) || 0));
      const remainingHours = Math.max(0, TAKEOUT_SHIFT_DURATION_HOURS - processedHours);
      const snapshot = Array.isArray(takeout.shift?.idle_order_board_snapshot)
        ? takeout.shift.idle_order_board_snapshot
        : [];
      const shiftOperatingCost = Math.max(0, Math.floor(Number(takeout.shift?.operating_cost || 0) || 0));
      const coveredIngredientsCount = Object.values(takeout.shift?.covered_ingredients ?? {})
        .reduce((sum, qty) => sum + Math.max(0, Math.floor(Number(qty || 0) || 0)), 0);
      const shiftSnapshotOrderCount = snapshot
        .reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row?.total_orders || row?.visible_order_count || 0) || 0)), 0);

      const quoteNow = nowTs();
      let nextShiftQuote = readValidTakeoutQuote({ nowMs: quoteNow });
      if (!active && !nextShiftQuote) {
        nextShiftQuote = buildAndStoreTakeoutQuote({ nowMs: quoteNow });
      }
      const projectedOperatingCost = Math.max(0, Math.floor(Number(nextShiftQuote?.operatingCost || 0) || 0));
      const projectedOrders = Math.max(0, Math.floor(Number(nextShiftQuote?.snapshotOrderTotal || 0) || 0));
      const nextShiftSnapshot = Array.isArray(nextShiftQuote?.snapshot) ? nextShiftQuote.snapshot : [];
      const counterMenuSnapshot = active
        ? snapshot
        : (nextShiftSnapshot.length > 0 ? nextShiftSnapshot : snapshot);

      const countByRecipe = new Map();
      for (const row of counterMenuSnapshot) {
        const rid = String(row?.recipe_id || "").trim();
        if (!rid) continue;
        const rawCount = active ? row?.visible_order_count : (row?.total_orders ?? row?.visible_order_count);
        const count = Math.max(0, Math.floor(Number(rawCount) || 0));
        countByRecipe.set(rid, count);
      }

      const counterMenuLines = takeout.menu_recipe_ids.length > 0
        ? takeout.menu_recipe_ids
          .map((rid) => `• ${displayRecipeName(rid)} — **${countByRecipe.get(rid) ?? 0}** orders`)
          .join("\n")
        : "_No menu configured yet._";

      const statusBits = [];
      if (active && Number.isFinite(shiftEndsAt) && shiftEndsAt > 0) {
        statusBits.push(`${getIcon("time")} **Shift Active,** ends <t:${Math.floor(shiftEndsAt / 1000)}:R> (<t:${Math.floor(shiftEndsAt / 1000)}:f>)`);
      } else {
        statusBits.push(`${getIcon("status_pending")} **Shift Inactive**`);
        statusBits.push(`${getIcon("coins")} Next shift ingredient cost: **${projectedOperatingCost}c**`);
        statusBits.push(`${getIcon("orders")} Next shift expected orders served: **${projectedOrders}**`);
      }
      const unclaimedIdleCoins = Math.max(0, Math.floor(Number(takeout.earned_unclaimed_coins || 0) || 0));
      if (unclaimedIdleCoins > 0) {
        statusBits.push(`${getIcon("coins")} Unclaimed idle coins: **${unclaimedIdleCoins}c**`);
      }
      if (shiftOperatingCost > 0) {
        statusBits.push(`${getIcon("coins")} Ingredients cost paid: **${shiftOperatingCost}c**`);
      }
      if (coveredIngredientsCount > 0) {
        statusBits.push(`${getIcon("basket")} Ingredients reserved for idle shift: **${coveredIngredientsCount}** units`);
      }
      if (shiftSnapshotOrderCount > 0) {
        statusBits.push(`${getIcon("orders")} Idle orders: **${shiftSnapshotOrderCount}** total`);
      }
      if (active) {
        statusBits.push(`${getIcon("time")} Completed hours: **${processedHours}/${TAKEOUT_SHIFT_DURATION_HOURS}**`);
        statusBits.push(`${getIcon("time")} Remaining hours: **${remainingHours}**`);
      }

      const hasStartedFirstTakeoutShift = Number.isFinite(Number(takeout.first_shift_started_at || 0))
        && Number(takeout.first_shift_started_at || 0) > 0;
      const minMenuRequired = Math.max(0, Math.floor(Number(menuLimits.minRequired || 0) || 0));
      const showFirstCounterSetupGuide = !active && !hasStartedFirstTakeoutShift;
      const firstCounterSetupGuide = showFirstCounterSetupGuide
        ? [
            minMenuRequired > 0
              ? `• Set your counter **Menu** with at least **${minMenuRequired}** recipe${minMenuRequired === 1 ? "" : "s"}.`
              : "• Set your counter **Menu** once you have learned recipes.",
            "• Tap **Counter** again to load your next shift ingredient cost + expected orders.",
            "• Tap **Start Shift** to begin your first 12h run.",
            "",
            `${getTakeoutCounterLabel()} Open **/noodle takeout** any time to manage your Take Out Counter shift.`
          ].join("\n")
        : null;

      const description = [
        banner,
        `Set your counter menu, start a cozy 12-hour shift, and collect idle earnings. While the shift is active, your main **Order Board** is idle and all service happens from **${getTakeoutCounterLabel()}**.`,
        "",
        takeoutCatchup?.processedHours > 0
          ? `${getIcon("time")} **${takeoutCatchup.processedHours}h** & earned **${takeoutCatchup.earned}c** while you were away.`
          : null,
        "\u200b",
        statusBits.join("\n"),
        `\n${getIcon("recipes")} **Counter Menu**`,
        `*Menu size: **${takeout.menu_recipe_ids.length}** (min ${menuLimits.minRequired}, max ${menuLimits.maxAllowed})*`,
        counterMenuLines
      ].filter(Boolean).join("\n");

      const embed = buildMenuEmbed({
        title: getTakeoutCounterLabel(),
        description,
        user: interaction.member ?? interaction.user,
        color: theme.colors.success
      });
      const firstCounterSetupEmbed = firstCounterSetupGuide
        ? buildMenuEmbed({
            title: `${getTakeoutCounterLabel()} Setup`,
            description: firstCounterSetupGuide,
            user: interaction.member ?? interaction.user
          })
        : null;

      const canOpenShift = takeoutEnabled && !active && takeout.menu_recipe_ids.length >= menuLimits.minRequired;
      const canClaim = Math.max(0, Math.floor(Number(takeout.earned_unclaimed_coins || 0) || 0)) > 0;
      const canCounterServe = takeoutEnabled && active && takeout.menu_recipe_ids.some((rid) => {
        const remaining = Math.max(0, Math.floor(Number(countByRecipe.get(rid) || 0) || 0));
        if (remaining <= 0) return false;
        return getTotalBowlsForRecipe(p, rid) > 0;
      });
      const menuPicker = showMenuPicker
        ? buildTakeoutMenuPickerRows(userId, {
            availableRecipeIds,
            selectedRecipeIds: readTakeoutMenuDraftSelection({
              serverId,
              userId,
              availableRecipeIds,
              fallbackRecipeIds: takeout.menu_recipe_ids
            }),
            minRequired: menuLimits.minRequired,
            maxAllowed: menuLimits.maxAllowed,
            page: menuPage
          })
        : null;

      const footerBase = `Coins: ${p.coins || 0}c`;
      const footerOwner = ownerFooterText(interaction.member ?? interaction.user);
      const pageLabel = menuPicker?.totalPages > 1 ? `Page ${menuPicker.safePage + 1}/${menuPicker.totalPages}` : null;
      const footerParts = [footerBase, pageLabel].filter(Boolean).join(" • ");
      embed.setFooter({ text: `${footerParts}\n${footerOwner}` });

      return {
        content: " ",
        ...composeV2FromLegacyEmbeds(firstCounterSetupEmbed ? [embed, firstCounterSetupEmbed] : [embed]),
        components: [
          ...(menuPicker?.rows ?? []),
          noodleTakeoutActionRow(userId, {
            activeShift: active,
            disableOpen: !canOpenShift,
            disableClaim: !canClaim,
            disableServe: !canCounterServe
          }),
          noodleMainMenuRowNoOrdersWithBack(userId)
        ],
        ephemeral
      };
    };

    if (sub === "takeout_menu") {
      if (isTakeoutShiftActive(p, now)) {
        return finalize(renderStatus(
          `${getIcon("time")} Your takeout shift is active. Update your counter menu after the current shift ends.`,
          { ephemeral: true }
        ));
      }

      const rawRecipes = String(opt.getString("recipes") || "").trim();
      const isDraftSelection = opt.getBoolean("menu_draft") === true;
      if (!rawRecipes) {
        if (!availableRecipeIds.length) {
          return finalize(renderStatus(`${getIcon("warning")} You need at least one learned recipe before setting a takeout menu.`, { ephemeral: true }));
        }
        return finalize(renderStatus(`${getIcon("recipes")} Pick recipes below to set your takeout menu.`, {
          showMenuPicker: true,
          menuPage: requestedMenuPage
        }));
      }

      const requestedIds = rawRecipes
        .split(",")
        .map((id) => resolveCanonicalRecipeId(id))
        .filter(Boolean);

      if (isDraftSelection) {
        const normalizedDraft = normalizeTakeoutDraftSelection(requestedIds, availableRecipeIds);
        writeTakeoutMenuDraftSelection({
          serverId,
          userId,
          selectedRecipeIds: normalizedDraft
        });

        if (normalizedDraft.length < menuLimits.minRequired) {
          return finalize(renderStatus(
            `${getIcon("recipes")} Menu draft saved: **${normalizedDraft.length}/${menuLimits.minRequired}** selected. Add at least **${menuLimits.minRequired - normalizedDraft.length}** more recipe${menuLimits.minRequired - normalizedDraft.length === 1 ? "" : "s"}.`,
            {
              ephemeral: true,
              showMenuPicker: true,
              menuPage: requestedMenuPage
            }
          ));
        }

        const menuResult = setTakeoutMenu(p, {
          menuRecipeIds: normalizedDraft,
          learnedRecipeIds: availableRecipeIds,
          now
        });

        if (!menuResult.ok) {
          if (menuResult.reason === "menu_too_small") {
            const needed = menuResult.limits?.minRequired ?? 0;
            return finalize(renderStatus(`${getIcon("warning")} Menu too small. Select at least **${needed}** recipe${needed === 1 ? "" : "s"}.`, {
              ephemeral: true,
              showMenuPicker: true,
              menuPage: requestedMenuPage
            }));
          }
          return finalize(renderStatus(`${getIcon("warning")} Could not update menu. Check recipe ids and try again.`, {
            ephemeral: true,
            showMenuPicker: true,
            menuPage: requestedMenuPage
          }));
        }

        clearTakeoutMenuDraftSelection({ serverId, userId });

        if (!isTakeoutShiftActive(p, nowTs())) {
          takeout.shift.idle_order_board_snapshot = takeout.menu_recipe_ids.map((rid) => ({
            recipe_id: rid,
            visible_order_count: 0
          }));
          clearTakeoutQuote();
        }

        return finalize(renderStatus(`${getIcon("status_complete")} Counter menu updated.`, {
          showMenuPicker: true,
          menuPage: requestedMenuPage
        }));
      }

      const menuResult = setTakeoutMenu(p, {
        menuRecipeIds: requestedIds,
        learnedRecipeIds: availableRecipeIds,
        now
      });

      if (!menuResult.ok) {
        if (menuResult.reason === "no_learned_recipes") {
          return finalize(renderStatus(`${getIcon("warning")} You need at least one learned recipe before setting a takeout menu.`, { ephemeral: true }));
        }
        if (menuResult.reason === "menu_too_small") {
          const needed = menuResult.limits?.minRequired ?? 0;
          return finalize(renderStatus(`${getIcon("warning")} Menu too small. Select at least **${needed}** recipe${needed === 1 ? "" : "s"}.`, { ephemeral: true }));
        }
        return finalize(renderStatus(`${getIcon("warning")} Could not update menu. Check recipe ids and try again.`, { ephemeral: true }));
      }

      clearTakeoutMenuDraftSelection({ serverId, userId });

      if (!isTakeoutShiftActive(p, nowTs())) {
        takeout.shift.idle_order_board_snapshot = takeout.menu_recipe_ids.map((rid) => ({
          recipe_id: rid,
          visible_order_count: 0
        }));
        clearTakeoutQuote();
      }

      return finalize(renderStatus(`${getIcon("status_complete")} Counter menu updated.`, {
        showMenuPicker: false,
        menuPage: requestedMenuPage
      }));
    }

    if (sub === "takeout_open") {
      if (takeout.menu_recipe_ids.length <= 0) {
        return finalize(renderStatus(`${getIcon("warning")} Configure your counter menu first with /noodle takeout_menu.` , { ephemeral: true }));
      }

      sweepExpiredAcceptedOrders(p, s, content, now);
      const acceptedOrderCount = Object.keys(p.orders?.accepted ?? {}).length;
      if (acceptedOrderCount > 0) {
        return finalize(renderStatus(
          `${getIcon("warning")} You still have **${acceptedOrderCount}** accepted order${acceptedOrderCount === 1 ? "" : "s"}. Serve or cancel them before opening a takeout shift.`,
          { ephemeral: true }
        ));
      }

      const set = buildSettingsMap(settingsCatalog, s.settings);
      s.season = computeActiveSeason(set);
      ensureDailyOrdersForPlayer(p, set, content, s.season, serverId, userId, s.active_event_id ?? null);
      applyHouse247OrderBoardOverride(p);

      const boardOrderTotal = Math.max(0, Math.floor(Number(p.orders_total_count || 0) || 0));
      const unlimitedOrders = hasHouse247Perk(p);
      const validQuote = readValidTakeoutQuote({ nowMs: now }) ?? buildAndStoreTakeoutQuote({ nowMs: now });
      let openResult = null;

      if (validQuote) {
        const playerCoins = Math.max(0, Math.floor(Number(p.coins || 0) || 0));
        if (playerCoins < validQuote.operatingCost) {
          openResult = {
            ok: false,
            reason: "insufficient_coins",
            operatingCost: validQuote.operatingCost,
            snapshotOrderTotal: validQuote.snapshotOrderTotal,
            requiredIngredients: validQuote.requiredIngredients,
            snapshot: validQuote.snapshot
          };
        } else {
          p.coins = playerCoins - validQuote.operatingCost;
          const opened = openTakeoutShift(p, {
            now,
            snapshot: validQuote.snapshot,
            snapshotOrderTotal: validQuote.snapshotOrderTotal,
            requiredIngredients: validQuote.requiredIngredients,
            coveredIngredients: validQuote.requiredIngredients,
            operatingCost: validQuote.operatingCost,
            operatingCostMarker: `takeout_shift:${validQuote.createdAt}`
          });
          if (!opened.ok) {
            p.coins = playerCoins;
            openResult = {
              ok: false,
              reason: opened.reason,
              operatingCost: validQuote.operatingCost,
              snapshotOrderTotal: validQuote.snapshotOrderTotal,
              requiredIngredients: validQuote.requiredIngredients,
              snapshot: validQuote.snapshot
            };
          } else {
            openResult = {
              ok: true,
              startedAt: opened.startedAt,
              endsAt: opened.endsAt,
              snapshotOrderTotal: validQuote.snapshotOrderTotal,
              operatingCost: validQuote.operatingCost,
              requiredIngredients: validQuote.requiredIngredients,
              snapshot: validQuote.snapshot
            };
          }
        }
      } else {
        openResult = startTakeoutShiftWithCoverage(p, {
          now,
          boardOrderTotal,
          unlimitedOrders,
          recipes: content.recipes ?? {},
          marketPrices: s.market_prices ?? {},
          items: content.items ?? {}
        });
      }
      if (!openResult.ok && openResult.reason === "shift_active") {
        emitTelemetry("takeout_shift_start_blocked", {
          userId,
          serverId,
          reason: "shift_active"
        });
        return finalize(renderStatus(`${getIcon("time")} Your current takeout shift is still active.`, { ephemeral: true }));
      }
      if (!openResult.ok && openResult.reason === "insufficient_coins") {
        const needed = Math.max(0, Math.floor(Number(openResult.operatingCost || 0) || 0));
        const has = Math.max(0, Math.floor(Number(p.coins || 0) || 0));
        emitTelemetry("takeout_shift_start_blocked", {
          userId,
          serverId,
          reason: "insufficient_coins",
          neededCoins: needed,
          hasCoins: has
        });
        return finalize(renderStatus(`${getIcon("warning")} You need **${needed}c** to open this 12h shift, but only have **${has}c**.`, { ephemeral: true }));
      }
      if (!openResult.ok) {
        emitTelemetry("takeout_shift_start_blocked", {
          userId,
          serverId,
          reason: String(openResult.reason || "unknown")
        });
        return finalize(renderStatus(`${getIcon("warning")} Could not open your takeout shift right now.`, { ephemeral: true }));
      }

      const coveredUnits = Object.values(openResult.requiredIngredients ?? {})
        .reduce((sum, qty) => sum + Math.max(0, Math.floor(Number(qty || 0) || 0)), 0);
      emitTelemetry("takeout_shift_started", {
        userId,
        serverId,
        boardOrderTotal,
        unlimitedOrders,
        snapshotOrderTotal: openResult.snapshotOrderTotal,
        operatingCost: openResult.operatingCost,
        coveredUnits,
        menuSize: takeout.menu_recipe_ids.length,
        startsAt: openResult.startedAt,
        endsAt: openResult.endsAt
      });

      clearTakeoutQuote();

      return finalize(
        renderStatus(
          `${getIcon("status_complete")} Shift started for **${TAKEOUT_SHIFT_DURATION_HOURS}h** with **${openResult.snapshotOrderTotal}** orders and an ingredient cost of **${openResult.operatingCost}c**. ` +
          `Ingredients needed for idle earnings are reserved while the shift is active.`, { ephemeral: true }
        )
      );
    }

    if (sub === "takeout_cook") {
      if (!isTakeoutShiftActive(p, now)) {
        return finalize(renderStatus(`${getIcon("help")} Start a shift to use **Counter Cook**.` , { ephemeral: true }));
      }
      const rawPage = Number(opt.getInteger("page") ?? 0);
      return finalize(buildTakeoutCookPickerPayload({
        userId,
        p,
        takeout,
        ownerUser: interaction.member ?? interaction.user,
        page: Number.isFinite(rawPage) ? rawPage : 0
      }));
    }

    if (sub === "takeout_needs") {
      if (!isTakeoutShiftActive(p, now)) {
        return finalize(renderStatus(`${getIcon("help")} Start a shift to view **Counter Order Ingredients**.`, { ephemeral: true }));
      }
      const rawPage = Number(opt.getInteger("page") ?? 0);
      return finalize(buildTakeoutNeedsPayload({
        userId,
        p,
        takeout,
        ownerUser: interaction.member ?? interaction.user,
        page: Number.isFinite(rawPage) ? rawPage : 0
      }));
    }

    if (sub === "takeout_serve") {
      if (!isTakeoutShiftActive(p, now)) {
        return finalize(renderStatus(`${getIcon("help")} Start a shift to use **Counter Serve**.`, { ephemeral: true }));
      }

      const selectedRecipeId = resolveCanonicalRecipeId(String(opt.getString("recipe") || "").trim());
      const snapshot = Array.isArray(takeout.shift?.idle_order_board_snapshot)
        ? takeout.shift.idle_order_board_snapshot
        : [];
      const menuSet = new Set(takeout.menu_recipe_ids || []);

      if (!selectedRecipeId) {
        return finalize(buildTakeoutServePickerPayload({
          userId,
          p,
          takeout,
          ownerUser: interaction.member ?? interaction.user
        }));
      }

      if (!menuSet.has(selectedRecipeId)) {
        return finalize(renderStatus(`${getIcon("warning")} That recipe is not on your current takeout menu.`, { ephemeral: true }));
      }

      const snapshotRow = snapshot.find((x) => String(x?.recipe_id || "") === selectedRecipeId);
      if (!snapshotRow || Math.max(0, Math.floor(Number(snapshotRow.visible_order_count || 0) || 0)) <= 0) {
        return finalize(renderStatus(`${getIcon("help")} No remaining counter orders for **${displayRecipeName(selectedRecipeId)}**.`, { ephemeral: true }));
      }

      const readyForRecipe = getTotalBowlsForRecipe(p, selectedRecipeId);
      if (readyForRecipe <= 0) {
        return finalize(renderStatus(`${getIcon("basket")} You need a ready bowl of **${displayRecipeName(selectedRecipeId)}** first.`, { ephemeral: true }));
      }

      const availableCounterOrders = Math.max(0, Math.floor(Number(snapshotRow.visible_order_count || 0) || 0));
      const servingsToProcess = Math.min(readyForRecipe, availableCounterOrders);
      if (servingsToProcess <= 0) {
        return finalize(renderStatus(`${getIcon("help")} No remaining counter orders for **${displayRecipeName(selectedRecipeId)}**.`, { ephemeral: true }));
      }
      const discoveryAttemptLimit = getTakeoutDiscoveryAttemptLimit(servingsToProcess);
      let discoveryAttemptsUsed = 0;

      let totalCoins = 0;
      let totalRep = 0;
      let totalSxp = 0;
      let servedCount = 0;
      let seasonalServedCount = 0;
      let seasonalServedCoins = 0;
      let leveledUp = false;
      const discoveryMessages = [];
      const recipe = content.recipes?.[selectedRecipeId] ?? null;
      const combinedEffects = calculateCombinedEffects(p, upgradesContent, staffContent, calculateStaffEffects);
      const activeEventEffects = getActiveEventEffects(eventsContent, s);

      for (let i = 0; i < servingsToProcess; i += 1) {
        const bowlEntry = getBestBowlEntry(p, selectedRecipeId);
        const bowl = bowlEntry?.bowl ?? null;
        if (!bowl || (bowl.qty ?? 0) <= 0) break;

        const servedAt = nowTs();
        const rewards = computeServeRewards({
          serverId,
          tier: recipe?.tier ?? "common",
          npcArchetype: null,
          isLimitedTime: false,
          servedAtMs: servedAt,
          acceptedAtMs: servedAt,
          speedWindowSeconds: 180,
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

        consumeFailStreakRelief(p);

        bowl.qty -= 1;
        if (bowl.qty <= 0) delete p.inv_bowls[bowlEntry?.key ?? selectedRecipeId];

        snapshotRow.visible_order_count = Math.max(0, Math.floor(Number(snapshotRow.visible_order_count || 0) || 0) - 1);

        p.coins = (Number.isFinite(p.coins) ? p.coins : 0) + rewards.coins;
        p.rep = (Number.isFinite(p.rep) ? p.rep : 0) + rewards.rep;
        p.sxp_total = (Number.isFinite(p.sxp_total) ? p.sxp_total : 0) + rewards.sxp;
        p.sxp_progress = (Number.isFinite(p.sxp_progress) ? p.sxp_progress : 0) + rewards.sxp;
        if (!p.lifetime) p.lifetime = {};
        p.lifetime.orders_served = (p.lifetime.orders_served ?? 0) + 1;
        p.lifetime.bowls_served_total = (p.lifetime.bowls_served_total ?? 0) + 1;
        p.lifetime.coins_earned = (p.lifetime.coins_earned ?? 0) + rewards.coins;
        leveledUp = applySxpLevelUp(p) || leveledUp;

        totalCoins += rewards.coins;
        totalRep += rewards.rep;
        totalSxp += rewards.sxp;
        servedCount += 1;

        const recipeTierForQuest = recipe?.tier ?? "common";
        const recipeSeasonForQuest = recipe?.season ?? null;
        const isSeasonalRecipeServe = recipeTierForQuest === "seasonal" && (!recipeSeasonForQuest || recipeSeasonForQuest === s.season);
        if (isSeasonalRecipeServe) {
          seasonalServedCount += 1;
          seasonalServedCoins += rewards.coins;
        }

        if (bowlQuality !== "salvage" && discoveryAttemptsUsed < discoveryAttemptLimit) {
          discoveryAttemptsUsed += 1;
          const dayKey = dayKeyUTC(servedAt);
          const discoveryRng = makeStreamRng({
            mode: "seeded",
            seed: 12345,
            streamName: "discovery",
            serverId,
            dayKey,
            extra: `${selectedRecipeId}_${servedAt}_${i}`
          });
          const discoveries = rollRecipeDiscovery({
            player: p,
            content,
            npcArchetype: null,
            tier: recipe?.tier ?? "common",
            rng: discoveryRng,
            activeSeason: s.season,
            activeEventId: s.active_event_id ?? null,
            allowPity: false,
            trackPityStreak: false
          });
          for (const discovery of discoveries ?? []) {
            const result = applyDiscovery(p, discovery, content, discoveryRng, { badgesContent });
            if (result?.message) discoveryMessages.push(result.message);
          }
        }
      }

      const remainingForRecipe = Math.max(0, Math.floor(Number(snapshotRow.visible_order_count || 0) || 0));
      if (servedCount <= 0) {
        return finalize(renderStatus(`${getIcon("basket")} You need a ready bowl of **${displayRecipeName(selectedRecipeId)}** first.`, { ephemeral: true }));
      }

      const serveResults = [
        `Served **${servedCount}× ${displayRecipeName(selectedRecipeId)}** from ${getTakeoutCounterLabel()}.`,
        `${getIcon("orders")} Remaining counter orders for this recipe: **${remainingForRecipe}**`
      ];
      if (leveledUp) {
        serveResults.push(`${getIcon("level_up")} Level up! You're now **Level ${Math.max(1, Number(p.shop_level || 1))}**.`);
      }

      if (servedCount > 0) {
        applyQuestProgress(
          p,
          questsContent,
          userId,
          {
            type: "serve",
            amount: servedCount,
            tierAmounts: { seasonal: seasonalServedCount }
          },
          now
        );
        if (totalCoins > 0) {
          applyQuestProgress(
            p,
            questsContent,
            userId,
            { type: "earn_coins", amount: totalCoins, tierAmounts: { seasonal: seasonalServedCoins } },
            now
          );
        }
      }

      const summary = `Rewards total: **+${totalCoins}c**, **+${totalSxp} SXP**, **+${totalRep} REP**.`;
      const discoveryLine = discoveryMessages.length > 0 ? `\n\n${discoveryMessages.slice(0, 4).join("\n")}` : "";
      const confirmationEmbed = buildMenuEmbed({
        title: `${getIcon("serve")} Orders Served`,
        description: [
          serveResults.join("\n"),
          "",
          `${summary}${discoveryLine}`
        ].join("\n"),
        user: interaction.member ?? interaction.user,
        color: theme.colors.success
      });
      const canCounterServe = getTakeoutRecipeNeedRows(p, takeout)
        .some((entry) => entry.need > 0 && entry.ready > 0);
      const canClaim = Math.max(0, Math.floor(Number(takeout?.earned_unclaimed_coins || 0) || 0)) > 0;
      return finalize({
        content: " ",
        ...composeV2FromLegacyEmbeds([confirmationEmbed]),
        components: [
          noodleTakeoutActionRow(userId, {
            activeShift: true,
            disableClaim: !canClaim,
            disableServe: !canCounterServe
          }),
          noodleMainMenuRowNoOrdersWithBack(userId)
        ]
      });
    }

    if (sub === "takeout_claim") {
      const claimed = claimTakeoutEarnings(p, { now });
      if (!claimed.ok) {
        emitTelemetry("takeout_claim_attempt", {
          userId,
          serverId,
          ok: false,
          reason: String(claimed.reason || "unknown"),
          unclaimedCoins: Math.max(0, Math.floor(Number(takeout.earned_unclaimed_coins || 0) || 0))
        });
        return finalize(renderStatus(`${getIcon("help")} No idle earnings to claim yet.`, { ephemeral: true }));
      }

      emitTelemetry("takeout_claim_attempt", {
        userId,
        serverId,
        ok: true,
        amount: claimed.amount,
        unclaimedCoinsAfter: Math.max(0, Math.floor(Number(takeout.earned_unclaimed_coins || 0) || 0))
      });

      return finalize(renderStatus(`${getIcon("coins")} Claimed **${claimed.amount}c** from your shop's idle earnings.`));
    }

    return finalize(renderStatus());
  });

  return commit(lockedPayload);
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
    const ingredients = getRelevantRecipeIngredients(p, r)
      .map((ing) => formatIngredientLabel(ing))
      .join(", ");
    const ingredientLine = ingredients ? ingredients : "_No ingredients listed._";
    return `• **${r.name}**${tier}${eventTag}\n  ${ingredientLine}`;
  });

  const cluesMap = p.clues_owned ?? {};
  const clueEntries = Object.values(cluesMap).filter((entry) => entry && !knownSet.has(entry.recipe_id));
  const clueLines = clueEntries
    .map((entry) => {
      const recipeId = entry.recipe_id;
      const recipe = content.recipes?.[recipeId];
      const name = recipe?.name ?? recipeId ?? "Unknown recipe";
      const tier = recipe?.tier ? ` (${recipe.tier})` : "";
      const eventTag = recipe?.event_id ? ` ${getIcon("event")} Event` : "";
      const count = entry.count ?? 0;
      const revealed = entry.revealed_ingredients ?? [];
      const revealedVisible = revealed.filter((id) => !isFishingIngredientLocked(p, id));
      const revealedNames = revealedVisible.length
        ? revealedVisible.map((id) => displayItemName(id)).join(", ")
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

  const hasMultiplePages = totalPages > 1;
  const prevPage = page <= 0 ? totalPages - 1 : page - 1;
  const nextPage = page >= totalPages - 1 ? 0 : page + 1;
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:nav:recipes:${userId}:${prevPage}`)
      .setLabel("Prev")
      .setEmoji(getButtonEmoji("back"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasMultiplePages),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:recipes:${userId}:${nextPage}`)
      .setLabel("Next")
      .setEmoji(getButtonEmoji("next"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasMultiplePages),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:recipes:${userId}:clues`)
      .setLabel("Clues")
      .setEmoji(getButtonEmoji("scroll"))
      .setStyle(isCluePage ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  return commit({
    content: " ",
    ...composeV2FromLegacyEmbeds([recipesEmbed]),
    components: [navRow, noodleMainMenuRow(userId)]
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
    title: `${getIcon("regulars")} Regulars`,
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
      .setCustomId(`noodle:nav:regulars:${userId}:${page <= 0 ? totalPages - 1 : page - 1}`)
      .setLabel("Prev")
      .setEmoji(getButtonEmoji("back"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(totalPages <= 1),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:regulars:${userId}:${page >= totalPages - 1 ? 0 : page + 1}`)
      .setLabel("Next")
      .setEmoji(getButtonEmoji("next"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(totalPages <= 1)
  );

  return commit({
    content: " ",
    ...composeV2FromLegacyEmbeds([regularsEmbed]),
    components: totalPages > 1 ? [navRow, noodleMainMenuRow(userId)] : [noodleMainMenuRow(userId)]
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
          const discovered = availableRecipes.includes(recipe.recipe_id);
          const discoveredIcon = discovered ? `${getIcon("status_complete")} ` : "";
          return `• ${discoveredIcon}**${recipe.name}**`;
        })
        .join("\n")
    : "_No seasonal recipe found for this season._";

  const seasonFlavorContent = {
    spring: {
      lore: "When spring arrives, old market paths reopen and regulars trade stories over bowls perfumed with herbs and blossom rain.",
      chefNote: "Keep your shop bright and welcoming; spring regulars love light broths and fresh toppings.",
      flavorLines: [
        "A soft drizzle taps the awning while scallions and steam perfume the lane.",
        "Petals drift by the doorway and every bowl tastes like a fresh start.",
        "Morning rain cools the street, but your broth keeps every seat warm."
      ]
    },
    summer: {
      lore: "Summer brings festival crowds and long evenings, when neon signs glow late and fast service earns loyal regulars.",
      chefNote: "Summer traffic is lively; keep a steady rhythm and ride the rush.",
      flavorLines: [
        "Lantern strings sway above the street and citrus steam hangs in warm air.",
        "The dinner line curls around the block as your counter keeps pace.",
        "Fans hum, bowls fly, and the whole lane buzzes with summer energy."
      ]
    },
    autumn: {
      lore: "In autumn, harvest caravans fill the market and your shop becomes a lantern-lit refuge for travelers and neighbors alike.",
      chefNote: "Autumn regulars linger longer; rich flavors and cozy pacing go a long way.",
      flavorLines: [
        "Spice and woodsmoke drift through the alley as lanterns flicker to life.",
        "Crisp evening air meets deep, savory broth at your shop door.",
        "Golden leaves gather by the steps while warm bowls steady the night."
      ]
    },
    winter: {
      lore: "Winter settles quietly over the district, and noodle shops become hearths where strangers thaw into familiar faces.",
      chefNote: "Lean into comfort: steady service and rich broth make winter regulars feel at home.",
      flavorLines: [
        "Snow hushes the street while your kitchen glows with patient heat.",
        "Scarves drip at the entrance and grateful regulars cradle hot bowls.",
        "Frost clings to the windows, but inside your broth keeps spirits bright."
      ]
    }
  };
  const seasonCard = seasonFlavorContent[server.season] ?? {
    lore: "Each season reshapes the rhythm of your noodle shop.",
    chefNote: "Trust your pace, keep your broth ready, and serve with heart.",
    flavorLines: ["The market shifts with the season, and your shop sets the tone."]
  };
  const flavorLines = Array.isArray(seasonCard.flavorLines) ? seasonCard.flavorLines : [];
  const randomFlavorLine = flavorLines.length
    ? flavorLines[Math.floor(Math.random() * flavorLines.length)]
    : null;

  const seasonEmbed = buildMenuEmbed({
    title: `${getIcon("season")} Season`,
    description: [
      `The world is currently in **${server.season}**.`,
      seasonCard.lore,
      "",
      ...(randomFlavorLine ? ["**Today's Flavor**", randomFlavorLine, ""] : []),
      seasonCard.chefNote,
      "",
      "**Seasonal Recipes**",
      seasonalLine
    ].join("\n"),
    user: interaction.member ?? interaction.user
  });

  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`noodle:nav:profile:${userId}`).setLabel("Back").setEmoji(getButtonEmoji("back")).setStyle(ButtonStyle.Secondary)
  );

  return commit({
    content: " ",
    ...composeV2FromLegacyEmbeds([seasonEmbed]),
    components: [noodleAboutNewsNavRow(userId, { active: "season" }), backRow]
  });
}

/* ---------------- STATUS (DEBUG) ------------ */
if (sub === "status") {
  if (!isDevAdmin(userId)) {
    return commit({
      content: " ",
      ...composeV2FromLegacyEmbeds([buildDevMessageEmbed({ message: "You don’t have access to that command.", isError: true })]),
      ephemeral: true
    });
  }
  const rolloutPlayer = ensurePlayer(serverId, userId);
  const statusEmbed = buildDevStatusEmbed();

  if (isComponentsV2Enabled({ guildId: serverId, userId, player: rolloutPlayer })) {
    const title = String(statusEmbed?.title ?? statusEmbed?.data?.title ?? `${getIcon("stats")} Status`).trim();
    const description = String(statusEmbed?.description ?? statusEmbed?.data?.description ?? "").trim();
    const lines = description ? description.split("\n") : ["Status unavailable."];
    const payload = buildComponentsV2MenuPayload({
      components: [
        { type: 10, content: [`## ${title}`, lines.join("\n")].filter(Boolean).join("\n\n") },
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 2,
              label: "Refresh",
              custom_id: `noodle:nav:status:${userId}`
            }
          ]
        }
      ],
      ownerId: userId,
      accentColor: theme.colors.primary,
      ephemeral: false
    });
    return replyOrEditInteraction(interaction, payload);
  }

  return commit({
    content: " ",
    ...composeV2FromLegacyEmbeds([statusEmbed]),
    ephemeral: false
  });
}

/* ---------------- EVENT ---------------- */
if (sub === "event") {
  const player = ensurePlayer(serverId, userId);
  const knownRecipeIds = new Set(getAvailableRecipes(player));
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
    ...composeV2FromLegacyEmbeds([eventEmbed]),
    components: [noodleAboutNewsNavRow(userId, { active: "event" }), backRow]
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
const lockedPayload = await withLock(db, `lock:user:${userId}`, owner, 8000, async () => {
  let p = ensurePlayer(serverId, userId);
  let s = ensureServer(serverId);
  unlockNoticePlayer = p;

  const now = nowTs();
  const set = buildSettingsMap(settingsCatalog, s.settings);
  s.season = computeActiveSeason(set);
  const activeEventId = s.active_event_id ?? null;
  const storyAnchor = activeEventId ? `story:${activeEventId}` : "story:default";
  const seasonAnchor = s.season ?? "seasonal:default";
  const questOptions = { storyKey: storyAnchor, seasonKey: seasonAnchor };
  let combinedEffects = null;
  let activeEventEffects = null;
  let timeCatchup = { applied: false, messages: [], spoilage: { messages: [] }, cooldownStatus: { expired: [], hasExpired: false } };
  let resilience = { applied: false, messages: [] };
  let progressionPrepared = false;

  const prepareCombinedEffects = () => {
    if (!combinedEffects) {
      combinedEffects = calculateCombinedEffects(p, upgradesContent, staffContent, calculateStaffEffects);
    }
    return combinedEffects;
  };

  const prepareProgressionState = () => {
    if (progressionPrepared) return;

    const effects = prepareCombinedEffects();
    const lastActiveAt = db ? (getLastActiveAt(db, serverId, userId) || now) : now;
    activeEventEffects = getActiveEventEffects(eventsContent, s);

    processTakeoutCatchup(p, {
      now,
      recipes: content.recipes ?? {},
      marketPrices: s.market_prices ?? {},
      items: content.items ?? {}
    });

    // Apply time catch-up (spoilage, inactivity messages, cooldown checks)
    timeCatchup = applyTimeCatchup(p, s, set, content, lastActiveAt, now, effects);

    sweepExpiredAcceptedOrders(p, s, content, now);

    rollMarket({ serverId, content, serverState: s, eventEffects: activeEventEffects });
    if (!s.market_prices) s.market_prices = {};

    const baseOrders = Math.max(1, Number(set.ORDERS_BASE_COUNT ?? 100));
    const totalOrders = computeOrderCount(set, effects);

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
    applyHouse247OrderBoardOverride(p);
    ensureQuests(p, questsContent, userId, now, questOptions);

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
    resilience = applyResilienceMechanics(p, s, content);

    // If resilience granted temporary recipes, regenerate order board to include them
    if (resilience.applied && p.resilience?.temp_recipes?.length > 0) {
      p.orders_day = null; // Force regeneration
      ensureDailyOrdersForPlayer(p, set, content, s.season, serverId, userId, activeEventId);
      applyHouse247OrderBoardOverride(p);
    }

    progressionPrepared = true;
  };

  const progressionSubcommands = new Set([
    "quests",
    "quests_vote",
    "quests_vote_claim",
    "quests_daily",
    "quests_claim",
    "forage",
    "fishing",
    "garden",
    "compost",
    "plant",
    "harvest",
    "buy",
    "sell",
    "cook",
    "orders",
    "accept",
    "cancel",
    "serve"
  ]);
  if (progressionSubcommands.has(sub)) {
    prepareProgressionState();
  }

  const commitState = async (replyObj) => {

    const replyWithUnlock = applyUnlockNoticeEmbeds(replyObj ?? {}, unlockNoticePlayer, interaction.member ?? interaction.user, {
      consumeSeatingNotice: true,
      consumeSubscriptionNotice: sub === "orders"
    });
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
      applyHouse247OrderBoardOverride(p);
    }
    
    const spoilageMessages = timeCatchup?.spoilage?.messages ?? [];
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
    const catchupMsgs = (timeCatchup?.messages ?? []).filter((msg) => !spoilageSet.has(msg));
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
    if ((resilience?.messages ?? []).length > 0) {
      rescueEmbeds.push(buildMenuEmbed({
        title: `${getIcon("rescue")} Rescue Mode`,
        description: (resilience?.messages ?? []).join("\n\n"),
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
      finalEmbeds = [...(finalEmbeds ?? []), ...rescueEmbeds];
    }

    if (!finalEmbeds || finalEmbeds.length === 0) {
      finalEmbeds = undefined;
    }

    const legacyBridgeSourceEmbeds = finalEmbeds ?? replyWithUnlock.embeds;
    const legacyBridgePayload = Array.isArray(legacyBridgeSourceEmbeds) && legacyBridgeSourceEmbeds.length > 0
      ? composeV2FromLegacyEmbeds(legacyBridgeSourceEmbeds)
      : {};
    const noticeApplied = withSeasonNotice({ ...replyWithUnlock, content: finalContent, ...legacyBridgePayload });

    let out = {
      ...noticeApplied,
      content: noticeApplied.content,
      ephemeral: noticeApplied.ephemeral ?? false,
      components: noticeApplied.ephemeral
        ? (noticeApplied.components ?? [])
        : (noticeApplied.components ?? [noodleMainMenuRow(userId)])
    };

    const sourceMessageFlags = Number(interaction?.message?.flags?.bitfield ?? interaction?.message?.flags ?? 0);
    const sourceMessageIsV2 = (sourceMessageFlags & MESSAGE_FLAG_IS_COMPONENTS_V2) !== 0;
    const shouldUseV2ContainerPayload = shouldConvertLegacyPayloadToV2ForSub({
      sub,
      navSource: overrides?.navSource,
      rolloutEnabled: isComponentsV2Enabled({ guildId: serverId, userId, player: p }),
      sourceMessageIsV2
    });
    const suppressGreenButtonTip = sub === "pantry" || sub === "store";
    if (suppressGreenButtonTip) {
      out.disableGreenButtonTip = true;
    }

    if (shouldUseV2ContainerPayload) {
      out = convertLegacyEmbedPayloadToComponentsV2(out);
    }

    if (out.embeds) {
      out.embeds = sanitizeEmbedsForDiscord(out.embeds);
    }
    if (out.embeds && !suppressGreenButtonTip) {
      out.embeds = applyGreenButtonFooter(out.embeds, out.components);
    }

    if (db) {
      putIdempotentResult(db, { key: idemKey, userId, action, ttlSeconds: 900, result: out });
    }
    return out;
  };

  /* ---------------- QUESTS ---------------- */
  if (sub === "quests") {
    const summary = getQuestSummary(p, questsContent, userId, now, questOptions);
    const active = summary.active;
    const pages = [
      {
        title: "Daily Quests",
        subtitle: "Refreshes every day",
        cadences: ["daily"]
      },
      {
        title: "Weekly & Monthly Quests",
        subtitle: "Longer goals for steady progress",
        cadences: ["weekly", "monthly"]
      },
      {
        title: "Story & Seasonal Quests",
        subtitle: "Narrative and event-driven objectives during the current season",
        cadences: ["story", "seasonal"]
      }
    ];
    const rawPage = opt.getInteger("page") ?? 0;
    const page = Math.min(Math.max(rawPage, 0), pages.length - 1);
    const current = pages[page];

    const pageQuests = active
      .filter((q) => current.cadences.includes(q.cadence))
      .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));

    const playerLevel = Math.max(1, Number(p?.shop_level ?? 1));
    const getFirstQuestUnlockLevel = (cadence) => {
      const levels = (questsContent?.quests ?? [])
        .filter((quest) => quest?.cadence === cadence)
        .map((quest) => Number(quest?.min_shop_level ?? 0))
        .filter((level) => Number.isFinite(level) && level > 0);
      if (!levels.length) return null;
      return Math.min(...levels);
    };

    const storyFirstUnlockLevel = getFirstQuestUnlockLevel("story");
    const seasonalFirstUnlockLevel = getFirstQuestUnlockLevel("seasonal");

    const storyUnlockText = storyFirstUnlockLevel == null
      ? `${getIcon("scroll")} Story quests are not available right now.`
      : (playerLevel >= storyFirstUnlockLevel
          ? `${getIcon("scroll")} Story quests unlock at shop level **${storyFirstUnlockLevel}**.`
          : `${getIcon("scroll")} Story quests unlock at shop level **${storyFirstUnlockLevel}** (in **${storyFirstUnlockLevel - playerLevel}** level${storyFirstUnlockLevel - playerLevel === 1 ? "" : "s"}).`);

    const seasonalUnlockText = seasonalFirstUnlockLevel == null
      ? `${getIcon("season")} Seasonal quests are not available right now.`
      : (playerLevel >= seasonalFirstUnlockLevel
          ? `${getIcon("season")} Seasonal quests unlock at shop level **${seasonalFirstUnlockLevel}**.`
          : `${getIcon("season")} Seasonal quests unlock at shop level **${seasonalFirstUnlockLevel}** (in **${seasonalFirstUnlockLevel - playerLevel}** level${seasonalFirstUnlockLevel - playerLevel === 1 ? "" : "s"}).`);

    const lines = pageQuests.length
      ? pageQuests.flatMap((q) => {
          const status = q.completed_at ? getIcon("status_complete") : getIcon("status_pending");
          const rewardParts = [];
          if (q.reward?.coins) rewardParts.push(`${q.reward.coins}c`);
          if (q.reward?.sxp) rewardParts.push(`${q.reward.sxp} SXP`);
          if (q.reward?.rep) rewardParts.push(`${q.reward.rep} REP`);
          const rewardText = rewardParts.length ? `Rewards: ${rewardParts.join(" · ")}` : "Rewards: none";
          const desc = q.description ? `${q.description}` : "No description provided.";
          return [
            `${status} **${q.name}**`,
            `${getIcon("scroll")} ${desc}`,
            `${getIcon("stats")} Progress: **${q.progress}/${q.target}**`,
            `${getIcon("coins")} ${rewardText}`,
            ""
          ];
        }).slice(0, -1)
      : (page === 2
          ? [
              "_No story or seasonal quests available yet._",
              storyUnlockText,
              seasonalUnlockText
            ]
          : ["_No quests available on this page right now._"]);

    const questsEmbed = buildMenuEmbed({
      title: `${getIcon("quests")} Quests — ${current.title}`,
      description: `_${current.subtitle}_\n\n${lines.join("\n")}`,
      user: interaction.member ?? interaction.user
    });
    const ownerText = ownerFooterText(interaction.member ?? interaction.user);
    questsEmbed.setFooter({
      text: `Page ${page + 1}/${pages.length} • ${ownerText}`
    });

    const pageRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
          .setCustomId(`noodle:nav:quests:${userId}:${page <= 0 ? pages.length - 1 : page - 1}`)
        .setLabel("Prev")
        .setEmoji(getButtonEmoji("back"))
        .setStyle(ButtonStyle.Secondary)
          .setDisabled(pages.length <= 1),
      new ButtonBuilder()
        .setCustomId(`noodle:nav:quests:${userId}:0`)
        .setLabel("Daily")
        .setStyle(page === 0 ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`noodle:nav:quests:${userId}:1`)
        .setLabel("Weekly/Monthly")
        .setStyle(page === 1 ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`noodle:nav:quests:${userId}:2`)
        .setLabel("Story/Seasonal")
        .setStyle(page === 2 ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
          .setCustomId(`noodle:nav:quests:${userId}:${page >= pages.length - 1 ? 0 : page + 1}`)
        .setLabel("Next")
        .setEmoji(getButtonEmoji("next"))
        .setStyle(ButtonStyle.Secondary)
          .setDisabled(pages.length <= 1)
    );

    return commitState({
      content: " ",
      ...composeV2FromLegacyEmbeds([questsEmbed]),
      components: [
        pageRow,
        noodleQuestsMenuRow(userId, { showClaim: hasClaimableQuests(p), showDaily: hasDailyRewardAvailable(p, now) }),
        noodleQuestsBackRow(userId)
      ]
    });
  }

  /* ---------------- QUESTS: VOTE ---------------- */
  if (sub === "quests_vote") {
    // Load player from latest server to check vote rewards, not current guild
    const latestServerId = db ? getLatestServerIdForUser(db, userId) : null;
    const voteServerId = latestServerId || serverId;
    const latestPlayer = voteServerId ? ensurePlayer(voteServerId, userId) : p;
    const status = getVoteRewardStatus(latestPlayer);
    const reward = status.reward;
    const rewardLine = [`${getIcon("coins")} **${reward.coins}c**`, `${getIcon("sxp")} **${reward.sxp} SXP**`, `${getIcon("rep")} **${reward.rep} REP**`].join(" · ");
    const house247Line = status.house247Active
      ? (status.house247ExpiresAt
        ? `<t:${Math.floor(status.house247ExpiresAt / 1000)}:R>`
        : "Active")
      : "Not active";
    const house247Label = status.house247ExpiresAt
      ? `${getHouse247Label()} remaining: expires **${house247Line}**`
      : `${getHouse247Label()} remaining: **${house247Line}**`;
    const lastVoteLine = status.lastVoteAt ? `<t:${Math.floor(status.lastVoteAt / 1000)}:R>` : "Not detected yet";
    const maxButtonsPerRow = 5;
    const maxLinkRows = 3;
    const maxVoteLinkButtons = maxButtonsPerRow * maxLinkRows;
    const voteLinkPages = getDisplayVotePlatformPages({ limit: maxVoteLinkButtons });
    const voteLinks = getVotePlatformStatusLines(latestPlayer, { limit: maxVoteLinkButtons }).join("\n");

    const makeVoteLinkButton = (page) => new ButtonBuilder()
      .setLabel(page.label)
      .setStyle(ButtonStyle.Link)
      .setURL(page.voteUrl);

    const voteSiteRows = [];
    for (let i = 0; i < voteLinkPages.length; i += maxButtonsPerRow) {
      const rowPages = voteLinkPages.slice(i, i + maxButtonsPerRow);
      if (!rowPages.length) continue;
      voteSiteRows.push(new ActionRowBuilder().addComponents(...rowPages.map(makeVoteLinkButton)));
    }

    const voteNavRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:nav:quests:${userId}`)
        .setLabel("Quests")
        .setEmoji(getButtonEmoji("quests"))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`noodle:action:quests_vote:${userId}`)
        .setLabel("Vote Rewards")
        .setEmoji(getButtonEmoji("vote"))
        .setStyle(ButtonStyle.Secondary)
    );
      voteSiteRows.push(voteNavRow);

    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:nav:profile:${userId}`)
        .setLabel("Back")
        .setEmoji(getButtonEmoji("back"))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`noodle:action:quests_vote_claim:${userId}`)
        .setLabel("Claim All Vote Rewards")
        .setEmoji(getButtonEmoji("status_complete"))
        .setStyle(status.pendingClaims > 0 ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(status.pendingClaims <= 0)
    );

    const voteEmbed = buildMenuEmbed({
      title: `${getIcon("vote")} Bot List Vote Rewards`,
      description: [
        `Vote for the bot on these sites, then claim your rewards here!`,
        "",
        "**Vote links:**",
        voteLinks,
        "",
        `Per vote reward: ${rewardLine}`,
        "Power vote bonus: **Rank.top power votes grant 4x rewards.**",
        `Per vote bonus: ${getHouse247Label()} **+12h** (unlimited orders + market stock)`,
        "",
        house247Label,
        `Ready to claim: **${status.pendingClaims}**`,
        `Last vote: **${lastVoteLine}**`,
        "_After voting, press **Vote Rewards** button to refresh._"
      ].join("\n"),
      user: interaction.member ?? interaction.user
    });

    return commitState({
      content: " ",
      ...composeV2FromLegacyEmbeds([voteEmbed]),
      components: [
        ...voteSiteRows,
        actionRow
      ]
    });
  }

  /* ---------------- QUESTS: VOTE CLAIM ---------------- */
  if (sub === "quests_vote_claim") {
    // Load player from latest server to claim vote rewards, not current guild
    const latestServerId = db ? getLatestServerIdForUser(db, userId) : null;
    const voteServerId = latestServerId || serverId;
    const latestPlayer = voteServerId ? ensurePlayer(voteServerId, userId) : p;
    const result = claimVoteRewards(latestPlayer, now);
    if (!result.ok) {
      const embed = buildMenuEmbed({
        title: `${getIcon("vote")} Bot List Vote Rewards`,
        description: result.message,
        user: interaction.member ?? interaction.user
      });
      return commitState({
        content: " ",
        ...composeV2FromLegacyEmbeds([embed]),
        components: [
          noodleQuestsMenuRow(userId, { showClaim: hasClaimableQuests(p), showDaily: hasDailyRewardAvailable(p, now), showQuests: true }),
          noodleQuestsBackRow(userId)
        ]
      });
    }

    const rewardLines = [];
    if (result.reward.coins) rewardLines.push(`${getIcon("coins")} **${result.reward.coins}c**`);
    if (result.reward.sxp) rewardLines.push(`${getIcon("sxp")} **${result.reward.sxp} SXP**`);
    if (result.reward.rep) rewardLines.push(`${getIcon("rep")} **${result.reward.rep} REP**`);

    const levelLine = result.leveledUp > 0 ? `\n${getIcon("level_up")} Level up! **+${result.leveledUp}**` : "";
    const claimedLabel = result.claimsClaimed === 1 ? "1 vote reward" : `${result.claimsClaimed} vote rewards`;
    const embed = buildMenuEmbed({
      title: `${getIcon("vote")} Vote Rewards Claimed`,
      description: `Claimed: **${claimedLabel}**\nRewards: ${rewardLines.join(" · ")}\nPending claims: **${result.pendingClaims}**${levelLine}`,
      user: interaction.member ?? interaction.user
    });

    // Save the updated player profile to the latest server
    if (db && voteServerId) {
      upsertPlayer(db, voteServerId, userId, latestPlayer, null, latestPlayer.schema_version);
    }

    return commitState({
      content: " ",
      ...composeV2FromLegacyEmbeds([embed]),
      components: [
        noodleQuestsMenuRow(userId, { showClaim: hasClaimableQuests(p), showDaily: hasDailyRewardAvailable(p, now), showQuests: true }),
        noodleQuestsBackRow(userId)
      ]
    });
  }

  /* ---------------- QUESTS: DAILY ---------------- */
  if (sub === "quests_daily") {
    const result = claimDailyReward(p, dailyRewards, now);
    if (!result.ok) {
      const embed = buildMenuEmbed({
        title: `${getIcon("daily_reward")} Daily Reward`,
        description: result.message,
        user: interaction.member ?? interaction.user
      });
      return commitState({
        content: " ",
        ...composeV2FromLegacyEmbeds([embed]),
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
    const embed = buildMenuEmbed({
      title: `${getIcon("daily_reward")} Daily Reward`,
      description: `Streak: **${result.streak}** day(s)\nRewards: ${rewardLines.join(" · ")} ${levelLine}`,
      user: interaction.member ?? interaction.user
    });
    return commitState({
      content: " ",
      ...composeV2FromLegacyEmbeds([embed]),
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
          return `${getIcon("status_complete")} **${entry.quest.name}** — ${rewardParts.join(" · ")}`;
        })
      : ["_No completed quests to claim._"]; 

    const levelLine = result.leveledUp > 0 ? `\n${getIcon("level_up")} Level up! **+${result.leveledUp}**` : "";
    const embed = buildMenuEmbed({
      title: `${getIcon("quests")} Quests Claimed`,
      description: `${lines.join("\n")}${levelLine}`,
      user: interaction.member ?? interaction.user
    });
    return commitState({
      content: " ",
      ...composeV2FromLegacyEmbeds([embed]),
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
      if (isComponentsV2Enabled({ guildId: serverId, userId, player: p })) {
        const { entries, page, totalPages } = buildSpecializationListData(p, now, rawPage, 5);
        return commitState(buildSpecializationListV2Message({
          userId,
          entries,
          page,
          totalPages,
          specializationsAvailable,
          ownerId: userId,
          buttonEmoji: getProfileV2ButtonEmoji()
        }));
      }
      const { embed, page, totalPages } = buildSpecializationListEmbed(
        p,
        interaction.member ?? interaction.user,
        now,
        rawPage,
        5
      );
      const components = [];
      if (totalPages > 1) {
        const prevPage = page <= 0 ? totalPages - 1 : page - 1;
        components.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`noodle:nav:specialize:${userId}:${prevPage}`)
            .setLabel("Prev")
            .setEmoji(getButtonEmoji("back"))
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(false),
          new ButtonBuilder()
              .setCustomId(`noodle:nav:specialize:${userId}:${page >= totalPages - 1 ? 0 : page + 1}`)
            .setLabel("Next")
            .setEmoji(getButtonEmoji("next"))
            .setStyle(ButtonStyle.Secondary)
              .setDisabled(false)
        ));
      }
      components.push(
        noodleSpecializeSelectRow(userId),
        noodleProfileEditRow(userId, { specializationsAvailable }),
        noodleProfileEditBackRow(userId)
      );
      return commitState({
        content: " ",
        ...composeV2FromLegacyEmbeds([embed]),
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
      if (isComponentsV2Enabled({ guildId: serverId, userId, player: p })) {
        return commitState(buildSpecializationConfirmV2Message({
          userId,
          specId,
          specName: spec.name,
          specDescription: spec.description,
          specThumbnailUrl: getSpecializationThumbnailUrl(spec),
          specializationsAvailable,
          ownerId: userId,
          buttonEmoji: getProfileV2ButtonEmoji()
        }));
      }
      const embed = buildMenuEmbed({
        title: `${getIcon("sparkle")} Confirm Specialization`,
        description: `You're about to switch to **${spec.name}**. Re-run with confirm=true to proceed.`,
        user: interaction.member ?? interaction.user
      });
      return commitState({
        content: " ",
        ...composeV2FromLegacyEmbeds([embed]),
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
    if (isComponentsV2Enabled({ guildId: serverId, userId, player: p })) {
      return commitState(buildSpecializationUpdatedV2Message({
        userId,
        specName: result.specialization?.name ?? specId,
        specThumbnailUrl: getSpecializationThumbnailUrl(result.specialization ?? spec),
        specializationsAvailable,
        ownerId: userId,
        buttonEmoji: getProfileV2ButtonEmoji()
      }));
    }
    return commitState({
      content: " ",
      ...composeV2FromLegacyEmbeds([embed]),
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
    if (isComponentsV2Enabled({ guildId: serverId, userId, player: p })) {
      const { entries, page, totalPages } = buildDecorSetsViewData({
        player: p,
        view: "specialization",
        page: rawPage,
        pageSize: 5
      });
      return commitState(buildDecorSetsV2Message({
        userId,
        entries,
        page,
        totalPages,
        ownerId: userId,
        buttonEmoji: getProfileV2ButtonEmoji()
      }));
    }
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
            .setCustomId(`noodle:nav:decor:${userId}:${page <= 0 ? totalPages - 1 : page - 1}`)
          .setLabel("Prev")
          .setEmoji(getButtonEmoji("back"))
          .setStyle(ButtonStyle.Secondary)
            .setDisabled(false),
        new ButtonBuilder()
            .setCustomId(`noodle:nav:decor:${userId}:${page >= totalPages - 1 ? 0 : page + 1}`)
          .setLabel("Next")
          .setEmoji(getButtonEmoji("next"))
          .setStyle(ButtonStyle.Secondary)
            .setDisabled(false)
      ));
    }
    components.push(noodleDecorBackRow(userId));

    return commitState({
      content: " ",
      ...composeV2FromLegacyEmbeds([embed]),
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
      ...composeV2FromLegacyEmbeds([embed]),
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`noodle-social:nav:stats:${userId}`)
          .setLabel("Back")
          .setEmoji(getButtonEmoji("back"))
          .setStyle(ButtonStyle.Secondary)
      )]
    });
  }

  /* ---------------- FORAGE MENU ---------------- */
  if (sub === "forage_menu") {
    if (isTutorialStepFromRouting(p, "intro_forage")) {
      return runNoodle(interaction, { sub: "forage", navSource: "forage_random" });
    }

    const forageMenuStartMs = performance.now();
    const { unlocked: kitchenUnlocked, justUnlocked: kitchenJustUnlocked } = getKitchenUnlockState(p);
    const { unlocked: fishingUnlocked, justUnlocked: fishingJustUnlocked } = getFishingUnlockState(p);
    const rawPickerPage = Number(opt.getInteger("page") ?? 0);
    const pickerPage = Number.isFinite(rawPickerPage) ? Math.max(0, rawPickerPage) : 0;
    const selectedItemId = String(opt.getString("item") ?? "").trim() || null;
    const payload = buildForageMenuPayload({
      userId,
      player: p,
      ownerUser: interaction.member ?? interaction.user,
      kitchenUnlocked,
      kitchenJustUnlocked,
      fishingUnlocked,
      fishingJustUnlocked,
      page: pickerPage,
      selectedItemId
    });
    emitNavSubroutePhase("nav:forage", {
      renderMs: performance.now() - forageMenuStartMs
    }, {
      mode: "menu"
    });
    return commitState(payload);
  }

  /* ---------------- FORAGE ---------------- */
  if (sub === "forage") {
    const forageActionStartMs = performance.now();
    const gardenUnlocked = isGardenUnlocked(p);
    const { unlocked: kitchenUnlocked, justUnlocked: kitchenJustUnlocked } = getKitchenUnlockState(p);
    const { unlocked: fishingUnlocked, justUnlocked: fishingJustUnlocked } = getFishingUnlockState(p);
    const rawPickerPage = Number(opt.getInteger("page") ?? 0);
    const pickerPage = Number.isFinite(rawPickerPage) ? Math.max(0, rawPickerPage) : 0;
    const itemId = opt.getString("item") ?? null;
    const isExplicitRandomForage = navSource === "forage_random" || isTutorialStepFromRouting(p, "intro_forage");
    ensureGardenState(p);
    if (combinedEffects.garden_autoharvest) {
      autoHarvestReadyPlots(p, content, combinedEffects, {
        capacityLimiter: (drops) => applyIngredientCapacityToDrops(drops, p, combinedEffects)
      });
    }
    const gardenState = getGardenActionState(p, combinedEffects);
    const foragePickerRows = buildForagePickerRows({ userId, player: p, randomPrimary: false, page: pickerPage });
    const normalizedForageItemId = String(itemId || "").trim();
    const selectedForageItemId = getAllowedForageIdsForPlayer(p).includes(normalizedForageItemId)
      ? normalizedForageItemId
      : null;
    const forageQtyRow = selectedForageItemId
      ? new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`noodle:pick:forage_qty:${userId}:${selectedForageItemId}:1:${foragePickerRows.safePage}`).setLabel("x1").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`noodle:pick:forage_qty:${userId}:${selectedForageItemId}:2:${foragePickerRows.safePage}`).setLabel("x2").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`noodle:pick:forage_qty:${userId}:${selectedForageItemId}:3:${foragePickerRows.safePage}`).setLabel("x3").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`noodle:pick:forage_qty:${userId}:${selectedForageItemId}:4:${foragePickerRows.safePage}`).setLabel("x4").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`noodle:pick:forage_qty:${userId}:${selectedForageItemId}:5:${foragePickerRows.safePage}`).setLabel("x5").setStyle(ButtonStyle.Primary)
        )
      : null;
    const navRows = buildForageFishingNavRows({
      userId,
      active: "forage",
      gardenUnlocked,
      fishingUnlocked,
      fishingJustUnlocked,
      kitchenUnlocked,
      kitchenJustUnlocked,
      prependRows: [
        foragePickerRows.actionRow,
        foragePickerRows.pickerRow,
        ...(forageQtyRow ? [forageQtyRow] : []),
        ...(foragePickerRows.pageRow ? [foragePickerRows.pageRow] : [])
      ]
    });

    if (!selectedForageItemId && !isExplicitRandomForage) {
      return commitState(buildForageMenuPayload({
        userId,
        player: p,
        ownerUser: interaction.member ?? interaction.user,
        kitchenUnlocked,
        kitchenJustUnlocked,
        fishingUnlocked,
        fishingJustUnlocked,
        page: pickerPage,
        selectedItemId: null
      }));
    }

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
        ...composeV2FromLegacyEmbeds([cooldownEmbed]),
        components: navRows
      });
    }

    const qtyRaw = opt.getInteger("quantity") ?? 1;
    const quantity = Math.max(1, Math.min(5, qtyRaw));
    const bonusItems = Math.max(0, Math.floor(combinedEffects.forage_bonus_items || 0));

    const allowed = getUnlockedIngredientIds(p, content);
    const allowedForage = new Set((FORAGE_ITEM_IDS ?? []).filter((id) => allowed.has(id)));
    const itemNameCache = new Map();
    const itemMetaCache = new Map();
    const getItemNameCached = (itemId) => {
      if (itemNameCache.has(itemId)) return itemNameCache.get(itemId);
      const value = displayItemName(itemId);
      itemNameCache.set(itemId, value);
      return value;
    };
    const getItemTagsCached = (itemId) => {
      if (itemMetaCache.has(itemId)) return itemMetaCache.get(itemId);
      const tags = Array.isArray(content.items?.[itemId]?.tags)
        ? content.items[itemId].tags.map((t) => String(t).toLowerCase())
        : [];
      itemMetaCache.set(itemId, tags);
      return tags;
    };

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
        .map((id) => `\`${getItemNameCached(id)}\``)
        .join(", ");

      return commitState({
        content: `That isn't a valid forage item for your unlocked recipes. Try one of: ${suggestions}`,
        components: navRows
      });
    }

    if (itemId && bonusItems > 0) {
      drops[itemId] = (drops[itemId] ?? 0) + bonusItems;
    }

    // Pity: guarantee a rare forage after 10 forages without any rare drop.
    // Keep pity progress until a rare actually survives capacity filtering.
    const allowedRare = RARE_FORAGE_ITEM_IDS.filter((id) => allowedForage.has(id));
    const injectedPityItemId = applyForagePityCounter(p, drops, {
      allowedRare,
      itemId,
      serverId,
      userId: interaction.user.id,
      dayKey: dayKeyUTC()
    });
    const capacityResult = applyIngredientCapacityToDrops(drops, p, combinedEffects, { allowDisplacingInventory: true });
    const { accepted, rejected, evicted } = capacityResult;

    if (allowedRare.length) {
      const acceptedHasRare = Object.keys(accepted).some((id) => allowedRare.includes(id));
      if (acceptedHasRare || (injectedPityItemId && Number(accepted[injectedPityItemId] || 0) > 0)) {
        p.forage_pity_rare_count = 0;
      }
    }

    if (evicted && Object.keys(evicted).length) {
      removeIngredientsFromInventory(p, evicted);
    }

    if (!Object.keys(accepted).length) {
      setForageCooldown(p, now);
      const nextForageTs = Math.floor((now + cooldownMs) / 1000);
      const forageFullEmbed = buildMenuEmbed({
        title: `${getIcon("forage")} Forage`,
        description: `${getIcon("pantry")} Your pantry is full. Upgrade storage or use ingredients to make room.\n\n${getIcon("cooldown")} You can forage again at <t:${nextForageTs}:t>, <t:${nextForageTs}:R>.`,
        user: interaction.member ?? interaction.user,
        color: theme.colors.success
      });
      return commitState({
        content: " ",
        ...composeV2FromLegacyEmbeds([forageFullEmbed]),
        components: navRows
      });
    }

    const inventoryResult = applyDropsToInventory(p, accepted);
    setForageCooldown(p, now);
    const nextForageTs = Math.floor((now + cooldownMs) / 1000);
    if (!Object.keys(inventoryResult.added).length) {
      const blockedLines = Object.entries(inventoryResult.blocked ?? {}).map(
        ([id, q]) => `**${q}×** ${getItemNameCached(id)}`
      );
      const blockedText = blockedLines.length
        ? ` Could not collect: ${blockedLines.join(", ")}.`
        : "";
      const forageFullEmbed = buildMenuEmbed({
        title: `${getIcon("forageables")} Forage`,
        description: `${getIcon("pantry")} Your pantry is full. Upgrade storage or use ingredients to make room.${blockedText}\n\n${getIcon("cooldown")} You can forage again at <t:${nextForageTs}:t>, <t:${nextForageTs}:R>.`,
        user: interaction.member ?? interaction.user,
        color: theme.colors.success
      });
      return commitState({
        content: " ",
        ...composeV2FromLegacyEmbeds([forageFullEmbed]),
        components: navRows
      });
    }
    advanceTutorial(p, "forage");
    applyQuestProgress(p, questsContent, userId, { type: "forage", amount: 1 }, now);

    const fishLines = [];
    const seafoodLines = [];
    const otherLines = [];

    for (const [id, q] of Object.entries(inventoryResult.added)) {
      const name = getItemNameCached(id);
      const tags = getItemTagsCached(id);
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
      : `You take a stroll through the nearby grove and return with:\n`;

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
        description += `\n\n${getIcon("seeds")} Seeds collected:\n${seedLines}`;
      } else {
        description += `\n\n${getIcon("seeds")} Small chance to find seeds from forageables (unlocked at level 25).`;
      }
    }

    if (!inventoryResult.success && Object.keys(inventoryResult.blocked).length > 0) {
      const blockedLines = Object.entries(inventoryResult.blocked).map(
        ([id, q]) => `**${q}×** ${getItemNameCached(id)}`
      );
      description += `\n\n${getIcon("warning")} **Pantry Full!** Could not collect: ${blockedLines.join(", ")}\n_Upgrade your Pantry to increase capacity._`;
    }

    description += tutorialSuffix(p);

    const rejectedText = Object.keys(rejected).length
      ? `\n\n${getIcon("pantry")} Pantry full — left behind ${Object.entries(rejected)
        .map(([id, q]) => `**${q}×** ${getItemNameCached(id)}`)
        .join(", ")}.`
      : "";
    if (rejectedText) description += rejectedText;
    description += `\n\n${getIcon("cooldown")} You can forage again at <t:${nextForageTs}:t>, <t:${nextForageTs}:R>.`;
    const forageEmbed = buildMenuEmbed({
      title: `${getIcon("forage")} Forage`,
      description: `${header}${bodyLines.join("\n\n")}${rejectedText}${tutorialSuffix(p)}`,
      user: interaction.member ?? interaction.user,
      color: theme.colors.success
    });
    forageEmbed.setDescription(description);
    const showTutorialCookRowAfterForage = resolveTutorialGateValue({
      player: p,
      gate: "showTutorialCookRowAfterForage",
      fallbackValue: false
    });
    const components = showTutorialCookRowAfterForage
      ? [noodleTutorialCookRow(userId)]
      : navRows;
    emitNavSubroutePhase("action:forage", {
      totalMs: performance.now() - forageActionStartMs
    }, {
      mode: "action"
    });
    return commitState({
      content: " ",
      ...composeV2FromLegacyEmbeds([forageEmbed]),
      components
    });
  }

  /* ---------------- FISHING ---------------- */
  if (sub === "fishing_menu") {
    ensureFishingState(p);
    const { unlocked: fishingUnlocked, justUnlocked: fishingJustUnlocked } = getFishingUnlockState(p);
    const { unlocked: kitchenUnlocked, justUnlocked: kitchenJustUnlocked } = getKitchenUnlockState(p);
    const rawPickerPage = Number(opt.getInteger("page") ?? 0);
    const pickerPage = Number.isFinite(rawPickerPage) ? Math.max(0, rawPickerPage) : 0;
    const selectedItemId = String(opt.getString("item") ?? "").trim() || null;

    if (!fishingUnlocked) {
      const gardenUnlocked = isGardenUnlocked(p);
      const lockedEmbed = buildMenuEmbed({
        title: `${getIcon("fishing")} Fishing`,
        description: [
          "Cast your line to catch fish and seafood for recipes and gold-star broths.",
          `${getIcon("lock")} Unlocks at shop level **${FISHING_UNLOCK_LEVEL}**.`
        ].join("\n\n"),
        user: interaction.member ?? interaction.user,
        color: theme.colors.success
      });
      return commitState({
        content: " ",
        ...composeV2FromLegacyEmbeds([lockedEmbed]),
        components: [
          noodleFeatureInfoRow(userId, {
            active: "fishing",
            gardenUnlocked,
            kitchenUnlocked,
            kitchenJustUnlocked,
            fishingUnlocked,
            fishingJustUnlocked
          }),
          noodleMainMenuRow(userId)
        ]
      });
    }

    return commitState(buildFishingMenuPayload({
      userId,
      player: p,
      ownerUser: interaction.member ?? interaction.user,
      kitchenUnlocked,
      kitchenJustUnlocked,
      fishingUnlocked,
      fishingJustUnlocked,
      page: pickerPage,
      selectedItemId
    }));
  }

  /* ---------------- FISHING ---------------- */
  if (sub === "fishing") {
    ensureFishingState(p);
    unlockNoticePlayer = p;
    const { unlocked: fishingUnlocked, justUnlocked: fishingJustUnlocked } = getFishingUnlockState(p);
    const gardenUnlocked = isGardenUnlocked(p);
    const { unlocked: kitchenUnlocked, justUnlocked: kitchenJustUnlocked } = getKitchenUnlockState(p);
    const now = nowTs();
    const rawPickerPage = Number(opt.getInteger("page") ?? 0);
    const pickerPage = Number.isFinite(rawPickerPage) ? Math.max(0, rawPickerPage) : 0;
    const itemId = opt.getString("item") ?? null;
    const isExplicitRandomFishing = navSource === "fishing_random";
    const qtyRaw = opt.getInteger("quantity") ?? 1;
    const quantity = Math.max(1, Math.min(5, qtyRaw));

    const fishingPickerRows = buildFishingPickerRows({ userId, player: p, randomPrimary: false, page: pickerPage });
    const normalizedFishingItemId = String(itemId || "").trim();
    const selectedFishingItemId = getAllowedFishingIdsForPlayer(p).includes(normalizedFishingItemId)
      ? normalizedFishingItemId
      : null;
    const fishingQtyRow = selectedFishingItemId
      ? new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`noodle:pick:fishing_qty:${userId}:${selectedFishingItemId}:1:${fishingPickerRows.safePage}`).setLabel("x1").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`noodle:pick:fishing_qty:${userId}:${selectedFishingItemId}:2:${fishingPickerRows.safePage}`).setLabel("x2").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`noodle:pick:fishing_qty:${userId}:${selectedFishingItemId}:3:${fishingPickerRows.safePage}`).setLabel("x3").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`noodle:pick:fishing_qty:${userId}:${selectedFishingItemId}:4:${fishingPickerRows.safePage}`).setLabel("x4").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`noodle:pick:fishing_qty:${userId}:${selectedFishingItemId}:5:${fishingPickerRows.safePage}`).setLabel("x5").setStyle(ButtonStyle.Primary)
        )
      : null;
    const navRows = buildForageFishingNavRows({
      userId,
      active: "fishing",
      gardenUnlocked,
      fishingUnlocked,
      fishingJustUnlocked,
      kitchenUnlocked,
      kitchenJustUnlocked,
      prependRows: [
        fishingPickerRows.actionRow,
        fishingPickerRows.pickerRow,
        ...(fishingQtyRow ? [fishingQtyRow] : []),
        ...(fishingPickerRows.pageRow ? [fishingPickerRows.pageRow] : [])
      ]
    });

    if (!selectedFishingItemId && !isExplicitRandomFishing) {
      return commitState(buildFishingMenuPayload({
        userId,
        player: p,
        ownerUser: interaction.member ?? interaction.user,
        kitchenUnlocked,
        kitchenJustUnlocked,
        fishingUnlocked,
        fishingJustUnlocked,
        page: pickerPage,
        selectedItemId: null
      }));
    }

    if (fishingUnlocked && !p.fishing.first_visit_ack) {
      p.fishing.first_visit_ack = true;
    }

    if (!fishingUnlocked) {
      const lockedEmbed = buildMenuEmbed({
        title: `${getIcon("fishing")} Fishing`,
        description: [
          "Cast your line to catch fish and seafood for recipes and gold-star broths.",
          `${getIcon("lock")} Unlocks at shop level **${FISHING_UNLOCK_LEVEL}**.`
        ].join("\n\n"),
        user: interaction.member ?? interaction.user,
        color: theme.colors.success
      });
      return commitState({
        content: " ",
        ...composeV2FromLegacyEmbeds([lockedEmbed]),
        components: [
          noodleFeatureInfoRow(userId, {
            active: "fishing",
            gardenUnlocked,
            kitchenUnlocked,
            kitchenJustUnlocked,
            fishingUnlocked,
            fishingJustUnlocked
          }),
          noodleMainMenuRow(userId)
        ]
      });
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
      return commitState({ content: " ", ...composeV2FromLegacyEmbeds([cooldownEmbed]), components: navRows });
    }

    const bonusItems = Math.max(0, Math.floor(combinedEffects.fishing_bonus_items || 0));
    const allowedFishing = new Set(getAllowedFishingIdsForPlayer(p));
    if (itemId && !allowedFishing.has(itemId)) {
      return commitState({
        content: "That isn't a valid fishing target.",
        components: navRows
      });
    }

    let drops;
    try {
      drops = rollFishingDrops({
        serverId,
        userId: interaction.user.id,
        picks: 2 + bonusItems,
        itemId,
        quantity,
        allowedItemIds: [...allowedFishing],
        effects: combinedEffects
      });
    } catch (err) {
      const unlockedFishingIds = [...allowedFishing];
      if (!unlockedFishingIds.length) {
        return commitState({
          content: `${getIcon("fishing")} You haven’t unlocked fishing catches yet.`,
          components: navRows
        });
      }

      const suggestions = unlockedFishingIds
        .map((id) => `\`${displayItemName(id)}\``)
        .join(", ");

      return commitState({
        content: `That isn't a valid fishing target. Try one of: ${suggestions}`,
        components: navRows
      });
    }

    if (itemId && bonusItems > 0) {
      drops[itemId] = (drops[itemId] ?? 0) + bonusItems;
    } else if (bonusItems > 0) {
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
    const nextFishingTs = Math.floor((now + fishingCooldownMs) / 1000);

    if (!Object.keys(accepted).length) {
      setFishingCooldown(p, now);
      const fullEmbed = buildMenuEmbed({
        title: `${getIcon("fishing")} Fishing`,
        description: `${getIcon("pantry")} Your pantry is full. Upgrade storage or use ingredients to make room.\n\n${getIcon("cooldown")} You can fish again at <t:${nextFishingTs}:t>, <t:${nextFishingTs}:R>.`,
        user: interaction.member ?? interaction.user,
        color: theme.colors.success
      });
      return commitState({ content: " ", ...composeV2FromLegacyEmbeds([fullEmbed]), components: navRows });
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
        description: `${getIcon("pantry")} Your pantry is full. Upgrade storage or use ingredients to make room.${blockedText}\n\n${getIcon("cooldown")} You can fish again at <t:${nextFishingTs}:t>, <t:${nextFishingTs}:R>.`,
        user: interaction.member ?? interaction.user,
        color: theme.colors.success
      });
      return commitState({ content: " ", ...composeV2FromLegacyEmbeds([fullEmbed]), components: navRows });
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
      const recipeNames = newlyUnlockedRecipes.map((rid) => displayRecipeName(rid)).join(" · ");
      unlockLines.push(`${getIcon("sparkle")} New recipes unlocked: ${recipeNames}.`);
      const activeEventId = s.active_event_id ?? null;
      ensureDailyOrdersForPlayer(p, set, content, s.season, serverId, userId, activeEventId);
      applyHouse247OrderBoardOverride(p);
    }

    const rejectedText = Object.keys(rejected || {}).length
      ? `\n\n${getIcon("pantry")} Pantry full — left behind ${Object.entries(rejected)
        .map(([id, q]) => `**${q}×** ${displayItemName(id)}`)
        .join(", ")}.`
      : "";
    const header = itemId
      ? `You cast with care and reel in:\n${groupedLinesText}${rejectedText}`
      : `You cast your line and reel in:\n${groupedLinesText}${rejectedText}`;

    const fishingEmbed = buildMenuEmbed({
      title: `${getIcon("bucket_of_fish")} Fishing`,
      description: [
        header,
        unlockLines.join("\n"),
        `${getIcon("cooldown")} You can fish again at <t:${nextFishingTs}:t>, <t:${nextFishingTs}:R>.`
      ].filter(Boolean).join("\n\n"),
      user: interaction.member ?? interaction.user,
      color: theme.colors.success
    });

    return commitState({ content: " ", ...composeV2FromLegacyEmbeds([fishingEmbed]), components: navRows });
  }

  /* ---------------- GARDEN ---------------- */
  if (sub === "garden") {
    const page = Math.max(0, Math.min(1, opt.getInteger("page") ?? 0));
    const gardenUnlocked = isGardenUnlocked(p);
    const { unlocked: kitchenUnlocked, justUnlocked: kitchenJustUnlocked } = getKitchenUnlockState(p);
    const { unlocked: fishingUnlocked, justUnlocked: fishingJustUnlocked } = getFishingUnlockState(p);
    let autoHarvestResult = null;
    if (combinedEffects.garden_autoharvest) {
      autoHarvestResult = autoHarvestReadyPlots(p, content, combinedEffects, {
        capacityLimiter: (drops) => applyIngredientCapacityToDrops(drops, p, combinedEffects)
      });
    }

    if (!gardenUnlocked) {
      const lockedEmbed = buildMenuEmbed({
        title: `${getIcon("garden")} Garden`,
        description: [
          "Plant seeds, harvest ingredients, and turn leftovers into compost for steady supplies.",
          `${getIcon("lock")} Unlocks at shop level **${GARDEN_UNLOCK_LEVEL}**.`
        ].join("\n\n"),
        user: interaction.member ?? interaction.user,
        color: theme.colors.success
      });
      const navRows = [
        noodleFeatureInfoRow(userId, {
          active: "garden",
          gardenUnlocked,
          kitchenUnlocked,
          kitchenJustUnlocked,
          fishingUnlocked,
          fishingJustUnlocked
        }),
        noodleMainMenuRow(userId)
      ];
      return commitState({ content: " ", ...composeV2FromLegacyEmbeds([lockedEmbed]), components: navRows });
    }

    const view = buildGardenView({
      player: p,
      combinedEffects,
      user: interaction.member ?? interaction.user,
      userId,
      autoHarvestResult,
      kitchenUnlocked,
      kitchenJustUnlocked,
      page
    });

    return commitState({
      content: " ",
      ...composeV2FromLegacyEmbeds([view.embed]),
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

    const garden = ensureGardenState(p);

    const spoiledPool = { ...garden.spoiled };
    const spoiledTotal = Object.values(spoiledPool).reduce((sum, v) => sum + (v || 0), 0);
    const pantryPool = getCompostableForageables(p, content);
    const pantryTotal = Object.values(pantryPool).reduce((sum, v) => sum + (v || 0), 0);

    const maxCraftable = Math.floor((spoiledTotal + pantryTotal) / COMPOST_PER_BAG);
    const requestedBags = Math.max(0, opt.getInteger("bags") || 0);
    const bagsToMake = Math.max(0, Math.min(requestedBags || maxCraftable, maxCraftable));
    const sourceRaw = (opt.getString("source") || "mix").toLowerCase();
    const source = ["fresh", "spoiled", "mix"].includes(sourceRaw) ? sourceRaw : "mix";

    if (maxCraftable <= 0) {
      const description = `${getIcon("warning")} Not enough compostable items. (${COMPOST_PER_BAG} needed per bag.)`;
      const embed = buildMenuEmbed({ title: `${getIcon("compost_bag")} Compost`, description, user: interaction.member ?? interaction.user, color: theme.colors.success });
      return commitState({ content: " ", ...composeV2FromLegacyEmbeds([embed]), components: navRows });
    }

    if (bagsToMake <= 0) {
      const embed = buildMenuEmbed({
        title: `${getIcon("compost_bag")} Compost`,
        description: `${getIcon("help")} Enter at least 1 bag (max ${maxCraftable}).`,
        user: interaction.member ?? interaction.user,
        color: theme.colors.success
      });
      return commitState({ content: " ", ...composeV2FromLegacyEmbeds([embed]), components: navRows, ephemeral: true });
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
      const embed = buildMenuEmbed({ title: `${getIcon("garden")} Garden`, description, user: interaction.member ?? interaction.user, color: theme.colors.success });
      return commitState({ content: " ", ...composeV2FromLegacyEmbeds([embed]), components: navRows, ephemeral: true });
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

    const description = [`${getIcon("compost_bag")} Packed **${bagsToMake}** compost bag(s).`,
      `Compost now: **${garden.compost_bags}**.`,
      usageBlocks].filter(Boolean).join("\n\n");

    const embed = buildMenuEmbed({
      title: `${getIcon("compost_bag")} Compost`,
      description,
      user: interaction.member ?? interaction.user,
      color: theme.colors.success
    });

    return commitState({
      content: " ",
      ...composeV2FromLegacyEmbeds([embed]),
      components: navRows
    });
  }

  if (sub === "plant") {
    const gardenUnlocked = isGardenUnlocked(p);
    const { unlocked: kitchenUnlocked, justUnlocked: kitchenJustUnlocked } = getKitchenUnlockState(p);
    let autoHarvestResult = null;
    if (combinedEffects.garden_autoharvest) {
      autoHarvestResult = autoHarvestReadyPlots(p, content, combinedEffects, {
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
        content: `${getIcon("seeds")} Pick a seed to plant.`,
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
      userId,
      autoHarvestResult
    });

    const summary = `${getIcon("planted")} Planted **${getSeedDisplayName(seedId, content)}** in plot #${result.plotIndex + 1}.`;
    const baseDesc = view.embed?.data?.description ?? view.embed?.description ?? "";
    view.embed.setDescription(`${summary}\n\n${baseDesc}`);

    return commitState({
      content: " ",
      ...composeV2FromLegacyEmbeds([view.embed]),
      components: [view.rows.navRow, view.rows.pageRow, view.rows.plantRow, view.rows.harvestSelectRow, noodleMainMenuRow(userId)]
    });
  }

  if (sub === "harvest") {
    const gardenUnlocked = isGardenUnlocked(p);
    let autoHarvestResult = null;
    if (combinedEffects.garden_autoharvest) {
      autoHarvestResult = autoHarvestReadyPlots(p, content, combinedEffects, {
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
      userId,
      autoHarvestResult
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
      summary = `${getIcon("harvest")} Harvested.
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
      ...composeV2FromLegacyEmbeds([view.embed]),
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
      const showSellButton = resolveTutorialGateValue({
        player: p,
        gate: "buyMenuShowSellButton",
        fallbackValue: true
      });
      const payload = buildMultiBuyPickerPayload({
        userId,
        p,
        s,
        ownerUser: interaction.member ?? interaction.user,
        page,
        showSellButton
      });

      return payload;
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
    const unlimitedMarketStock = hasUnlimitedMarketStock(p, nowTs());
    const stock = unlimitedMarketStock ? Number.MAX_SAFE_INTEGER : (p.market_stock?.[itemId] ?? 0);
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

    if (!unlimitedMarketStock && stock < qtyToBuy) {
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
    if (!unlimitedMarketStock) {
      p.market_stock[itemId] = stock - qtyToBuy;
    }

    applyQuestProgress(p, questsContent, userId, { type: "buy", amount: qtyToBuy }, now);

    advanceTutorial(p, "buy");
    const showTutorialForageRowAfterBuy = resolveTutorialGateValue({
      player: p,
      gate: "showTutorialForageRowAfterBuy",
      fallbackValue: false
    });

    const capacityNote = qtyToBuy < qty ? `\n${getIcon("pantry")} Pantry capacity limited your purchase to **${qtyToBuy}**.` : "";
    const subscriptionNote = unlimitedMarketStock
      ? `\n${getHouse247Label()} active: unlimited stock.`
      : "";
    const buyEmbed = buildMenuEmbed({
      title: `${getIcon("cart")} Purchase Complete`,
      description: `${getIcon("cart")} Bought **${qtyToBuy}× ${item.name}** for **${cost}c**.${capacityNote}${subscriptionNote}${tutorialSuffix(p)}`,
      user: interaction.member ?? interaction.user
    });
    return commitState({
      content: " ",
      ...composeV2FromLegacyEmbeds([buyEmbed]),
      components: showTutorialForageRowAfterBuy ? [noodleTutorialForageRow(userId)] : undefined
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

      return payload;
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
    return commitState({ content: " ", ...composeV2FromLegacyEmbeds([sellEmbed]) });
  }

  /* ---------------- COOK ---------------- */
  if (sub === "cook") {
    const recipeId = opt.getString("recipe");
    const qty = opt.getInteger("quantity");
    const page = opt.getInteger("page") ?? 0;
    const v2MinigameCook = opt.getBoolean("v2_minigame") === true;
    const v2Score = Math.max(0, Math.floor(Number(opt.getInteger("v2_score") ?? 0) || 0));
    const v2Turns = Math.max(1, Math.floor(Number(opt.getInteger("v2_turns") ?? 1) || 1));
    const v2SuccessBowlsOverride = Number(opt.getInteger("v2_success_bowls") ?? null);
    const v2QualityBias = String(opt.getString("v2_quality_bias") ?? "").trim().toLowerCase();

    if (!recipeId) {
      const payload = buildCookRecipePickerScenePayload({
        userId,
        p,
        s,
        quantity: 1,
        page: Number.isFinite(Number(page)) ? Number(page) : 0
      });

      return payload;
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
      const ingredientOptional = isIngredientOptionalForPlayer(p, ing);
      const need = (ing.qty ?? 0) * qtyToCook;
      if (need <= 0) continue;
      const isBroth = normalizeIngredientType(ing.item_id) === "broth";
      if (isBroth && !ingredientOptional && brothUnitsPerBowl == null) {
        brothUnitsPerBowl = Math.max(1, ing.qty ?? 1);
      }
      const haveIng = p.inv_ingredients?.[ing.item_id] ?? 0;
      if (ingredientOptional) {
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
    const tutorialStep = getCurrentTutorialStep(p);
    const counterCookFlow = Boolean(opt.getBoolean("counter_cook"));
    const disableFailures = counterCookFlow || tutorialStep?.id === "intro_cook";
    const outcome = resolveCookOutcomeForFlow({
      v2MinigameCook,
      batchOutput,
      minigameScore: v2Score,
      minigameTurns: v2Turns,
      successBowlsOverride: v2SuccessBowlsOverride,
      qualityBias: v2QualityBias,
      rollBatchOutcomeFn: rollCookBatchOutcome,
      rollBatchOutcomeArgs: {
        quantity: batchOutput,
        tier: r.tier,
        player: p,
        effects: combinedEffects,
        rng: cookRng,
        blessing,
        disableFailures
      }
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

    applyQuestProgress(p, questsContent, userId, { type: "cook", amount: batchOutput, recipeTier: r.tier }, now);
    applyCollectionProgressOnCook(p, collectionsContent, content, { recipeId, bowlsCooked: batchOutput });

    const lostLine = ingredientsToUse
      .map((ing) => {
        const lostQty = (ing.qty ?? 0) * outcome.failed;
        return lostQty > 0 ? `**${lostQty}× ${displayItemName(ing.item_id)}**` : null;
      })
      .filter(Boolean)
      .join(" · ");
    const salvageLine = outcome.salvage > 0 ? ` Salvaged **${outcome.salvage}** bowl(s).` : "";
    const failCause = v2MinigameCook
      ? "Kitchen Line performance"
      : "recipe tier risk";
    const failInfo = outcome.failed > 0
      ? `${getIcon("warning")} **Cook failure**: ${outcome.failed} bowl(s) failed. Lost: ${lostLine}. Cause: ${failCause}.${salvageLine}`
      : null;

    const cookEmbed = buildMenuEmbed({
      title: counterCookFlow ? `${getIcon("cook")} Counter Cook` : `${getIcon("cook")} Cooked`,
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

    const showTutorialServeRowAfterCook = resolveTutorialGateValue({
      player: p,
      gate: "showTutorialServeRowAfterCook",
      fallbackValue: false
    });
    const hasAcceptedOrders = Object.keys(p.orders?.accepted ?? {}).length > 0;

    if (counterCookFlow) {
      const takeout = ensureTakeoutState(p);
      const canCounterServe = getTakeoutRecipeNeedRows(p, takeout)
        .some((entry) => entry.need > 0 && entry.ready > 0);
      const canClaim = Math.max(0, Math.floor(Number(takeout?.earned_unclaimed_coins || 0) || 0)) > 0;
      return commitState({
        content: " ",
        ...composeV2FromLegacyEmbeds([cookEmbed]),
        components: [
          noodleTakeoutActionRow(userId, {
            activeShift: true,
            disableClaim: !canClaim,
            disableServe: !canCounterServe
          }),
          noodleMainMenuRowNoOrdersWithBack(userId)
        ]
      });
    }

    return commitState({
      content: " ",
      ...composeV2FromLegacyEmbeds([cookEmbed]),
      components: showTutorialServeRowAfterCook
        ? [noodleTutorialServeRow(userId)]
        : [noodleOrdersActionRow(userId, { highlightAccept: !hasAcceptedOrders, disableServe: !hasAcceptedOrders })]
    });
  }

  /* ---------------- ORDERS ---------------- */
  if (sub === "orders") {
    const now2 = nowTs();
    const sweep2 = sweepExpiredAcceptedOrders(p, s, content, now2);
    const takeoutShiftActive = hasActivePerk(p, SUBSCRIPTION_PERKS.TAKEOUT_COUNTER, now2) && isTakeoutShiftActive(p, now2);

    const acceptedEntries = Object.entries(p.orders?.accepted ?? {});
    const prepChefOrdersResult = runPrepChefAutoBuy({
      p,
      s,
      acceptedOrdersNow: acceptedEntries.map(([, a]) => a?.order).filter(Boolean),
      acceptedNow: 0,
      triggerOnOrdersBoard: true,
      includeFailureMessages: false
    });

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
      for (const ing of getRelevantRecipeIngredients(p, recipe)) {
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
    if (prepChefOrdersResult.messages.length > 0) {
      statusParts.push(prepChefOrdersResult.messages.join("\n"));
    }
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

    const acceptedDisplayEntries = acceptedEntries.map(([fullId, a]) => {
      const snap = a?.order ?? null;

      let timeLeft = "";
      if (a?.expires_at) {
        const msLeft = a.expires_at - now2;
        if (msLeft <= 0) timeLeft = " *(expired)*";
        else timeLeft = ` *(expires <t:${Math.floor(a.expires_at / 1000)}:R>)*`;
      } else timeLeft = " *(no rush)*";

      const order = snap;

      if (!order) {
        return {
          shortId: shortOrderId(fullId),
          serveReady: false,
          line: `${getIcon("status_complete")} \`${shortOrderId(fullId)}\`${timeLeft}`
        };
      }

      const npcName = content.npcs[order.npc_archetype]?.name ?? "a customer";
      const rName = content.recipes[order.recipe_id]?.name ?? "a dish";
      const lt = order.is_limited_time ? getIcon("hourglass") : "•";
      const serveReady = getTotalBowlsForRecipe(p, order.recipe_id) > 0;

      return {
        shortId: shortOrderId(fullId),
        serveReady,
        line: `${getIcon("status_complete")} \`${shortOrderId(fullId)}\` ${lt} **${rName}** — *${npcName}* (${order.tier})${timeLeft}`
      };
    });
    const acceptedLines = acceptedDisplayEntries.map((entry) => entry.line);

    const parts = [];
    if (sweep2.warning) parts.push(sweep2.warning, "");

    const { availableCount } = getOrdersMeta(p);
    const remaining = availableCount;
    const marketRestockDay = p.market_stock_day ?? s.market_day ?? dayKeyUTC(now2);
    const marketRestockMs = parseYYYYMMDD(marketRestockDay) + (24 * 60 * 60 * 1000);
    const unlimitedMarketStock = hasUnlimitedMarketStock(p, nowTs());
    const hasMarketStock = unlimitedMarketStock || Object.values(p.market_stock ?? {}).some((qty) => Number(qty) > 0);
    const ordersDayKey = p.orders_day ?? dayKeyUTC(now2);
    const nextOrdersResetMs = parseYYYYMMDD(ordersDayKey) + (24 * 60 * 60 * 1000);
    const nextOrdersResetTs = Math.floor(nextOrdersResetMs / 1000);
    const nextOrdersResetText = `<t:${nextOrdersResetTs}:f> (<t:${nextOrdersResetTs}:R>)`;
    if (takeoutShiftActive) {
      parts.push(
        "**Today’s Orders**",
        `${getTakeoutCounterLabel()} Your shop is idle on the main **Order Board** while your Take Out Counter shift is active. Serve orders from **${getTakeoutCounterLabel()}** until the shift ends.`
      );
    } else if (remaining > 0) {
      parts.push(
        "**Today’s Orders**",
        hasHouse247Perk(p)
          ? `**${getHouse247Label()} active: unlimited orders.** Tap **Accept** below to start serving customers.`
          : `There are **${remaining}** orders available. Tap **Accept** below to start serving customers.`
      );
    } else if (acceptedLines.length) {
      parts.push(
        `${getIcon("orders")} **Today’s Orders**`,
        `No new orders left today. Finish your accepted ones and come back ${nextOrdersResetText}.`
      );
    } else {
      parts.push(
        `${getIcon("confetti")} You’ve completed all of today’s orders! New orders arrive ${nextOrdersResetText}.`,
        `${getIcon("vote")} Want unlimited orders before reset? Vote in **/noodle quests_vote** to activate **${getHouse247Label()}** for **12 hours per vote**.`
      );
    }


    if (!takeoutShiftActive) {
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
    }

    const tutSuffix = tutorialSuffix(p);
    if (tutSuffix) parts.push("", tutSuffix);

    const showCancel = acceptedEntries.length > 0;
    const highlightAccept = !takeoutShiftActive && acceptedEntries.length === 0 && remaining > 0;
    const disableAccept = takeoutShiftActive || remaining <= 0;
    const disableCook = takeoutShiftActive;
    const disableServe = takeoutShiftActive || acceptedEntries.length === 0;
    const showTakeout = hasActivePerk(p, SUBSCRIPTION_PERKS.TAKEOUT_COUNTER, nowTs());

    if (isComponentsV2Enabled({ guildId: serverId, userId, player: p })) {
      const sceneState = putSceneState({
        sceneKey: "orders.board",
        ownerId: userId,
        state: {
          acceptedOrderIds: acceptedDisplayEntries.map((entry) => entry.shortId),
          readyServeOrderIds: acceptedDisplayEntries.filter((entry) => entry.serveReady).map((entry) => entry.shortId)
        }
      });

      const headerLines = [
        takeoutShiftActive
          ? `${getTakeoutCounterLabel()} Your shop is idle on the main **Order Board** while your Take Out Counter shift is active. Serve orders from **${getTakeoutCounterLabel()}** until the shift ends.`
          : (remaining > 0
            ? `Open orders: **${remaining}**`
            : "No new orders left right now.")
      ];
      if (!takeoutShiftActive) {
        headerLines.push(
          acceptedDisplayEntries.length > 0
            ? `Accepted: **${acceptedDisplayEntries.length}**`
            : "Accepted: **0**"
        );
      }

      const tutorialActionKey = resolveTutorialOrdersActionKey(p);
      const tutorialQuickActions = tutorialActionKey
        ? [
            {
              label: tutorialActionKey === "acc"
                ? "Accept"
                : tutorialActionKey === "buy"
                  ? "Buy"
                  : tutorialActionKey === "fg"
                    ? "Forage"
                    : tutorialActionKey === "ck"
                      ? "Cook"
                      : "Serve",
              actionKey: tutorialActionKey,
              style: 3,
              disabled: tutorialActionKey === "acc"
                ? disableAccept
                : tutorialActionKey === "ck"
                  ? disableCook
                  : tutorialActionKey === "sv"
                    ? disableServe
                    : false,
              emoji: tutorialActionKey === "acc"
                ? getButtonEmoji("orders")
                : tutorialActionKey === "buy"
                  ? getButtonEmoji("cart")
                  : tutorialActionKey === "fg"
                    ? getButtonEmoji("forage")
                    : tutorialActionKey === "ck"
                      ? getButtonEmoji("cook")
                      : getButtonEmoji("serve")
            }
          ]
        : null;

      const quickActions = tutorialQuickActions ?? [
        { label: "Accept", actionKey: "acc", style: highlightAccept ? 3 : 1, disabled: disableAccept, emoji: getButtonEmoji("orders") },
        { label: "Cook", actionKey: "ck", style: 2, disabled: disableCook, emoji: getButtonEmoji("cook") },
        { label: "Serve", actionKey: "sv", style: disableServe ? 2 : 1, disabled: disableServe, emoji: getButtonEmoji("serve") },
        { label: "Cancel", actionKey: "cnl", style: 2, disabled: !showCancel, emoji: getButtonEmoji("cancel") },
        { label: "Main Menu", actionKey: "nm", style: 2, disabled: false, emoji: getButtonEmoji("back") },
        { label: "Buy", actionKey: "buy", style: 2, disabled: false, emoji: getButtonEmoji("cart") },
        { label: "Pantry", actionKey: "pn", style: 2, disabled: false, emoji: getButtonEmoji("pantry") },
        { label: "Quests", actionKey: "qs", style: 2, disabled: false, emoji: getButtonEmoji("quests") },
        ...(showTakeout
          ? [{ label: "Takeout", actionKey: "tk", style: takeoutShiftActive ? 1 : 3, disabled: false, emoji: getButtonEmoji("orders") }]
          : [])
      ];

      const v2Payload = buildOrdersBoardV2Message({
        userId,
        token: sceneState.token,
        headerLines,
        acceptedEntries: acceptedDisplayEntries,
        acceptedSummaryLines: !takeoutShiftActive && acceptedDisplayEntries.length > 0 ? statusParts : [],
        showAcceptedSection: !takeoutShiftActive,
        quickActions
      });

      return commitState(v2Payload);
    }

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
    const tutorialRows = getTutorialProgressRows(p, userId, { highlightAccept, disableAccept });
    return commitState({
      content: " ",
      ...composeV2FromLegacyEmbeds([menuEmbed]),
      components: tutorialRows
        ? tutorialRows
        : [
            noodleOrdersMenuActionRow(userId, {
              showCancel,
              highlightAccept,
              disableAccept,
              disableCook,
              disableServe,
              showTakeout
            }),
            noodleMainMenuRowNoOrders(userId)
          ]
    });
  }

  /* ---------------- ACCEPT -------- */
  if (sub === "accept") {
    const now2 = nowTs();
    const takeoutShiftActive = hasActivePerk(p, SUBSCRIPTION_PERKS.TAKEOUT_COUNTER, now2) && isTakeoutShiftActive(p, now2);
    if (takeoutShiftActive) {
      return commitState({
        content: `${getTakeoutCounterLabel()} Your shop is idle on the main **Order Board** while Take Out Counter is active. Serve orders from **${getTakeoutCounterLabel()}** until the shift ends.`,
        ephemeral: true
      });
    }

    const tutorialSingleAcceptMode = isTutorialStepFromRouting(p, "intro_order");
    const rawInput = String(opt.getString("order_id") ?? "").trim();
    if (!rawInput) {
      const payload = buildAcceptPickerPayload({
        userId,
        serverId,
        p,
        s,
        ownerUser: interaction.member ?? interaction.user
      });

      return payload;
    }
    const tokens = rawInput
      .split(/[\s,]+/)
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);

    if (!tokens.length) return commitState({ content: "Pick at least one order to accept.", ephemeral: true });

    const cap = getOrderAcceptCap(p, nowTs());
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
      const isLimitedTimeOrder = tutorialSingleAcceptMode && acceptedNow === 0
        ? false
        : Boolean(order.is_limited_time);
      const speedWindowSeconds = isLimitedTimeOrder
        ? getLimitedTimeWindowSeconds(p, baseSpeedWindowSeconds)
        : baseSpeedWindowSeconds;
      const expiresAt = isLimitedTimeOrder
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
          is_limited_time: isLimitedTimeOrder,
          speed_window_seconds: speedWindowSeconds,
          base_speed_window_seconds: baseSpeedWindowSeconds
        }
      };

      const rName = content.recipes[order.recipe_id]?.name ?? "a dish";
      const timeNote = expiresAt
        ? `${getIcon("hourglass")} expires <t:${Math.floor(expiresAt / 1000)}:R>.`
        : `${getIcon("forage")} No rush.`;

      const extendedNote = isLimitedTimeOrder && speedWindowSeconds !== baseSpeedWindowSeconds
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

    const prepChefAcceptResult = runPrepChefAutoBuy({
      p,
      s,
      acceptedOrdersNow,
      acceptedNow,
      triggerOnOrdersBoard: false,
      includeFailureMessages: true
    });
    if (prepChefAcceptResult.messages.length > 0) {
      results.push(...prepChefAcceptResult.messages);
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
      getRelevantRecipeIngredients(p, recipe).forEach((ing) => {
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
        const rName = displayRecipeName(recipeId);
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
    const showTutorialBuyRowAfterAccept = resolveTutorialGateValue({
      player: p,
      gate: "showTutorialBuyRowAfterAccept",
      fallbackValue: false
    });
    return commitState({
      content: " ",
      ...composeV2FromLegacyEmbeds([acceptEmbed]),
      components: showTutorialBuyRowAfterAccept
        ? [noodleTutorialBuyRow(userId)]
        : [
            noodleOrdersActionRow(userId, { highlightAccept: !hasAcceptedOrders, disableServe: !hasAcceptedOrders }),
            noodleMainMenuRow(userId)
          ]
    });
  }

  /* ---------------- CANCEL ---------------- */
  if (sub === "cancel") {
    const rawInput = String(opt.getString("order_id") ?? "").trim();
    const tokens = rawInput
      .split(/[\s,]+/)
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);

    if (tokens.length) {
      clearCancelOrderDraftSelection({ serverId, userId });
    }

    if (!tokens.length) {
      if (isComponentsV2Enabled({ guildId: serverId, userId, player: p })) {
        return buildCancelPickerScenePayload({ userId, p });
      }

      const payload = buildCancelServePickerPayload({
        action: "cancel",
        userId,
        serverId,
        p,
        ownerUser: interaction.member ?? interaction.user,
        page: Number(opt.getInteger("page") ?? 0) || 0
      });

      return payload;
    }

    // Ensure orders is a valid object (handle case where it might be an array or null)
    if (!p.orders || typeof p.orders !== 'object' || Array.isArray(p.orders)) {
      p.orders = { accepted: {}, seasonal_served_today: 0, epic_served_today: 0 };
    }
    if (!p.orders.accepted) p.orders.accepted = {};
    const accepted = p.orders.accepted;

    const results = [];
    let canceled = 0;
    for (const token of tokens) {
      const fullId = Object.keys(accepted).find((id) => {
        const full = String(id).toUpperCase();
        const short = shortOrderId(id);
        return full === token || short === token;
      });

      if (!fullId) {
        results.push(`${getIcon("question")} You don’t have order \`${token}\` accepted.`);
        continue;
      }

      const entry = accepted[fullId];
      const orderSnap = entry?.order ?? null;
      const rName = orderSnap ? (content.recipes[orderSnap.recipe_id]?.name ?? "a dish") : null;
      const npcName = orderSnap ? (content.npcs[orderSnap.npc_archetype]?.name ?? orderSnap.npc_archetype) : null;
      delete accepted[fullId];
      canceled += 1;
      results.push(`${getIcon("cancel")} Canceled \`${shortOrderId(fullId)}\`${rName ? ` — **${rName}**` : ""}${npcName ? ` for *${npcName}*` : ""}.`);
    }

    if (canceled <= 0) {
      return commitState({ content: results.join("\n") || "You don’t have those orders accepted.", ephemeral: true });
    }

    const cancelMsg = results.join("\n");
    const cancelEmbed = buildMenuEmbed({
      title: canceled === 1 ? `${getIcon("cancel")} Order Canceled` : `${getIcon("cancel")} Orders Canceled`,
      description: cancelMsg,
      user: interaction.member ?? interaction.user
    });
    return commitState({
      content: " ",
      ...composeV2FromLegacyEmbeds([cancelEmbed])
    });
  }

  /* ---------------- SERVE ---------------- */
  if (sub === "serve") {
    const now2 = nowTs();
    const takeoutShiftActive = hasActivePerk(p, SUBSCRIPTION_PERKS.TAKEOUT_COUNTER, now2) && isTakeoutShiftActive(p, now2);
    if (takeoutShiftActive) {
      return commitState({
        content: `${getTakeoutCounterLabel()} Your shop is idle on the main **Order Board** while Take Out Counter is active. Serve orders from **${getTakeoutCounterLabel()}** until the shift ends.`,
        ephemeral: true
      });
    }

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
        serverId,
        p,
        ownerUser: interaction.member ?? interaction.user,
        page: Number(opt.getInteger("page") ?? 0) || 0
      });

      return payload;
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
    let totalCoins = 0;
    let totalRep = 0;
    let totalSxp = 0;
    let servedCount = 0;
    const servedByNpc = {};
    let seasonalServedCount = 0;
    let seasonalServedCoins = 0;
    let duplicateDiscoveryCoins = 0;
    let discoveryRewardGrantedThisServe = false;
    let leveledUp = false;
    let recipeUnlocked = false;
    const unlockedRecipeNames = [];

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
      if (allowDiscovery && !discoveryRewardGrantedThisServe) {
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

        if ((discoveries?.length || 0) > 0) {
          discoveryRewardGrantedThisServe = true;
        }
        
        for (const discovery of discoveries ?? []) {
          const result = applyDiscovery(p, discovery, content, discoveryRng, { badgesContent });
          if (result.message) {
            discoveryMessages.push(result.message);
          } else if (result.isDuplicate && result.reward) {
            const rewardMatch = String(result.reward).match(/\+(\d+)c/i);
            const duplicateCoins = rewardMatch ? Number(rewardMatch[1] || 0) : 0;
            duplicateDiscoveryCoins += duplicateCoins;

            const recipeLabel = discovery.recipeName || discovery.recipeId || "that recipe";
            const duplicateType = discovery.type === "scroll" ? "scroll" : "clue";

            if (duplicateCoins > 0) {
              discoveryMessages.push(
                `${getIcon("sparkle")} You already found a **${duplicateType}** for **${recipeLabel}**, so you got **+${duplicateCoins}c** bonus coins.`
              );
            } else {
              discoveryMessages.push(
                `${getIcon("sparkle")} You already found a **${duplicateType}** for **${recipeLabel}**.`
              );
            }
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
      servedByNpc[order.npc_archetype] = (servedByNpc[order.npc_archetype] ?? 0) + 1;

      const recipeTierForQuest = recipe?.tier ?? order.tier;
      const recipeSeasonForQuest = recipe?.season ?? order.season ?? null;
      const isSeasonalRecipeServe = recipeTierForQuest === "seasonal" && (!recipeSeasonForQuest || recipeSeasonForQuest === s.season);
      if (isSeasonalRecipeServe) {
        seasonalServedCount += 1;
        seasonalServedCoins += rewards.coins;
      }

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
            serveMsg += ` ${getIcon("sparkle")} Aura buff already active (expires <t:${ts}:R>)`;
          } else {
            serveMsg += ` ${getIcon("sparkle")} +2 REP for 15 min (expires <t:${ts}:R>)`;
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
      const rName = displayRecipeName(recipeId);
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
      const failPayload = { content: " ", ...composeV2FromLegacyEmbeds([failEmbed]) };
      if (isComponentsV2Enabled({ guildId: serverId, userId, player: p })) {
        return commitState(convertLegacyEmbedPayloadToComponentsV2(failPayload));
      }
      return commitState(failPayload);
    }

    if (servedCount > 0) {
      applyQuestProgress(
        p,
        questsContent,
        userId,
        {
          type: "serve",
          amount: servedCount,
          tierAmounts: { seasonal: seasonalServedCount },
          npcAmounts: servedByNpc
        },
        now
      );
      if (totalCoins > 0) {
        applyQuestProgress(
          p,
          questsContent,
          userId,
          { type: "earn_coins", amount: totalCoins, tierAmounts: { seasonal: seasonalServedCoins } },
          now
        );
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
    const hiddenSpecUnlockNotices = [];
    if (newlyUnlockedSpecs.length) {
      for (const spec of newlyUnlockedSpecs) {
        state.unlocked_spec_ids.push(spec.spec_id);
        hiddenSpecUnlockNotices.push({
          title: `${getIcon("sparkle")} Hidden Specialization Unlocked`,
          details: [
            `**${spec.name}** is now unlocked.`,
            "Open **/noodle specialize** to view and switch your specialization."
          ],
          tone: "success",
          thumbnailUrl: getSpecializationThumbnailUrl(spec)
        });
      }
    }
    
    // If a recipe was unlocked, refresh order pool and let regulars know they can order it now
    if (recipeUnlocked) {
      const activeEventId = s.active_event_id ?? null;
      ensureDailyOrdersForPlayer(p, set, content, s.season, serverId, userId, activeEventId);
      applyHouse247OrderBoardOverride(p);
      const friendlyNames = unlockedRecipeNames.length
        ? unlockedRecipeNames.length === 1
          ? unlockedRecipeNames[0]
          : `${unlockedRecipeNames.slice(0, -1).join(", ")} & ${unlockedRecipeNames.at(-1)}`
        : "your new recipe";
      results.push(`${getIcon("regulars")} Regulars are already asking for **${friendlyNames}**.`);
    }

    const duplicateSummary = duplicateDiscoveryCoins > 0
      ? ` (includes **+${duplicateDiscoveryCoins}c** from duplicate clues/scrolls)`
      : "";
    const summary = `Rewards total: **+${totalCoins}c**, **+${totalSxp} SXP**, **+${totalRep} REP**${duplicateSummary}.`;
    const levelLine = leveledUp ? `\n${getIcon("level_up")} Level up! You're now **Level ${p.shop_level}**.` : "";
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
  serveLines.push("", `${summary}${levelLine}${discoveryLine}${suffix}`);

    const serveEmbed = buildMenuEmbed({
      title: `${getIcon("serve")} Orders Served`,
      description: serveLines.join("\n"),
      user: interaction.member ?? interaction.user
    });

    const servePayload = {
      content: " ",
      components,
      ...composeV2FromLegacyEmbeds([serveEmbed, ...embeds]),
      notices: hiddenSpecUnlockNotices
    };
    if (isComponentsV2Enabled({ guildId: serverId, userId, player: p })) {
      return commitState(convertLegacyEmbedPayloadToComponentsV2(servePayload));
    }
    return commitState(servePayload);
  }

  return commitState({ content: "That subcommand exists but isn’t implemented yet.", ephemeral: true });
});
return commit(lockedPayload);

} catch (e) {
console.error("NOODLE CMD ERROR:", e?.stack ?? e);
return commit({ content: cozyError(e), ephemeral: true });
}
}

/* ------------------------------------------------------------------ */
/*  Component routing                                                  */
/* ------------------------------------------------------------------ */

function getCustomIdPrefix(customId, maxSegments = 3) {
  const id = String(customId || "").trim();
  if (!id) return null;
  const parts = id.split(":").filter(Boolean);
  if (!parts.length) return null;
  return parts.slice(0, maxSegments).join(":");
}

function getV2SceneModule(sceneKey = "") {
  const key = String(sceneKey || "").trim();
  if (!key) return "unknown";
  const [moduleKey] = key.split(".");
  return moduleKey || "unknown";
}

function getV2LoopTrackerKey({ serverId, userId, loop = "" } = {}) {
  return `${String(serverId || "")}:${String(userId || "")}:${String(loop || "")}`;
}

function startV2LoopTracker({ serverId, userId, loop } = {}) {
  const key = getV2LoopTrackerKey({ serverId, userId, loop });
  const now = nowTs();
  v2LoopTracker.set(key, {
    startedAt: now,
    clicks: 0,
    lastAt: now
  });
}

function touchV2LoopTracker({ serverId, userId, loop } = {}) {
  const key = getV2LoopTrackerKey({ serverId, userId, loop });
  const now = nowTs();
  const current = v2LoopTracker.get(key) ?? {
    startedAt: now,
    clicks: 0,
    lastAt: now
  };
  current.clicks = Number(current.clicks || 0) + 1;
  current.lastAt = now;
  if (!Number.isFinite(Number(current.startedAt)) || Number(current.startedAt) <= 0) {
    current.startedAt = now;
  }
  v2LoopTracker.set(key, current);
  return {
    clicks: current.clicks,
    elapsedMs: Math.max(0, now - Number(current.startedAt || now))
  };
}

function completeV2LoopTracker({ serverId, userId, loop } = {}) {
  const key = getV2LoopTrackerKey({ serverId, userId, loop });
  const now = nowTs();
  const current = v2LoopTracker.get(key);
  v2LoopTracker.delete(key);
  if (!current) return { clicks: 0, elapsedMs: 0 };
  return {
    clicks: Number(current.clicks || 0),
    elapsedMs: Math.max(0, now - Number(current.startedAt || now))
  };
}

function collectStringLeaves(value, out = []) {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringLeaves(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStringLeaves(item, out);
    return out;
  }
  return out;
}

function extractPrepChefMessagesFromPayload(payload) {
  const allStrings = collectStringLeaves(payload, []);
  const seen = new Set();
  const messages = [];
  for (const raw of allStrings) {
    const text = String(raw || "");
    if (!text || !text.includes("Prep Chef")) continue;
    for (const line of text.split(/\r?\n/)) {
      const idx = line.indexOf("Prep Chef");
      if (idx < 0) continue;
      const prepLine = line.slice(idx).trim();
      if (!prepLine) continue;
      if (seen.has(prepLine)) continue;
      seen.add(prepLine);
      messages.push(prepLine);
    }
  }
  return messages;
}

function summarizePrepChefMessages(messages, { includeFailureMessages = true } = {}) {
  const lines = Array.isArray(messages)
    ? messages.map((line) => String(line || "").trim()).filter(Boolean)
    : [];

  const purchasedByItem = new Map();
  let totalAutoCost = 0;
  let fallbackFailure = "";

  for (const line of lines) {
    const normalized = line.replace(/\*\*/g, "").trim();
    if (!normalized) continue;

    const lower = normalized.toLowerCase();
    if (lower.includes("prep chef auto-bought:")) {
      const match = normalized.match(/prep chef auto-bought:\s*(.+?)(?:\s*\(total\s*\d+c\)\.?|$)/i);
      const purchasedItems = String(match?.[1] || "").trim();
      if (purchasedItems) {
        for (const token of purchasedItems.split(/\s*·\s*/)) {
          const entry = String(token || "").trim();
          if (!entry) continue;
          const itemMatch = entry.match(/^(\d+)x\s+(.+)$/i);
          const qty = Number(itemMatch?.[1] || 1);
          const itemName = String(itemMatch?.[2] || entry).trim();
          if (!itemName) continue;
          purchasedByItem.set(itemName, (purchasedByItem.get(itemName) ?? 0) + Math.max(0, qty));
        }
      }

      const costMatch = normalized.match(/total\s*(\d+)c/i);
      if (costMatch) {
        totalAutoCost += Math.max(0, Math.floor(Number(costMatch[1]) || 0));
      }
      continue;
    }

    if (!includeFailureMessages || fallbackFailure) continue;
    if (lower.includes("prep chef found only forage/fishing ingredients missing")) {
      fallbackFailure = `${getIcon("chef")} Prep Chef found only forage/fishing ingredients missing (no market ingredients to auto-buy).`;
      continue;
    }
    if (lower.includes("prep chef could not auto-buy: not enough coins")) {
      fallbackFailure = `${getIcon("chef")} Prep Chef could not auto-buy: not enough coins.`;
      continue;
    }
    if (lower.includes("prep chef could not auto-buy: market stock is sold out")) {
      fallbackFailure = `${getIcon("chef")} Prep Chef could not auto-buy: market stock is sold out for one or more needed items.`;
      continue;
    }
    if (lower.includes("prep chef could not auto-buy: pantry storage is full")) {
      fallbackFailure = `${getIcon("chef")} Prep Chef could not auto-buy: pantry storage is full for one or more ingredient types.`;
      continue;
    }
    if (lower.includes("prep chef skipped auto-buy")) {
      fallbackFailure = `${getIcon("chef")} Prep Chef skipped auto-buy: accepted orders already have ready bowls.`;
    }
  }

  if (purchasedByItem.size > 0) {
    const purchasedItems = [...purchasedByItem.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([itemName, qty]) => `${qty}x ${itemName}`)
      .join(" · ");
    return [`${getIcon("chef")} Prep Chef auto-bought: ${purchasedItems} (Total **${totalAutoCost}c**).`];
  }

  if (fallbackFailure) return [fallbackFailure];
  return [];
}

async function handleComponent(interaction) {
const customId = String(interaction.customId || "");

// Note: deferUpdate is already called in index.js for most components
// We don't need to defer again here, just route to the appropriate handler
const userId = interaction.user.id;
const serverId = interaction.guildId;
if (!serverId) {
  return componentCommit(interaction, { content: "This game runs inside a server (not DMs).", ephemeral: true });
}
const v2Parsed = parseV2CustomId(customId);
if (v2Parsed.isV2) {
  const rolloutPlayer = ensurePlayer(serverId, userId);
  if (!isComponentsV2Enabled({ guildId: serverId, userId, player: rolloutPlayer })) {
    emitTelemetry("v2_scene_error", {
      module: "gate",
      sceneKey: String(v2Parsed.sceneKey || ""),
      actionKey: String(v2Parsed.actionKey || ""),
      reason: "v2_disabled"
    });
    return componentCommit(interaction, {
      content: "This V2 menu is currently disabled. Use `/noodle` to reopen the V1 menu.",
      ephemeral: true
    });
  }
  if (!v2Parsed.valid) {
    emitTelemetry("v2_scene_error", {
      module: getV2SceneModule(v2Parsed.sceneKey),
      sceneKey: String(v2Parsed.sceneKey || ""),
      actionKey: String(v2Parsed.actionKey || ""),
      reason: String(v2Parsed.error || "invalid_route")
    });
    return componentCommit(interaction, {
      content: "This menu expired or is invalid. Please reopen from /noodle.",
      ephemeral: true
    });
  }
  if (isV2OwnerMismatch(v2Parsed, userId)) {
    emitTelemetry("v2_scene_error", {
      module: getV2SceneModule(v2Parsed.sceneKey),
      sceneKey: String(v2Parsed.sceneKey || ""),
      actionKey: String(v2Parsed.actionKey || ""),
      reason: "owner_mismatch"
    });
    return componentCommit(interaction, {
      content: "That menu isn’t for you.",
      ephemeral: true
    });
  }

  const sceneState = getSceneState({
    sceneKey: v2Parsed.sceneKey,
    token: v2Parsed.token,
    ownerId: userId
  });
  if (!sceneState.ok && sceneState.stale) {
    emitTelemetry("v2_scene_error", {
      module: getV2SceneModule(v2Parsed.sceneKey),
      sceneKey: String(v2Parsed.sceneKey || ""),
      actionKey: String(v2Parsed.actionKey || ""),
      reason: String(sceneState.reason || "stale")
    });

    if (v2Parsed.sceneKey === "orders.board" && (sceneState.reason === "missing_state" || sceneState.reason === "expired")) {
      const action = String(v2Parsed.actionKey || "").trim();
      const serveArg = String(v2Parsed.args?.[0] ?? "").trim();
      const p = ensurePlayer(serverId, userId);
      const s = ensureServer(serverId);

      if (action === "acc") {
        startV2LoopTracker({ serverId, userId, loop: "orders" });
        const payload = buildAcceptPickerScenePayload({ serverId, userId, p, s });
        return componentCommit(interaction, payload);
      }
      if (action === "cnl") {
        startV2LoopTracker({ serverId, userId, loop: "orders" });
        const payload = buildCancelPickerScenePayload({ userId, p });
        return componentCommit(interaction, payload);
      }
      if (action === "sv") {
        startV2LoopTracker({ serverId, userId, loop: "serve" });
        const payload = serveArg
          ? buildServePickerScenePayload({ userId, p, selectedShortIds: [serveArg], readyOnly: true })
          : buildServePickerScenePayload({ userId, p });
        return componentCommit(interaction, payload);
      }
      if (action === "ck") {
        startV2LoopTracker({ serverId, userId, loop: "cook" });
        const payload = buildCookRecipePickerScenePayload({ userId, p, s, quantity: 1 });
        return componentCommit(interaction, payload);
      }
      if (action === "fg") {
        const forageSub = resolveForageNavSub(p);
        if (forageSub === "forage") {
          return runNoodle(interaction, { sub: "forage", navSource: "forage_random" });
        }
        return runNoodle(interaction, { sub: forageSub });
      }
      if (action === "buy") return runNoodle(interaction, { sub: "buy" });
      if (action === "pn") return runNoodle(interaction, { sub: "pantry" });
      if (action === "qs") return runNoodle(interaction, { sub: "quests" });
      if (action === "tk") return runNoodle(interaction, { sub: "takeout" });
      if (action === "rf") return runNoodle(interaction, { sub: "orders" });
      if (action === "nm") return runNoodle(interaction, { sub: "profile" });
    }

    if (rolloutPlayer?.tutorial?.active === true) {
      const recoverySub = resolveTutorialRecoverySub({ player: rolloutPlayer, fallbackSub: "orders" });
      return runNoodle(interaction, { sub: recoverySub });
    }
    const acceptedCount = Object.keys(ensurePlayer(serverId, userId).orders?.accepted ?? {}).length;
    if (v2Parsed.sceneKey === "serve.order_picker" || v2Parsed.sceneKey === "serve.result") {
      return componentCommit(interaction, {
        content: acceptedCount > 0
          ? "This serve view expired. Reopen `/noodle orders`, then tap **Serve** again."
          : "You need to accept an order before serving. Open `/noodle orders` and tap **Accept**.",
        ephemeral: true
      });
    }
    return componentCommit(interaction, {
      content: "That view is stale. Run `/noodle orders` to reopen the orders board.",
      ephemeral: true
    });
  }

  const transition = touchV2LoopTracker({
    serverId,
    userId,
    loop: getV2SceneModule(v2Parsed.sceneKey)
  });
  emitTelemetry("v2_scene_transition", {
    module: getV2SceneModule(v2Parsed.sceneKey),
    sceneKey: String(v2Parsed.sceneKey || ""),
    actionKey: String(v2Parsed.actionKey || ""),
    clickCount: transition.clicks,
    loopElapsedMs: transition.elapsedMs,
    argsCount: Array.isArray(v2Parsed.args) ? v2Parsed.args.length : 0
  });

  if (v2Parsed.sceneKey === "orders.board") {
    const state = sceneState?.value?.state ?? {};
    const action = v2Parsed.actionKey;
    const serveArg = String(v2Parsed.args?.[0] ?? "").trim();

    if (action === "acc") {
      startV2LoopTracker({ serverId, userId, loop: "orders" });
      const s = ensureServer(serverId);
      const p = ensurePlayer(serverId, userId);
      const payload = buildAcceptPickerScenePayload({ serverId, userId, p, s });
      return componentCommit(interaction, payload);
    }
    if (action === "ck") {
      startV2LoopTracker({ serverId, userId, loop: "cook" });
      const s = ensureServer(serverId);
      const p = ensurePlayer(serverId, userId);
      if (isTutorialStepFromRouting(p, "intro_cook")) {
        const tutorialRecipeId = resolveTutorialCookRecipeId(p);
        if (tutorialRecipeId) {
          const tutorialPayload = buildCookMinigameScenePayload({
            userId,
            recipeId: tutorialRecipeId,
            quantity: 1,
            totalTurns: 6,
            turnIndex: 0,
            score: 0,
            misses: 0,
            turnMs: 18000,
            graceMs: 3000,
            tutorialMode: true,
            coachingLine: "Tutorial mode: generous timing is enabled for this step. Future kitchen turns use a **10s** order window."
          });
          return componentCommit(interaction, tutorialPayload);
        }
      }
      const payload = buildCookRecipePickerScenePayload({ userId, p, s, quantity: 1 });
      return componentCommit(interaction, payload);
    }
    if (action === "fg") {
      const p = ensurePlayer(serverId, userId);
      const forageSub = resolveForageNavSub(p);
      if (forageSub === "forage") {
        return runNoodle(interaction, { sub: "forage", navSource: "forage_random" });
      }
      return runNoodle(interaction, { sub: forageSub });
    }
    if (action === "buy") return runNoodle(interaction, { sub: "buy" });
    if (action === "pn") return runNoodle(interaction, { sub: "pantry" });
    if (action === "qs") return runNoodle(interaction, { sub: "quests" });
    if (action === "tk") return runNoodle(interaction, { sub: "takeout" });
    if (action === "rf") return runNoodle(interaction, { sub: "orders" });
    if (action === "nm") return runNoodle(interaction, { sub: "profile" });
    if (action === "cnl") {
      startV2LoopTracker({ serverId, userId, loop: "orders" });
      const p = ensurePlayer(serverId, userId);
      const payload = buildCancelPickerScenePayload({ userId, p });
      return componentCommit(interaction, payload);
    }
    if (action === "sv") {
      startV2LoopTracker({ serverId, userId, loop: "serve" });
      const p = ensurePlayer(serverId, userId);
      if (!serveArg) {
        const payload = buildServePickerScenePayload({ userId, p });
        return componentCommit(interaction, payload);
      }
      const readyServeOrderIds = new Set((state.readyServeOrderIds || []).map((id) => String(id || "").trim()).filter(Boolean));
      if (!readyServeOrderIds.has(serveArg)) {
        return componentCommit(interaction, {
          content: "That order is no longer ready. Reopen `/noodle orders` and try again.",
          ephemeral: true
        });
      }
      const payload = buildServePickerScenePayload({ userId, p, selectedShortIds: [serveArg], readyOnly: true });
      return componentCommit(interaction, payload);
    }
  }

  if (v2Parsed.sceneKey === "orders.accept_picker") {
    const state = sceneState?.value?.state ?? {};
    const action = v2Parsed.actionKey;
    const selectedShortId = String(v2Parsed.args?.[0] ?? "").trim();

    if (action === "bk" || action === "cnl") {
      return runNoodle(interaction, { sub: "orders" });
    }

    if (action === "sel") {
      const entries = Array.isArray(state.entries) ? state.entries : [];
      const selected = entries.find((entry) => String(entry?.shortId ?? "") === selectedShortId);
      if (!selected) {
        return componentCommit(interaction, {
          content: "That order is no longer selectable. Reopen `/noodle orders`.",
          ephemeral: true
        });
      }

      const currentSelected = Array.isArray(state.selectedShortIds)
        ? state.selectedShortIds.map((id) => String(id || "").trim()).filter(Boolean)
        : [];
      const selectedSet = new Set(currentSelected);
      if (selectedSet.has(selectedShortId)) {
        selectedSet.delete(selectedShortId);
      } else {
        const p = ensurePlayer(serverId, userId);
        const cap = getOrderAcceptCap(p, nowTs());
        const acceptedCount = Object.keys(p.orders?.accepted ?? {}).length;
        const remainingSlots = Math.max(0, cap - acceptedCount);
        if (selectedSet.size >= remainingSlots) {
          const s = ensureServer(serverId);
          const payload = buildAcceptPickerScenePayload({
            serverId,
            userId,
            p,
            s,
            selectedShortIds: [...selectedSet],
            statusLine: `${getIcon("warning")} You can accept up to **${cap}** order(s). Deselect one first.`
          });
          return componentCommit(interaction, payload);
        }
        selectedSet.add(selectedShortId);
      }

      const p = ensurePlayer(serverId, userId);
      const s = ensureServer(serverId);
      const payload = buildAcceptPickerScenePayload({
        serverId,
        userId,
        p,
        s,
        selectedShortIds: [...selectedSet],
        page: Number(state.page) || 0
      });
      return componentCommit(interaction, payload);
    }

    if (action === "pg") {
      const arg = String(v2Parsed.args?.[0] ?? "").trim().toLowerCase();
      const totalPages = Math.max(1, Math.floor(Number(state.totalPages) || 1));
      const currentPage = Math.max(0, Math.min(Math.floor(Number(state.page) || 0), totalPages - 1));
      const nextPage = arg === "prev"
        ? (currentPage <= 0 ? totalPages - 1 : currentPage - 1)
        : (currentPage >= totalPages - 1 ? 0 : currentPage + 1);
      const currentSelected = Array.isArray(state.selectedShortIds)
        ? state.selectedShortIds.map((id) => String(id || "").trim()).filter(Boolean)
        : [];

      const p = ensurePlayer(serverId, userId);
      const s = ensureServer(serverId);
      const payload = buildAcceptPickerScenePayload({
        serverId,
        userId,
        p,
        s,
        selectedShortIds: currentSelected,
        page: nextPage
      });
      return componentCommit(interaction, payload);
    }

    if (action === "cfm") {
      const entries = Array.isArray(state.entries) ? state.entries : [];
      const requestedShortId = String(v2Parsed.args?.[0] ?? "").trim();
      const selectedShortIds = Array.isArray(state.selectedShortIds)
        ? state.selectedShortIds.map((id) => String(id || "").trim()).filter(Boolean)
        : [];
      const effectiveSelectedShortIds = requestedShortId ? [requestedShortId] : selectedShortIds;
      if (effectiveSelectedShortIds.length <= 0) {
        return componentCommit(interaction, {
          content: "Select one or more orders first.",
          ephemeral: true
        });
      }

      const orderTokenByShortId = state.orderTokenByShortId ?? {};
      const selectableOrderTokenByShortId = state.selectableOrderTokenByShortId ?? orderTokenByShortId;
      const validShortIds = new Set(Object.keys(selectableOrderTokenByShortId).map((id) => String(id || "").trim()).filter(Boolean));
      const targets = effectiveSelectedShortIds.filter((shortId) => validShortIds.has(shortId));
      if (targets.length <= 0) {
        return componentCommit(interaction, {
          content: "Those selections are no longer available. Reopen `/noodle orders`.",
          ephemeral: true
        });
      }

      let acceptedCount = 0;
      let duplicateCount = 0;
      let invalidCount = 0;
      let capCount = 0;
      const prepChefMessages = [];

      for (const shortId of targets) {
        const fullOrderId = String(selectableOrderTokenByShortId?.[shortId] ?? "").trim();
        if (!fullOrderId) {
          invalidCount += 1;
          continue;
        }

        const beforePlayer = ensurePlayer(serverId, userId);
        const beforeAcceptedOrderIds = Object.keys(beforePlayer.orders?.accepted ?? {});
        const cap = getOrderAcceptCap(beforePlayer, nowTs());

        if (beforeAcceptedOrderIds.length >= cap) {
          capCount += 1;
          continue;
        }

        const silentResult = await runNoodle(interaction, {
          sub: "accept",
          overrides: {
            silentResponse: true,
            strings: { order_id: fullOrderId }
          }
        });

        const extracted = extractPrepChefMessagesFromPayload(silentResult);
        for (const msg of extracted) {
          if (!prepChefMessages.includes(msg)) prepChefMessages.push(msg);
        }

        const afterPlayer = ensurePlayer(serverId, userId);
        const afterAcceptedOrderIds = Object.keys(afterPlayer.orders?.accepted ?? {});
        const outcome = deriveAcceptOutcome({
          targetOrderId: fullOrderId,
          cap,
          beforeAcceptedOrderIds,
          afterAcceptedOrderIds
        });

        if (outcome.code === "accepted") acceptedCount += 1;
        else if (outcome.code === "duplicate") duplicateCount += 1;
        else if (outcome.code === "cap") capCount += 1;
        else invalidCount += 1;
      }

      let statusLine = `${getIcon("warning")} No orders were accepted.`;
      if (acceptedCount > 0 && duplicateCount === 0 && capCount === 0 && invalidCount === 0) {
        statusLine = `${getIcon("status_complete")} Accepted ${acceptedCount} ${acceptedCount === 1 ? "order" : "orders"}.`;
      } else {
        const summaryParts = [];
        if (acceptedCount > 0) summaryParts.push(`${getIcon("status_complete")} Accepted: **${acceptedCount}**`);
        if (duplicateCount > 0) summaryParts.push(`${getIcon("warning")} Already Accepted: **${duplicateCount}**`);
        if (capCount > 0) summaryParts.push(`${getIcon("warning")} Blocked By Cap: **${capCount}**`);
        if (invalidCount > 0) summaryParts.push(`${getIcon("warning")} Unavailable: **${invalidCount}**`);
        if (summaryParts.length > 0) {
          statusLine = summaryParts.join(" • ");
        }
      }
      const prepChefSummaryLines = summarizePrepChefMessages(prepChefMessages, { includeFailureMessages: true });
      if (prepChefSummaryLines.length > 0) {
        statusLine = `${statusLine}\n${prepChefSummaryLines.join("\n")}`;
      }

      const p = ensurePlayer(serverId, userId);
      const tutorialStepAfterAccept = resolveTutorialProgressRowKey(p);
      if (acceptedCount > 0 && tutorialStepAfterAccept && tutorialStepAfterAccept !== "accept_only") {
        return runNoodle(interaction, { sub: "orders" });
      }

      const s = ensureServer(serverId);
      const payload = buildAcceptPickerScenePayload({
        serverId,
        userId,
        p,
        s,
        selectedShortIds: [],
        statusLine,
        page: Number(state.page) || 0
      });
      return componentCommit(interaction, payload);
    }
  }

  if (v2Parsed.sceneKey === "orders.accept_result") {
    const state = sceneState?.value?.state ?? {};
    const action = v2Parsed.actionKey;
    const argShortId = String(v2Parsed.args?.[0] ?? "").trim();
    const selectedShortId = argShortId || String(state.selectedShortId ?? "").trim();
    const orderTokenByShortId = state.orderTokenByShortId ?? {};
    const fullOrderId = String(orderTokenByShortId?.[selectedShortId] ?? "").trim();

    if (action === "ord") {
      return runNoodle(interaction, { sub: "orders" });
    }

    if (action === "bk") {
      const s = ensureServer(serverId);
      const p = ensurePlayer(serverId, userId);
      const payload = buildAcceptPickerScenePayload({ serverId, userId, p, s });
      return componentCommit(interaction, payload);
    }

    if (action === "cnl") {
      return runNoodle(interaction, { sub: "orders" });
    }

    if (action === "ck") {
      const s = ensureServer(serverId);
      const p = ensurePlayer(serverId, userId);
      const payload = buildCookRecipePickerScenePayload({ userId, p, s, quantity: 1 });
      return componentCommit(interaction, payload);
    }

    if (action === "cfm") {
      if (!fullOrderId) {
        return componentCommit(interaction, {
          content: "That order is no longer available. Reopen `/noodle orders`.",
          ephemeral: true
        });
      }

      const p = ensurePlayer(serverId, userId);
      const beforeAcceptedOrderIds = Object.keys(p.orders?.accepted ?? {});
      const cap = getOrderAcceptCap(p, nowTs());

      const silentResult = await runNoodle(interaction, {
        sub: "accept",
        overrides: {
          silentResponse: true,
          strings: { order_id: fullOrderId }
        }
      });
      const prepChefMessages = extractPrepChefMessagesFromPayload(silentResult);
      const prepChefSummaryLines = summarizePrepChefMessages(prepChefMessages, { includeFailureMessages: true });

      const afterPlayer = ensurePlayer(serverId, userId);
      const afterAcceptedOrderIds = Object.keys(afterPlayer.orders?.accepted ?? {});
      const outcome = deriveAcceptOutcome({
        targetOrderId: fullOrderId,
        cap,
        beforeAcceptedOrderIds,
        afterAcceptedOrderIds
      });

      const resultState = putSceneState({
        sceneKey: "orders.accept_result",
        ownerId: userId,
        state: {
          entries: state.entries ?? [],
          orderTokenByShortId,
          selectedShortId
        }
      });

      const detailLine = outcome.code === "accepted"
        ? `${getIcon("status_complete")} Accepted \`${shortOrderId(fullOrderId)}\`.`
        : `${getIcon("warning")} ${outcome.message}`;
      const detailLineWithPrepChef = prepChefSummaryLines.length > 0
        ? `${detailLine}\n${prepChefSummaryLines.join("\n")}`
        : detailLine;

      const acceptLoop = completeV2LoopTracker({ serverId, userId, loop: "orders" });
      emitTelemetry("v2_loop_summary", {
        module: "orders",
        loop: "accept",
        outcomeCode: outcome.code,
        clickCount: acceptLoop.clicks,
        completionMs: acceptLoop.elapsedMs
      });

      return componentCommit(interaction, buildAcceptResultV2Message({
        userId,
        token: resultState.token,
        outcomeCode: outcome.code,
        detailLine: detailLineWithPrepChef
      }));
    }
  }

  if (v2Parsed.sceneKey === "orders.cancel_picker") {
    const state = sceneState?.value?.state ?? {};
    const action = v2Parsed.actionKey;
    const selectedShortId = String(v2Parsed.args?.[0] ?? "").trim();

    if (action === "bk" || action === "cnl") {
      return runNoodle(interaction, { sub: "orders" });
    }

    if (action === "sel") {
      const entries = Array.isArray(state.entries) ? state.entries : [];
      const selected = entries.find((entry) => String(entry?.shortId ?? "") === selectedShortId);
      if (!selected) {
        return componentCommit(interaction, {
          content: "That order is no longer selectable. Reopen `/noodle orders`.",
          ephemeral: true
        });
      }

      const currentSelected = Array.isArray(state.selectedShortIds)
        ? state.selectedShortIds.map((id) => String(id || "").trim()).filter(Boolean)
        : [];
      const selectedSet = new Set(currentSelected);
      if (selectedSet.has(selectedShortId)) selectedSet.delete(selectedShortId);
      else selectedSet.add(selectedShortId);

      const p = ensurePlayer(serverId, userId);
      const payload = buildCancelPickerScenePayload({
        userId,
        p,
        selectedShortIds: [...selectedSet]
      });
      return componentCommit(interaction, payload);
    }

    if (action === "cfm") {
      const entries = Array.isArray(state.entries) ? state.entries : [];
      const selectedShortIds = Array.isArray(state.selectedShortIds)
        ? state.selectedShortIds.map((id) => String(id || "").trim()).filter(Boolean)
        : [];
      if (selectedShortIds.length <= 0) {
        return componentCommit(interaction, {
          content: "Select one or more orders first.",
          ephemeral: true
        });
      }

      const validShortIds = new Set(entries.map((entry) => String(entry?.shortId || "").trim()).filter(Boolean));
      const orderTokenByShortId = state.orderTokenByShortId ?? {};
      const targets = selectedShortIds.filter((shortId) => validShortIds.has(shortId));
      if (targets.length <= 0) {
        return componentCommit(interaction, {
          content: "Those selections are no longer available. Reopen `/noodle orders`.",
          ephemeral: true
        });
      }

      let canceledCount = 0;
      let missingCount = 0;
      let invalidCount = 0;

      for (const shortId of targets) {
        const fullOrderId = String(orderTokenByShortId?.[shortId] ?? "").trim();
        if (!fullOrderId) {
          invalidCount += 1;
          continue;
        }

        const beforePlayer = ensurePlayer(serverId, userId);
        const beforeAcceptedOrderIds = Object.keys(beforePlayer.orders?.accepted ?? {});

        await runNoodle(interaction, {
          sub: "cancel",
          overrides: {
            silentResponse: true,
            strings: { order_id: fullOrderId }
          }
        });

        const afterPlayer = ensurePlayer(serverId, userId);
        const afterAcceptedOrderIds = Object.keys(afterPlayer.orders?.accepted ?? {});
        const outcome = deriveCancelOutcome({
          targetOrderId: fullOrderId,
          beforeAcceptedOrderIds,
          afterAcceptedOrderIds
        });

        if (outcome.code === "canceled") canceledCount += 1;
        else if (outcome.code === "missing") missingCount += 1;
        else invalidCount += 1;
      }

      const summaryParts = [];
      if (canceledCount > 0) summaryParts.push(`${getIcon("status_complete")} Canceled: **${canceledCount}**`);
      if (missingCount > 0) summaryParts.push(`${getIcon("warning")} Unavailable: **${missingCount}**`);
      if (invalidCount > 0) summaryParts.push(`${getIcon("warning")} Failed: **${invalidCount}**`);
      const statusLine = summaryParts.length > 0
        ? summaryParts.join(" • ")
        : `${getIcon("warning")} No orders were canceled.`;

      const p = ensurePlayer(serverId, userId);
      const payload = buildCancelPickerScenePayload({
        userId,
        p,
        selectedShortIds: [],
        statusLine
      });
      return componentCommit(interaction, payload);
    }
  }

  if (v2Parsed.sceneKey === "cook.recipe_picker") {
    const state = sceneState?.value?.state ?? {};
    const action = v2Parsed.actionKey;
    const entries = Array.isArray(state.entries) ? state.entries : [];
    const selectedRecipeId = String(state.selectedRecipeId || "").trim() || String(entries?.[0]?.recipeId || "").trim();
    const quantity = Math.max(1, Math.min(99, Math.floor(Number(state.quantity) || 1)));
    const page = Math.max(0, Math.floor(Number(state.page) || 0));
    const totalPages = Math.max(1, Math.floor(Number(state.totalPages) || 1));

    if (action === "bk") {
      return runNoodle(interaction, { sub: "orders" });
    }

    if (action === "sel") {
      const nextRecipeId = String(interaction.values?.[0] ?? v2Parsed.args?.[0] ?? "").trim();
      if (!entries.some((entry) => String(entry?.recipeId || "") === nextRecipeId)) {
        return componentCommit(interaction, {
          content: "That recipe is no longer available. Reopen `/noodle orders`.",
          ephemeral: true
        });
      }

      const payload = buildCookRecipePickerScenePayload({
        userId,
        p: ensurePlayer(serverId, userId),
        s: ensureServer(serverId),
        selectedRecipeId: nextRecipeId,
        quantity,
        page
      });
      return componentCommit(interaction, payload);
    }

    if (action === "pg") {
      const arg = String(v2Parsed.args?.[0] ?? "").trim().toLowerCase();
      const nextPage = arg === "prev"
        ? (page <= 0 ? totalPages - 1 : page - 1)
        : (page >= totalPages - 1 ? 0 : page + 1);
      const payload = buildCookRecipePickerScenePayload({
        userId,
        p: ensurePlayer(serverId, userId),
        s: ensureServer(serverId),
        selectedRecipeId,
        quantity,
        page: nextPage
      });
      return componentCommit(interaction, payload);
    }

    if (action === "qty") {
      const arg = String(v2Parsed.args?.[0] ?? "").trim();
      const deltas = { m5: -5, m1: -1, p1: 1, p5: 5 };
      const delta = deltas[arg] ?? 0;
      const nextQuantity = Math.max(1, Math.min(99, quantity + delta));
      const payload = buildCookRecipePickerScenePayload({
        userId,
        p: ensurePlayer(serverId, userId),
        s: ensureServer(serverId),
        selectedRecipeId,
        quantity: nextQuantity,
        page
      });
      return componentCommit(interaction, payload);
    }

    if (action === "cfa") {
      const p = ensurePlayer(serverId, userId);
      const cookAllState = buildCookAllPlanForAcceptedOrders(p);
      if (!cookAllState.canCookAll) {
          const message = cookAllState.totalQuantity <= 0
          ? `${getIcon("warning")} Cook All is unavailable: all accepted orders already have ready bowls.`
          : (cookAllState.shortages.length > 0
            ? `${getIcon("warning")} Cook All needs more ingredients first.`
            : `${getIcon("warning")} Cook All needs **${cookAllState.totalQuantity}** bowl slots but only **${cookAllState.remainingBowls}** are available.`);
          return componentCommit(interaction, {
            content: message,
            ephemeral: true
          });
      }

      const totalQuantity = Math.max(1, Math.min(99, cookAllState.totalQuantity));
      const totalTurns = deriveCookMinigameTotalTurns(totalQuantity);
      const payload = buildCookMinigameScenePayload({
        userId,
        recipeId: String(cookAllState.plan?.[0]?.recipeId || selectedRecipeId || "").trim(),
        recipeNameOverride: "All Accepted Orders",
        quantity: totalQuantity,
        totalTurns,
        turnIndex: 0,
        score: 0,
        misses: 0,
        cookAllPlan: cookAllState.plan
      });
      return componentCommit(interaction, payload);
    }

    if (action === "go") {
      if (!selectedRecipeId) {
        return componentCommit(interaction, {
          content: "Select a recipe first.",
          ephemeral: true
        });
      }

      const selectedEntry = entries.find((entry) => String(entry?.recipeId || "") === selectedRecipeId);
      const selectedCookable = Math.max(0, Math.floor(Number(selectedEntry?.cookable) || 0));
      const p = ensurePlayer(serverId, userId);
      const combinedEffects = calculateCombinedEffects(p, upgradesContent, staffContent, calculateStaffEffects);
      const bowlCap = getBowlCapacity(p, combinedEffects);
      const bowlCount = getBowlCount(p);
      const remainingBowls = Math.max(0, bowlCap - bowlCount);
      if (remainingBowls <= 0) {
        return componentCommit(interaction, {
          content: `${getIcon("basket")} Your cooked bowls storage is full. Serve bowls or upgrade storage to make room.`,
          ephemeral: true
        });
      }
      if (selectedCookable <= 0) {
        return componentCommit(interaction, {
          content: `${getIcon("warning")} You don't have enough ingredients to cook this recipe yet.`,
          ephemeral: true
        });
      }

      const effectiveQuantity = Math.max(1, Math.min(quantity, selectedCookable, remainingBowls));
      const payload = buildCookMinigameScenePayload({
        userId,
        recipeId: selectedRecipeId,
        quantity: effectiveQuantity,
        totalTurns: deriveCookMinigameTotalTurns(effectiveQuantity),
        turnIndex: 0,
        score: 0,
        misses: 0
      });
      return componentCommit(interaction, payload);
    }
  }

  if (v2Parsed.sceneKey === "cook.minigame") {
    const state = sceneState?.value?.state ?? {};
    const action = String(v2Parsed.actionKey || "").trim();
    const recipeId = String(state.recipeId || "").trim();
    const quantity = Math.max(1, Math.min(99, Math.floor(Number(state.quantity) || 1)));
    const totalTurns = Math.max(1, Math.min(20, Math.floor(Number(state.totalTurns) || 8)));
    const turnIndex = Math.max(0, Math.min(totalTurns - 1, Math.floor(Number(state.turnIndex) || 0)));
    const score = Math.max(0, Math.min(totalTurns, Math.floor(Number(state.score) || 0)));
    const misses = Math.max(0, Math.floor(Number(state.misses) || 0));
    const runToken = String(state.runToken || "").trim();
    const turnMs = Math.max(250, Math.floor(Number(state.turnMs) || 10000));
    const graceMs = Math.max(0, Math.floor(Number(state.graceMs) || 0));
    const turnStartedAt = Math.max(0, Math.floor(Number(state.turnStartedAt) || Date.now()));
    const counterCookFlow = Boolean(state.counterCook === true);
    const returnSub = String(state.returnSub || "orders").trim() || "orders";
    const tutorialMode = Boolean(state.tutorialMode === true);
    const coachingLine = String(state.coachingLine || "").trim();
      const recipeNameOverride = String(state.recipeNameOverride || "").trim();
      const cookAllPlan = Array.isArray(state.cookAllPlan)
        ? state.cookAllPlan
          .map((row) => ({
            recipeId: String(row?.recipeId || "").trim(),
            quantity: Math.max(0, Math.floor(Number(row?.quantity) || 0))
          }))
          .filter((row) => row.recipeId && row.quantity > 0)
        : [];
      const cookAllMode = cookAllPlan.length > 0;
    const targetActions = Array.isArray(state.targetActions)
      ? state.targetActions.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean)
      : [];

    if (!recipeId) {
      return componentCommit(interaction, {
        content: "This cook run is missing recipe context. Reopen `/noodle orders`.",
        ephemeral: true
      });
    }

    if (action === "bk") {
      if (counterCookFlow) {
        return runNoodle(interaction, { sub: "takeout_cook" });
      }
      const payload = buildCookRecipePickerScenePayload({
        userId,
        p: ensurePlayer(serverId, userId),
        s: ensureServer(serverId),
        selectedRecipeId: recipeId,
        quantity
      });
      return componentCommit(interaction, payload);
    }

    if (action === "prep" || action === "heat" || action === "plate" || action === "serve") {
      const target = String(targetActions[turnIndex] || "prep").trim().toLowerCase();
      const turnResult = evaluateCookMinigameTurn({
        action,
        targetAction: target,
        turnStartedAt,
        turnMs,
        graceMs,
        nowMs: Date.now()
      });
      const nextTurnIndex = turnIndex + 1;
      const nextScore = score + turnResult.scoreDelta;
      const nextMisses = misses + turnResult.missDelta;

      if (nextTurnIndex < totalTurns) {
        const payload = buildCookMinigameScenePayload({
          userId,
          recipeId,
          quantity,
          totalTurns,
          turnIndex: nextTurnIndex,
          score: nextScore,
          misses: nextMisses,
          targetActions,
          runToken,
          turnMs,
          graceMs,
          turnStartedAt: Date.now(),
          lastTurnStatus: turnResult.status,
          counterCook: counterCookFlow,
          returnSub,
          tutorialMode,
            coachingLine,
            recipeNameOverride,
            cookAllPlan
        });
        return componentCommit(interaction, payload);
      }

      const performance = deriveCookMinigamePerformance({
        score: nextScore,
        totalTurns,
        quantity
      });

        const beforePlayer = ensurePlayer(serverId, userId);
        const beforeTotalBowlCount = getBowlCount(beforePlayer);

        if (cookAllMode) {
          const successByRecipe = allocateSuccessBowlsAcrossPlan(cookAllPlan, performance.successBowls);
          for (const row of cookAllPlan) {
            const rowQty = Math.max(1, Math.floor(Number(row.quantity) || 1));
            const rowSuccess = Math.max(0, Math.min(rowQty, Math.floor(Number(successByRecipe[row.recipeId]) || 0)));
            await runNoodle(interaction, {
              sub: "cook",
              overrides: {
                silentResponse: true,
                strings: {
                  recipe: row.recipeId,
                  v2_quality_bias: performance.qualityBias
                },
                integers: {
                  quantity: rowQty,
                  v2_score: performance.score,
                  v2_turns: performance.totalTurns,
                  v2_success_bowls: rowSuccess
                },
                booleans: {
                  v2_minigame: true,
                  counter_cook: counterCookFlow
                },
                messageId: interaction.message?.id ?? null
              }
            });
          }
        } else {
          await runNoodle(interaction, {
            sub: "cook",
            overrides: {
              silentResponse: true,
              strings: {
                recipe: recipeId,
                v2_quality_bias: performance.qualityBias
              },
              integers: {
                quantity,
                v2_score: performance.score,
                v2_turns: performance.totalTurns,
                v2_success_bowls: performance.successBowls
              },
              booleans: {
                v2_minigame: true,
                counter_cook: counterCookFlow
              },
              messageId: interaction.message?.id ?? null
            }
          });
        }

        const afterPlayer = ensurePlayer(serverId, userId);
        const produced = Math.max(0, getBowlCount(afterPlayer) - beforeTotalBowlCount);

      const resultState = putSceneState({
        sceneKey: "cook.result",
        ownerId: userId,
        state: {
          recipeId,
          quantity,
          score: performance.score,
          totalTurns: performance.totalTurns,
          successBowls: performance.successBowls,
          failBowls: performance.failBowls,
          qualityBias: performance.qualityBias,
          runToken,
          turnMs,
          graceMs,
          counterCook: counterCookFlow,
          returnSub,
          tutorialMode,
          coachingLine
        }
      });

      const summaryLines = [
          cookAllMode
            ? `${getIcon("cook")} Your accepted orders have been cooked!`
            : `${getIcon("cook")} "${displayRecipeName(recipeId)}" has been cooked.`,
        `Kitchen Line score: **${performance.score}/${performance.totalTurns}** (${performance.accuracyLabel}).`,
        produced > 0
          ? `${getIcon("status_complete")} Cooked **${produced}** bowl(s).`
          : `${getIcon("warning")} Cooked **0** bowl(s). Check ingredients/capacity and try again.`
      ];
      const tutorialStepAfterCook = tutorialMode ? getCurrentTutorialStep(afterPlayer) : null;
      if (tutorialMode && tutorialStepAfterCook) {
        summaryLines.push(`**Tutorial — ${tutorialStepAfterCook.title}**`);
        summaryLines.push(String(tutorialStepAfterCook.text || "").trim() || "Continue to the next tutorial step.");
      }

      const cookLoop = completeV2LoopTracker({ serverId, userId, loop: "cook" });
      emitTelemetry("v2_minigame_outcome", {
        module: "cook",
        outcome: performance.accuracyLabel,
        score: performance.score,
        totalTurns: performance.totalTurns,
        qualityBias: performance.qualityBias,
        successBowls: performance.successBowls,
        failBowls: performance.failBowls
      });
      emitTelemetry("v2_loop_summary", {
        module: "cook",
        loop: "cook_minigame",
        outcomeCode: performance.accuracyLabel,
        clickCount: cookLoop.clicks,
        completionMs: cookLoop.elapsedMs
      });

      return componentCommit(interaction, buildCookResultV2Message({
        userId,
        token: resultState.token,
          title: "## Cook Result",
        summaryLines,
        tutorialNextOnly: tutorialMode,
          tutorialNextLabel: "Next Tutorial Step",
          preferServe: canServeAllOrders(afterPlayer)
      }));
    }
  }

  if (v2Parsed.sceneKey === "cook.result") {
    const state = sceneState?.value?.state ?? {};
    const action = String(v2Parsed.actionKey || "").trim();
    const recipeId = String(state.recipeId || "").trim();
    const quantity = Math.max(1, Math.min(99, Math.floor(Number(state.quantity) || 1)));
    const counterCookFlow = Boolean(state.counterCook === true);
    const returnSub = String(state.returnSub || "orders").trim() || "orders";
    const tutorialMode = Boolean(state.tutorialMode === true);

    if (action === "nxt") {
      if (counterCookFlow || !tutorialMode) {
        return runNoodle(interaction, { sub: "orders" });
      }
      const p = ensurePlayer(serverId, userId);
      const nextSub = resolveTutorialRecoverySub({ player: p, fallbackSub: "orders" });
      return runNoodle(interaction, { sub: nextSub });
    }

    if (action === "ord") {
      if (counterCookFlow) {
        return runNoodle(interaction, { sub: returnSub === "orders" ? "orders" : "takeout" });
      }
      return runNoodle(interaction, { sub: "orders" });
    }

    if (action === "cook") {
      if (counterCookFlow) {
        return runNoodle(interaction, { sub: "takeout_cook" });
      }
      const payload = buildCookRecipePickerScenePayload({
        userId,
        p: ensurePlayer(serverId, userId),
        s: ensureServer(serverId),
        selectedRecipeId: recipeId,
        quantity
      });
      return componentCommit(interaction, payload);
    }

    if (action === "serve") {
      const p = ensurePlayer(serverId, userId);
      const payload = buildServePickerScenePayload({ userId, p });
      return componentCommit(interaction, payload);
    }
  }

  if (v2Parsed.sceneKey === "serve.order_picker") {
    const state = sceneState?.value?.state ?? {};
    const action = String(v2Parsed.actionKey || "").trim();
    const entries = Array.isArray(state.entries) ? state.entries : [];
    const selectedShortIds = Array.isArray(state.selectedShortIds)
      ? state.selectedShortIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    const stateReadyOnly = Boolean(state.readyOnly);

    if (action === "bk") {
      return runNoodle(interaction, { sub: "orders" });
    }

    if (action === "sel") {
      const nextShortId = String(v2Parsed.args?.[0] ?? "").trim();
      if (!entries.some((entry) => String(entry?.shortId || "") === nextShortId)) {
        return componentCommit(interaction, {
          content: "That order is no longer selectable. Reopen `/noodle orders`.",
          ephemeral: true
        });
      }
      const selectedSet = new Set(selectedShortIds);
      if (selectedSet.has(nextShortId)) selectedSet.delete(nextShortId);
      else selectedSet.add(nextShortId);

      const p = ensurePlayer(serverId, userId);
      const payload = buildServePickerScenePayload({
        userId,
        p,
        selectedShortIds: [...selectedSet],
        readyOnly: stateReadyOnly
      });
      return componentCommit(interaction, payload);
    }

    if (action === "cfm") {
      if (selectedShortIds.length <= 0) {
        return componentCommit(interaction, {
          content: "Select one or more orders first.",
          ephemeral: true
        });
      }

      const validShortIds = new Set(entries.map((entry) => String(entry?.shortId || "").trim()).filter(Boolean));
      const targets = selectedShortIds.filter((shortId) => validShortIds.has(shortId));
      if (targets.length <= 0) {
        return componentCommit(interaction, {
          content: "Those selections are no longer available. Reopen `/noodle orders`.",
          ephemeral: true
        });
      }

      // Use the same serve execution path as Serve All so results stay identical.
      const orderTokens = targets.join(",");
      return runNoodle(interaction, {
        sub: "serve",
        overrides: {
          strings: { order_id: orderTokens },
          messageId: interaction.message?.id ?? null
        }
      });
    }

    if (action === "sfa") {
      const p = ensurePlayer(serverId, userId);
      if (!canServeAllOrders(p)) {
        const neededByRecipe = {};
        Object.values(p.orders?.accepted ?? {}).forEach((entry) => {
          const recipeId = String(entry?.order?.recipe_id || "").trim();
          if (!recipeId) return;
          neededByRecipe[recipeId] = (neededByRecipe[recipeId] ?? 0) + 1;
        });
        const missingLines = Object.entries(neededByRecipe)
          .map(([recipeId, need]) => {
            const ready = getTotalBowlsForRecipe(p, recipeId);
            if (ready >= need) return null;
            const recipeName = displayRecipeName(recipeId);
            const short = Math.max(0, need - ready);
            return `${recipeName}: need **${need}**, ready **${ready}** (cook **${short}** more)`;
          })
          .filter(Boolean);

        const statusLine = missingLines.length > 0
          ? `${getIcon("warning")} Serve All unavailable. ${missingLines.join(" • ")}`
          : `${getIcon("warning")} Serve All unavailable until all accepted orders are ready.`;
        const payload = buildServePickerScenePayload({
          userId,
          p,
          selectedShortIds,
          readyOnly: stateReadyOnly,
          statusLine
        });
        return componentCommit(interaction, payload);
      }

      const orderTokens = Object.keys(p.orders?.accepted ?? {})
        .map((orderId) => shortOrderId(orderId))
        .filter(Boolean)
        .join(",");

        return runNoodle(interaction, {
        sub: "serve",
        overrides: {
          strings: { order_id: orderTokens },
          messageId: interaction.message?.id ?? null
        }
      });
    }

  }

  if (v2Parsed.sceneKey === "serve.result") {
    const state = sceneState?.value?.state ?? {};
    const action = String(v2Parsed.actionKey || "").trim();
    const recipeId = String(state.recipeId || "").trim();

    if (action === "ord") {
      return runNoodle(interaction, { sub: "orders" });
    }

    if (action === "again") {
      const p = ensurePlayer(serverId, userId);
      const payload = buildServePickerScenePayload({
        userId,
        p,
        readyOnly: Boolean(state.readyOnly)
      });
      return componentCommit(interaction, payload);
    }

    if (action === "cook") {
      const p = ensurePlayer(serverId, userId);
      const s = ensureServer(serverId);
      const payload = buildCookRecipePickerScenePayload({
        userId,
        p,
        s,
        selectedRecipeId: recipeId || null,
        quantity: 1
      });
      return componentCommit(interaction, payload);
    }
  }

  return componentCommit(interaction, {
    content: "This V2 scene is recognized but not wired yet.",
    ephemeral: true
  });
}
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
    ...composeV2FromLegacyEmbeds([embed]),
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

  const legacyPayload = {
    content: " ",
    ...composeV2FromLegacyEmbeds([reminderEmbed]),
    components
  };

  if (isComponentsV2Enabled({ guildId: targetServerId, userId, player: p })) {
    return componentCommit(interaction, convertLegacyEmbedPayloadToComponentsV2(legacyPayload));
  }

  return componentCommit(interaction, legacyPayload);
}

const componentPlayer = ensurePlayer(serverId, userId);
const componentTouched = trackLastKitchen(componentPlayer, serverId, interaction.channelId);
if (componentTouched && db) {
  upsertPlayer(db, serverId, userId, componentPlayer, null, componentPlayer.schema_version);
}

// lock UI to owner when ownerId is present
if (ownerId && ownerId !== userId && (kind === "nav" || kind === "action" || kind === "pick" || kind === "multibuy" || kind === "profile" || kind === "decor")) {
return componentCommit(interaction, { content: "That menu isn’t for you.", ephemeral: true });
}

if (interaction.isSelectMenu?.() && kind === "garden" && action === "plant_select") {
  if (ownerId && ownerId !== userId) {
    return componentCommit(interaction, { content: "That garden isn’t yours.", ephemeral: true });
  }
  const seedId = interaction.values?.[0];
  if (!seedId || seedId === "no_seed") {
    return componentCommit(interaction, { content: `${getIcon("seeds")} Pick a seed to plant.`, ephemeral: true });
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

  if (isComponentsV2Enabled({ guildId: serverId, userId, player: p })) {
    return componentCommit(interaction, {
      ...buildSpecializationPickerV2Message({
        userId,
        options,
        specializationsAvailable,
        ownerId: userId,
        buttonEmoji: getProfileV2ButtonEmoji()
      }),
      targetMessageId: interaction.message?.id
    });
  }

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
    ...composeV2FromLegacyEmbeds([embed]),
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
  if (isComponentsV2Enabled({ guildId: serverId, userId, player: p })) {
    const { entries, page, totalPages } = buildSpecializationListData(p, nowTs(), 0, 5);
    return componentCommit(interaction, {
      ...buildSpecializationListV2Message({
        userId,
        entries,
        page,
        totalPages,
        specializationsAvailable,
        ownerId: userId,
        buttonEmoji: getProfileV2ButtonEmoji()
      }),
      targetMessageId: interaction.message?.id
    });
  }
  const { embed, page, totalPages } = buildSpecializationListEmbed(p, interaction.member ?? interaction.user, nowTs(), 0, 5);
  const components = [];
  if (totalPages > 1) {
    const prevPage = page <= 0 ? totalPages - 1 : page - 1;
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:nav:specialize:${userId}:${prevPage}`)
        .setLabel("Prev")
        .setEmoji(getButtonEmoji("back"))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false),
      new ButtonBuilder()
          .setCustomId(`noodle:nav:specialize:${userId}:${page >= totalPages - 1 ? 0 : page + 1}`)
        .setLabel("Next")
        .setEmoji(getButtonEmoji("next"))
        .setStyle(ButtonStyle.Secondary)
          .setDisabled(false)
    ));
  }
  components.push(
    noodleSpecializeSelectRow(userId),
    noodleProfileEditRow(userId, { specializationsAvailable }),
    noodleProfileEditBackRow(userId)
  );
  return componentCommit(interaction, {
    content: " ",
    ...composeV2FromLegacyEmbeds([embed]),
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

  if (isComponentsV2Enabled({ guildId: serverId, userId, player: p })) {
    return componentCommit(interaction, {
      ...buildSpecializationUpdatedV2Message({
        userId,
        specName: result.specialization?.name ?? specId,
        specThumbnailUrl: getSpecializationThumbnailUrl(result.specialization ?? spec),
        specializationsAvailable,
        ownerId: userId,
        buttonEmoji: getProfileV2ButtonEmoji()
      }),
      targetMessageId: interaction.message?.id
    });
  }

  const embed = buildMenuEmbed({
    title: `${getIcon("sparkle")} Specialization Updated`,
    description: `Active specialization: **${result.specialization?.name ?? specId}**.`,
    user: interaction.member ?? interaction.user
  });

  return componentCommit(interaction, {
    content: " ",
    ...composeV2FromLegacyEmbeds([embed]),
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
    .sort((a, b) => displayItemName(a.id).localeCompare(displayItemName(b.id), undefined, { sensitivity: "base" }))
    .map((entry) => ({
      label: `${displayItemName(entry.id)} (${entry.qty})`.slice(0, 100),
      value: `${entry.source}:${entry.id}`,
      description: `${entry.qty} unit(s) available`.slice(0, 100)
    }));

  options.push(...freshOptions);

  options.sort((a, b) => String(a.label || "").localeCompare(String(b.label || ""), undefined, { sensitivity: "base" }));

  if (options.length > 25) {
    options.length = 25;
  }

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
  const compostCount = garden.compost_bags || 0;
  const compostDescription = [
    `Compost: **${compostCount}** bags`,
    `Spoiled saved: **${gardenState.spoiledTotal}**`,
    `Fresh forageables: **${gardenState.pantryTotal}**`,
    `*Recipe: ${COMPOST_PER_BAG} spoiled or fresh forageables = 1 bag*`
  ].join("\n");

  const compostEmbed = buildMenuEmbed({
    title: `${getIcon("compost_bag")} Compost`,
    description: compostDescription,
    user: interaction.member ?? interaction.user,
    color: theme.colors.success
  });

  const { options } = buildCompostSelectOptions(p);

  if (!options.length) {
    return componentCommit(interaction, { content: `${getIcon("warning")} No compostable items available.`, ephemeral: true });
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
    ...composeV2FromLegacyEmbeds([compostEmbed]),
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
    return componentCommit(interaction, { content: `${getIcon("compost_bag")} No compostable items available.`, ephemeral: true });
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
      const name = src === "spoiled" ? "ingredients" : displayItemName(id);
      return `${src === "spoiled" ? "Spoiled" : "Fresh"} — ${name}`;
    })
    .filter(Boolean)
    .join("\n");
  const header = selectionList
    ? `Selected sources:\n${selectionList}\n\nAdd 5/10 buttons pull that many units from each selected source.`
    : `No items selected. Add 5/10 buttons pull that many units from each selected source.`;
  const compostCount = gardenState.compostCount;
  const compostDescription = [
    `Compost: **${compostCount}** bags`,
    header
  ].join("\n\n");

  const compostEmbed = buildMenuEmbed({
    title: `${getIcon("compost_bag")} Compost`,
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
    ...composeV2FromLegacyEmbeds([compostEmbed]),
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

  let spoiledUsed = {};
  let freshUsed = {};
  let totalUnitsUsed = 0;

  for (const { source, itemId } of parsedSelections) {
    if (source === "spoiled") {
      const spoiledEntries = Object.entries(garden.spoiled || {}).filter(([, qty]) => qty > 0);
      const availableUnits = spoiledEntries.reduce((sum, [, qty]) => sum + qty, 0);
      const unitsToUse = Math.min(amountRequested, availableUnits);
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

    const unitsToUse = Math.min(amountRequested, availableUnits);
    if (unitsToUse <= 0) continue;

    pool[itemId] = Math.max(0, availableUnits - unitsToUse);
    if (pool[itemId] <= 0) delete pool[itemId];

    freshUsed[itemId] = (freshUsed[itemId] || 0) + unitsToUse;
    totalUnitsUsed += unitsToUse;
  }

  const bagsMade = Math.floor(totalUnitsUsed / COMPOST_PER_BAG);
  if (bagsMade <= 0) {
    compostSelectionCache.delete(messageId);
    return componentCommit(interaction, { content: `${getIcon("warning")} Not enough of the selected items to craft any compost bags.`, ephemeral: true });
  }

  const requestedUnits = amountRequested * parsedSelections.length;
  const partialNote = totalUnitsUsed < requestedUnits
    ? `${getIcon("help")} Not enough of the selected items for the full amount.`
    : null;

  garden.compost_bags = (garden.compost_bags || 0) + bagsMade;
  if (bagsMade > 0) {
    applyQuestProgress(p, questsContent, userId, { type: "garden_compost", amount: bagsMade }, nowTs());
  }
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
    `${getIcon("compost_bag")} Packed **${bagsMade}** compost bag(s).`,
    `Compost now: **${garden.compost_bags}**.`,
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
    title: `${getIcon("compost_bag")} Compost`,
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
    ...composeV2FromLegacyEmbeds([compostEmbed]),
    components,
    targetMessageId: interaction.message?.id
  });
}

if (kind === "nav") {
const navStartMs = performance.now();
const sub = action;
const customIdPrefix = getCustomIdPrefix(id);
let resolvedSub = sub;
let runMs = 0;
let resolveMs = 0;
let telemetryError = null;

try {
  const resolveStartMs = performance.now();
  const p = ensurePlayer(serverId, userId);
  resolvedSub = resolveComponentNavSub({ player: p, sub });
  resolveMs = performance.now() - resolveStartMs;

  const sourceMessageId = interaction.message?.id;
  const page = parts[4] ? Number(parts[4]) : null;
  const sourceMessageFlags = Number(interaction.message?.flags?.bitfield ?? interaction.message?.flags ?? 0);
  const sourceMessageIsV2 = (sourceMessageFlags & MESSAGE_FLAG_IS_COMPONENTS_V2) !== 0;
  const runStartMs = performance.now();

  if (resolvedSub === "accept" && sourceMessageIsV2) {
    const s = ensureServer(serverId);
    const payload = buildAcceptPickerScenePayload({
      serverId,
      userId,
      p,
      s,
      page: page !== null && Number.isFinite(page) ? Math.max(0, page) : 0
    });
    const result = await componentCommit(interaction, payload);
    runMs = performance.now() - runStartMs;
    return result;
  }

  const result = await runNoodle(interaction, {
    sub: resolvedSub,
    group: null,
    overrides: {
      messageId: sourceMessageId,
      navSource: sub,
      integers: page !== null && Number.isFinite(page) ? { page } : undefined
    }
  });
  runMs = performance.now() - runStartMs;
  return result;
} catch (error) {
  telemetryError = error?.code ?? error?.name ?? "nav_dispatch_error";
  throw error;
} finally {
  emitTelemetry("component_nav_phase", {
    route: "component:noodle",
    subroute: `nav:${sub || "unknown"}`,
    resolvedSubroute: `sub:${resolvedSub || "unknown"}`,
    customIdPrefix,
    resolveMs,
    runMs,
    totalMs: performance.now() - navStartMs,
    error: telemetryError
  });
}
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
if (action === "forage_random") {
  const rawPage = Number(parts[4] ?? 0);
  const page = Number.isFinite(rawPage) ? Math.max(0, rawPage) : 0;
  return runNoodle(interaction, {
    sub: "forage",
    overrides: {
      messageId: interaction.message?.id ?? null,
      navSource: "forage_random",
      integers: { page }
    }
  });
}

if (action === "forage_page") {
  const rawPage = Number(parts[4] ?? 0);
  const page = Number.isFinite(rawPage) ? Math.max(0, rawPage) : 0;
  return runNoodle(interaction, {
    sub: "forage_menu",
    overrides: { messageId: interaction.message?.id ?? null, integers: { page } }
  });
}

if (action === "fishing_random") {
  const rawPage = Number(parts[4] ?? 0);
  const page = Number.isFinite(rawPage) ? Math.max(0, rawPage) : 0;
  return runNoodle(interaction, {
    sub: "fishing",
    overrides: {
      messageId: interaction.message?.id ?? null,
      navSource: "fishing_random",
      integers: { page }
    }
  });
}

if (action === "fishing_page") {
  const rawPage = Number(parts[4] ?? 0);
  const page = Number.isFinite(rawPage) ? Math.max(0, rawPage) : 0;
  return runNoodle(interaction, {
    sub: "fishing_menu",
    overrides: { messageId: interaction.message?.id ?? null, integers: { page } }
  });
}

if (action === "forage_qty") {
  const itemId = String(parts[4] ?? "").trim();
  const rawQty = Number(parts[5] ?? 1);
  const qty = Number.isFinite(rawQty) ? Math.max(1, Math.min(5, Math.floor(rawQty))) : 1;
  const rawPage = Number(parts[6] ?? 0);
  const page = Number.isFinite(rawPage) ? Math.max(0, rawPage) : 0;
  if (!itemId || !getAllowedForageIdsForPlayer(ensurePlayer(serverId, userId)).includes(itemId)) {
    return componentCommit(interaction, { content: "Pick a valid ingredient first.", ephemeral: true });
  }
  return runNoodle(interaction, {
    sub: "forage",
    overrides: {
      messageId: interaction.message?.id ?? null,
      strings: { item: itemId },
      integers: { quantity: qty, page }
    }
  });
}

if (action === "fishing_qty") {
  const itemId = String(parts[4] ?? "").trim();
  const rawQty = Number(parts[5] ?? 1);
  const qty = Number.isFinite(rawQty) ? Math.max(1, Math.min(5, Math.floor(rawQty))) : 1;
  const rawPage = Number(parts[6] ?? 0);
  const page = Number.isFinite(rawPage) ? Math.max(0, rawPage) : 0;
  if (!itemId || !getAllowedFishingIdsForPlayer(ensurePlayer(serverId, userId)).includes(itemId)) {
    return componentCommit(interaction, { content: "Pick a valid fishing target first.", ephemeral: true });
  }
  return runNoodle(interaction, {
    sub: "fishing",
    overrides: {
      messageId: interaction.message?.id ?? null,
      strings: { item: itemId },
      integers: { quantity: qty, page }
    }
  });
}

if (action === "accept") {
  const s = ensureServer(serverId);
  const p = ensurePlayer(serverId, userId);
  const rawPage = Number(parts[4] ?? 0);
  const sourceMessageFlags = Number(interaction.message?.flags?.bitfield ?? interaction.message?.flags ?? 0);
  const sourceMessageIsV2 = (sourceMessageFlags & MESSAGE_FLAG_IS_COMPONENTS_V2) !== 0;

  if (sourceMessageIsV2) {
    const payload = buildAcceptPickerScenePayload({
      serverId,
      userId,
      p,
      s,
      page: Number.isFinite(rawPage) ? Math.max(0, rawPage) : 0
    });
    return componentCommit(interaction, payload);
  }

  if (!parts[4]) {
    clearAcceptOrderDraftSelection({ serverId, userId });
  }
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

if (action === "accept_commit") {
  const selectedOrderIds = readAcceptOrderDraftSelection({ serverId, userId });
  if (!selectedOrderIds.length) {
    return componentCommit(interaction, { content: "Select at least one order first.", ephemeral: true });
  }

  clearAcceptOrderDraftSelection({ serverId, userId });
  return runNoodle(interaction, {
    sub: "accept",
    overrides: {
      strings: { order_id: selectedOrderIds.join(",") },
      messageId: interaction.message?.id ?? null
    }
  });
}

if (action === "accept_clear") {
  clearAcceptOrderDraftSelection({ serverId, userId });
  const s = ensureServer(serverId);
  const p = ensurePlayer(serverId, userId);
  const rawPage = Number(parts[4] ?? 0);
  const payload = buildAcceptPickerPayload({
    userId,
    serverId,
    p,
    s,
    ownerUser: interaction.member ?? interaction.user,
    page: Number.isFinite(rawPage) ? rawPage : 0
  });
  return componentCommit(interaction, payload);
}

if (action === "cancel_commit") {
  const selectedOrderIds = readCancelOrderDraftSelection({ serverId, userId });
  if (!selectedOrderIds.length) {
    return componentCommit(interaction, { content: "Select at least one order first.", ephemeral: true });
  }

  clearCancelOrderDraftSelection({ serverId, userId });
  return runNoodle(interaction, {
    sub: "cancel",
    overrides: {
      strings: { order_id: selectedOrderIds.join(",") },
      messageId: interaction.message?.id ?? null
    }
  });
}

if (action === "cancel_clear") {
  clearCancelOrderDraftSelection({ serverId, userId });
  const p = ensurePlayer(serverId, userId);
  const rawPage = Number(parts[4] ?? 0);
  const payload = buildCancelServePickerPayload({
    action: "cancel",
    userId,
    serverId,
    p,
    ownerUser: interaction.member ?? interaction.user,
    page: Number.isFinite(rawPage) ? rawPage : 0
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
        const rName = displayRecipeName(recipeId);
        const short = need - ready;
        return `• ${rName} — need **${need}**, ready **${ready}** (cook **${short}** more)`;
      })
      .filter(Boolean);

    const payload = buildCancelServePickerPayload({
      action: "serve",
      userId,
      serverId,
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
  const rawPage = Number(parts[4] ?? 0);
  if (action === "cancel" && !parts[4]) {
    clearCancelOrderDraftSelection({ serverId, userId });
  }
  const payload = buildCancelServePickerPayload({
    action,
    userId,
    serverId,
    p,
    ownerUser: interaction.member ?? interaction.user,
    page: Number.isFinite(rawPage) ? rawPage : 0
  });

  return componentCommit(interaction, payload);
}

if (action === "cook") {
  const p = ensurePlayer(serverId, userId);
  if (isTutorialStepFromRouting(p, "intro_cook")) {
    const tutorialRecipeId = resolveTutorialCookRecipeId(p);
    if (tutorialRecipeId) {
      const tutorialPayload = buildCookMinigameScenePayload({
        userId,
        recipeId: tutorialRecipeId,
        quantity: 1,
        totalTurns: 6,
        turnIndex: 0,
        score: 0,
        misses: 0,
        turnMs: 18000,
        graceMs: 3000,
        tutorialMode: true,
        coachingLine: "Tutorial mode: generous timing is enabled for this step. Future kitchen turns use a **10s** order window."
      });
      return componentCommit(interaction, tutorialPayload);
    }
  }

  // select a recipe from known_recipes, then modal for qty
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

if (action === "takeout_cook") {
  const rawPage = Number(parts[4] ?? 0);
  const page = Number.isFinite(rawPage) ? Math.max(0, rawPage) : 0;
  return runNoodle(interaction, {
    sub: "takeout_cook",
    overrides: {
      messageId: interaction.message?.id ?? null,
      integers: { page }
    }
  });
}

if (action === "takeout_serve") {
  return runNoodle(interaction, {
    sub: "takeout_serve",
    overrides: { messageId: interaction.message?.id ?? null }
  });
}

return componentCommit(interaction, { content: "Unknown picker action.", ephemeral: true });

}

/* ---------------- PICKER SELECT MENUS ---------------- */
// Handle select menus for pickers:
if (interaction.isSelectMenu?.()) {
const cid = interaction.customId;

if (cid.startsWith("noodle:takeout:menu_select:")) {
  const idParts = cid.split(":");
  const owner = idParts[3];
  const rawPage = Number(idParts[4] ?? 0);
  const page = Number.isFinite(rawPage) ? Math.max(0, rawPage) : 0;
  if (owner && owner !== interaction.user.id) {
    return componentCommit(interaction, { content: "That menu isn’t for you.", ephemeral: true });
  }

  const pageSelectedRecipeIds = (interaction.values ?? []).filter(Boolean);

  const p = ensurePlayer(serverId, interaction.user.id);
  const s = ensureServer(serverId);
  const settings = buildSettingsMap(settingsCatalog, s.settings);
  s.season = computeActiveSeason(settings);
  const availableRecipeIds = filterRecipeIdsByActiveSeasonEvent(getValidAvailableRecipeIds(p), s);
  const menuLimits = getTakeoutMenuLimits(availableRecipeIds.length);
  const currentDraftSelection = readTakeoutMenuDraftSelection({
    serverId,
    userId: interaction.user.id,
    availableRecipeIds,
    fallbackRecipeIds: p?.takeout?.menu_recipe_ids ?? []
  });
  const selectedRecipeIds = mergeTakeoutMenuPageSelection({
    availableRecipeIds,
    currentSelectedRecipeIds: currentDraftSelection,
    pageSelectedRecipeIds,
    page,
    maxAllowed: menuLimits.maxAllowed
  });

  return runNoodle(interaction, {
    sub: "takeout_menu",
    overrides: {
      strings: { recipes: selectedRecipeIds.join(",") },
      booleans: { menu_draft: true },
      integers: { page },
      messageId: interaction.message?.id ?? null
    }
  });
}

// accept picker
if (cid.startsWith("noodle:pick:accept_select:")) {
  const parts2 = cid.split(":");
  const rawPage = Number(parts2[4] ?? 0);
  const page = Number.isFinite(rawPage) ? Math.max(0, rawPage) : 0;

  const s = ensureServer(serverId);
  const p = ensurePlayer(serverId, userId);
  const set = buildSettingsMap(settingsCatalog, s.settings);
  s.season = computeActiveSeason(set);
  const activeEventEffects = getActiveEventEffects(eventsContent, s);
  const activeEventId = s.active_event_id ?? null;
  rollMarket({ serverId, content, serverState: s, eventEffects: activeEventEffects });
  ensureDailyOrdersForPlayer(p, set, content, s.season, serverId, userId, activeEventId);
  applyHouse247OrderBoardOverride(p);

  const pageSize = 25;
  const { totalCount, consumedSet } = getOrdersMeta(p);
  const availablePages = [];
  for (let idx = 0; idx < totalCount; idx++) {
    if (consumedSet.has(idx)) continue;
    const pageIdx = Math.floor(idx / pageSize);
    if (!availablePages.includes(pageIdx)) availablePages.push(pageIdx);
  }

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

  const availableOrderIds = [];
  const pageData = loadPage(page);
  const pageOrderIds = (pageData?.orders ?? []).map((o) => String(o.order_id));
  for (const pg of availablePages.length ? availablePages : [page]) {
    const data = Number(pg) === page ? pageData : loadPage(pg);
    availableOrderIds.push(...((data?.orders ?? []).map((o) => String(o.order_id))));
  }

  const currentSelected = readAcceptOrderDraftSelection({ serverId, userId, availableOrderIds });
  const merged = mergeAcceptOrderPageSelection({
    availableOrderIds,
    currentSelectedOrderIds: currentSelected,
    pageOrderIds,
    pageSelectedOrderIds: interaction.values ?? []
  });
  writeAcceptOrderDraftSelection({ serverId, userId, selectedOrderIds: merged });

  const payload = buildAcceptPickerPayload({
    userId,
    serverId,
    p,
    s,
    ownerUser: interaction.member ?? interaction.user,
    page
  });
  return componentCommit(interaction, payload);
}

// cancel picker
if (cid.startsWith("noodle:pick:cancel_select:")) {
  const parts2 = cid.split(":");
  const owner = parts2[3];
  const rawPage = Number(parts2[4] ?? 0);
  const page = Number.isFinite(rawPage) ? Math.max(0, rawPage) : 0;
  if (owner && owner !== interaction.user.id) {
    return componentCommit(interaction, { content: "That menu isn’t for you.", ephemeral: true });
  }

  const p = ensurePlayer(serverId, userId);
  const accepted = Object.entries(p.orders?.accepted ?? {});
  const pageSize = 25;
  const safePage = Math.max(0, Math.min(page, Math.max(0, Math.ceil(accepted.length / pageSize) - 1)));
  const pageOrderIds = accepted
    .slice(safePage * pageSize, (safePage + 1) * pageSize)
    .map(([oid]) => String(oid));
  const availableOrderIds = accepted.map(([oid]) => String(oid));
  const currentSelected = readCancelOrderDraftSelection({ serverId, userId, availableOrderIds });
  const merged = mergeCancelOrderPageSelection({
    availableOrderIds,
    currentSelectedOrderIds: currentSelected,
    pageOrderIds,
    pageSelectedOrderIds: interaction.values ?? []
  });
  writeCancelOrderDraftSelection({ serverId, userId, selectedOrderIds: merged });

  const payload = buildCancelServePickerPayload({
    action: "cancel",
    userId,
    serverId,
    p,
    ownerUser: interaction.member ?? interaction.user,
    page: safePage
  });
  return componentCommit(interaction, payload);
}

// serve picker
if (cid.startsWith("noodle:pick:serve_select:")) {
  const orderIds = interaction.values ?? [];
  return await runNoodle(interaction, {
    sub: "serve",
    overrides: { strings: { order_id: orderIds.join(",") } }
  });
}

if (cid.startsWith("noodle:pick:takeout_serve_select:")) {
  const recipeId = interaction.values?.[0] ?? "";
  return await runNoodle(interaction, {
    sub: "takeout_serve",
    overrides: { strings: { recipe: recipeId }, messageId: interaction.message?.id ?? null }
  });
}

if (cid.startsWith("noodle:pick:takeout_cook_select:")) {
  const idParts = cid.split(":");
  const owner = idParts[3];
  const recipeId = interaction.values?.[0];

  if (owner && owner !== interaction.user.id) {
    return componentCommit(interaction, { content: "That menu isn’t for you.", ephemeral: true });
  }

  if (interaction.deferred || interaction.replied) {
    return componentCommit(interaction, { content: "That menu expired, tap again.", ephemeral: true });
  }

  const sourceMessageId = interaction.message?.id ?? "none";
  const modal = new ModalBuilder()
    .setCustomId(`noodle:pick:takeout_cook_qty:${userId}:${recipeId}:${sourceMessageId}`)
    .setTitle("Counter cook bowls");

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
    console.log(`⚠️ showModal failed for takeout cook:`, e?.message);
    const code = e?.code ?? e?.message;
    if (code === 10062 || e?.message?.includes("Unknown interaction")) {
      return;
    }
    if (e?.message?.includes("already been acknowledged")) {
      return componentCommit(interaction, {
        content: `${getIcon("warning")} Counter Cook menu timed out. Tap **Counter Cook** again.`,
        ephemeral: true
      });
    }
    return componentCommit(interaction, {
      content: `${getIcon("warning")} Discord couldn't show the modal. Try using Counter Cook again.`,
      ephemeral: true
    });
  }
}

// cook picker -> open qty modal
if (cid.startsWith("noodle:pick:cook_select:")) {
  const recipeId = interaction.values?.[0];
  const title = interaction.message?.embeds?.[0]?.data?.title
    ?? interaction.message?.embeds?.[0]?.title
    ?? "";
  const fromCounterCook = String(title).includes("Counter Cook");

  if (interaction.deferred || interaction.replied) {
    return componentCommit(interaction, { content: "That menu expired, tap again.", ephemeral: true });
  }

  const sourceMessageId = interaction.message?.id ?? "none";
  const modal = new ModalBuilder()
    .setCustomId(fromCounterCook
      ? `noodle:pick:takeout_cook_qty:${userId}:${recipeId}:${sourceMessageId}`
      : `noodle:pick:cook_qty:${userId}:${recipeId}:${sourceMessageId}`)
    .setTitle(fromCounterCook ? "Counter cook bowls" : "Cook bowls");

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
    if (code === 10062 || e?.message?.includes("Unknown interaction")) {
      return;
    }
    if (e?.message?.includes("already been acknowledged")) {
      return componentCommit(interaction, {
        content: `${getIcon("warning")} That cook menu timed out. Tap **Cook** again.`,
        ephemeral: true
      });
    }
    return componentCommit(interaction, {
      content: `${getIcon("warning")} Discord couldn't show the modal. Try using "/noodle cook" directly instead.`,
      ephemeral: true
    });
  }
}

// forage picker -> open qty modal
if (cid.startsWith("noodle:pick:forage_item_select:")) {
  const idParts = cid.split(":");
  const rawPage = Number(idParts[4] ?? 0);
  const page = Number.isFinite(rawPage) ? Math.max(0, rawPage) : 0;
  const itemId = interaction.values?.[0] ?? null;
  if (!itemId || itemId === "none") {
    return componentCommit(interaction, { content: "Pick an ingredient first.", ephemeral: true });
  }

  return runNoodle(interaction, {
    sub: "forage_menu",
    overrides: {
      strings: { item: itemId },
      integers: { page },
      messageId: interaction.message?.id ?? null
    }
  });
}

// fishing picker -> open qty modal
if (cid.startsWith("noodle:pick:fishing_item_select:")) {
  const idParts = cid.split(":");
  const rawPage = Number(idParts[4] ?? 0);
  const page = Number.isFinite(rawPage) ? Math.max(0, rawPage) : 0;
  const itemId = interaction.values?.[0] ?? null;
  if (!itemId || itemId === "none") {
    return componentCommit(interaction, { content: "Pick a fishing target first.", ephemeral: true });
  }

  return runNoodle(interaction, {
    sub: "fishing_menu",
    overrides: {
      strings: { item: itemId },
      integers: { page },
      messageId: interaction.message?.id ?? null
    }
  });
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

  /* ---------------- TAKEOUT COOK QTY MODAL ---------------- */
  if (interaction.isModalSubmit?.() && interaction.customId.startsWith("noodle:pick:takeout_cook_qty:")) {
    const parts2 = interaction.customId.split(":");
    // noodle:pick:takeout_cook_qty:<ownerId>:<recipeId>:<messageId>
    const owner = parts2[3];
    const recipeId = parts2[4];
    const messageId = parts2[5] && parts2[5] !== "none" ? parts2[5] : null;

    if (owner && owner !== interaction.user.id) {
      return componentCommit(interaction, { content: "That counter cook prompt isn’t for you.", ephemeral: true });
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

    const payload = buildCookMinigameScenePayload({
      userId,
      recipeId,
      quantity: qty,
      totalTurns: 8,
      turnIndex: 0,
      score: 0,
      misses: 0,
      counterCook: true,
      returnSub: "takeout"
    });
    return componentCommit(interaction, payload);
  }

  /* ---------------- FORAGE QTY MODAL ---------------- */
  if (interaction.isModalSubmit?.() && interaction.customId.startsWith("noodle:pick:forage_qty:")) {
    const parts2 = interaction.customId.split(":");
    // noodle:pick:forage_qty:<ownerId>:<itemId>:<page>:<messageId>
    const owner = parts2[3];
    const itemId = parts2[4];
    const rawPage = Number(parts2[5] ?? 0);
    const page = Number.isFinite(rawPage) ? Math.max(0, rawPage) : 0;
    const messageId = parts2[6] && parts2[6] !== "none" ? parts2[6] : null;

    if (owner && owner !== interaction.user.id) {
      return componentCommit(interaction, { content: "That forage prompt isn’t for you.", ephemeral: true });
    }

    const rawQty = String(interaction.fields.getTextInputValue("qty") ?? "").trim();
    const qty = Number(rawQty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 5) {
      return componentCommit(interaction, { content: "Enter a whole number quantity (1-5).", ephemeral: true });
    }

    if (messageId) {
      try {
        await interaction.deferReply({ ephemeral: true });
      } catch (e) {
        // ignore
      }
    }

    return runNoodle(interaction, {
      sub: "forage",
      overrides: {
        strings: { item: itemId },
        integers: { quantity: qty, page },
        messageId
      }
    });
  }

  /* ---------------- FISHING QTY MODAL ---------------- */
  if (interaction.isModalSubmit?.() && interaction.customId.startsWith("noodle:pick:fishing_qty:")) {
    const parts2 = interaction.customId.split(":");
    // noodle:pick:fishing_qty:<ownerId>:<itemId>:<page>:<messageId>
    const owner = parts2[3];
    const itemId = parts2[4];
    const rawPage = Number(parts2[5] ?? 0);
    const page = Number.isFinite(rawPage) ? Math.max(0, rawPage) : 0;
    const messageId = parts2[6] && parts2[6] !== "none" ? parts2[6] : null;

    if (owner && owner !== interaction.user.id) {
      return componentCommit(interaction, { content: "That fishing prompt isn’t for you.", ephemeral: true });
    }

    const rawQty = String(interaction.fields.getTextInputValue("qty") ?? "").trim();
    const qty = Number(rawQty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 5) {
      return componentCommit(interaction, { content: "Enter a whole number quantity (1-5).", ephemeral: true });
    }

    if (messageId) {
      try {
        await interaction.deferReply({ ephemeral: true });
      } catch (e) {
        // ignore
      }
    }

    return runNoodle(interaction, {
      sub: "fishing",
      overrides: {
        strings: { item: itemId },
        integers: { quantity: qty, page },
        messageId
      }
    });
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

    if (isComponentsV2Enabled({ guildId: serverId, userId, player: p })) {
      return componentCommit(interaction, {
        ...buildProfileEditV2Message({
          userId,
          specializationsAvailable,
          statusLine: `${getIcon("status_complete")} Shop name updated to **${trimmed}**.`,
          ownerId: userId,
          buttonEmoji: getProfileV2ButtonEmoji()
        }),
        targetMessageId: messageId ?? interaction.message?.id
      });
    }

    return componentCommit(interaction, {
      content: " ",
      ...composeV2FromLegacyEmbeds([embed]),
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

    if (isComponentsV2Enabled({ guildId: serverId, userId, player: p })) {
      return componentCommit(interaction, {
        ...buildProfileEditV2Message({
          userId,
          specializationsAvailable,
          statusLine: `${getIcon("status_complete")} Tagline updated: *${trimmed}*`,
          ownerId: userId,
          buttonEmoji: getProfileV2ButtonEmoji()
        }),
        targetMessageId: messageId ?? interaction.message?.id
      });
    }

    return componentCommit(interaction, {
      content: " ",
      ...composeV2FromLegacyEmbeds([embed]),
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
    const limitMultiBuyToBuy1 = resolveTutorialGateValue({
      player: p,
      gate: "limitMultiBuyToBuy1",
      fallbackValue: false
    });
    const showSellButton = resolveTutorialGateValue({
      player: p,
      gate: "multiBuySelectionShowSellButton",
      fallbackValue: true
    });
    const serverState = ensureServer(serverId);
    const { hasActiveOrders } = computeMarketShoppingShortages(p, serverState);
    const { selectedNames, btnRow } = buildMultiBuyButtonsRow(interaction.user.id, picked, sourceMessageId, {
      limitToBuy1: limitMultiBuyToBuy1,
      showBuyNeeded: hasActiveOrders
    });

    const sellButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`noodle:nav:sell:${interaction.user.id}`)
        .setLabel("Sell Items").setEmoji(getButtonEmoji("coins"))
        .setStyle(ButtonStyle.Secondary)
    );

    const selectionEmbed = buildMenuEmbed({
      title: `${getIcon("cart")} Multi-buy`,
      description: `**Selected:** ${selectedNames}\nChoose how you want to buy:`,
      user: interaction.member ?? interaction.user
    });
    selectionEmbed.setFooter({
      text: `Coins: ${p.coins || 0}c\n${ownerFooterText(interaction.member ?? interaction.user)}`
    });

    return componentCommit(interaction, {
      content: " ",
      ...composeV2FromLegacyEmbeds([selectionEmbed]),
      components: showSellButton ? [btnRow, sellButton] : [btnRow]
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
      if (isComponentsV2Enabled({ guildId: serverId, userId, player: p })) {
        return componentCommit(interaction, {
          ...buildSpecializationConfirmV2Message({
            userId,
            specId,
            specName: spec.name,
            specDescription: spec.description,
            specThumbnailUrl: getSpecializationThumbnailUrl(spec),
            specializationsAvailable,
            ownerId: userId,
            buttonEmoji: getProfileV2ButtonEmoji(),
            lockedReason: `Reason: ${check.reason}`
          }),
          targetMessageId: interaction.message?.id
        });
      }

      const embed = buildMenuEmbed({
        title: `${getIcon("sparkle")} Specialization Locked`,
        description: `You can't select **${spec.name}** yet.\nReason: ${check.reason}${description}`,
        user: interaction.member ?? interaction.user
      });

      return componentCommit(interaction, {
        content: " ",
        ...composeV2FromLegacyEmbeds([embed]),
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

    if (isComponentsV2Enabled({ guildId: serverId, userId, player: p })) {
      return componentCommit(interaction, {
        ...buildSpecializationConfirmV2Message({
          userId,
          specId,
          specName: spec.name,
          specDescription: spec.description,
          specThumbnailUrl: getSpecializationThumbnailUrl(spec),
          specializationsAvailable,
          ownerId: userId,
          buttonEmoji: getProfileV2ButtonEmoji()
        }),
        targetMessageId: interaction.message?.id
      });
    }

    return componentCommit(interaction, {
      content: " ",
      ...composeV2FromLegacyEmbeds([embed]),
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
      const serverState = ensureServer(serverId);
      const limitMultiBuyToBuy1 = resolveTutorialGateValue({
        player: p,
        gate: "limitMultiBuyToBuy1",
        fallbackValue: false
      });
      const showSellButton = resolveTutorialGateValue({
        player: p,
        gate: "multiBuySelectionShowSellButton",
        fallbackValue: true
      });
      const { hasActiveOrders } = computeMarketShoppingShortages(p, serverState);
      const { selectedNames, btnRow } = buildMultiBuyButtonsRow(interaction.user.id, selectedIds, sourceId, {
        limitToBuy1: limitMultiBuyToBuy1,
        showBuyNeeded: hasActiveOrders
      });
      const sellButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`noodle:nav:sell:${interaction.user.id}`)
          .setLabel("Sell Items").setEmoji(getButtonEmoji("coins"))
          .setStyle(ButtonStyle.Secondary)
      );
      const selectionEmbed = buildMenuEmbed({
        title: `${getIcon("cart")} Multi-buy`,
        description: `**Selected:** ${selectedNames}\nQuantity entry has been removed. Use Buy 1/5/10 each instead.`,
        user: interaction.member ?? interaction.user
      });
      selectionEmbed.setFooter({
        text: `Coins: ${p.coins || 0}c\n${ownerFooterText(interaction.member ?? interaction.user)}`
      });
      return componentCommit(interaction, {
        content: " ",
        ...composeV2FromLegacyEmbeds([selectionEmbed]),
        components: showSellButton ? [btnRow, sellButton] : [btnRow],
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

    // Buy N each / needed -> perform purchase
    if (mode === "buy1" || mode === "buy5" || mode === "buy10" || mode === "buyneed") {
      const qtyEach = mode === "buy10" ? 10 : mode === "buy5" ? 5 : 1;
      const sourceMessageId = interaction.message?.id;
      const action = mode === "buyneed" ? "multibuy_buyneed" : `multibuy_buy${qtyEach}`;
      const idemKey = makeIdempotencyKey({ serverId, userId, action, interactionId: interaction.id });
      const cached = db ? getIdempotentResult(db, idemKey) : null;
      if (cached) return componentCommit(interaction, cached);

      const ownerLock = `discord:${interaction.id}`;

      const lockedPayload = await withLock(db, `lock:user:${userId}`, ownerLock, 8000, async () => {
        let s = ensureServer(serverId);
        let p2 = ensurePlayer(serverId, userId);
        if (!p2.market_stock) p2.market_stock = {};
        const unlimitedMarketStock = hasUnlimitedMarketStock(p2, nowTs());

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
        if (mode === "buyneed") {
          const { shoppingShortages } = computeMarketShoppingShortages(p2, s);
          const shortById = new Map(shoppingShortages.map((row) => [row.id, row.short]));
          for (const id3 of selectedIds) {
            const neededShort = Math.max(0, Math.floor(Number(shortById.get(id3) || 0) || 0));
            want[id3] = neededShort;
          }
        } else {
          for (const id3 of selectedIds) want[id3] = qtyEach;
        }

        let totalCost = 0;
        const buyLines = [];
        let capacityReduced = false;

        for (const [id3, qty3] of Object.entries(want)) {
          if (!MARKET_ITEM_IDS.includes(id3)) {
            const friendly = displayItemName(id3);
            return { content: `${friendly} isn’t a market item.`, ephemeral: true };
          }

          const it = content.items?.[id3];
          if (!it) {
            const friendly = displayItemName(id3);
            return { content: `Unknown item: ${friendly}.`, ephemeral: true };
          }

          const basePrice = s.market_prices?.[id3] ?? it.base_price ?? 0;
          const price = applyMarketDiscount(basePrice, combinedEffects);
          const stock = p2.market_stock?.[id3] ?? 0;
          const type = normalizeIngredientType(id3);
          const remaining = remainingByType[type] ?? 0;
          const capacity = checkIngredientCapacity(p2, id3, 0);
          const stackRemaining = Math.max(0, (capacity.maxCapacity ?? 0) - (capacity.currentQty ?? 0));
          const requestedQty = Math.max(0, Math.floor(Number(qty3 || 0) || 0));
          if (requestedQty <= 0) continue;

          const qtyToBuy = Math.min(requestedQty, remaining, stackRemaining);

          if (qtyToBuy <= 0) {
            capacityReduced = true;
            continue;
          }

          if (!unlimitedMarketStock && stock < qtyToBuy) {
            const friendly = displayItemName(id3);
            return {
              content: `Only ${stock} in stock today for **${friendly}**.`,
              ephemeral: true
            };
          }

          if (qtyToBuy < requestedQty) capacityReduced = true;

          totalCost += price * qtyToBuy;
          buyLines.push({ id: id3, qty: qtyToBuy, name: it.name, price });
          remainingByType[type] = remaining - qtyToBuy;
        }

        if (!buyLines.length) {
          return {
            content: mode === "buyneed"
              ? `${getIcon("help")} No purchasable shopping shortages found for the selected items right now.`
              : `${getIcon("pantry")} Your pantry is full. Upgrade storage or use ingredients to make room.`,
            ephemeral: true
          };
        }

        if ((p2.coins ?? 0) < totalCost) {
          return { content: `Not enough coins. Total is **${totalCost}c**.`, ephemeral: true };
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
          return { 
            content: `${getIcon("warning")} **Pantry Full!** Cannot store: ${blockedItems}\nUpgrade your Pantry to increase capacity.`,
            ephemeral: true
          };
        }

        // Apply purchase
        p2.coins -= totalCost;

        for (const x of buyLines) {
          if (!unlimitedMarketStock) {
            p2.market_stock[x.id] = (p2.market_stock[x.id] ?? 0) - x.qty;
          }
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

        const pretty = buyLines.map((x) => `• **${x.qty}×** ${x.name} (${x.price}c ea)`).join("\n");

        const buyEmbed = buildMenuEmbed({
          title: `${getIcon("cart")} Purchase Complete`,
          description: `Bought:\n${pretty}\n\nTotal: **${totalCost}c**.${capacityReduced ? `\n${getIcon("pantry")} Pantry capacity limited this purchase.` : ""}${unlimitedMarketStock ? `\n${getHouse247Label()} active: stock limit bypassed.` : ""}${tutorialSuffix(p2)}`,
          user: interaction.member ?? interaction.user
        });
        buyEmbed.setFooter({
          text: `Coins: ${p2.coins || 0}c\n${ownerFooterText(interaction.member ?? interaction.user)}`
        });

        const showTutorialForageRowAfterMultiBuyPurchase = resolveTutorialGateValue({
          player: p2,
          gate: "showTutorialForageRowAfterMultiBuyPurchase",
          fallbackValue: false
        });
        const tutorialActive = Boolean(p2.tutorial?.active && getCurrentTutorialStep(p2));

        let components;
        if (tutorialActive) {
          const questsAvailable = hasDailyRewardAvailable(p2, nowTs()) || hasClaimableQuests(p2);
          components = showTutorialForageRowAfterMultiBuyPurchase
            ? [noodleTutorialForageRow(userId)]
            : [noodleMainMenuRow(userId), noodleSecondaryMenuRow(userId, { questsAvailable })];
        } else {
          const { hasActiveOrders } = computeMarketShoppingShortages(p2, s);
          const { btnRow } = buildMultiBuyButtonsRow(interaction.user.id, selectedIds, sourceMessageId, {
            limitToBuy1: false,
            showBuyNeeded: hasActiveOrders
          });
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
          ...composeV2FromLegacyEmbeds([buyEmbed]),
          components,
          targetMessageId: interaction.message?.id ?? sourceMessageId ?? null
        };

        if (db) {
          putIdempotentResult(db, { key: idemKey, userId, action, ttlSeconds: 900, result: replyObj });
        }
        
        return replyObj;
      });

      return componentCommit(interaction, lockedPayload);
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
    purgeExpiredSelectionCache(sellSelectionCacheV2);
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

    const selectedNames = formatSelectedItemNames(picked);

    const sourceMessageId = interaction.message?.id ?? "none";
    const selectionToken = makeSelectionToken();
    sellSelectionCacheV2.set(selectionToken, {
      userId: interaction.user.id,
      selectedIds: picked.slice(0, 5),
      page,
      sourceMessageId: sourceMessageId === "none" ? null : sourceMessageId,
      expiresAt: Date.now() + SELECTION_CACHE_TTL_MS
    });
    const btnRow = buildSellQuantityRow(interaction.user.id, picked, page, selectionToken);

    const sellEmbed = buildMenuEmbed({
      title: `${getIcon("coins")} Sell Items`,
      description: `**Selected:** ${selectedNames}\nChoose how you want to sell:`,
      user: interaction.member ?? interaction.user
    });

    return componentCommit(interaction, {
      content: " ",
      ...composeV2FromLegacyEmbeds([sellEmbed]),
      components: [btnRow],
      targetMessageId: interaction.message?.id ?? null
    });
  }

  /* ---------------- SELL BUTTONS ---------------- */
  if (interaction.isButton?.() && interaction.customId.startsWith("noodle:sell:")) {
    purgeExpiredSelectionCache(sellSelectionCacheV2);
    const parts2 = interaction.customId.split(":");
    // noodle:sell:<mode>:<ownerId>:<token>
    const mode = parts2[2];
    const owner = parts2[3];
    const tokenOrLegacyPage = parts2[4] ?? null;
    const isLegacyShape = Number.isFinite(Number(tokenOrLegacyPage)) && parts2.length > 5;

    let page = 0;
    let selectedIds = [];
    let selectionToken = null;

    const cacheEntry = tokenOrLegacyPage && !isLegacyShape ? sellSelectionCacheV2.get(tokenOrLegacyPage) : null;
    if (cacheEntry) {
      if (cacheEntry.expiresAt < Date.now()) {
        sellSelectionCacheV2.delete(tokenOrLegacyPage);
        return componentCommit(interaction, { content: `${getIcon("warning")} Selection expired. Please try again.`, ephemeral: true });
      }
      if (cacheEntry.userId && cacheEntry.userId !== interaction.user.id) {
        return componentCommit(interaction, { content: "That menu isn't for you.", ephemeral: true });
      }

      page = Number.isFinite(cacheEntry.page) ? Number(cacheEntry.page) : 0;
      selectedIds = (cacheEntry.selectedIds ?? []).filter(Boolean).slice(0, 5);
      selectionToken = tokenOrLegacyPage;
      cacheEntry.expiresAt = Date.now() + SELECTION_CACHE_TTL_MS;
      sellSelectionCacheV2.set(tokenOrLegacyPage, cacheEntry);
    } else {
      if (tokenOrLegacyPage && !isLegacyShape) {
        return componentCommit(interaction, { content: `${getIcon("warning")} Selection expired. Please reselect items and try again.`, ephemeral: true });
      }
      // Backward-compat fallback for older component IDs in already-rendered messages.
      const maybePage = Number(tokenOrLegacyPage);
      const hasLegacyPage = Number.isFinite(maybePage);
      page = hasLegacyPage ? maybePage : 0;
      const idsPart = parts2.slice(hasLegacyPage ? 5 : 4).join(":");
      selectedIds = idsPart.split(",").filter(Boolean).slice(0, 5);
    }

    if (owner && owner !== interaction.user.id) {
      return componentCommit(interaction, { content: "That menu isn't for you.", ephemeral: true });
    }

    if (!selectedIds.length) {
      return componentCommit(interaction, { content: "No items selected.", ephemeral: true });
    }

    if (mode === "qty") {
      const selectedNames = formatSelectedItemNames(selectedIds);
      const btnRow = buildSellQuantityRow(interaction.user.id, selectedIds, page, selectionToken);

      const sellEmbed = buildMenuEmbed({
        title: `${getIcon("coins")} Sell Items`,
        description: `**Selected:** ${selectedNames}\nQuantity entry has been removed. Use Sell 1/5/10 each instead.`,
        user: interaction.member ?? interaction.user
      });

      return componentCommit(interaction, {
        content: " ",
        ...composeV2FromLegacyEmbeds([sellEmbed]),
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
      const lockedPayload = await withLock(db, `lock:user:${userId}`, owner2, 8000, async () => {
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
          return {
            content: `${getIcon("cancel")} You don't have any of those items to sell.`,
            ephemeral: true
          };
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
          ...composeV2FromLegacyEmbeds([sellEmbed]),
          components: pickerPayload.ephemeral
            ? (pickerPayload.components ?? [])
            : [buildSellQuantityRow(userId, selectedIds, page, selectionToken), ...(pickerPayload.components ?? [noodleMainMenuRow(userId)])],
          targetMessageId: pickerPayload.ephemeral ? undefined : (interaction.message?.id ?? null),
          ephemeral: pickerPayload.ephemeral
        };

        if (db) {
          putIdempotentResult(db, { key: idemKey, userId, action, ttlSeconds: 900, result: replyObj });
        }
        return replyObj;
      });

      return componentCommit(interaction, lockedPayload);
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
  .addSubcommand((sc) =>
    sc
      .setName("fishing")
      .setDescription("Cast a line for fresh catches.")
      .addStringOption((o) => o.setName("item").setDescription("What to fish for (type to search)").setRequired(false).setAutocomplete(true))
      .addIntegerOption((o) => o.setName("quantity").setDescription("Quantity (1-5)").setRequired(false).setMinValue(1).setMaxValue(5))
  )
  .addSubcommand((sc) => sc.setName("recipes").setDescription("View your unlocked recipes and clues."))
  .addSubcommand((sc) => sc.setName("regulars").setDescription("View regular NPCs and their bonuses."))
  .addSubcommand((sc) => sc.setName("event").setDescription("Show the current event (if any)."))
  .addSubcommand((sc) => sc.setName("quests").setDescription("View active quests."))
  .addSubcommand((sc) => sc.setName("quests_daily").setDescription("Claim your daily reward."))
  .addSubcommand((sc) => sc.setName("quests_claim").setDescription("Claim completed quest rewards."))
  .addSubcommand((sc) => sc.setName("quests_vote").setDescription("View and claim bot-list vote rewards."))
  .addSubcommandGroup((sg) =>
    sg
      .setName("takeout")
      .setDescription("Take Out Counter actions.")
      .addSubcommand((sc) => sc.setName("status").setDescription("View your Take Out Counter status."))
      .addSubcommand((sc) =>
        sc
          .setName("menu")
          .setDescription("Set your Take Out Counter menu using a recipe picker.")
          .addStringOption((o) =>
            o
              .setName("recipes")
              .setDescription("Optional legacy input: comma-separated recipe ids (max 10).")
              .setRequired(false)
          )
      )
      .addSubcommand((sc) => sc.setName("open").setDescription("Open a 12-hour takeout shift."))
      .addSubcommand((sc) => sc.setName("claim").setDescription("Claim idle takeout earnings."))
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

export const noodleCommand = {
  data: noodleCommandData,

  async execute(interaction) {
    const rawSub = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup(false);
    const sub = group === "takeout"
      ? (rawSub === "status"
          ? "takeout"
          : rawSub === "menu"
            ? "takeout_menu"
            : rawSub === "open"
              ? "takeout_open"
              : rawSub === "claim"
                ? "takeout_claim"
                : rawSub)
      : rawSub;
    return runNoodle(interaction, { sub, group });
  },

  async handleComponent(interaction) {
    return handleComponent(interaction);
  }
};

export {
  runNoodle,
  noodleMainMenuRow,
  noodleMainMenuRowNoProfile,
  displayItemName,
  renderProfileEmbed,
  resolveComponentNavSub
};
