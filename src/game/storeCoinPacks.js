export const STORE_COIN_PACKS = Object.freeze({
  coin_pack_099: Object.freeze({
    id: "coin_pack_099",
    priceUsd: 0.99,
    priceLabel: "$0.99",
    coins: 10_000
  }),
  coin_pack_199: Object.freeze({
    id: "coin_pack_199",
    priceUsd: 1.99,
    priceLabel: "$1.99",
    coins: 25_000
  }),
  coin_pack_499: Object.freeze({
    id: "coin_pack_499",
    priceUsd: 4.99,
    priceLabel: "$4.99",
    coins: 100_000
  })
});

const DEFAULT_COIN_PACK_SKU_MAP = Object.freeze({
  // Chef's Coin Crate - 10,000c
  "1511191985644507336": "coin_pack_099",
  // Brothkeeper's Savings - 25,000c
  "1511192707119321109": "coin_pack_199",
  // Greedy Noodle Goblin Hoard - 100,000c
  "1511192852288376884": "coin_pack_499"
});

const VALID_COIN_PACK_IDS = new Set(Object.keys(STORE_COIN_PACKS));

function parseCoinPackMap(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([externalId, coinPackId]) => [String(externalId), String(coinPackId).trim().toLowerCase()])
        .filter(([, coinPackId]) => VALID_COIN_PACK_IDS.has(coinPackId))
    );
  } catch {
    const pairs = raw.split(",").map((entry) => entry.trim()).filter(Boolean);
    const mapped = {};
    for (const pair of pairs) {
      const [externalId, coinPackIdRaw] = pair.split(":").map((part) => String(part || "").trim());
      const coinPackId = coinPackIdRaw.toLowerCase();
      if (!externalId || !VALID_COIN_PACK_IDS.has(coinPackId)) continue;
      mapped[externalId] = coinPackId;
    }
    return mapped;
  }
}

const ENV_COIN_PACK_SKU_MAP = parseCoinPackMap(process.env.NOODLE_COIN_PACK_SKU_MAP);
const ENV_COIN_PACK_PRODUCT_MAP = parseCoinPackMap(process.env.NOODLE_COIN_PACK_PRODUCT_MAP);

export function getStoreCoinPack(coinPackId) {
  if (!coinPackId) return null;
  const packId = String(coinPackId).trim().toLowerCase();
  return STORE_COIN_PACKS[packId] ?? null;
}

export function resolveStoreCoinPackIdFromSku(skuId) {
  if (!skuId) return null;
  const id = String(skuId);
  return ENV_COIN_PACK_SKU_MAP[id] ?? DEFAULT_COIN_PACK_SKU_MAP[id] ?? null;
}

export function resolveStoreCoinPackIdFromProduct(productId) {
  if (!productId) return null;
  return ENV_COIN_PACK_PRODUCT_MAP[String(productId)] ?? null;
}

export function resolveStoreCoinPackIdFromMetadata(metadata = {}) {
  const directCandidates = [
    metadata?.coin_pack_id,
    metadata?.coin_pack,
    metadata?.coin_pack_key,
    metadata?.pack_id
  ];
  for (const candidate of directCandidates) {
    const pack = getStoreCoinPack(candidate);
    if (pack) return pack.id;
  }

  const mappedCandidates = [
    metadata?.product_id,
    metadata?.spec_id,
    metadata?.sku_id,
    metadata?.sku,
    metadata?.item_id
  ];
  for (const candidate of mappedCandidates) {
    const mapped = resolveStoreCoinPackIdFromProduct(candidate);
    if (mapped) return mapped;
  }

  return null;
}

export function grantStoreCoinPack({ player, coinPackId } = {}) {
  if (!player || typeof player !== "object") {
    return { ok: false, reason: "Missing player." };
  }

  const pack = getStoreCoinPack(coinPackId);
  if (!pack) {
    return { ok: false, reason: "Coin pack not found." };
  }

  const coinsToGrant = Math.max(0, Math.floor(Number(pack.coins || 0) || 0));
  if (coinsToGrant <= 0) {
    return { ok: false, reason: "Coin pack is invalid." };
  }

  player.coins = (Number(player.coins) || 0) + coinsToGrant;
  if (!player.lifetime || typeof player.lifetime !== "object") player.lifetime = {};
  player.lifetime.coins_earned = (Number(player.lifetime.coins_earned) || 0) + coinsToGrant;

  return {
    ok: true,
    coinPackId: pack.id,
    coinsGranted: coinsToGrant,
    pack
  };
}
