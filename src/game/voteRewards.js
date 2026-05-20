import { nowTs } from "../util/time.js";
import { applySxpLevelUp } from "./serve.js";

export const TOPGG_BOT_URL = "https://top.gg/bot/1460058511802105976/vote";

export const VOTE_SOURCES = {
  TOPGG: "topgg",
  DISCORDBOTLIST: "discordbotlist",
  VOIDBOTS: "voidbots",
  DISCORDS: "discords",
  BOTLIST_ME: "botlistme",
  DISCORDBOTSGG: "discordbotsgg",
  STELLARBOTLIST: "stellarbotlist",
  DISCORDLIST_GG: "discordlistgg",
  RADAR_CPDV: "radarcpdv",
  DISCORDEXTREME_LIST: "discordextremelist"
};

export const VOTE_PLATFORM_PAGES = [
  {
    source: VOTE_SOURCES.TOPGG,
    label: "Top.gg",
    voteUrl: TOPGG_BOT_URL,
    isVoteLive: true,
    supportsVoteRewards: true,
    supportsServerCount: true
  },
  {
    source: VOTE_SOURCES.DISCORDBOTLIST,
    label: "Discord Bot List",
    voteUrl: "https://discordbotlist.com/bots/noodle-story/upvote",
    isVoteLive: true,
    supportsVoteRewards: true,
    supportsServerCount: true
  },
  {
    source: VOTE_SOURCES.VOIDBOTS,
    label: "Void Bots",
    voteUrl: "https://voidbots.net/bot/1460058511802105976/vote",
    isVoteLive: true,
    supportsVoteRewards: true,
    supportsServerCount: true
  },
  {
    source: VOTE_SOURCES.DISCORDS,
    label: "Discords.com",
    voteUrl: "https://discords.com/bots/bot/1460058511802105976/vote",
    isVoteLive: true,
    supportsVoteRewards: true,
    supportsServerCount: true
  },
  {
    source: VOTE_SOURCES.BOTLIST_ME,
    label: "BotList.me",
    voteUrl: null,
    isVoteLive: false,
    supportsVoteRewards: true,
    supportsServerCount: true,
    notes: "*Bot page pending*"
  },
  {
    source: VOTE_SOURCES.DISCORDBOTSGG,
    label: "Discord Bots",
    voteUrl: "https://discord.bots.gg/bots/1460058511802105976",
    supportsVoteRewards: false,
    supportsServerCount: true,
    notes: "Server count only"
  },
  {
    source: VOTE_SOURCES.STELLARBOTLIST,
    label: "Stellar Bot List",
    voteUrl: "https://stellarbotlist.com/bot/1460058511802105976/vote",
    isVoteLive: false,
    supportsVoteRewards: true,
    supportsServerCount: true,
    notes: "*Pending bot approval*"
  },
  {
    source: VOTE_SOURCES.DISCORDLIST_GG,
    label: "DiscordList",
    voteUrl: "https://discordlist.gg/bot/1460058511802105976/vote",
    isVoteLive: true,
    supportsVoteRewards: true,
    supportsServerCount: true
  },
  {
    source: VOTE_SOURCES.RADAR_CPDV,
    label: "Radarcord",
    voteUrl: "https://radar.cpdv.net/bot/1460058511802105976/vote",
    isVoteLive: false,
    supportsVoteRewards: true,
    supportsServerCount: true
  },
  {
    source: VOTE_SOURCES.DISCORDEXTREME_LIST,
    label: "Discord Extreme List",
    voteUrl: "https://discordextremelist.xyz/en-US/bots/1460058511802105976",
    supportsVoteRewards: false,
    supportsServerCount: true,
    notes: "Server count only"
  },
];

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
      last_webhook_at: null,
      sources: {}
    };
  }
  if (!Number.isFinite(player.vote_rewards.pending_claims)) player.vote_rewards.pending_claims = 0;
  if (!player.vote_rewards.sources || typeof player.vote_rewards.sources !== "object") {
    player.vote_rewards.sources = {};
  }
  return player.vote_rewards;
}

function ensureVoteSourceState(player, source = VOTE_SOURCES.TOPGG) {
  const state = ensureVoteState(player);
  const sourceKey = String(source || VOTE_SOURCES.TOPGG).trim().toLowerCase() || VOTE_SOURCES.TOPGG;

  if (!state.sources[sourceKey] || typeof state.sources[sourceKey] !== "object") {
    state.sources[sourceKey] = {
      last_webhook_at: null,
      last_vote_at: null,
      votes_total: 0
    };
  }

  // Backfill legacy Top.gg values into per-source state.
  if (sourceKey === VOTE_SOURCES.TOPGG) {
    if (!state.sources[sourceKey].last_webhook_at && state.last_webhook_at) {
      state.sources[sourceKey].last_webhook_at = state.last_webhook_at;
    }
    if (!state.sources[sourceKey].last_vote_at && state.last_vote_at) {
      state.sources[sourceKey].last_vote_at = state.last_vote_at;
    }
  }

  return { state, sourceState: state.sources[sourceKey], sourceKey };
}

