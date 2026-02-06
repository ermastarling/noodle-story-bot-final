import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { loadBadgesContent, loadContentBundle, loadSettingsCatalog, loadStaffContent, loadUpgradesContent } from "../content/index.js";
import { buildSettingsMap } from "../settings/resolve.js";
import { newServerState } from "../game/server.js";
import { newPlayerProfile } from "../game/player.js";
import { computeActiveSeason } from "../game/seasons.js";
import { generateOrderBoard } from "../game/orders.js";
import { computeServeRewards, applySxpLevelUp } from "../game/serve.js";
import { getAvailableRecipes } from "../game/resilience.js";
import { calculateCombinedEffects, calculateUpgradeCost, purchaseUpgrade } from "../game/upgrades.js";
import { calculateStaffEffects } from "../game/staff.js";
import { getQualityMultiplier, rollCookQuality } from "../game/cooking.js";
import { unlockBadges } from "../game/badges.js";
import { applyDiscovery, applyNpcDiscoveryBuff, rollRecipeDiscovery } from "../game/discovery.js";
import { makeStreamRng, rngBetween } from "../util/rng.js";
import { dayKeyUTC } from "../util/time.js";

const DEFAULTS = {
  days: 30,
  players: 100,
  ordersPerDay: 8,
  seed: 1337,
  startDate: "2026-01-01",
  output: "sim-output.json",
  onTimeChance: 0.7,
  upgradePurchasesPerDay: 2,
  upgradeSpendFraction: 0.8
};

function parseArgs(argv) {
  const out = { ...DEFAULTS };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const [key, value] = arg.split("=");
    if (!key?.startsWith("--")) continue;
    const name = key.slice(2);
    if (name === "days") out.days = Number(value);
    if (name === "players") out.players = Number(value);
    if (name === "orders-per-day") out.ordersPerDay = Number(value);
    if (name === "seed") out.seed = Number(value);
    if (name === "start") out.startDate = String(value);
    if (name === "output") out.output = String(value);
    if (name === "on-time") out.onTimeChance = Math.max(0, Math.min(1, Number(value)));
    if (name === "upgrade-purchases") out.upgradePurchasesPerDay = Math.max(0, Number(value));
    if (name === "upgrade-spend") out.upgradeSpendFraction = Math.max(0, Math.min(1, Number(value)));
  }
  return out;
}

function clampNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function buildPlayer(id) {
  const player = newPlayerProfile(id);
  if (!player.lifetime) player.lifetime = {};
  return player;
}

function pickOrders(rng, board, count) {
  if (!board.length || count <= 0) return [];
  const picks = [];
  const pool = [...board];
  while (pool.length && picks.length < count) {
    const idx = Math.floor(rng() * pool.length);
    picks.push(pool.splice(idx, 1)[0]);
  }
  return picks;
}

