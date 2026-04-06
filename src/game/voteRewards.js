import { nowTs } from "../util/time.js";
import { applySxpLevelUp } from "./serve.js";

export const TOPGG_BOT_URL = "https://top.gg/bot/1460058511802105976/vote";

const DEFAULT_VOTE_REWARD = {
  coins: 1000,
  sxp: 300,
  rep: 50
};

function ensureVoteState(player) {
  if (!player.vote_rewards) {
    player.vote_rewards = {
      pending_claims: 0,
      last_vote_at: null,
      last_claim_at: null,
      last_webhook_at: null
    };
  }
  if (!Number.isFinite(player.vote_rewards.pending_claims)) player.vote_rewards.pending_claims = 0;
  return player.vote_rewards;
}

export function registerTopggVote(player, now = nowTs()) {
  const state = ensureVoteState(player);
  const lastWebhookAt = Number(state.last_webhook_at || 0);
  const duplicateWindowMs = 5 * 60 * 1000;

  // Top.gg can retry webhooks; suppress obvious duplicates received too close together.
  if (lastWebhookAt > 0 && now - lastWebhookAt < duplicateWindowMs) {
    state.last_webhook_at = now;
    return { ok: true, duplicate: true, pendingClaims: state.pending_claims };
  }

  state.pending_claims += 1;
  state.last_vote_at = now;
  state.last_webhook_at = now;

  return { ok: true, duplicate: false, pendingClaims: state.pending_claims };
}

export function getVoteRewardStatus(player) {
  const state = ensureVoteState(player);
  return {
    pendingClaims: Math.max(0, Number(state.pending_claims || 0)),
    lastVoteAt: state.last_vote_at,
    lastClaimAt: state.last_claim_at,
    reward: { ...DEFAULT_VOTE_REWARD }
  };
}

export function claimTopggVoteReward(player, now = nowTs()) {
  const state = ensureVoteState(player);
  const pendingClaims = Math.max(0, Number(state.pending_claims || 0));
  if (pendingClaims <= 0) {
    return { ok: false, message: "No vote reward is ready yet. Vote on Top.gg first, then claim." };
  }

  const reward = { ...DEFAULT_VOTE_REWARD };
  state.pending_claims = pendingClaims - 1;
  state.last_claim_at = now;

  player.coins = (player.coins || 0) + (reward.coins || 0);
  player.rep = (player.rep || 0) + (reward.rep || 0);
  player.sxp_total = (player.sxp_total || 0) + (reward.sxp || 0);
  player.sxp_progress = (player.sxp_progress || 0) + (reward.sxp || 0);

  if (!player.lifetime) player.lifetime = {};
  if (reward.coins) {
    player.lifetime.coins_earned = (player.lifetime.coins_earned || 0) + reward.coins;
  }

  const leveledUp = reward.sxp ? applySxpLevelUp(player) : 0;

  return {
    ok: true,
    reward,
    leveledUp,
    pendingClaims: Math.max(0, Number(state.pending_claims || 0))
  };
}
