import fs from "fs";
import path from "path";

import { performance } from "perf_hooks";
import {
  loadBadgesContent,
  loadContentBundle,
  loadEventsContent,
  loadQuestsContent,
  loadSettingsCatalog,
  loadStaffContent,
  loadUpgradesContent
} from "../content/index.js";
import { withEventRecipes } from "../game/events.js";
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
import { rollForageDrops, applyDropsToInventory } from "../game/forage.js";
import { rollMarket, rollPlayerMarketStock } from "../game/market.js";
import { ensureQuests, applyQuestProgress, claimCompletedQuests } from "../game/quests.js";
import { makeStreamRng, rngBetween } from "../util/rng.js";
import { dayKeyUTC } from "../util/time.js";

const DEFAULTS = {
  days: 30,
  players: 100,
  guilds: 5,
  ordersPerDay: 150,
  seed: 1337,
  startDate: "2026-01-01",
  output: "sim-output.json",
  onTimeChance: 0.7,
  upgradeSpendFraction: 1.0,
  includeEvents: 1,
  seasonMode: "rolling_days"
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
    if (name === "guilds") out.guilds = Number(value);
    if (name === "orders-per-day") out.ordersPerDay = Number(value);
    if (name === "seed") out.seed = Number(value);
    if (name === "start") out.startDate = String(value);
    if (name === "output") out.output = String(value);
    if (name === "on-time") out.onTimeChance = Math.max(0, Math.min(1, Number(value)));
    if (name === "upgrade-spend") out.upgradeSpendFraction = Math.max(0, Math.min(1, Number(value)));
    if (name === "include-events") out.includeEvents = Number(value) ? 1 : 0;
    if (name === "season-mode") out.seasonMode = String(value);
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

function createMetrics() {
  return new Map();
}

function recordMetric(metrics, name, durationMs) {
  const entry = metrics.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 };
  entry.count += 1;
  entry.totalMs += durationMs;
  entry.maxMs = Math.max(entry.maxMs, durationMs);
  metrics.set(name, entry);
}

function timeSection(metrics, name, fn) {
  const start = performance.now();
  const result = fn();
  const durationMs = performance.now() - start;
  recordMetric(metrics, name, durationMs);
  return result;
}