function serveOrder({ order, player, content, combinedEffects, dayTs, rng, onTimeChance, activeSeason, simSeed }) {
  const recipe = content.recipes?.[order.recipe_id];
  const isLimited = Boolean(order.is_limited_time);
  const speedWindowSeconds = order.speed_window_seconds ?? 120;

  const baseServeOffsetMs = Math.floor(rngBetween(rng, 2, 10) * 60 * 1000);
  const servedAtMs = dayTs + baseServeOffsetMs;
  let acceptedAtMs = servedAtMs - 5 * 60 * 1000;

  if (isLimited) {
    const onTime = rng() < onTimeChance;
    if (onTime) {
      acceptedAtMs = servedAtMs - Math.floor(rngBetween(rng, 0.2, 0.9) * speedWindowSeconds * 1000);
    } else {
      acceptedAtMs = servedAtMs - Math.floor(rngBetween(rng, 1.1, 2.0) * speedWindowSeconds * 1000);
    }
  }

  const rewards = computeServeRewards({
    serverId: "sim-server",
    tier: order.tier,
    npcArchetype: order.npc_archetype,
    isLimitedTime: isLimited,
    servedAtMs,
    acceptedAtMs,
    speedWindowSeconds,
    player,
    recipe,
    content,
    effects: combinedEffects
  });

  const quality = rollCookQuality(rng, player, combinedEffects, null);
  const qualityMult = getQualityMultiplier(quality);
  rewards.coins = Math.floor(rewards.coins * qualityMult);
  rewards.rep = Math.floor(rewards.rep * qualityMult);
  rewards.sxp = Math.floor(rewards.sxp * qualityMult);

  player.coins = clampNumber(player.coins, 0) + rewards.coins;
  player.rep = clampNumber(player.rep, 0) + rewards.rep;
  player.sxp_total = clampNumber(player.sxp_total, 0) + rewards.sxp;
  player.sxp_progress = clampNumber(player.sxp_progress, 0) + rewards.sxp;

  applySxpLevelUp(player);

  if (!player.lifetime) player.lifetime = {};
  player.lifetime.orders_served = clampNumber(player.lifetime.orders_served, 0) + 1;
  player.lifetime.bowls_served_total = clampNumber(player.lifetime.bowls_served_total, 0) + 1;
  player.lifetime.coins_earned = clampNumber(player.lifetime.coins_earned, 0) + rewards.coins;

  if (!player.lifetime.npc_seen) player.lifetime.npc_seen = {};
  player.lifetime.npc_seen[order.npc_archetype] = true;

  if (quality !== "salvage") {
    applyNpcDiscoveryBuff(player, order.npc_archetype);
    const discoveryRng = makeStreamRng({
      mode: "seeded",
      seed: simSeed,
      streamName: "sim-discovery",
      serverId: "sim-server",
      dayKey: dayKeyUTC(servedAtMs),
      extra: order.order_id
    });
    const discoveries = rollRecipeDiscovery({
      player,
      content,
      npcArchetype: order.npc_archetype,
      tier: order.tier,
      rng: discoveryRng,
      activeSeason
    });

    for (const discovery of discoveries ?? []) {
      applyDiscovery(player, discovery, content, discoveryRng);
    }
  }
}

function findAffordableUpgrades(player, upgradesContent, budget) {
  const entries = Object.entries(upgradesContent.upgrades ?? {});
  const options = [];

  for (const [upgradeId, upgrade] of entries) {
    const currentLevel = player.upgrades?.[upgradeId] ?? 0;
    if (currentLevel >= upgrade.max_level) continue;
    const cost = calculateUpgradeCost(upgrade, currentLevel);
    if (cost <= 0 || cost > budget) continue;
    options.push({ upgradeId, cost });
  }

  options.sort((a, b) => a.cost - b.cost);
  return options;
}

function purchaseUpgrades({ player, upgradesContent, rng, maxPurchases, spendFraction }) {
  if (maxPurchases <= 0) return;
  const budget = Math.floor((player.coins ?? 0) * spendFraction);
  let remaining = Math.min(player.coins ?? 0, budget);
  let purchases = 0;

  while (purchases < maxPurchases) {
    const options = findAffordableUpgrades(player, upgradesContent, remaining);
    if (!options.length) break;

    const cheapest = options.filter((opt) => opt.cost === options[0].cost);
    const pick = cheapest[Math.floor(rng() * cheapest.length)];
    const result = purchaseUpgrade(player, pick.upgradeId, upgradesContent);
    if (!result?.success) break;

    remaining = Math.max(0, remaining - result.cost);
    purchases += 1;
  }
}

function simulateDay({
  dayIndex,
  dayTs,
  settings,
  content,
  badgesContent,
  players,
  rng,
  ordersPerDay,
  onTimeChance,
  upgradePurchasesPerDay,
  upgradeSpendFraction,
  upgradesContent,
  staffContent
}) {
  const dayKey = dayKeyUTC(dayTs);
  const season = computeActiveSeason(settings, dayTs);

  for (const player of players) {
    const availableRecipes = new Set(getAvailableRecipes(player));
    if (!availableRecipes.size) continue;

    const board = generateOrderBoard({
      serverId: "sim-server",
      dayKey,
      settings,
      content,
      activeSeason: season,
      playerRecipePool: availableRecipes,
      player
    });

    const playerRng = makeStreamRng({
      mode: "seeded",
      seed: dayIndex + 1,
      streamName: "sim-orders",
      serverId: "sim-server",
      dayKey,
      userId: player.user_id
    });

    const picks = pickOrders(playerRng, board, ordersPerDay);
    if (!picks.length) continue;

    const combinedEffects = calculateCombinedEffects(player, upgradesContent, staffContent, calculateStaffEffects);

    for (const order of picks) {
      serveOrder({
        order,
        player,
        content,
        combinedEffects,
        dayTs,
        rng: playerRng,
        onTimeChance,
        activeSeason: season,
        simSeed: dayIndex + 1
      });
    }

    unlockBadges(player, badgesContent);
    purchaseUpgrades({
      player,
      upgradesContent,
      rng: playerRng,
      maxPurchases: upgradePurchasesPerDay,
      spendFraction: upgradeSpendFraction
    });
  }

  return { dayKey, season };
}

