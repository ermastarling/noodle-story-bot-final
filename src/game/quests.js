import { dayKeyUTC, nowTs } from "../util/time.js";
import { makeStreamRng, weightedPick } from "../util/rng.js";
import { applySxpLevelUp } from "./serve.js";

const LEGACY_SEASONAL_TIER_QUEST_IDS = new Set([
  "seasonal_lantern_service",
  "seasonal_bowl_batch",
  "seasonal_shared_table",
  "seasonal_coin_rush"
]);

function ensureQuestState(player) {
  if (!player.quests) player.quests = { active: {}, completed: [], claimed: [] };
  if (!player.quests.active) player.quests.active = {};
  if (!player.quests.completed) player.quests.completed = [];
  if (!player.quests.claimed) player.quests.claimed = [];
  if (!("daily_day" in player.quests)) player.quests.daily_day = null;
  if (!("weekly_week" in player.quests)) player.quests.weekly_week = null;
  if (!("monthly_month" in player.quests)) player.quests.monthly_month = null;
  if (!("story_key" in player.quests)) player.quests.story_key = null;
  if (!("seasonal_key" in player.quests)) player.quests.seasonal_key = null;
  if (!player.quests.quest_options) player.quests.quest_options = {};
  if (!player.quests.weekly_reset_v2) {
    for (const [id, quest] of Object.entries(player.quests.active)) {
      if (quest?.cadence === "weekly") delete player.quests.active[id];
    }
    player.quests.weekly_week = null;
    player.quests.weekly_reset_v2 = true;
  }
  return player.quests;
}

function getWeekKey(ts) {
  const date = new Date(ts);
  const day = date.getUTCDay();
  const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), diff));
  return dayKeyUTC(monday.getTime());
}

function getMonthKey(ts) {
  const date = new Date(ts);
  const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  return dayKeyUTC(monthStart.getTime());
}

function buildWeightedPool(templates) {
  return Object.fromEntries(
    templates.map((q) => [q.quest_id, Math.max(0.01, Number(q.weight ?? 1))])
  );
}

function pickQuestTemplates(rng, templates, count) {
  const chosen = [];
  const pool = new Map(templates.map((q) => [q.quest_id, q]));
  while (chosen.length < count && pool.size > 0) {
    const weights = Object.fromEntries(
      [...pool.values()].map((q) => [q.quest_id, Math.max(0.01, Number(q.weight ?? 1))])
    );
    const pickId = weightedPick(rng, weights);
    const pick = pool.get(pickId);
    if (!pick) break;
    chosen.push(pick);
    pool.delete(pickId);
  }
  return chosen;
}

function applyRewardMultiplier(reward, mult) {
  return {
    coins: Math.floor((reward.coins || 0) * mult),
    sxp: Math.floor((reward.sxp || 0) * mult),
    rep: Math.floor((reward.rep || 0) * mult)
  };
}

function createQuestInstance(template, instanceId, cadence, rewards) {
  return {
    instance_id: instanceId,
    quest_id: template.quest_id,
    name: template.name,
    description: template.description,
    cadence,
    type: template.type,
    target: template.target,
    requires_recipe_tier: template.requires_recipe_tier ?? null,
    requires_npc_archetypes: Array.isArray(template.requires_npc_archetypes)
      ? [...template.requires_npc_archetypes]
      : null,
    progress: 0,
    reward: rewards,
    min_shop_level: template.min_shop_level ?? null,
    assigned_at: nowTs(),
    completed_at: null,
    claimed_at: null
  };
}

function getProgressAmountForQuest(quest, event, defaultAmount) {
  let amount = defaultAmount;

  const requiredNpcs = Array.isArray(quest?.requires_npc_archetypes)
    ? quest.requires_npc_archetypes.filter(Boolean)
    : [];
  if (requiredNpcs.length > 0) {
    const npcAmounts = event?.npcAmounts ?? null;
    if (npcAmounts) {
      amount = requiredNpcs.reduce((sum, npcId) => sum + Math.max(0, Number(npcAmounts[npcId] ?? 0)), 0);
    } else if (event?.npcArchetype) {
      amount = requiredNpcs.includes(event.npcArchetype) ? amount : 0;
    } else {
      amount = 0;
    }
  }

  const requiredTier = quest?.requires_recipe_tier ?? (LEGACY_SEASONAL_TIER_QUEST_IDS.has(quest?.quest_id) ? "seasonal" : null);
  if (!requiredTier) return amount;

  const tierAmounts = event?.tierAmounts ?? null;
  if (tierAmounts && Object.prototype.hasOwnProperty.call(tierAmounts, requiredTier)) {
    return Math.max(0, Number(tierAmounts[requiredTier] ?? 0));
  }

  const eventTier = event?.recipeTier ?? null;
  if (eventTier) {
    return eventTier === requiredTier ? amount : 0;
  }

  return 0;
}

