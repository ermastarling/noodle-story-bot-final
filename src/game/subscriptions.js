export const SUBSCRIPTION_PERKS = Object.freeze({
  HOUSE_247: "house_247",
  TAKEOUT_COUNTER: "takeout_counter"
});

export const SUBSCRIPTION_MONTHLY_COIN_GRANT = 50_000;
export const ORDER_ACCEPT_CAP_BASE = 5;
export const ORDER_ACCEPT_CAP_HOUSE_247 = 500;
export const HOUSE_247_VOTE_DURATION_MS = 12 * 60 * 60 * 1000;

const KNOWN_PERKS = new Set(Object.values(SUBSCRIPTION_PERKS));
const PAID_SUBSCRIPTION_PERKS = new Set([SUBSCRIPTION_PERKS.TAKEOUT_COUNTER]);
const MONTHLY_COIN_GRANT_PERKS = new Set([SUBSCRIPTION_PERKS.TAKEOUT_COUNTER]);

function defaultPerkState() {
  return {
    active: false,
    entitlement_id: null,
    period_start_at: null,
    period_end_at: null,
    last_coin_grant_period: null,
    last_coin_grant_at: null,
    last_event_type: null,
    last_event_at: null,
    updated_at: null
  };
}

export function createDefaultSubscriptionState() {
  return {
    perks: {
      [SUBSCRIPTION_PERKS.HOUSE_247]: defaultPerkState(),
      [SUBSCRIPTION_PERKS.TAKEOUT_COUNTER]: defaultPerkState()
    }
  };
}

function parseSkuMap(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([sku, perk]) => [String(sku), String(perk).trim().toLowerCase()])
        .filter(([, perk]) => PAID_SUBSCRIPTION_PERKS.has(perk))
    );
  } catch {
    const pairs = raw.split(",").map((entry) => entry.trim()).filter(Boolean);
    const mapped = {};
    for (const pair of pairs) {
      const [sku, perk] = pair.split(":").map((part) => String(part || "").trim());
      if (!sku || !perk) continue;
      const perkId = perk.toLowerCase();
      if (!PAID_SUBSCRIPTION_PERKS.has(perkId)) continue;
      mapped[sku] = perkId;
    }
    return mapped;
  }
}

const ENV_SKU_MAP = parseSkuMap(process.env.NOODLE_SUBSCRIPTION_SKU_MAP);

export function resolveSubscriptionPerkId(skuId) {
  if (!skuId) return null;
  return ENV_SKU_MAP[String(skuId)] ?? null;
}

function ensureVoteRewardState(player) {
  if (!player || typeof player !== "object") return null;
  if (!player.vote_rewards || typeof player.vote_rewards !== "object" || Array.isArray(player.vote_rewards)) {
    player.vote_rewards = {
      pending_claims: 0,
      last_vote_at: null,
      last_claim_at: null,
      last_webhook_at: null,
      sources: {},
      house_247_expires_at: null
    };
  }
  return player.vote_rewards;
}

export function getHouse247VoteExpiry(player) {
  const voteRewards = ensureVoteRewardState(player);
  const expiresAt = Number(voteRewards?.house_247_expires_at || 0);
  return Number.isFinite(expiresAt) && expiresAt > 0 ? Math.floor(expiresAt) : null;
}

export function hasHouse247VoteAccess(player, now = Date.now()) {
  const expiresAt = getHouse247VoteExpiry(player);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return false;
  return Number(now) < expiresAt;
}

export function grantHouse247VoteAccess(player, {
  now = Date.now(),
  durationMs = HOUSE_247_VOTE_DURATION_MS
} = {}) {
  const voteRewards = ensureVoteRewardState(player);
  const duration = Math.max(0, Math.floor(Number(durationMs) || 0));
  if (duration <= 0) return getHouse247VoteExpiry(player);

  const currentExpiry = Number(voteRewards?.house_247_expires_at || 0);
  const startAt = Number.isFinite(currentExpiry) && currentExpiry > Number(now)
    ? currentExpiry
    : Number(now);
  const nextExpiry = Math.floor(startAt + duration);
  voteRewards.house_247_expires_at = nextExpiry;
  return nextExpiry;
}

function normalizeTimestamp(value) {
  if (value == null || value === "") return null;

  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) {
    // Treat small numeric values as epoch seconds.
    if (asNumber > 0 && asNumber < 1_000_000_000_000) {
      return Math.floor(asNumber * 1000);
    }
    return Math.floor(asNumber);
  }

  const asDate = Date.parse(String(value));
  if (!Number.isFinite(asDate)) return null;
  return Math.floor(asDate);
}

function normalizePeriodMarker(value) {
  const ts = normalizeTimestamp(value);
  return Number.isFinite(ts) ? String(ts) : null;
}

export function resolveSubscriptionBillingPeriodKey({ periodStartAt = null, periodEndAt = null, now = Date.now() } = {}) {
  const startMarker = normalizePeriodMarker(periodStartAt);
  if (startMarker) return `start:${startMarker}`;

  const endMarker = normalizePeriodMarker(periodEndAt);
  if (endMarker) return `end:${endMarker}`;

  const date = new Date(Number.isFinite(Number(now)) ? Number(now) : Date.now());
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `month:${y}-${m}`;
}

