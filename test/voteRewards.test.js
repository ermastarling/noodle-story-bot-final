import test from "node:test";
import assert from "node:assert/strict";

import {
  claimVoteRewards,
  getDisplayVotePlatformPages,
  getVoteRewardStatus,
  getVotePlatformStatusLines,
  registerVoteFromSource,
  VOTE_SOURCES
} from "../src/game/voteRewards.js";
import {
  applySubscriptionEntitlementEvent,
  HOUSE_247_VOTE_DURATION_MS,
  SUBSCRIPTION_PERKS
} from "../src/game/subscriptions.js";

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

  const result = claimVoteRewards(player, 1234567890);

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

  const result = claimVoteRewards(player);

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

test("Vote rewards: fixed duplicate window mode does not slide forward", () => {
  const now = 1_000_000;
  const player = mockPlayer();

  const firstVote = registerVoteFromSource(player, VOTE_SOURCES.TOPGG, now, {
    duplicateWindowMode: "fixed"
  });
  assert.equal(firstVote.duplicate, false);
  assert.equal(firstVote.pendingClaims, 1);

  const duplicateVote = registerVoteFromSource(player, VOTE_SOURCES.TOPGG, now + 60_000, {
    duplicateWindowMode: "fixed"
  });
  assert.equal(duplicateVote.duplicate, true);
  assert.equal(duplicateVote.pendingClaims, 1);

  const retryAfterWindow = registerVoteFromSource(player, VOTE_SOURCES.TOPGG, now + (5 * 60_000) + 30_000, {
    duplicateWindowMode: "fixed"
  });
  assert.equal(retryAfterWindow.duplicate, false);
  assert.equal(retryAfterWindow.pendingClaims, 2);
});

test("Vote rewards: rapid duplicate retries do not require persistence on every hit", () => {
  const now = 1_000_000;
  const player = mockPlayer();

  const firstVote = registerVoteFromSource(player, VOTE_SOURCES.TOPGG, now);
  assert.equal(firstVote.shouldPersistDuplicate, true);

  const rapidDuplicate = registerVoteFromSource(player, VOTE_SOURCES.TOPGG, now + 10_000);
  assert.equal(rapidDuplicate.duplicate, true);
  assert.equal(rapidDuplicate.shouldPersistDuplicate, false);

  const laterDuplicate = registerVoteFromSource(player, VOTE_SOURCES.TOPGG, now + 40_000);
  assert.equal(laterDuplicate.duplicate, true);
  assert.equal(laterDuplicate.shouldPersistDuplicate, true);
});

test("Vote rewards: fixed mode duplicate does not request persistence", () => {
  const now = 1_000_000;
  const player = mockPlayer();

  registerVoteFromSource(player, VOTE_SOURCES.TOPGG, now, { duplicateWindowMode: "fixed" });
  const duplicateVote = registerVoteFromSource(player, VOTE_SOURCES.TOPGG, now + 60_000, {
    duplicateWindowMode: "fixed"
  });

  assert.equal(duplicateVote.duplicate, true);
  assert.equal(duplicateVote.shouldPersistDuplicate, false);
});

test("Vote rewards: Rank.top vote grants two pending claims and doubled payout", () => {
  const now = 2_000_000;
  const player = mockPlayer();

  const rankTopVote = registerVoteFromSource(player, VOTE_SOURCES.RANKTOP, now);
  assert.equal(rankTopVote.ok, true);
  assert.equal(rankTopVote.duplicate, false);
  assert.equal(rankTopVote.pendingClaims, 2);

  const claim = claimVoteRewards(player, now + 1_000);
  assert.equal(claim.ok, true);
  assert.equal(claim.claimsClaimed, 2);
  assert.deepEqual(claim.reward, {
    coins: 2000,
    sxp: 600,
    rep: 100
  });
  assert.equal(player.coins, 2000);
  assert.equal(player.rep, 100);
  assert.equal(player.sxp_total, 600);
  assert.equal(player.sxp_progress, 600);
  assert.equal(player.lifetime.coins_earned, 2000);
});

test("Vote rewards: display pages are Rank.top-first and respect limit", () => {
  const pages = getDisplayVotePlatformPages();
  assert.ok(pages.length > 0);
  assert.equal(pages[0].source, VOTE_SOURCES.RANKTOP);

  const limited = getDisplayVotePlatformPages({ limit: 1 });
  assert.equal(limited.length, 1);
  assert.equal(limited[0].source, VOTE_SOURCES.RANKTOP);
});

test("Vote rewards: status lines follow display ordering and limit", () => {
  const now = 3_000_000;
  const player = mockPlayer();

  registerVoteFromSource(player, VOTE_SOURCES.TOPGG, now);
  registerVoteFromSource(player, VOTE_SOURCES.RANKTOP, now + 10_000);

  const lines = getVotePlatformStatusLines(player);
  assert.ok(lines.length > 0);
  assert.match(lines[0], /Rank\.top/i);

  const limitedLines = getVotePlatformStatusLines(player, { limit: 1 });
  assert.equal(limitedLines.length, 1);
  assert.match(limitedLines[0], /Rank\.top/i);
});

test("Vote rewards: each vote adds 12h of 24/7 House and stacks from current expiry", () => {
  const now = 4_000_000;
  const player = mockPlayer();

  const first = registerVoteFromSource(player, VOTE_SOURCES.TOPGG, now);
  assert.equal(first.duplicate, false);
  assert.equal(first.house247ExpiresAt, now + HOUSE_247_VOTE_DURATION_MS);

  const second = registerVoteFromSource(player, VOTE_SOURCES.DISCORDBOTLIST, now + 1_000);
  assert.equal(second.duplicate, false);
  assert.equal(second.house247ExpiresAt, now + HOUSE_247_VOTE_DURATION_MS * 2);

  const status = getVoteRewardStatus(player);
  assert.equal(status.house247ExpiresAt, now + HOUSE_247_VOTE_DURATION_MS * 2);
});

test("Vote rewards: duplicate retries do not extend 24/7 House timer", () => {
  const now = 5_000_000;
  const player = mockPlayer();

  const first = registerVoteFromSource(player, VOTE_SOURCES.TOPGG, now);
  const duplicate = registerVoteFromSource(player, VOTE_SOURCES.TOPGG, now + 60_000);

  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.house247ExpiresAt, first.house247ExpiresAt);
});

test("Vote rewards: 24/7 status is active when subscription perk is active without votes", () => {
  const now = 1_700_000_000_000;
  const player = mockPlayer();

  applySubscriptionEntitlementEvent(player, {
    perkId: SUBSCRIPTION_PERKS.HOUSE_247,
    eventType: "ENTITLEMENT_UPDATE",
    periodStartAt: now - 1_000,
    periodEndAt: now + 86_400_000,
    now
  });

  const status = getVoteRewardStatus(player, now);
  assert.equal(status.house247Active, true);
  assert.equal(status.house247ExpiresAt, null);
});