function summarizeMetrics(metrics) {
  const out = {};
  for (const [name, entry] of metrics.entries()) {
    out[name] = {
      count: entry.count,
      avgMs: entry.count ? entry.totalMs / entry.count : 0,
      maxMs: entry.maxMs
    };
  }
  return out;
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

function serveOrder({ order, player, content, combinedEffects, dayTs, rng, onTimeChance, activeSeason, activeEventId, simSeed }) {
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

  const quality = rollCookQuality(rng, player, combinedEffects, null, order.tier);
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
      activeSeason,
      activeEventId
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

function purchaseUpgrades({ player, upgradesContent, rng, spendFraction }) {
  const budget = Math.floor((player.coins ?? 0) * spendFraction);
  let remaining = Math.min(player.coins ?? 0, budget);
  const tried = new Set();

  while (remaining > 0) {
    const options = findAffordableUpgrades(player, upgradesContent, remaining).filter(opt => !tried.has(opt.upgradeId));
    if (!options.length) break;

    const cheapest = options.filter((opt) => opt.cost === options[0].cost);
    const pick = cheapest[Math.floor(rng() * cheapest.length)];
    const result = purchaseUpgrade(player, pick.upgradeId, upgradesContent);
    if (!result?.success) {
      tried.add(pick.upgradeId);
      continue;
    }

    remaining = Math.max(0, remaining - result.cost);
  }
}

function simulateDay({
  dayIndex,
  dayTs,
  settings,
  content,
  badgesContent,
  questsContent,
  players,
  rng: _rng,
  ordersPerDay,
  onTimeChance,
  upgradeSpendFraction,
  upgradesContent,
  staffContent,
  metrics,
  serverStates
}) {
  const dayKey = dayKeyUTC(dayTs);
  const season = computeActiveSeason(settings, dayTs);

  for (const [serverId, serverState] of serverStates.entries()) {
    timeSection(metrics, "market_roll", () => rollMarket({ serverId, content, serverState, eventEffects: null }));
  }

  for (const { player, serverId } of players) {
    const availableRecipes = new Set(getAvailableRecipes(player));
    if (!availableRecipes.size) continue;

    const serverState = serverStates?.get(serverId) || null;
    const activeEventId = serverState?.active_event_id ?? null;
    if (serverState) serverState.season = season;

    const storyAnchor = serverState?.active_event_id ? `story:${serverState.active_event_id}` : "story:default";
    const seasonAnchor = season ?? "seasonal:default";
    timeSection(metrics, "quests_assign", () => ensureQuests(player, questsContent, player.user_id, dayTs, { storyKey: storyAnchor, seasonKey: seasonAnchor }));

    const forageDrops = timeSection(metrics, "forage", () =>
      rollForageDrops({ serverId, userId: player.user_id, picks: 2 })
    );
    timeSection(metrics, "forage_apply", () => applyDropsToInventory(player, forageDrops));
    applyQuestProgress(player, questsContent, player.user_id, { type: "forage", amount: 1 }, dayTs);

    timeSection(metrics, "market_stock", () =>
      rollPlayerMarketStock({
        userId: player.user_id,
        serverId,
        content,
        playerState: player,
        eventEffects: null,
        orderCountHint: ordersPerDay,
        baseOrders: 100
      })
    );

    const prices = serverState?.market_prices || {};
    const affordable = Object.entries(prices)
      .filter(([itemId, price]) => (player.market_stock?.[itemId] ?? 0) > 0 && price > 0 && (player.coins ?? 0) >= price)
      .sort((a, b) => a[1] - b[1]);

    if (affordable.length) {
      const [buyItemId, price] = affordable[0];
      const purchaseResult = applyDropsToInventory(player, { [buyItemId]: 1 });
      if (purchaseResult?.status !== "blocked") {
        player.coins = Math.max(0, (player.coins ?? 0) - price);
        player.market_stock[buyItemId] = Math.max(0, (player.market_stock[buyItemId] ?? 0) - 1);
        applyQuestProgress(player, questsContent, player.user_id, { type: "buy", amount: 1 }, dayTs);
      }
    }

    const board = timeSection(metrics, "order_board", () =>
      generateOrderBoard({
        serverId,
        dayKey,
        settings,
        content,
        activeSeason: season,
        playerRecipePool: availableRecipes,
        player,
        activeEventId
      })
    );

    const playerRng = makeStreamRng({
      mode: "seeded",
      seed: dayIndex + 1,
      streamName: "sim-orders",
      serverId,
      dayKey,
      userId: player.user_id
    });

    const picks = pickOrders(playerRng, board, ordersPerDay);
    if (!picks.length) continue;

    const combinedEffects = calculateCombinedEffects(player, upgradesContent, staffContent, calculateStaffEffects);

    for (const order of picks) {
      timeSection(metrics, "serve_order", () =>
        serveOrder({
          order,
          player,
          content,
          combinedEffects,
          dayTs,
          rng: playerRng,
          onTimeChance,
          activeSeason: season,
          activeEventId,
          simSeed: dayIndex + 1
        })
      );
      applyQuestProgress(player, questsContent, player.user_id, { type: "serve", amount: 1 }, dayTs);
    }

    timeSection(metrics, "unlock_badges", () => unlockBadges(player, badgesContent));
    timeSection(metrics, "purchase_upgrades", () =>
      purchaseUpgrades({
        player,
        upgradesContent,
        rng: playerRng,
        spendFraction: upgradeSpendFraction
      })
    );

    claimCompletedQuests(player);
  }

  return { dayKey, season };
}

function summarizePlayers(players) {
  const stats = players.map(({ player }) => ({
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
  const baseContent = loadContentBundle(1);
  const eventsContent = loadEventsContent();
  const content = config.includeEvents ? withEventRecipes(baseContent, eventsContent) : baseContent;
  const settingsCatalog = loadSettingsCatalog();
  const settings = buildSettingsMap(settingsCatalog, {});
  settings.SEASON_MODE = config.seasonMode || settings.SEASON_MODE;
  const badgesContent = loadBadgesContent();
  const upgradesContent = loadUpgradesContent();
  const staffContent = loadStaffContent();
  const questsContent = loadQuestsContent();
  const metrics = createMetrics();

  const guildCount = Math.max(1, Number(config.guilds) || DEFAULTS.guilds);
  const guildIds = Array.from({ length: guildCount }, (_, i) => `sim-guild-${i + 1}`);
  const serverStates = new Map();
  for (const gid of guildIds) {
    const serverState = newServerState(gid);
    serverState.settings = settings;
    if (config.includeEvents && eventsContent?.events?.length) {
      serverState.active_event_id = eventsContent.events[0]?.event_id ?? null;
    }
    serverStates.set(gid, serverState);
  }

  const players = [];
  for (let i = 0; i < config.players; i += 1) {
    const serverId = guildIds[i % guildIds.length];
    players.push({ player: buildPlayer(`sim-user-${i + 1}`), serverId });
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
      questsContent,
      players,
      rng,
      ordersPerDay: config.ordersPerDay,
      onTimeChance: config.onTimeChance,
      upgradeSpendFraction: config.upgradeSpendFraction,
      upgradesContent,
      staffContent,
      metrics,
      serverStates
    });
    dayResults.push(result);
  }

  const summary = summarizePlayers(players);
  const output = {
    config,
    days: dayResults,
    summary,
    metrics: summarizeMetrics(metrics)
  };

  const outPath = path.resolve(process.cwd(), config.output);
  timeSection(metrics, "output_write", () => fs.writeFileSync(outPath, JSON.stringify(output, null, 2)));
  console.log(`Simulation complete. Wrote ${outPath}`);
  console.log(`Avg coins: ${summary.coins.avg.toFixed(2)} | Avg level: ${summary.level.avg.toFixed(2)} | Avg rep: ${summary.rep.avg.toFixed(2)}`);
  console.log(`Metrics (avg ms):`, Object.fromEntries(Object.entries(output.metrics).map(([k, v]) => [k, v.avgMs.toFixed(3)])));
}

main();