function trimCadenceQuestsInPlace(questsState, cadence, keepCount) {
  if (!questsState?.active) return;
  const active = Object.entries(questsState.active)
    .filter(([, q]) => q?.cadence === cadence)
    .map(([id, q]) => ({ id, quest: q }));

  if (active.length <= keepCount) return;

  const scoreQuestRetention = (quest) => {
    if (quest?.completed_at && !quest?.claimed_at) return 3;
    if (!quest?.completed_at && (quest?.progress ?? 0) > 0) return 2;
    return 1;
  };

  active.sort((a, b) => {
    const scoreDiff = scoreQuestRetention(b.quest) - scoreQuestRetention(a.quest);
    if (scoreDiff !== 0) return scoreDiff;

    const aTarget = Math.max(1, Number(a.quest?.target ?? 1));
    const bTarget = Math.max(1, Number(b.quest?.target ?? 1));
    const aRatio = Math.max(0, Number(a.quest?.progress ?? 0)) / aTarget;
    const bRatio = Math.max(0, Number(b.quest?.progress ?? 0)) / bTarget;
    if (bRatio !== aRatio) return bRatio - aRatio;

    const aAssigned = Number(a.quest?.assigned_at ?? 0);
    const bAssigned = Number(b.quest?.assigned_at ?? 0);
    if (aAssigned !== bAssigned) return aAssigned - bAssigned;

    return a.id.localeCompare(b.id);
  });

  const toDrop = active.slice(keepCount);
  for (const entry of toDrop) {
    delete questsState.active[entry.id];
  }
}

function isQuestTemplateEligible(template, playerLevel) {
  const minLevel = Number(template.min_shop_level ?? 0);
  if (Number.isFinite(minLevel) && minLevel > 0 && playerLevel < minLevel) return false;

  const maxLevel = Number(template.max_shop_level ?? 0);
  if (Number.isFinite(maxLevel) && maxLevel > 0 && playerLevel > maxLevel) return false;

  return true;
}