function summarizePlayers(players) {
  const stats = players.map((player) => ({
    userId: player.user_id,
    coins: player.coins ?? 0,
    rep: player.rep ?? 0,
    level: player.shop_level ?? 1,
    sxpTotal: player.sxp_total ?? 0,
    bowlsServed: player.lifetime?.bowls_served_total ?? 0,
    recipesKnown: player.known_recipes?.length ?? 0,
    upgradesTotal: Object.values(player.upgrades ?? {}).reduce((sum, v) => sum + (v || 0), 0)
  }));

  const sum = (key) => stats.reduce((acc, p) => acc + (p[key] ?? 0), 0);
  const min = (key) => Math.min(...stats.map((p) => p[key] ?? 0));
  const max = (key) => Math.max(...stats.map((p) => p[key] ?? 0));
  const avg = (key) => (stats.length ? sum(key) / stats.length : 0);

  return {
    count: stats.length,
    coins: { avg: avg("coins"), min: min("coins"), max: max("coins") },
    rep: { avg: avg("rep"), min: min("rep"), max: max("rep") },
    level: { avg: avg("level"), min: min("level"), max: max("level") },
    sxpTotal: { avg: avg("sxpTotal"), min: min("sxpTotal"), max: max("sxpTotal") },
    bowlsServed: { avg: avg("bowlsServed"), min: min("bowlsServed"), max: max("bowlsServed") },
    recipesKnown: { avg: avg("recipesKnown"), min: min("recipesKnown"), max: max("recipesKnown") },
    upgradesTotal: { avg: avg("upgradesTotal"), min: min("upgradesTotal"), max: max("upgradesTotal") },
    players: stats
  };
}

function main() {
  const config = parseArgs(process.argv);
  const content = loadContentBundle(1);
  const settingsCatalog = loadSettingsCatalog();
  const settings = buildSettingsMap(settingsCatalog, {});
  const badgesContent = loadBadgesContent();
  const upgradesContent = loadUpgradesContent();
  const staffContent = loadStaffContent();

  const serverState = newServerState("sim-server");
  serverState.settings = settings;

  const players = [];
  for (let i = 0; i < config.players; i += 1) {
    players.push(buildPlayer(`sim-user-${i + 1}`));
  }

  const startTs = Date.parse(config.startDate + "T00:00:00Z");
  const rng = makeStreamRng({ mode: "seeded", seed: config.seed, streamName: "sim-run" });

  const dayResults = [];
  for (let day = 0; day < config.days; day += 1) {
    const dayTs = startTs + day * 24 * 60 * 60 * 1000;
    const result = simulateDay({
      dayIndex: day,
      dayTs,
      settings,
      content,
      badgesContent,
      players,
      rng,
      ordersPerDay: config.ordersPerDay,
      onTimeChance: config.onTimeChance,
      upgradePurchasesPerDay: config.upgradePurchasesPerDay,
      upgradeSpendFraction: config.upgradeSpendFraction,
      upgradesContent,
      staffContent
    });
    dayResults.push(result);
  }

  const summary = summarizePlayers(players);
  const output = {
    config,
    days: dayResults,
    summary
  };

  const outPath = path.resolve(process.cwd(), config.output);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Simulation complete. Wrote ${outPath}`);
  console.log(`Avg coins: ${summary.coins.avg.toFixed(2)} | Avg level: ${summary.level.avg.toFixed(2)} | Avg rep: ${summary.rep.avg.toFixed(2)}`);
}

main();
