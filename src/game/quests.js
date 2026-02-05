import { dayKeyUTC, nowTs } from "../util/time.js";
import { makeStreamRng, weightedPick } from "../util/rng.js";
import { applySxpLevelUp } from "./serve.js";

function ensureQuestState(player) {
  if (!player.quests) player.quests = { active: {}, completed: [], claimed: [] };
  if (!player.quests.active) player.quests.active = {};
  if (!player.quests.completed) player.quests.completed = [];
  if (!player.quests.claimed) player.quests.claimed = [];
  return player.quests;
}

function getWeekKey(ts) {
  const date = new Date(ts);
  const day = date.getUTCDay();
  const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), diff));
  return dayKeyUTC(monday.getTime());
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
    progress: 0,
    reward: rewards,
    assigned_at: nowTs(),
    completed_at: null,
    claimed_at: null
  };
}

export function ensureQuests(player, questsContent, userId, now = nowTs()) {
  const quests = ensureQuestState(player);
  const counts = questsContent?.counts ?? { daily: 3, weekly: 2, story: 0, seasonal: 0 };
  const multipliers = questsContent?.cadence_multipliers ?? { daily: 1, weekly: 2.5, story: 4, seasonal: 3 };
  const templates = questsContent?.quests ?? [];

  const dailyKey = dayKeyUTC(now);
  if (quests.daily_day !== dailyKey) {
    quests.daily_day = dailyKey;
    // Clear previous daily quests
    for (const [id, quest] of Object.entries(quests.active)) {
      if (quest.cadence === "daily") delete quests.active[id];
    }
    const dailyTemplates = templates.filter((q) => q.cadence === "daily");
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
    const weeklyTemplates = templates.filter((q) => q.cadence === "weekly");
    const rng = makeStreamRng({ mode: "seeded", seed: 2021, streamName: "quests-weekly", serverId: userId, dayKey: weekKey });
    const picks = pickQuestTemplates(rng, weeklyTemplates, counts.weekly || 0);
    for (const template of picks) {
      const instanceId = `${template.quest_id}:${weekKey}`;
      const reward = applyRewardMultiplier(template.reward ?? {}, multipliers.weekly ?? 1);
      quests.active[instanceId] = createQuestInstance(template, instanceId, "weekly", reward);
    }
  }

  return quests;
}

export function applyQuestProgress(player, questsContent, userId, event, now = nowTs()) {
  const quests = ensureQuests(player, questsContent, userId, now);
  const updated = [];
  const amount = Math.max(0, Number(event.amount ?? 1));

  for (const quest of Object.values(quests.active)) {
    if (quest.type !== event.type) continue;
    if (quest.completed_at) continue;

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

export function getQuestSummary(player, questsContent, userId, now = nowTs()) {
  const quests = ensureQuests(player, questsContent, userId, now);
  const active = Object.values(quests.active);
  return { active };
}
