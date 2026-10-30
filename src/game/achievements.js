import { applySxpLevelUp } from "./serve.js";
import { nowTs } from "../util/time.js";

const ACHIEVEMENT_NOTICE_LIMIT = 50;
export const ACHIEVEMENTS_PER_PAGE = 10;

function getByPath(source, path) {
  return String(path ?? "").split(".").reduce((value, key) => value?.[key], source);
}

function matchesCriteria(player, criteria) {
  const threshold = Number(criteria?.threshold);
  const value = getByPath(player, criteria.path);
  if (criteria.type === "array_includes") {
    return Array.isArray(value) && value.includes(criteria.value);
  }
  if (!Number.isSafeInteger(threshold) || threshold < 1) return false;
  if (criteria.type === "metric") return Number(value) >= threshold;
  if (criteria.type === "array_length") return Array.isArray(value) && value.length >= threshold;
  if (criteria.type === "distinct") return value && typeof value === "object" && Object.keys(value).length >= threshold;
  return false;
}

export function validateAchievementsContent(content) {
  if (!Array.isArray(content?.achievements)) {
    throw new Error("Achievements content must include an achievements array");
  }
  const ids = new Set();
  for (const achievement of content.achievements) {
    const id = String(achievement?.achievement_id ?? "").trim();
    if (!id || ids.has(id)) throw new Error("Achievement IDs must be non-empty and unique");
    ids.add(id);
    const threshold = Number(achievement?.criteria?.threshold);
    const criteriaValid = achievement?.criteria?.type === "array_includes"
      ? String(achievement?.criteria?.value ?? "").trim().length > 0
      : Number.isSafeInteger(threshold) && threshold >= 1;
    if (!achievement?.name || !achievement?.description || !criteriaValid
      || !["metric", "array_length", "distinct", "array_includes"].includes(achievement?.criteria?.type)
      || !String(achievement?.criteria?.path ?? "").trim()) {
      throw new Error(`Invalid achievement definition: ${id}`);
    }
    const reward = achievement?.reward ?? {};
    const rewardTypes = ["coins", "sxp", "rep"].filter((key) => reward[key] !== undefined);
    if (!rewardTypes.length || rewardTypes.some((key) => !Number.isSafeInteger(Number(reward[key])) || Number(reward[key]) < 1)) {
      throw new Error(`Invalid achievement reward: ${id}`);
    }
  }
  return content.achievements;
}

function queueAchievementNotice(player, notice) {
  player.notifications ??= {};
  if (!Array.isArray(player.notifications.pending_v2_notice_cards)) {
    player.notifications.pending_v2_notice_cards = [];
  }
  player.notifications.pending_v2_notice_cards.push(notice);
  if (player.notifications.pending_v2_notice_cards.length > ACHIEVEMENT_NOTICE_LIMIT) {
    player.notifications.pending_v2_notice_cards = player.notifications.pending_v2_notice_cards.slice(-ACHIEVEMENT_NOTICE_LIMIT);
  }
}

export function evaluatePlayerAchievements(player, content, now = nowTs()) {
  const definitions = validateAchievementsContent(content);
  player.achievements ??= {};
  const achievements = player.achievements;
  if (!achievements.unlocked || typeof achievements.unlocked !== "object" || Array.isArray(achievements.unlocked)) {
    achievements.unlocked = {};
  }
  if (!Array.isArray(achievements.claimed_ids)) achievements.claimed_ids = [];
  const isFirstEvaluation = !Number.isFinite(Number(achievements.initialized_at));
  const createdAt = Number(player.created_at || now);
  const isRetroactive = isFirstEvaluation && now - createdAt > 24 * 60 * 60 * 1000;
  const unlocked = [];

  for (const definition of definitions) {
    if (achievements.unlocked[definition.achievement_id] || !matchesCriteria(player, definition.criteria)) continue;
    achievements.unlocked[definition.achievement_id] = { unlocked_at: now };
    unlocked.push(definition);
  }

  if (isRetroactive && unlocked.length) {
    queueAchievementNotice(player, {
      title: "Achievement rewards can be claimed!",
      details: ["Congrats! You already have achievement rewards ready to claim. Run `/noodle achievements` to see them!"],
      tone: "info"
    });
  } else {
    for (const achievement of unlocked) {
      queueAchievementNotice(player, {
        title: `Achievement unlocked: ${achievement.name}`,
        details: [achievement.description, "Congrats! Run `/noodle achievements` to claim your reward!"],
        tone: "success"
      });
    }
  }

  if (isFirstEvaluation) achievements.initialized_at = now;
  return { unlocked, retroactiveNotice: Boolean(isRetroactive && unlocked.length) };
}

export function getVisibleAchievements(player, content) {
  const definitions = validateAchievementsContent(content);
  const unlocked = player?.achievements?.unlocked ?? {};
  return definitions.filter((achievement) => !achievement.secret || unlocked[achievement.achievement_id]);
}

export function hasClaimableAchievementRewards(player, content = null) {
  const unlocked = player?.achievements?.unlocked;
  if (!unlocked || typeof unlocked !== "object" || Array.isArray(unlocked)) return false;
  const claimed = new Set(Array.isArray(player?.achievements?.claimed_ids) ? player.achievements.claimed_ids : []);
  const currentIds = Array.isArray(content?.achievements)
    ? new Set(content.achievements.map((achievement) => achievement?.achievement_id).filter(Boolean))
    : null;
  return Object.keys(unlocked).some((achievementId) =>
    (!currentIds || currentIds.has(achievementId)) && !claimed.has(achievementId));
}

export function getAchievementPage(achievements, requestedPage, pageSize = ACHIEVEMENTS_PER_PAGE) {
  const entries = Array.isArray(achievements) ? achievements : [];
  const safePageSize = Math.max(1, Math.floor(Number(pageSize) || ACHIEVEMENTS_PER_PAGE));
  const totalPages = Math.max(1, Math.ceil(entries.length / safePageSize));
  const parsedPage = Number(requestedPage);
  const page = Number.isFinite(parsedPage)
    ? Math.max(0, Math.min(totalPages - 1, Math.floor(parsedPage)))
    : 0;
  const startIndex = page * safePageSize;

  return {
    page,
    totalPages,
    entries: entries.slice(startIndex, startIndex + safePageSize)
  };
}

export function claimAchievementReward(player, achievementId, content) {
  const definitions = validateAchievementsContent(content);
  const achievement = definitions.find((entry) => entry.achievement_id === achievementId);
  if (!achievement) return { ok: false, reason: "not_found" };
  const state = player?.achievements;
  if (!state?.unlocked?.[achievementId]) return { ok: false, reason: "not_unlocked" };
  state.claimed_ids ??= [];
  if (state.claimed_ids.includes(achievementId)) return { ok: false, reason: "already_claimed" };

  const reward = achievement.reward;
  if (reward.coins) {
    player.coins = (Number(player.coins) || 0) + reward.coins;
    player.lifetime ??= {};
    player.lifetime.coins_earned = (Number(player.lifetime.coins_earned) || 0) + reward.coins;
  }
  if (reward.rep) player.rep = (Number(player.rep) || 0) + reward.rep;
  if (reward.sxp) {
    player.sxp_total = (Number(player.sxp_total) || 0) + reward.sxp;
    player.sxp_progress = (Number(player.sxp_progress) || 0) + reward.sxp;
    applySxpLevelUp(player);
  }
  state.claimed_ids.push(achievementId);
  return { ok: true, achievement, reward };
}
