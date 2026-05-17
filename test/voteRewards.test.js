import test from "node:test";
import assert from "node:assert/strict";

import {
  claimTopggVoteReward,
  getVoteRewardStatus,
  registerVoteFromSource,
  VOTE_SOURCES
} from "../src/game/voteRewards.js";

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

test("Vote rewards: duplicate suppression is isolated per source", () => {
  const player = mockPlayer();
  const now = 1_000_000;

  const topggFirst = registerVoteFromSource(player, VOTE_SOURCES.TOPGG, now);
  assert.equal(topggFirst.ok, true);
  assert.equal(topggFirst.duplicate, false);
  assert.equal(topggFirst.pendingClaims, 1);

  const topggDuplicate = registerVoteFromSource(player, VOTE_SOURCES.TOPGG, now + 60_000);
  assert.equal(topggDuplicate.ok, true);
  assert.equal(topggDuplicate.duplicate, true);
  assert.equal(topggDuplicate.pendingClaims, 1);

  const secondSource = registerVoteFromSource(player, VOTE_SOURCES.DISCORDBOTLIST, now + 90_000);
  assert.equal(secondSource.ok, true);
  assert.equal(secondSource.duplicate, false);
  assert.equal(secondSource.pendingClaims, 2);
});

test("Vote rewards: duplicate webhook timestamp must persist across requests", () => {
  const now = 1_000_000;

  // First webhook request creates one pending claim.
  const firstRequestPlayer = mockPlayer();
  const firstVote = registerVoteFromSource(firstRequestPlayer, VOTE_SOURCES.TOPGG, now);
  assert.equal(firstVote.duplicate, false);
  assert.equal(firstVote.pendingClaims, 1);

  // Simulate loading persisted player state in a later webhook request.
  const secondRequestPlayer = JSON.parse(JSON.stringify(firstRequestPlayer));
  const duplicateVote = registerVoteFromSource(secondRequestPlayer, VOTE_SOURCES.TOPGG, now + 60_000);
  assert.equal(duplicateVote.duplicate, true);
  assert.equal(duplicateVote.pendingClaims, 1);

  // If duplicate timestamp mutations are persisted, later retries still suppress correctly.
  const persistedAfterDuplicate = JSON.parse(JSON.stringify(secondRequestPlayer));
  const retryAfterOriginalWindow = registerVoteFromSource(
    persistedAfterDuplicate,
    VOTE_SOURCES.TOPGG,
    now + (5 * 60_000) + 30_000
  );
  assert.equal(retryAfterOriginalWindow.duplicate, true);
  assert.equal(retryAfterOriginalWindow.pendingClaims, 1);

  // Demonstrates the stale-state failure this regression protects against.
  const staleReloadWithoutDuplicatePersist = JSON.parse(JSON.stringify(firstRequestPlayer));
  const staleRetry = registerVoteFromSource(
    staleReloadWithoutDuplicatePersist,
    VOTE_SOURCES.TOPGG,
    now + (5 * 60_000) + 30_000
  );
  assert.equal(staleRetry.duplicate, false);
  assert.equal(staleRetry.pendingClaims, 2);
});