export function ensureSubscriptionState(player) {
  if (!player || typeof player !== "object") return createDefaultSubscriptionState();

  if (!player.subscriptions || typeof player.subscriptions !== "object" || Array.isArray(player.subscriptions)) {
    player.subscriptions = createDefaultSubscriptionState();
    return player.subscriptions;
  }

  if (!player.subscriptions.perks || typeof player.subscriptions.perks !== "object" || Array.isArray(player.subscriptions.perks)) {
    player.subscriptions.perks = {};
  }

  for (const perkId of KNOWN_PERKS) {
    const existing = player.subscriptions.perks[perkId];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      player.subscriptions.perks[perkId] = defaultPerkState();
      continue;
    }

    player.subscriptions.perks[perkId] = {
      ...defaultPerkState(),
      ...existing
    };
  }

  return player.subscriptions;
}

export function hasActivePerk(player, perkId, now = Date.now()) {
  const perkKey = String(perkId || "").trim().toLowerCase();
  if (!KNOWN_PERKS.has(perkKey)) return false;

  const subscriptions = ensureSubscriptionState(player);
  const perkState = subscriptions.perks[perkKey];
  if (!perkState?.active) return false;

  const periodEndAt = normalizeTimestamp(perkState.period_end_at);
  if (!Number.isFinite(periodEndAt)) return true;
  return now < periodEndAt;
}

export function hasUnlimitedMarketStock(player, now = Date.now()) {
  return hasHouse247VoteAccess(player, now)
    || hasActivePerk(player, SUBSCRIPTION_PERKS.HOUSE_247, now);
}

export function getOrderAcceptCap(player, now = Date.now()) {
  return hasUnlimitedMarketStock(player, now)
    ? ORDER_ACCEPT_CAP_HOUSE_247
    : ORDER_ACCEPT_CAP_BASE;
}

export function applySubscriptionEntitlementEvent(player, {
  perkId,
  eventType,
  entitlementId = null,
  periodStartAt = null,
  periodEndAt = null,
  now = Date.now()
} = {}) {
  const perkKey = String(perkId || "").trim().toLowerCase();
  if (!KNOWN_PERKS.has(perkKey)) {
    return { ok: false, reason: "unknown_perk", changed: false };
  }

  const type = String(eventType || "").trim().toUpperCase();
  if (!type) {
    return { ok: false, reason: "missing_event_type", changed: false };
  }

  const subscriptions = ensureSubscriptionState(player);
  const perkState = subscriptions.perks[perkKey];
  const before = JSON.stringify(perkState);

  const normalizedStartAt = normalizeTimestamp(periodStartAt);
  const normalizedEndAt = normalizeTimestamp(periodEndAt);

  if (type === "ENTITLEMENT_CREATE" || type === "ENTITLEMENT_UPDATE") {
    perkState.active = true;
    if (entitlementId) perkState.entitlement_id = String(entitlementId);
    if (Number.isFinite(normalizedStartAt)) perkState.period_start_at = normalizedStartAt;
    if (Number.isFinite(normalizedEndAt)) perkState.period_end_at = normalizedEndAt;
  } else if (type === "ENTITLEMENT_DELETE") {
    perkState.active = false;
    if (Number.isFinite(normalizedEndAt)) {
      perkState.period_end_at = normalizedEndAt;
    } else {
      perkState.period_end_at = now;
    }
  } else {
    return { ok: false, reason: "unsupported_event_type", changed: false };
  }

  perkState.last_event_type = type;
  perkState.last_event_at = now;
  perkState.updated_at = now;

  const changed = before !== JSON.stringify(perkState);

  return {
    ok: true,
    changed,
    perkId: perkKey,
    eventType: type,
    active: hasActivePerk(player, perkKey, now),
    state: { ...perkState }
  };
}

export function applyMonthlySubscriptionCoinGrant(player, {
  perkId,
  periodStartAt = null,
  periodEndAt = null,
  coins = SUBSCRIPTION_MONTHLY_COIN_GRANT,
  now = Date.now()
} = {}) {
  const perkKey = String(perkId || "").trim().toLowerCase();
  if (!KNOWN_PERKS.has(perkKey)) {
    return { ok: false, reason: "unknown_perk", granted: false, amount: 0 };
  }

  if (!MONTHLY_COIN_GRANT_PERKS.has(perkKey)) {
    return {
      ok: true,
      granted: false,
      amount: 0,
      perkId: perkKey,
      billingPeriodKey: resolveSubscriptionBillingPeriodKey({ periodStartAt, periodEndAt, now })
    };
  }

  const grantAmount = Math.max(0, Math.floor(Number(coins) || 0));
  if (grantAmount <= 0) {
    return { ok: false, reason: "invalid_grant_amount", granted: false, amount: 0 };
  }

  const subscriptions = ensureSubscriptionState(player);
  const perkState = subscriptions.perks[perkKey];
  const billingPeriodKey = resolveSubscriptionBillingPeriodKey({ periodStartAt, periodEndAt, now });

  if (String(perkState.last_coin_grant_period || "") === billingPeriodKey) {
    return {
      ok: true,
      granted: false,
      amount: 0,
      perkId: perkKey,
      billingPeriodKey
    };
  }

  player.coins = (Number(player.coins) || 0) + grantAmount;
  if (!player.lifetime || typeof player.lifetime !== "object") player.lifetime = {};
  player.lifetime.coins_earned = (Number(player.lifetime.coins_earned) || 0) + grantAmount;

  perkState.last_coin_grant_period = billingPeriodKey;
  perkState.last_coin_grant_at = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  perkState.updated_at = perkState.last_coin_grant_at;

  return {
    ok: true,
    granted: true,
    amount: grantAmount,
    perkId: perkKey,
    billingPeriodKey
  };
}