export function ensureQuests(player, questsContent, userId, now = nowTs(), options = {}) {
  const quests = ensureQuestState(player);
  const counts = questsContent?.counts ?? { daily: 3, weekly: 2, monthly: 1, story: 0, seasonal: 0 };
  const multipliers = questsContent?.cadence_multipliers ?? { daily: 1, weekly: 2.5, monthly: 4, story: 4, seasonal: 3 };
  const templates = questsContent?.quests ?? [];
  const playerLevel = player?.shop_level ?? 1;
  const savedOptions = quests.quest_options ?? {};
  const storyKeyInput = options.storyKey ?? savedOptions.storyKey ?? null;
  const seasonalKeyInput = options.seasonKey ?? savedOptions.seasonKey ?? null;
  const storyKey = storyKeyInput ?? (quests.story_key ?? "story:default");
  const seasonalKey = seasonalKeyInput ?? (quests.seasonal_key ?? "seasonal:default");

  const dailyKey = dayKeyUTC(now);
  if (quests.daily_day !== dailyKey) {
    quests.daily_day = dailyKey;
    // Clear previous daily quests
    for (const [id, quest] of Object.entries(quests.active)) {
      if (quest.cadence === "daily") delete quests.active[id];
    }
    const dailyTemplates = templates.filter((q) => q.cadence === "daily" && isQuestTemplateEligible(q, playerLevel));
    const rng = makeStreamRng({ mode: "seeded", seed: 1337, streamName: "quests", serverId: userId, dayKey: dailyKey });
    const picks = pickQuestTemplates(rng, dailyTemplates, counts.daily || 0);
    for (const template of picks) {
      const instanceId = `${template.quest_id}:${dailyKey}`;
      const reward = applyRewardMultiplier(template.reward ?? {}, multipliers.daily ?? 1);
      quests.active[instanceId] = createQuestInstance(template, instanceId, "daily", reward);
    }
  }

  const weekKey = getWeekKey(now);
  if (quests.weekly_week !== weekKey) {
    quests.weekly_week = weekKey;
    for (const [id, quest] of Object.entries(quests.active)) {
      if (quest.cadence === "weekly") delete quests.active[id];
    }
    const weeklyTemplates = templates.filter((q) => q.cadence === "weekly" && isQuestTemplateEligible(q, playerLevel));
    const rng = makeStreamRng({ mode: "seeded", seed: 2021, streamName: "quests-weekly", serverId: userId, dayKey: weekKey });
    const picks = pickQuestTemplates(rng, weeklyTemplates, counts.weekly || 0);
    for (const template of picks) {
      const instanceId = `${template.quest_id}:${weekKey}`;
      const reward = applyRewardMultiplier(template.reward ?? {}, multipliers.weekly ?? 1);
      quests.active[instanceId] = createQuestInstance(template, instanceId, "weekly", reward);
    }
  }

  const monthKey = getMonthKey(now);
  if (quests.monthly_month !== monthKey) {
    quests.monthly_month = monthKey;
    for (const [id, quest] of Object.entries(quests.active)) {
      if (quest.cadence === "monthly") delete quests.active[id];
    }
    const monthlyTemplates = templates.filter((q) => q.cadence === "monthly" && isQuestTemplateEligible(q, playerLevel));
    const rng = makeStreamRng({ mode: "seeded", seed: 3031, streamName: "quests-monthly", serverId: userId, dayKey: monthKey });
    const picks = pickQuestTemplates(rng, monthlyTemplates, counts.monthly || 0);
    for (const template of picks) {
      const instanceId = `${template.quest_id}:${monthKey}`;
      const reward = applyRewardMultiplier(template.reward ?? {}, multipliers.monthly ?? 1);
      quests.active[instanceId] = createQuestInstance(template, instanceId, "monthly", reward);
    }
  }

  const storyCount = Math.max(0, Number(counts.story ?? 0));
  if (storyCount <= 0) {
    if (quests.story_key !== null) {
      for (const [id, quest] of Object.entries(quests.active)) {
        if (quest.cadence === "story") delete quests.active[id];
      }
      quests.story_key = null;
    }
  } else {
    const storyTemplates = templates.filter((q) => q.cadence === "story" && isQuestTemplateEligible(q, playerLevel));
    const effectiveStoryCount = Math.min(storyCount, storyTemplates.length);
    if (storyTemplates.length > 0 && storyKey !== quests.story_key) {
      for (const [id, quest] of Object.entries(quests.active)) {
        if (quest.cadence === "story") delete quests.active[id];
      }
      const rng = makeStreamRng({ mode: "seeded", seed: 4041, streamName: "quests-story", serverId: userId, dayKey: storyKey });
      const picks = pickQuestTemplates(rng, storyTemplates, effectiveStoryCount);
      for (const template of picks) {
        const instanceId = `${template.quest_id}:${storyKey}`;
        const reward = applyRewardMultiplier(template.reward ?? {}, multipliers.story ?? 1);
        quests.active[instanceId] = createQuestInstance(template, instanceId, "story", reward);
      }
      quests.story_key = storyKey;
    } else if (storyTemplates.length > 0 && quests.story_key === storyKey) {
      // Backfill story quests for existing players when configured story count increases.
      const activeStoryQuests = Object.values(quests.active).filter((q) => q.cadence === "story");
      const missingStorySlots = Math.max(0, effectiveStoryCount - activeStoryQuests.length);
      if (missingStorySlots > 0) {
        const activeStoryIds = new Set(activeStoryQuests.map((q) => q.quest_id));
        const availableTemplates = storyTemplates.filter((q) => !activeStoryIds.has(q.quest_id));
        const rng = makeStreamRng({ mode: "seeded", seed: 4041, streamName: "quests-story-backfill", serverId: userId, dayKey: storyKey });
        const picks = pickQuestTemplates(rng, availableTemplates, missingStorySlots);
        for (const template of picks) {
          const instanceId = `${template.quest_id}:${storyKey}`;
          if (quests.active[instanceId]) continue;
          const reward = applyRewardMultiplier(template.reward ?? {}, multipliers.story ?? 1);
          quests.active[instanceId] = createQuestInstance(template, instanceId, "story", reward);
        }
      }

      // Trim extras when configured story count is reduced.
      trimCadenceQuestsInPlace(quests, "story", effectiveStoryCount);
    }
  }

  const seasonalCount = Math.max(0, Number(counts.seasonal ?? 0));
  if (seasonalCount <= 0) {
    if (quests.seasonal_key !== null) {
      for (const [id, quest] of Object.entries(quests.active)) {
        if (quest.cadence === "seasonal") delete quests.active[id];
      }
      quests.seasonal_key = null;
    }
  } else {
    const seasonalTemplates = templates.filter((q) => q.cadence === "seasonal" && isQuestTemplateEligible(q, playerLevel));
    if (seasonalTemplates.length > 0 && seasonalKey !== quests.seasonal_key) {
      for (const [id, quest] of Object.entries(quests.active)) {
        if (quest.cadence === "seasonal") delete quests.active[id];
      }
      const rng = makeStreamRng({ mode: "seeded", seed: 5051, streamName: "quests-seasonal", serverId: userId, dayKey: seasonalKey });
      const picks = pickQuestTemplates(rng, seasonalTemplates, seasonalCount);
      for (const template of picks) {
        const instanceId = `${template.quest_id}:${seasonalKey}`;
        const reward = applyRewardMultiplier(template.reward ?? {}, multipliers.seasonal ?? 1);
        quests.active[instanceId] = createQuestInstance(template, instanceId, "seasonal", reward);
      }
      quests.seasonal_key = seasonalKey;
    } else if (seasonalTemplates.length > 0 && quests.seasonal_key === seasonalKey) {
      // Backfill seasonal quests for existing players when configured seasonal count increases.
      const activeSeasonalQuests = Object.values(quests.active).filter((q) => q.cadence === "seasonal");
      const missingSeasonalSlots = Math.max(0, seasonalCount - activeSeasonalQuests.length);
      if (missingSeasonalSlots > 0) {
        const activeSeasonalIds = new Set(activeSeasonalQuests.map((q) => q.quest_id));
        const availableTemplates = seasonalTemplates.filter((q) => !activeSeasonalIds.has(q.quest_id));
        const rng = makeStreamRng({ mode: "seeded", seed: 5051, streamName: "quests-seasonal-backfill", serverId: userId, dayKey: seasonalKey });
        const picks = pickQuestTemplates(rng, availableTemplates, missingSeasonalSlots);
        for (const template of picks) {
          const instanceId = `${template.quest_id}:${seasonalKey}`;
          if (quests.active[instanceId]) continue;
          const reward = applyRewardMultiplier(template.reward ?? {}, multipliers.seasonal ?? 1);
          quests.active[instanceId] = createQuestInstance(template, instanceId, "seasonal", reward);
        }
      }

      // Trim extras when configured seasonal count is reduced.
      trimCadenceQuestsInPlace(quests, "seasonal", seasonalCount);
    }
  }

  quests.quest_options = { storyKey, seasonalKey };
  return quests;
}

