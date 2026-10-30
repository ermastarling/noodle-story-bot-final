import { getPlayer, upsertPlayer } from "../db/index.js";
import { applyDiscovery, getDiscoverableRecipes } from "./discovery.js";
import { applySxpLevelUp } from "./serve.js";
import { nowTs } from "../util/time.js";

function normalizeReward(reward) {
  const type = String(reward?.type ?? "");
  const amount = Number(reward?.amount);
  if (!["coins", "rep", "sxp", "recipe_clue"].includes(type) || !Number.isSafeInteger(amount) || amount < 1) {
    throw new Error("Invalid counting milestone reward configuration");
  }
  if (reward.fallback) normalizeReward(reward.fallback);
  return { type, amount, fallback: reward.fallback ?? null };
}

export function validateCountingMilestoneConfig(config) {
  if (!Array.isArray(config?.milestones)) {
    throw new Error("Counting milestone configuration must include a milestones array");
  }
  const seenCounts = new Set();
  for (const entry of config.milestones) {
    if (!Number.isSafeInteger(entry?.count) || entry.count < 1 || seenCounts.has(entry.count)) {
      throw new Error("Counting milestone counts must be unique positive safe integers");
    }
    seenCounts.add(entry.count);
    normalizeReward(entry.reward);
  }
  return config.milestones;
}

function applyCountingReward(player, reward, content, milestone) {
  const normalized = normalizeReward(reward);
  if (normalized.type === "coins") {
    player.coins = (Number(player.coins) || 0) + normalized.amount;
    player.lifetime ??= {};
    player.lifetime.coins_earned = (Number(player.lifetime.coins_earned) || 0) + normalized.amount;
    return { type: normalized.type, amount: normalized.amount };
  }
  if (normalized.type === "rep") {
    player.rep = (Number(player.rep) || 0) + normalized.amount;
    return { type: normalized.type, amount: normalized.amount };
  }
  if (normalized.type === "sxp") {
    player.sxp_total = (Number(player.sxp_total) || 0) + normalized.amount;
    player.sxp_progress = (Number(player.sxp_progress) || 0) + normalized.amount;
    const levelsGained = applySxpLevelUp(player);
    return { type: normalized.type, amount: normalized.amount, levelsGained };
  }

  const recipes = getDiscoverableRecipes(player, content, { excludeCompletedClues: true })
    .filter((recipe) => !player.known_recipes?.includes(recipe.recipe_id))
    .sort((left, right) => left.recipe_id.localeCompare(right.recipe_id));
  if (!recipes.length) {
    return normalized.fallback
      ? applyCountingReward(player, normalized.fallback, content, milestone)
      : null;
  }
  const recipe = recipes[milestone % recipes.length];
  const outcome = applyDiscovery(player, {
    type: "clue",
    recipeId: recipe.recipe_id,
    recipeName: recipe.name
  }, content);
  if (!outcome || outcome.isDuplicate) return null;
  return {
    type: normalized.type,
    recipeId: recipe.recipe_id,
    recipeName: recipe.name,
    recipeUnlocked: Boolean(outcome.recipeUnlocked)
  };
}

export function grantCountingMilestoneReward(db, { guildId, channelId, userId, milestone, content }) {
  if (!db || !guildId || !channelId || !userId || !Number.isSafeInteger(milestone) || milestone < 1) {
    throw new Error("Invalid counting milestone grant context");
  }
  const getPending = db.prepare(`
    SELECT user_id, reward_json FROM counting_milestone_rewards
    WHERE guild_id = ? AND channel_id = ? AND milestone = ? AND status = 'pending'
  `);
  const markGranted = db.prepare(`
    UPDATE counting_milestone_rewards SET status = 'granted', granted_at = ?, result_json = ?
    WHERE guild_id = ? AND channel_id = ? AND milestone = ? AND status = 'pending'
  `);

  return db.transaction(() => {
    const pending = getPending.get(guildId, channelId, milestone);
    if (!pending) {
      return { status: "already_granted" };
    }
    if (pending.user_id !== userId) {
      return { status: "winner_mismatch", userId: pending.user_id, milestone };
    }
    const player = getPlayer(db, guildId, pending.user_id);
    if (!player) {
      return { status: "profile_missing", userId: pending.user_id, milestone };
    }
    const updatedPlayer = structuredClone(player);
    const reward = applyCountingReward(updatedPlayer, JSON.parse(pending.reward_json), content, milestone);
    if (!reward) {
      db.prepare(`
        UPDATE counting_milestone_rewards SET status = 'unavailable'
        WHERE guild_id = ? AND channel_id = ? AND milestone = ? AND status = 'pending'
      `).run(guildId, channelId, milestone);
      return { status: "unavailable" };
    }
    upsertPlayer(db, guildId, pending.user_id, updatedPlayer, null, updatedPlayer.schema_version);
    const result = markGranted.run(nowTs(), JSON.stringify(reward), guildId, channelId, milestone);
    if (result.changes !== 1) throw new Error("Counting milestone reward claim changed during grant");
    return { status: "granted", userId: pending.user_id, milestone, reward };
  })();
}

export function grantPendingCountingMilestoneRewards(db, content) {
  const pending = db.prepare(`
    SELECT guild_id AS guildId, channel_id AS channelId, milestone, user_id AS userId
    FROM counting_milestone_rewards
    WHERE status = 'pending'
    ORDER BY created_at
  `).all();
  const results = [];
  for (const row of pending) {
    results.push(grantCountingMilestoneReward(db, { ...row, content }));
  }
  return results;
}

export function markCountingMilestoneNoticeSent(db, { guildId, channelId, milestone }) {
  return db.prepare(`
    UPDATE counting_milestone_rewards SET notice_sent_at = ?
    WHERE guild_id = ? AND channel_id = ? AND milestone = ? AND status = 'granted' AND notice_sent_at IS NULL
  `).run(nowTs(), guildId, channelId, milestone).changes === 1;
}

export function getPendingCountingMilestoneNotices(db) {
  return db.prepare(`
    SELECT guild_id AS guildId, channel_id AS channelId, milestone, user_id AS userId, result_json AS resultJson
    FROM counting_milestone_rewards
    WHERE status = 'granted' AND notice_sent_at IS NULL AND result_json IS NOT NULL
    ORDER BY granted_at
  `).all().map((row) => ({ ...row, reward: JSON.parse(row.resultJson) }));
}

export function buildCountingRewardNotice({ userId, milestone, reward }) {
  let rewardDescription;
  if (reward.type === "recipe_clue") {
    rewardDescription = `a recipe clue for **${reward.recipeName}**`;
  } else if (reward.type === "coins") {
    rewardDescription = `**${reward.amount.toLocaleString()} coins**`;
  } else {
    rewardDescription = `**${reward.amount.toLocaleString()} ${reward.type.toUpperCase()}**`;
  }
  return `<@${userId}> reached the ${milestone} counting milestone and earned ${rewardDescription} for their Noodle Shop!`;
}
