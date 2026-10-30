import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { upsertPlayer, getPlayer } from "../src/db/index.js";
import { newPlayerProfile } from "../src/game/player.js";
import { applyCountingSubmission } from "../src/game/counting.js";
import {
  buildCountingRewardNotice,
  getPendingCountingMilestoneNotices,
  grantCountingMilestoneReward,
  grantPendingCountingMilestoneRewards,
  markCountingMilestoneNoticeSent,
  validateCountingMilestoneConfig
} from "../src/game/countingRewards.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function setupDb() {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(path.join(__dirname, "../src/db/schema.sql"), "utf8"));
  return db;
}

function queueReward(db, { userId, milestone, reward, guildId = "guild", channelId = "counting" }) {
  db.prepare(`
    INSERT INTO counting_milestone_rewards(guild_id, channel_id, milestone, user_id, reward_json, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(guildId, channelId, milestone, userId, JSON.stringify(reward), Date.now());
}

test("Counting milestone reward grants once and keeps a durable notice until sent", () => {
  const db = setupDb();
  try {
    const userId = "reward-coin-user";
    upsertPlayer(db, "guild", userId, newPlayerProfile(userId), null, 1);
    const startingCoins = getPlayer(db, "guild", userId).coins;
    queueReward(db, { userId, milestone: 10, reward: { type: "coins", amount: 250 } });

    const granted = grantCountingMilestoneReward(db, {
      guildId: "guild", channelId: "counting", userId, milestone: 10, content: { recipes: {} }
    });
    assert.deepEqual(granted, {
      status: "granted",
      userId,
      milestone: 10,
      reward: { type: "coins", amount: 250 }
    });
    assert.equal(getPlayer(db, "guild", userId).coins, startingCoins + 250);
    assert.deepEqual(grantCountingMilestoneReward(db, {
      guildId: "guild", channelId: "counting", userId, milestone: 10, content: { recipes: {} }
    }), { status: "already_granted" });
    assert.equal(getPlayer(db, "guild", userId).coins, startingCoins + 250);

    const [notice] = getPendingCountingMilestoneNotices(db);
    assert.equal(buildCountingRewardNotice(notice), `<@${userId}> reached the 10 counting milestone and earned **250 coins** for their Noodle Shop!`);
    assert.equal(markCountingMilestoneNoticeSent(db, notice), true);
    assert.equal(getPendingCountingMilestoneNotices(db).length, 0);
  } finally {
    db.close();
  }
});

test("Counting milestone grants recover pending rewards after restart", () => {
  const db = setupDb();
  try {
    const userId = "reward-recovery-user";
    upsertPlayer(db, "guild", userId, newPlayerProfile(userId), null, 1);
    queueReward(db, { userId, milestone: 25, reward: { type: "rep", amount: 10 } });

    assert.deepEqual(grantPendingCountingMilestoneRewards(db, { recipes: {} }), [{
      status: "granted",
      userId,
      milestone: 25,
      reward: { type: "rep", amount: 10 }
    }]);
    assert.equal(getPlayer(db, "guild", userId).rep, 10);
    assert.equal(grantPendingCountingMilestoneRewards(db, { recipes: {} }).length, 0);
  } finally {
    db.close();
  }
});

test("Counting recipe clue milestones only select recipes the player does not know", () => {
  const db = setupDb();
  try {
    const userId = "reward-clue-user";
    upsertPlayer(db, "guild", userId, newPlayerProfile(userId), null, 1);
    queueReward(db, { userId, milestone: 100, reward: { type: "recipe_clue", amount: 1 } });

    const content = {
      recipes: {
        unowned_recipe: {
          recipe_id: "unowned_recipe",
          name: "Unowned Noodle",
          tier: "common",
          ingredients: [{ item_id: "broth" }]
        }
      },
      items: {}
    };
    const granted = grantCountingMilestoneReward(db, {
      guildId: "guild", channelId: "counting", userId, milestone: 100, content
    });
    assert.equal(granted.status, "granted");
    assert.equal(granted.reward.type, "recipe_clue");
    assert.equal(granted.reward.recipeId, "unowned_recipe");
    assert.equal(getPlayer(db, "guild", userId).clues_owned.unowned_recipe.count, 1);
  } finally {
    db.close();
  }
});

test("Counting milestone configuration is recorded atomically with valid count", () => {
  const db = setupDb();
  try {
    const result = applyCountingSubmission(db, {
      guildId: "guild",
      channelId: "counting",
      userId: "milestone-user",
      messageId: "900",
      number: 1,
      milestoneRewards: [{ count: 1, reward: { type: "coins", amount: 10 } }]
    });

    test("Counting milestone config rejects duplicate and invalid reward entries", () => {
      assert.throws(() => validateCountingMilestoneConfig({ milestones: [
        { count: 10, reward: { type: "coins", amount: 10 } },
        { count: 10, reward: { type: "rep", amount: 1 } }
      ] }), /unique positive safe integers/);
      assert.throws(() => validateCountingMilestoneConfig({ milestones: [
        { count: 10, reward: { type: "valor", amount: 10 } }
      ] }), /Invalid counting milestone reward configuration/);
    });

    test("Counting recipe clue milestone falls back when there are no undiscovered recipes", () => {
      const db = setupDb();
      try {
        const userId = "reward-clue-fallback-user";
        upsertPlayer(db, "guild", userId, newPlayerProfile(userId), null, 1);
        queueReward(db, {
          userId,
          milestone: 100,
          reward: { type: "recipe_clue", amount: 1, fallback: { type: "coins", amount: 500 } }
        });
        const granted = grantCountingMilestoneReward(db, {
          guildId: "guild",
          channelId: "counting",
          userId,
          milestone: 100,
          content: { recipes: {} }
        });
        assert.equal(granted.status, "granted");
        assert.deepEqual(granted.reward, { type: "coins", amount: 500 });
      } finally {
        db.close();
      }
    });
    assert.equal(result.milestone, 1);
    assert.equal(db.prepare("SELECT status FROM counting_milestone_rewards").get().status, "pending");
  } finally {
    db.close();
  }
});

test("counting milestone grants require the per-user lock path in the runtime handler", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/index.js"), "utf8");
  assert.match(source, /withLock\(db, `lock:user:\$\{userId\}`[\s\S]{0,200}grantCountingMilestoneReward\(/);
});
