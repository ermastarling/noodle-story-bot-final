import test from "node:test";
import assert from "node:assert/strict";

import { claimTopggVoteReward, getVoteRewardStatus } from "../src/game/voteRewards.js";

function mockPlayer() {
  return {
    coins: 0,
    rep: 0,
    sxp_total: 0,
    sxp_progress: 0,
    lifetime: {},
    vote_rewards: {
      pending_claims: 0,
      last_vote_at: null,
      last_claim_at: null,
      last_webhook_at: null
    }
  };
}

test("Vote rewards: claim collects all pending rewards", () => {
  const player = mockPlayer();
  player.vote_rewards.pending_claims = 3;

  const result = claimTopggVoteReward(player, 1234567890);

  assert.equal(result.ok, true);
  assert.equal(result.claimsClaimed, 3);
  assert.equal(result.pendingClaims, 0);
  assert.deepEqual(result.reward, {
    coins: 3000,
    sxp: 900,
    rep: 150
  });

  assert.equal(player.coins, 3000);
  assert.equal(player.rep, 150);
  assert.equal(player.sxp_total, 900);
  assert.equal(player.sxp_progress, 900);
  assert.equal(player.lifetime.coins_earned, 3000);

  const status = getVoteRewardStatus(player);
  assert.equal(status.pendingClaims, 0);
});

test("Vote rewards: claim fails when no pending rewards", () => {
  const player = mockPlayer();

  const result = claimTopggVoteReward(player);

  assert.equal(result.ok, false);
  assert.match(result.message, /No vote rewards are ready yet/i);
});
