import test from "node:test";
import assert from "node:assert/strict";
import { socialMainMenuRow, statsViewButtons } from "../src/commands/noodleSocial.js";
import { hasClaimableAchievementRewards } from "../src/game/achievements.js";

const achievements = {
  achievements: [
    { achievement_id: "ready" },
    { achievement_id: "claimed" }
  ]
};

test("Stats and Achievements buttons use the green style when a reward is claimable", () => {
  const player = {
    achievements: {
      unlocked: { ready: { unlocked_at: 1 }, claimed: { unlocked_at: 1 }, removed: { unlocked_at: 1 } },
      claimed_ids: ["claimed"]
    }
  };
  assert.equal(hasClaimableAchievementRewards(player, achievements), true);
  assert.equal(hasClaimableAchievementRewards({
    achievements: { unlocked: { claimed: {} }, claimed_ids: ["claimed"] }
  }, achievements), false);

  const statsEntryButtons = socialMainMenuRow("123", { achievementRewardsAvailable: true }).toJSON().components;
  const statsPageButtons = statsViewButtons("123", { achievementRewardsAvailable: true })
    .flatMap((row) => row.toJSON().components);

  assert.equal(statsEntryButtons.find((button) => button.label === "Stats").style, 3);
  assert.equal(statsPageButtons.find((button) => button.label === "Achievements").style, 3);

  const statsEntryWithoutRewards = socialMainMenuRow("123", { achievementRewardsAvailable: false }).toJSON().components;
  const statsPageWithoutRewards = statsViewButtons("123", { achievementRewardsAvailable: false })
    .flatMap((row) => row.toJSON().components);
  assert.equal(statsEntryWithoutRewards.find((button) => button.label === "Stats").style, 2);
  assert.equal(statsPageWithoutRewards.find((button) => button.label === "Achievements").style, 2);
});
