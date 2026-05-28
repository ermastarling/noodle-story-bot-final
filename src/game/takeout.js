import { nowTs } from "../util/time.js";

export const TAKEOUT_SHIFT_DURATION_HOURS = 12;
export const TAKEOUT_SHIFT_DURATION_MS = TAKEOUT_SHIFT_DURATION_HOURS * 60 * 60 * 1000;
export const TAKEOUT_MENU_MIN_RECIPES = 5;
export const TAKEOUT_MENU_MAX_RECIPES = 10;
export const TAKEOUT_SNAPSHOT_MIN_ORDERS = 100;
export const TAKEOUT_SNAPSHOT_MAX_ORDERS = 500;
export const TAKEOUT_SNAPSHOT_UNLIMITED_MIN_ORDERS = 1000;
export const TAKEOUT_SNAPSHOT_UNLIMITED_MAX_ORDERS = 2000;
const TAKEOUT_HOUR_MS = 60 * 60 * 1000;

const TIER_PAYOUT_MULTIPLIERS = Object.freeze({
  common: 1.3,
  uncommon: 1.5,
  rare: 1.75,
  epic: 2.1,
  legendary: 2.5,
  seasonal: 1.6
});

function defaultShiftState() {
  return {
    status: "inactive",
    started_at: null,
    ends_at: null,
    last_processed_hour_index: 0,
    last_tick_at: null,
    operating_cost_paid_marker: null,
    operating_cost: 0,
    required_ingredients: {},
    covered_ingredients: {},
    idle_order_board_snapshot: []
  };
}

export function createDefaultTakeoutState() {
  return {
    menu_recipe_ids: [],
    shift: defaultShiftState(),
    earned_unclaimed_coins: 0,
    first_shift_started_at: null,
    updated_at: null
  };
}

export function ensureTakeoutState(player) {
  if (!player || typeof player !== "object") return createDefaultTakeoutState();

  if (!player.takeout || typeof player.takeout !== "object" || Array.isArray(player.takeout)) {
    player.takeout = createDefaultTakeoutState();
    return player.takeout;
  }

  const takeout = player.takeout;
  if (!Array.isArray(takeout.menu_recipe_ids)) takeout.menu_recipe_ids = [];
  if (!Number.isFinite(Number(takeout.earned_unclaimed_coins))) takeout.earned_unclaimed_coins = 0;
  takeout.earned_unclaimed_coins = Math.max(0, Math.floor(Number(takeout.earned_unclaimed_coins) || 0));
  {
    const firstShiftStartedAt = Number(takeout.first_shift_started_at || 0);
    takeout.first_shift_started_at = Number.isFinite(firstShiftStartedAt) && firstShiftStartedAt > 0
      ? firstShiftStartedAt
      : null;
  }

  if (!takeout.shift || typeof takeout.shift !== "object" || Array.isArray(takeout.shift)) {
    takeout.shift = defaultShiftState();
  } else {
    takeout.shift = {
      ...defaultShiftState(),
      ...takeout.shift
    };
  }

  if (!Array.isArray(takeout.shift.idle_order_board_snapshot)) {
    takeout.shift.idle_order_board_snapshot = [];
  }

  return takeout;
}

export function getTakeoutMenuLimits(learnedRecipeCount) {
  const learned = Math.max(0, Math.floor(Number(learnedRecipeCount) || 0));
  const maxAllowed = Math.min(TAKEOUT_MENU_MAX_RECIPES, learned);
  const minRequired = learned > 0 ? Math.min(TAKEOUT_MENU_MIN_RECIPES, maxAllowed) : 0;
  return { learned, minRequired, maxAllowed };
}