export function applyQuestProgress(player, questsContent, userId, event, now = nowTs(), options = {}) {
  const quests = ensureQuests(player, questsContent, userId, now, options);
  const updated = [];
  const baseAmount = Math.max(0, Number(event.amount ?? 1));

  for (const quest of Object.values(quests.active)) {
    if (quest.type !== event.type) continue;
    if (quest.completed_at) continue;

    const amount = getProgressAmountForQuest(quest, event, baseAmount);
    if (amount <= 0) continue;

    quest.progress = Math.min(quest.target, (quest.progress || 0) + amount);
    if (quest.progress >= quest.target) {
      quest.completed_at = now;
      quests.completed.push(quest.instance_id);
      updated.push(quest);
    }
  }

  return updated;
}

export function claimCompletedQuests(player) {
  const quests = ensureQuestState(player);
  const claimed = [];

  for (const quest of Object.values(quests.active)) {
    if (!quest.completed_at || quest.claimed_at) continue;
    quest.claimed_at = nowTs();
    quests.claimed.push(quest.instance_id);

    const reward = quest.reward ?? {};
    player.coins = (player.coins || 0) + (reward.coins || 0);
    player.rep = (player.rep || 0) + (reward.rep || 0);
    player.sxp_total = (player.sxp_total || 0) + (reward.sxp || 0);
    player.sxp_progress = (player.sxp_progress || 0) + (reward.sxp || 0);

    if (!player.lifetime) player.lifetime = {};
    if (reward.coins) {
      player.lifetime.coins_earned = (player.lifetime.coins_earned || 0) + reward.coins;
    }

    claimed.push({ quest, reward });
  }

  const leveledUp = claimed.reduce((sum, entry) => sum + (entry.reward?.sxp ? applySxpLevelUp(player) : 0), 0);

  return { claimed, leveledUp };
}

export function getQuestSummary(player, questsContent, userId, now = nowTs(), options = {}) {
  const quests = ensureQuests(player, questsContent, userId, now, options);
  const active = Object.values(quests.active);
  return { active };
}
