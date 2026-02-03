import { makeStreamRng, rngBetween } from "../util/rng.js";
import { dayKeyUTC } from "../util/time.js";

const MARKET_ROLL_MIN = 0.85;
const MARKET_ROLL_MAX = 1.15;
const SELL_RATE = 0.60;
const PRICE_MIN = 1;

// ✅ Market pool: guarantees these are available daily (if present in content.items)
export const MARKET_ITEM_IDS = [
  // Broths & Bases
  "broth_soy",
  "broth_ginger",
  "broth_butter",
  "broth_sweet_soy",
  "broth_chicken",
  "broth_rich_stock",
  "broth_chili",
  "broth_light",
  "broth_beef",
  "broth_mixed",
  "broth_herbal",
  "broth_miso",
  "broth_black_garlic",
  "broth_shio",
  "broth_citrus_infused",
  "broth_glowing_miso",
  "broth_fire",
  "broth_floral",
  "broth_sakura",
  "broth_chilled_citrus",
  "broth_pumpkin",
  "broth_creamy_hearth",

  // Noodles
  "noodles_wheat",
  "noodles_soft",
  "noodles_thin",
  "noodles_egg",
  "noodles_thick",
  "noodles_ramen",
  "noodles_udon",
  "noodles_chunky",
  "noodles_fine",
  "noodles_hand_pulled",
  "noodles_spiced",

  // Toppings
  "topping_chili_flakes",
  "topping_extra_broth",
  "topping_roasted_pork",

  // Spices
  "spice_sesame_oil",
  "spice_chili_oil"
];

// Helper: integer between [min,max] using your rng stream
function rngInt(rng, min, max) {
  if (max <= min) return min;
  return min + Math.floor(rng() * (max - min + 1));
}

export function rollMarket({ serverId, content, serverState }) {
  const dayKey = dayKeyUTC();
  if (
  serverState.market_day === dayKey &&
  serverState.market_prices
) return serverState;

  const rng = makeStreamRng({ mode:"seeded", seed:12345, streamName:"market", serverId, dayKey });
  const prices = {};

  // ✅ Roll only the explicitly-allowed market items
  for (const itemId of MARKET_ITEM_IDS) {
    const item = content.items?.[itemId];
    if (!item) continue; // if content missing, skip safely

    // Require base_price to price it; if missing, skip (or set a fallback here)
    if (!item.base_price) continue;

    const price = Math.max(
      PRICE_MIN,
      Math.floor(item.base_price * rngBetween(rng, MARKET_ROLL_MIN, MARKET_ROLL_MAX))
    );
    prices[itemId] = price;
  }

  serverState.market_day = dayKey;
  serverState.market_prices = prices;
  serverState.market_specials = [];
  serverState.market_wanted = [];
  return serverState;
}

// Roll per-player market stock (called once per day per player)
export function rollPlayerMarketStock({ userId, serverId, content, playerState }) {
  const dayKey = dayKeyUTC();
  const hasStock = playerState.market_stock && Object.values(playerState.market_stock).some((qty) => Number(qty) > 0);
  
  if (playerState.market_stock_day === dayKey && hasStock) {
    return playerState;
  }

  const rng = makeStreamRng({ mode:"seeded", seed:54321, streamName:"player_market", serverId, userId, dayKey });
  const stock = {};

  for (const itemId of MARKET_ITEM_IDS) {
    const item = content.items?.[itemId];
    if (!item || !item.base_price) continue;

    // Stock defaults with higher minimum (100-150 instead of 10-40)
    const min = item.stock_min ?? 100;
    const max = item.stock_max ?? 150;
    if (max <= 0) continue;
    
    const qty = rngInt(rng, min, max);
    stock[itemId] = qty;
  }

  playerState.market_stock = stock;
  playerState.market_stock_day = dayKey;
  return playerState;
}

export function sellPrice(serverState, itemId) {
  const p = serverState.market_prices?.[itemId] ?? 0;
  return Math.floor(p * SELL_RATE);
}