export function normalizeTakeoutMenuSelection({ selectedRecipeIds = [], learnedRecipeIds = [] } = {}) {
  const learnedSet = new Set((learnedRecipeIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const deduped = [];
  const seen = new Set();

  for (const rawId of selectedRecipeIds || []) {
    const recipeId = String(rawId || "").trim();
    if (!recipeId || seen.has(recipeId) || !learnedSet.has(recipeId)) continue;
    seen.add(recipeId);
    deduped.push(recipeId);
    if (deduped.length >= TAKEOUT_MENU_MAX_RECIPES) break;
  }

  return deduped;
}

function buildShiftSnapshot(menuRecipeIds = []) {
  return menuRecipeIds.map((recipeId) => ({
    recipe_id: recipeId,
    visible_order_count: 0,
    total_orders: 0,
    hourly_order_counts: Array.from({ length: TAKEOUT_SHIFT_DURATION_HOURS }, () => 0)
  }));
}

function toIntSeed(value) {
  const n = Math.floor(Number(value) || 0);
  if (!Number.isFinite(n)) return 0;
  return n;
}

function deriveShiftSeed(parts = []) {
  // FNV-1a style integer mixing gives stable pseudo-randomness per shift seed.
  let hash = 2166136261;
  for (const part of parts) {
    const n = toIntSeed(part);
    hash ^= n;
    hash = Math.imul(hash, 16777619);
    hash >>>= 0;
  }
  return hash >>> 0;
}

export function buildTakeoutShiftSnapshot(menuRecipeIds = [], {
  hours = TAKEOUT_SHIFT_DURATION_HOURS,
  totalOrders = TAKEOUT_SNAPSHOT_MIN_ORDERS
} = {}) {
  const out = buildShiftSnapshot(menuRecipeIds);
  if (!out.length) return out;

  const totalHours = Math.max(1, Math.floor(Number(hours) || TAKEOUT_SHIFT_DURATION_HOURS));
  const menuSize = out.length;
  const parsedTotalOrders = Number(totalOrders);
  const orderTotal = Number.isFinite(parsedTotalOrders) && parsedTotalOrders > 0
    ? Math.floor(parsedTotalOrders)
    : TAKEOUT_SNAPSHOT_MIN_ORDERS;
  if (orderTotal <= 0) return out;

  const hourlyCounts = Array.from({ length: totalHours }, () => Math.floor(orderTotal / totalHours));
  let remainder = orderTotal % totalHours;
  for (let hour = 0; hour < totalHours && remainder > 0; hour += 1) {
    hourlyCounts[hour] += 1;
    remainder -= 1;
  }

  let rotation = 0;
  for (let hour = 0; hour < totalHours; hour += 1) {
    const ordersThisHour = hourlyCounts[hour] ?? 0;
    for (let j = 0; j < ordersThisHour; j += 1) {
      const idx = (rotation + j) % menuSize;
      const row = out[idx];
      row.hourly_order_counts[hour] = (row.hourly_order_counts[hour] ?? 0) + 1;
      row.total_orders += 1;
      row.visible_order_count = row.total_orders;
    }
    rotation = (rotation + ordersThisHour) % menuSize;
  }

  return out;
}

function resolveSnapshotOrderTotal({
  boardOrderTotal = null,
  unlimitedOrders = false,
  shiftSeed = 0,
  menuRecipeCount = 0
} = {}) {
  if (unlimitedOrders) {
    const minOrders = TAKEOUT_SNAPSHOT_UNLIMITED_MIN_ORDERS;
    const maxOrders = TAKEOUT_SNAPSHOT_UNLIMITED_MAX_ORDERS;
    const span = Math.max(1, maxOrders - minOrders + 1);
    const seed = deriveShiftSeed([shiftSeed, boardOrderTotal, menuRecipeCount]);
    return minOrders + (seed % span);
  }

  const boardTotal = Math.floor(Number(boardOrderTotal) || 0);
  if (!Number.isFinite(boardTotal) || boardTotal <= 0) return TAKEOUT_SNAPSHOT_MIN_ORDERS;
  return Math.max(TAKEOUT_SNAPSHOT_MIN_ORDERS, Math.min(TAKEOUT_SNAPSHOT_MAX_ORDERS, boardTotal));
}

export function computeTakeoutRequiredIngredients(snapshot = [], recipes = {}) {
  const totals = {};

  for (const row of snapshot || []) {
    const recipeId = String(row?.recipe_id || "").trim();
    if (!recipeId) continue;
    const recipe = recipes?.[recipeId];
    const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
    const orderCount = Math.max(
      0,
      Math.floor(Number(row?.total_orders ?? row?.visible_order_count ?? 0) || 0)
    );
    if (orderCount <= 0) continue;

    for (const ing of ingredients) {
      const itemId = String(ing?.item_id || "").trim();
      const qty = Math.max(0, Math.floor(Number(ing?.qty || 0) || 0));
      if (!itemId || qty <= 0) continue;
      totals[itemId] = (totals[itemId] ?? 0) + (qty * orderCount);
    }
  }

  return totals;
}

export function computeTakeoutOperatingCost(requiredIngredients = {}, { marketPrices = {}, items = {} } = {}) {
  let total = 0;
  for (const [itemId, qtyRaw] of Object.entries(requiredIngredients || {})) {
    const qty = Math.max(0, Math.floor(Number(qtyRaw || 0) || 0));
    if (qty <= 0) continue;
    const marketPrice = Number(marketPrices?.[itemId]);
    const basePrice = Number(items?.[itemId]?.base_price);
    const unitPrice = Number.isFinite(marketPrice) && marketPrice > 0
      ? marketPrice
      : (Number.isFinite(basePrice) && basePrice > 0 ? basePrice : 0);
    total += unitPrice * qty;
  }
  return Math.max(0, Math.floor(total));
}

function resolveIngredientUnitPrice(itemId, { marketPrices = {}, items = {} } = {}) {
  const marketPrice = Number(marketPrices?.[itemId]);
  const basePrice = Number(items?.[itemId]?.base_price);
  if (Number.isFinite(marketPrice) && marketPrice > 0) return marketPrice;
  if (Number.isFinite(basePrice) && basePrice > 0) return basePrice;
  return 0;
}

function resolveTakeoutOrderCoinValue(recipeId, {
  recipes = {},
  marketPrices = {},
  items = {}
} = {}) {
  const recipe = recipes?.[recipeId];
  const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
  let ingredientCost = 0;
  for (const ing of ingredients) {
    const itemId = String(ing?.item_id || "").trim();
    const qty = Math.max(0, Math.floor(Number(ing?.qty || 0) || 0));
    if (!itemId || qty <= 0) continue;
    ingredientCost += resolveIngredientUnitPrice(itemId, { marketPrices, items }) * qty;
  }

  const tierKey = String(recipe?.tier || "common").trim().toLowerCase();
  const mult = Number(TIER_PAYOUT_MULTIPLIERS[tierKey] ?? TIER_PAYOUT_MULTIPLIERS.common);
  const payout = Math.round(ingredientCost * mult);
  return Math.max(1, Number.isFinite(payout) ? payout : 1);
}

function consumeCoveredIngredients(coveredIngredients, recipeIngredients, orderCount) {
  const qtyToServe = Math.max(0, Math.floor(Number(orderCount || 0) || 0));
  if (qtyToServe <= 0) return 0;

  const required = [];
  for (const ing of recipeIngredients || []) {
    const itemId = String(ing?.item_id || "").trim();
    const qtyPerOrder = Math.max(0, Math.floor(Number(ing?.qty || 0) || 0));
    if (!itemId || qtyPerOrder <= 0) continue;
    required.push({ itemId, qtyPerOrder });
  }
  if (!required.length) return qtyToServe;

  let maxServable = qtyToServe;
  for (const req of required) {
    const available = Math.max(0, Math.floor(Number(coveredIngredients?.[req.itemId] || 0) || 0));
    const possible = Math.floor(available / req.qtyPerOrder);
    if (possible < maxServable) maxServable = possible;
  }

  if (maxServable <= 0) return 0;
  for (const req of required) {
    const needed = req.qtyPerOrder * maxServable;
    coveredIngredients[req.itemId] = Math.max(
      0,
      Math.floor(Number(coveredIngredients?.[req.itemId] || 0) || 0) - needed
    );
  }

  return maxServable;
}

export function processTakeoutCatchup(player, {
  now = nowTs(),
  recipes = {},
  marketPrices = {},
  items = {}
} = {}) {
  const takeout = ensureTakeoutState(player);
  const shift = takeout.shift;
  if (shift.status !== "active") {
    return { ok: true, processedHours: 0, earned: 0, completed: false, totalProcessedHours: 0 };
  }

  const startedAt = Number(shift.started_at || 0);
  const endsAt = Number(shift.ends_at || 0);
  if (!Number.isFinite(startedAt) || startedAt < 0 || !Number.isFinite(endsAt) || endsAt <= startedAt) {
    shift.status = "inactive";
    shift.last_tick_at = now;
    takeout.updated_at = now;
    return { ok: true, processedHours: 0, earned: 0, completed: true, totalProcessedHours: 0 };
  }

  const effectiveNow = Math.min(now, endsAt);
  const elapsedWholeHours = Math.max(0, Math.floor((effectiveNow - startedAt) / TAKEOUT_HOUR_MS));
  const maxProcessableHours = Math.min(TAKEOUT_SHIFT_DURATION_HOURS, elapsedWholeHours);
  const prevProcessedHours = Math.max(0, Math.floor(Number(shift.last_processed_hour_index || 0) || 0));
  if (prevProcessedHours >= maxProcessableHours) {
    const completed = maxProcessableHours >= TAKEOUT_SHIFT_DURATION_HOURS || now >= endsAt;
    if (completed) shift.status = "inactive";
    shift.last_tick_at = now;
    takeout.updated_at = now;
    return { ok: true, processedHours: 0, earned: 0, completed, totalProcessedHours: maxProcessableHours };
  }

  const coveredIngredients = shift.covered_ingredients && typeof shift.covered_ingredients === "object"
    ? shift.covered_ingredients
    : {};
  shift.covered_ingredients = coveredIngredients;

  const snapshot = Array.isArray(shift.idle_order_board_snapshot)
    ? shift.idle_order_board_snapshot
    : [];
  let earned = 0;

  for (let hour = prevProcessedHours; hour < maxProcessableHours; hour += 1) {
    for (const row of snapshot) {
      const recipeId = String(row?.recipe_id || "").trim();
      if (!recipeId) continue;

      const hourly = Array.isArray(row?.hourly_order_counts) ? row.hourly_order_counts : [];
      const orderCount = Math.max(0, Math.floor(Number(hourly[hour] || 0) || 0));
      if (orderCount <= 0) continue;

      const recipe = recipes?.[recipeId];
      const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
      const served = consumeCoveredIngredients(coveredIngredients, ingredients, orderCount);
      if (served <= 0) continue;

      const perOrderCoins = resolveTakeoutOrderCoinValue(recipeId, { recipes, marketPrices, items });
      earned += perOrderCoins * served;

      // Keep snapshot demand in sync with idle catch-up so served orders are not re-servable.
      const remainingVisible = Math.max(0, Math.floor(Number(row?.visible_order_count || 0) || 0) - served);
      row.visible_order_count = remainingVisible;

      if (!player.lifetime || typeof player.lifetime !== "object") player.lifetime = {};
      player.lifetime.bowls_served_total = (Number(player.lifetime.bowls_served_total) || 0) + served;
      player.lifetime.orders_served = (Number(player.lifetime.orders_served) || 0) + served;
    }
  }

  const earnedSafe = Math.max(0, Math.floor(Number(earned || 0) || 0));
  takeout.earned_unclaimed_coins = Math.max(
    0,
    Math.floor(Number(takeout.earned_unclaimed_coins || 0) || 0) + earnedSafe
  );
  shift.last_processed_hour_index = maxProcessableHours;
  shift.last_tick_at = now;

  const completed = maxProcessableHours >= TAKEOUT_SHIFT_DURATION_HOURS || now >= endsAt;
  if (completed) shift.status = "inactive";

  takeout.updated_at = now;

  return {
    ok: true,
    processedHours: Math.max(0, maxProcessableHours - prevProcessedHours),
    earned: earnedSafe,
    completed,
    totalProcessedHours: maxProcessableHours
  };
}

export function isTakeoutShiftActive(player, now = nowTs()) {
  const takeout = ensureTakeoutState(player);
  if (takeout.shift.status !== "active") return false;

  const endsAt = Number(takeout.shift.ends_at || 0);
  if (!Number.isFinite(endsAt) || endsAt <= 0) return false;
  return now < endsAt;
}

export function finishTakeoutShiftIfEnded(player, now = nowTs()) {
  const takeout = ensureTakeoutState(player);
  const shift = takeout.shift;
  if (shift.status !== "active") return false;

  const endsAt = Number(shift.ends_at || 0);
  if (!Number.isFinite(endsAt) || endsAt <= 0 || now < endsAt) return false;

  shift.status = "inactive";
  shift.last_tick_at = now;
  takeout.updated_at = now;
  return true;
}

export function openTakeoutShift(player, {
  now = nowTs(),
  snapshot = null,
  snapshotOrderTotal = null,
  requiredIngredients = null,
  coveredIngredients = null,
  operatingCost = null,
  operatingCostMarker = null
} = {}) {
  const takeout = ensureTakeoutState(player);

  // End stale active shifts first so players can immediately start a new 12h run.
  finishTakeoutShiftIfEnded(player, now);

  if (isTakeoutShiftActive(player, now)) {
    return { ok: false, reason: "shift_active" };
  }

  const startedAt = now;
  const endsAt = startedAt + TAKEOUT_SHIFT_DURATION_MS;
  const normalizedSnapshot = Array.isArray(snapshot)
    ? snapshot
    : buildTakeoutShiftSnapshot(takeout.menu_recipe_ids, { totalOrders: snapshotOrderTotal });
  const normalizedRequiredIngredients = requiredIngredients && typeof requiredIngredients === "object"
    ? { ...requiredIngredients }
    : {};
  const normalizedCoveredIngredients = coveredIngredients && typeof coveredIngredients === "object"
    ? { ...coveredIngredients }
    : { ...normalizedRequiredIngredients };

  takeout.shift = {
    status: "active",
    started_at: startedAt,
    ends_at: endsAt,
    last_processed_hour_index: 0,
    last_tick_at: startedAt,
    operating_cost_paid_marker: operatingCostMarker ?? null,
    operating_cost: Math.max(0, Math.floor(Number(operatingCost || 0) || 0)),
    required_ingredients: normalizedRequiredIngredients,
    covered_ingredients: normalizedCoveredIngredients,
    idle_order_board_snapshot: normalizedSnapshot
  };
  if (!Number.isFinite(Number(takeout.first_shift_started_at || 0)) || Number(takeout.first_shift_started_at || 0) <= 0) {
    takeout.first_shift_started_at = startedAt;
  }
  takeout.updated_at = now;

  return {
    ok: true,
    startedAt,
    endsAt
  };
}

export function startTakeoutShiftWithCoverage(player, {
  now = nowTs(),
  boardOrderTotal = null,
  unlimitedOrders = false,
  recipes = {},
  marketPrices = {},
  items = {}
} = {}) {
  const takeout = ensureTakeoutState(player);
  const menuRecipeIds = Array.isArray(takeout.menu_recipe_ids) ? [...takeout.menu_recipe_ids] : [];

  if (menuRecipeIds.length <= 0) {
    return { ok: false, reason: "menu_not_set" };
  }

  const snapshotOrderTotal = resolveSnapshotOrderTotal({
    boardOrderTotal,
    unlimitedOrders,
    shiftSeed: now,
    menuRecipeCount: menuRecipeIds.length
  });
  const snapshot = buildTakeoutShiftSnapshot(menuRecipeIds, { totalOrders: snapshotOrderTotal });
  const requiredIngredients = computeTakeoutRequiredIngredients(snapshot, recipes);
  const operatingCost = computeTakeoutOperatingCost(requiredIngredients, { marketPrices, items });
  const playerCoins = Math.max(0, Math.floor(Number(player?.coins || 0) || 0));

  if (playerCoins < operatingCost) {
    return {
      ok: false,
      reason: "insufficient_coins",
      snapshotOrderTotal,
      operatingCost,
      requiredIngredients,
      snapshot
    };
  }

  player.coins = playerCoins - operatingCost;

  const openResult = openTakeoutShift(player, {
    now,
    snapshot,
    snapshotOrderTotal,
    requiredIngredients,
    coveredIngredients: requiredIngredients,
    operatingCost,
    operatingCostMarker: `takeout_shift:${now}`
  });
  if (!openResult.ok) {
    player.coins = playerCoins;
    return {
      ...openResult,
      snapshotOrderTotal,
      operatingCost,
      requiredIngredients,
      snapshot
    };
  }

  return {
    ok: true,
    startedAt: openResult.startedAt,
    endsAt: openResult.endsAt,
    snapshotOrderTotal,
    operatingCost,
    requiredIngredients,
    snapshot
  };
}

export function setTakeoutMenu(player, { menuRecipeIds = [], learnedRecipeIds = [], now = nowTs() } = {}) {
  const takeout = ensureTakeoutState(player);
  const normalizedMenu = normalizeTakeoutMenuSelection({ selectedRecipeIds: menuRecipeIds, learnedRecipeIds });

  const limits = getTakeoutMenuLimits(learnedRecipeIds.length);
  if (limits.learned <= 0) {
    return { ok: false, reason: "no_learned_recipes", limits, menuRecipeIds: [] };
  }

  if (normalizedMenu.length < limits.minRequired) {
    return { ok: false, reason: "menu_too_small", limits, menuRecipeIds: normalizedMenu };
  }

  if (normalizedMenu.length > limits.maxAllowed) {
    return { ok: false, reason: "menu_too_large", limits, menuRecipeIds: normalizedMenu };
  }

  takeout.menu_recipe_ids = normalizedMenu;
  takeout.updated_at = now;

  return { ok: true, limits, menuRecipeIds: [...normalizedMenu] };
}

export function claimTakeoutEarnings(player, { now = nowTs() } = {}) {
  const takeout = ensureTakeoutState(player);
  const amount = Math.max(0, Math.floor(Number(takeout.earned_unclaimed_coins) || 0));
  if (amount <= 0) {
    return { ok: false, reason: "nothing_to_claim", amount: 0 };
  }

  player.coins = (Number(player.coins) || 0) + amount;
  if (!player.lifetime || typeof player.lifetime !== "object") player.lifetime = {};
  player.lifetime.coins_earned = (Number(player.lifetime.coins_earned) || 0) + amount;

  takeout.earned_unclaimed_coins = 0;
  takeout.updated_at = now;

  return { ok: true, amount };
}