function normalizeDuplicateWindowMode(mode) {
  const normalized = String(mode || "sliding").trim().toLowerCase();
  return normalized === "fixed" ? "fixed" : "sliding";
}

export function registerVoteFromSource(player, source = VOTE_SOURCES.TOPGG, now = nowTs(), options = {}) {
  const { state, sourceState, sourceKey } = ensureVoteSourceState(player, source);
  const duplicateWindowMode = normalizeDuplicateWindowMode(options?.duplicateWindowMode);
  const lastWebhookAt = Number(sourceState.last_webhook_at || 0);
  const duplicateWindowMs = 5 * 60 * 1000;
  const duplicateRefreshMs = 30 * 1000;

  // Bot list webhooks can retry; suppress obvious duplicates per source.
  if (lastWebhookAt > 0 && now - lastWebhookAt < duplicateWindowMs) {
    let shouldPersistDuplicate = false;
    if (duplicateWindowMode === "sliding") {
      // Throttle duplicate timestamp refreshes to avoid excessive write volume.
      if (now - lastWebhookAt >= duplicateRefreshMs) {
        sourceState.last_webhook_at = now;
        state.last_webhook_at = now;
        shouldPersistDuplicate = true;
      }
    }
    return {
      ok: true,
      source: sourceKey,
      duplicate: true,
      lifetimeLimited: false,
      shouldPersistDuplicate,
      pendingClaims: state.pending_claims
    };
  }

  state.pending_claims += 1;
  state.last_vote_at = now;
  state.last_webhook_at = now;

  sourceState.last_vote_at = now;
  sourceState.last_webhook_at = now;
  sourceState.votes_total = Math.max(0, Number(sourceState.votes_total || 0)) + 1;

  return {
    ok: true,
    source: sourceKey,
    duplicate: false,
    lifetimeLimited: false,
    shouldPersistDuplicate: true,
    pendingClaims: state.pending_claims
  };
}

export function registerTopggVote(player, now = nowTs()) {
  return registerVoteFromSource(player, VOTE_SOURCES.TOPGG, now);
}

export function getVotePlatformPages() {
  return VOTE_PLATFORM_PAGES.map((page) => ({ ...page }));
}

function getSourceLastVoteAt(player, source) {
  const state = ensureVoteState(player || {});
  const sourceKey = String(source || "").trim().toLowerCase();
  const sourceState = state.sources?.[sourceKey];
  const sourceLastVoteAt = Number(sourceState?.last_vote_at || 0);
  if (Number.isFinite(sourceLastVoteAt) && sourceLastVoteAt > 0) {
    return sourceLastVoteAt;
  }

  if (sourceKey === VOTE_SOURCES.TOPGG) {
    const legacyLastVoteAt = Number(state.last_vote_at || 0);
    if (Number.isFinite(legacyLastVoteAt) && legacyLastVoteAt > 0) {
      return legacyLastVoteAt;
    }
  }

  return null;
}

export function getVotePlatformStatusLines(player) {
  return getVotePlatformPages()
    .filter((page) => page.supportsVoteRewards && page.voteUrl && page.isVoteLive !== false)
    .map((page) => {
      const sourceLastVoteAt = getSourceLastVoteAt(player, page.source);
      const lastVoteText = sourceLastVoteAt
        ? `<t:${Math.floor(sourceLastVoteAt / 1000)}:R>`
        : "Not detected yet";
      return `- **[${page.label}](${page.voteUrl})** — last vote: ${lastVoteText}`;
    });
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
    return { ok: false, message: "No vote rewards are ready yet. Vote on any supported bot list first, then claim." };
  }

  const reward = {
    coins: (DEFAULT_VOTE_REWARD.coins || 0) * pendingClaims,
    sxp: (DEFAULT_VOTE_REWARD.sxp || 0) * pendingClaims,
    rep: (DEFAULT_VOTE_REWARD.rep || 0) * pendingClaims
  };
  state.pending_claims = 0;
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
    claimsClaimed: pendingClaims,
    reward,
    leveledUp,
    pendingClaims: Math.max(0, Number(state.pending_claims || 0))
  };
}
