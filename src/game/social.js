import { nowTs } from "../util/time.js";
import crypto from "crypto";

/* ------------------------------------------------------------------ */
/*  Constants - Phase D Social Systems Configuration                  */
/* ------------------------------------------------------------------ */

export const BLESSING_DURATION_HOURS = 6;
export const BLESSING_COOLDOWN_HOURS = 24;
export const MAX_PARTY_SIZE = 4;
export const MIN_TIP_AMOUNT = 1;
export const MAX_TIP_AMOUNT = 10000;

export const BLESSING_TYPES = [
  "limited_time_window_add",
  "discovery_chance_add",
  "quality_shift",
  "npc_weight_mult"
];

export const BLESSING_EFFECTS = {
  discovery_chance_add: { clueBonus: 0.01, scrollBonus: 0.01 },
  limited_time_window_add: { speedWindowMult: 1.25 },
  npc_weight_mult: {
    rarityMultipliers: {
      common: 1,
      uncommon: 1.2,
      rare: 1.5,
      epic: 2.0,
      seasonal: 1.3
    }
  }
};

/* ------------------------------------------------------------------ */
/*  Blessing System (D3)                                               */
/* ------------------------------------------------------------------ */

/**
 * Grant a blessing to a visitor (non-economic temporary buff)
 * Returns updated visitor player state or throws error
 */
export function grantBlessing(visitorPlayer, hostUserId, blessingType) {
  const now = nowTs();
  
  // Validate blessing type
  if (!BLESSING_TYPES.includes(blessingType)) {
    throw new Error(`Invalid blessing type: ${blessingType}`);
  }

  // Check if visitor already has an active blessing
  if (visitorPlayer.social?.active_blessing) {
    const blessing = visitorPlayer.social.active_blessing;
    if (blessing.expires_at > now) {
      throw new Error("You already have an active blessing");
    }
  }

  // Check visitor's blessing cooldown
  const lastBlessingAt = visitorPlayer.social?.last_blessing_at || 0;
  const cooldownEnds = lastBlessingAt + (BLESSING_COOLDOWN_HOURS * 60 * 60 * 1000);
  if (now < cooldownEnds) {
    const remainingMinutes = Math.ceil((cooldownEnds - now) / (60 * 1000));
    throw new Error(`Blessing cooldown active. Try again in ${remainingMinutes} minutes`);
  }

  // Grant the blessing
  const expiresAt = now + (BLESSING_DURATION_HOURS * 60 * 60 * 1000);
  
  if (!visitorPlayer.social) visitorPlayer.social = {};
  visitorPlayer.social.active_blessing = {
    type: blessingType,
    granted_by: hostUserId,
    granted_at: now,
    expires_at: expiresAt
  };
  visitorPlayer.social.last_blessing_at = now;
  
  return visitorPlayer;
}

/**
 * Check if a player has an active blessing
 */
export function hasActiveBlessing(player, blessingType = null) {
  const now = nowTs();
  const blessing = player.social?.active_blessing;
  
  if (!blessing || blessing.expires_at <= now) {
    return false;
  }
  
  if (blessingType && blessing.type !== blessingType) {
    return false;
  }
  
  return true;
}

/**
 * Get active blessing or null
 */
export function getActiveBlessing(player) {
  const now = nowTs();
  const blessing = player.social?.active_blessing;
  
  if (!blessing || blessing.expires_at <= now) {
    return null;
  }
  
  return blessing;
}

/**
 * Clear expired blessings (call during player state load)
 */
export function clearExpiredBlessings(player) {
  const now = nowTs();
  if (player.social?.active_blessing) {
    if (player.social.active_blessing.expires_at <= now) {
      player.social.active_blessing = null;
    }
  }
  return player;
}

/* ------------------------------------------------------------------ */
/*  Party System (D2 - Community aspect)                              */
/* ------------------------------------------------------------------ */

/**
 * Create a new party
 */
export function createParty(db, serverId, leaderUserId, partyName) {
  const partyId = crypto.randomUUID();
  const now = nowTs();
  
  db.prepare(`
    INSERT INTO guild_parties (party_id, server_id, party_name, leader_user_id, created_at, max_members, status)
    VALUES (?, ?, ?, ?, ?, ?, 'active')
  `).run(partyId, serverId, partyName, leaderUserId, now, MAX_PARTY_SIZE);
  
  // Add leader as first member
  db.prepare(`
    INSERT INTO party_members (party_id, user_id, joined_at, contribution_points)
    VALUES (?, ?, ?, 0)
  `).run(partyId, leaderUserId, now);
  
  return { partyId, partyName };
}

/**
 * Join an existing party
 */
export function joinParty(db, serverId, partyIdPrefix, userId) {
  const now = nowTs();
  
  // Check if party exists and is active in this server (match by prefix)
  const party = db.prepare("SELECT * FROM guild_parties WHERE party_id LIKE ? AND server_id = ? AND status = 'active'").get(partyIdPrefix + '%', serverId);
  if (!party) {
    throw new Error("Party not found or inactive");
  }
  
  // Check party size
  const memberCount = db.prepare("SELECT COUNT(*) as count FROM party_members WHERE party_id = ? AND left_at IS NULL").get(party.party_id);
  if (memberCount.count >= party.max_members) {
    throw new Error("Party is full");
  }
  
  // Check if already a member
  const existing = db.prepare("SELECT * FROM party_members WHERE party_id = ? AND user_id = ? AND left_at IS NULL").get(party.party_id, userId);
  if (existing) {
    throw new Error("Already a party member");
  }
  
  // Check if user previously left this party
  const previousMember = db.prepare("SELECT * FROM party_members WHERE party_id = ? AND user_id = ?").get(party.party_id, userId);
  
  if (previousMember) {
    // Rejoin by updating the existing row
    db.prepare(`
      UPDATE party_members 
      SET joined_at = ?, left_at = NULL, contribution_points = 0
      WHERE party_id = ? AND user_id = ?
    `).run(now, party.party_id, userId);
  } else {
    // Join party for the first time
    db.prepare(`
      INSERT INTO party_members (party_id, user_id, joined_at, contribution_points)
      VALUES (?, ?, ?, 0)
    `).run(party.party_id, userId, now);
  }
  
  return { partyId: party.party_id, partyName: party.party_name };
}

/**
 * Leave a party
 */
export function leaveParty(db, partyId, userId) {
  const now = nowTs();
  
  const membership = db.prepare("SELECT * FROM party_members WHERE party_id = ? AND user_id = ? AND left_at IS NULL").get(partyId, userId);
  if (!membership) {
    throw new Error("Not a member of this party");
  }
  
  // Mark as left
  db.prepare("UPDATE party_members SET left_at = ? WHERE party_id = ? AND user_id = ?").run(now, partyId, userId);
  
  // Check if party leader left
  const party = db.prepare("SELECT * FROM guild_parties WHERE party_id = ?").get(partyId);
  if (party.leader_user_id === userId) {
    // Promote another active member or disband
    const members = db.prepare("SELECT * FROM party_members WHERE party_id = ? AND left_at IS NULL ORDER BY joined_at").all(partyId);
    if (members.length > 0) {
      db.prepare("UPDATE guild_parties SET leader_user_id = ? WHERE party_id = ?").run(members[0].user_id, partyId);
    } else {
      // Disband party if no members left
      db.prepare("UPDATE guild_parties SET status = 'disbanded', disbanded_at = ? WHERE party_id = ?").run(now, partyId);
    }
  }
}

/**
 * Kick a party member (leader only)
 */
export function kickPartyMember(db, partyId, targetUserId) {
  const now = nowTs();

  const membership = db.prepare(
    "SELECT * FROM party_members WHERE party_id = ? AND user_id = ? AND left_at IS NULL"
  ).get(partyId, targetUserId);
  if (!membership) {
    throw new Error("User is not an active party member");
  }

  db.prepare("UPDATE party_members SET left_at = ? WHERE party_id = ? AND user_id = ?")
    .run(now, partyId, targetUserId);
}

/**
 * Invite a user to a party
 */
export function inviteUserToParty(db, serverId, partyId, inviteTargetId) {
  const now = nowTs();
  
  // Check if party exists and is active
  const party = db.prepare("SELECT * FROM guild_parties WHERE party_id = ? AND server_id = ? AND status = 'active'").get(partyId, serverId);
  if (!party) {
    throw new Error("Party not found or inactive");
  }
  
  // Check party size
  const memberCount = db.prepare("SELECT COUNT(*) as count FROM party_members WHERE party_id = ? AND left_at IS NULL").get(partyId);
  if (memberCount.count >= party.max_members) {
    throw new Error("Party is full");
  }
  
  // Check if already a member (including those who left)
  const existing = db.prepare("SELECT * FROM party_members WHERE party_id = ? AND user_id = ?").get(partyId, inviteTargetId);
  if (existing && existing.left_at === null) {
    throw new Error("User is already a party member");
  }
  
  // Add user to party or re-invite if they left
  if (existing && existing.left_at !== null) {
    // Update the existing record to rejoin
    db.prepare("UPDATE party_members SET left_at = NULL, joined_at = ? WHERE party_id = ? AND user_id = ?").run(now, partyId, inviteTargetId);
  } else {
    // Insert new member
    db.prepare(`
      INSERT INTO party_members (party_id, user_id, joined_at, contribution_points)
      VALUES (?, ?, ?, 0)
    `).run(partyId, inviteTargetId, now);
  }
  
  return { partyId, partyName: party.party_name };
}

/**
 * Get party info
 */
export function getParty(db, partyId) {
  const party = db.prepare("SELECT * FROM guild_parties WHERE party_id = ?").get(partyId);
  if (!party) return null;
  
  const members = db.prepare("SELECT * FROM party_members WHERE party_id = ? AND left_at IS NULL ORDER BY joined_at").all(partyId);
  
  return {
    ...party,
    members: members
  };
}

/**
 * Get user's active party
 */
export function getUserActiveParty(db, userId) {
  const membership = db.prepare(`
    SELECT pm.*, gp.* 
    FROM party_members pm
    JOIN guild_parties gp ON pm.party_id = gp.party_id
    WHERE pm.user_id = ? AND pm.left_at IS NULL AND gp.status = 'active'
    ORDER BY pm.joined_at DESC
    LIMIT 1
  `).get(userId);
  
  if (!membership) return null;
  
  return getParty(db, membership.party_id);
}

/**
 * Rename an existing party
 */
export function renameParty(db, partyId, newName) {
  const party = db.prepare("SELECT * FROM guild_parties WHERE party_id = ? AND status = 'active'").get(partyId);
  if (!party) {
    throw new Error("Party not found or inactive");
  }
  db.prepare("UPDATE guild_parties SET party_name = ? WHERE party_id = ?").run(newName, partyId);
  return { partyId, partyName: newName };
}

/**
 * Transfer party leadership to another active member
 */
export function transferPartyLeadership(db, partyId, newLeaderUserId) {
  const party = db.prepare("SELECT * FROM guild_parties WHERE party_id = ? AND status = 'active'").get(partyId);
  if (!party) {
    throw new Error("Party not found or inactive");
  }
  const membership = db.prepare(
    "SELECT * FROM party_members WHERE party_id = ? AND user_id = ? AND left_at IS NULL"
  ).get(partyId, newLeaderUserId);
  if (!membership) {
    throw new Error("User is not an active party member");
  }
  db.prepare("UPDATE guild_parties SET leader_user_id = ? WHERE party_id = ?").run(newLeaderUserId, partyId);
  return { partyId, leaderUserId: newLeaderUserId };
}

/* ------------------------------------------------------------------ */
/*  Tip System (Safe Coin Transfers)                                  */
/* ------------------------------------------------------------------ */

/**
 * Transfer coins from one player to another as a tip
 * Returns { sender: updatedSenderState, receiver: updatedReceiverState, tipId }
 */
export function transferTip(db, serverId, senderPlayer, receiverPlayer, amount, message = null) {
  const now = nowTs();
  
  // Validation
  if (amount < MIN_TIP_AMOUNT || amount > MAX_TIP_AMOUNT) {
    throw new Error(`Tip amount must be between ${MIN_TIP_AMOUNT} and ${MAX_TIP_AMOUNT} coins`);
  }
  
  if (senderPlayer.user_id === receiverPlayer.user_id) {
    throw new Error("Cannot tip yourself");
  }
  
  if (senderPlayer.coins < amount) {
    throw new Error(`Insufficient coins. You have ${senderPlayer.coins} coins`);
  }
  
  // Transfer coins
  senderPlayer.coins -= amount;
  receiverPlayer.coins += amount;
  
  // Record tip
  const tipId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO tips (tip_id, server_id, from_user_id, to_user_id, amount, created_at, message)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(tipId, serverId, senderPlayer.user_id, receiverPlayer.user_id, amount, now, message);
  
  // Track in lifetime stats
  if (!senderPlayer.lifetime) senderPlayer.lifetime = {};
  if (!receiverPlayer.lifetime) receiverPlayer.lifetime = {};
  
  senderPlayer.lifetime.coins_tipped_out = (senderPlayer.lifetime.coins_tipped_out || 0) + amount;
  receiverPlayer.lifetime.coins_tipped_in = (receiverPlayer.lifetime.coins_tipped_in || 0) + amount;
  
  return { 
    sender: senderPlayer, 
    receiver: receiverPlayer, 
    tipId 
  };
}

/**
 * Get recent tips for display
 */
export function getRecentTips(db, serverId, limit = 10) {
  return db.prepare(`
    SELECT * FROM tips 
    WHERE server_id = ? 
    ORDER BY created_at DESC 
    LIMIT ?
  `).all(serverId, limit);
}

/**
 * Get tip statistics for a user
 */
export function getUserTipStats(db, serverId, userId) {
  const sent = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
    FROM tips WHERE server_id = ? AND from_user_id = ?
  `).get(serverId, userId);
  
  const received = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
    FROM tips WHERE server_id = ? AND to_user_id = ?
  `).get(serverId, userId);
  
  return {
    sent: { count: sent.count, total: sent.total },
    received: { count: received.count, total: received.total }
  };
}

/* ------------------------------------------------------------------ */
/*  NPC Affinity System (D4 - Flavor Only)                            */
/* ------------------------------------------------------------------ */

/**
 * Update server-wide NPC affinity (cosmetic/narrative only)
 */
export function updateNpcAffinity(serverState, npcArchetype, delta) {
  if (!serverState.npc_affinity) {
    serverState.npc_affinity = {};
  }
  
  const current = serverState.npc_affinity[npcArchetype] || 0;
  serverState.npc_affinity[npcArchetype] = Math.max(0, current + delta);
  
  return serverState;
}

/**
 * Get NPC affinity level
 */
export function getNpcAffinity(serverState, npcArchetype) {
  return serverState.npc_affinity?.[npcArchetype] || 0;
}

/* ------------------------------------------------------------------ */
/*  Community Events (D2)                                              */
/* ------------------------------------------------------------------ */

/**
 * Initialize or update community event progress
 */
export function updateCommunityEvent(serverState, eventId, contribution) {
  if (!serverState.community_events) {
    serverState.community_events = {};
  }
  
  if (!serverState.community_events[eventId]) {
    serverState.community_events[eventId] = {
      event_id: eventId,
      total_contributions: 0,
      milestones_unlocked: [],
      started_at: nowTs()
    };
  }
  
  serverState.community_events[eventId].total_contributions += contribution;
  return serverState;
}

/**
 * Check and unlock community event milestones
 */
export function checkEventMilestones(serverState, eventId, milestones) {
  const event = serverState.community_events?.[eventId];
  if (!event) return [];
  
  const newUnlocks = [];
  for (const milestone of milestones) {
    if (event.total_contributions >= milestone.threshold) {
      if (!event.milestones_unlocked.includes(milestone.id)) {
        event.milestones_unlocked.push(milestone.id);
        newUnlocks.push(milestone);
      }
    }
  }
  
  return newUnlocks;
}

/* ------------------------------------------------------------------ */
/*  Shared Orders (D2 - Async Co-Op)                                  */
/* ------------------------------------------------------------------ */

/**
 * Create a shared order for a party
 */
export function createSharedOrder(db, partyId, recipeId, serverId, servings = 5) {
  const sharedOrderId = crypto.randomUUID();
  const now = nowTs();
  
  db.prepare(`
    INSERT INTO shared_orders (shared_order_id, party_id, order_id, server_id, created_at, status, servings)
    VALUES (?, ?, ?, ?, ?, 'active', ?)
  `).run(sharedOrderId, partyId, recipeId, serverId, now, servings);
  
  return { sharedOrderId, servings };
}

/**
 * Contribute to a shared order
 */
export function contributeToSharedOrder(db, sharedOrderId, userId, ingredientId, quantity) {
  const now = nowTs();
  
  // Check if shared order exists and is active
  const sharedOrder = db.prepare("SELECT * FROM shared_orders WHERE shared_order_id = ? AND status = 'active'").get(sharedOrderId);
  if (!sharedOrder) {
    throw new Error("Shared order not found or already completed");
  }
  
  // Check if user is party member
  const membership = db.prepare("SELECT * FROM party_members WHERE party_id = ? AND user_id = ? AND left_at IS NULL").get(sharedOrder.party_id, userId);
  if (!membership) {
    throw new Error("Not a member of this party");
  }
  
  // Record contribution
  const existing = db.prepare("SELECT * FROM shared_order_contributions WHERE shared_order_id = ? AND user_id = ? AND ingredient_id = ?")
    .get(sharedOrderId, userId, ingredientId);
  
  if (existing) {
    db.prepare(`
      UPDATE shared_order_contributions 
      SET quantity = quantity + ?, contributed_at = ?
      WHERE shared_order_id = ? AND user_id = ? AND ingredient_id = ?
    `).run(quantity, now, sharedOrderId, userId, ingredientId);
  } else {
    db.prepare(`
      INSERT INTO shared_order_contributions (shared_order_id, user_id, ingredient_id, quantity, contributed_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(sharedOrderId, userId, ingredientId, quantity, now);
  }
  
  // Update party member contribution points
  db.prepare(`
    UPDATE party_members 
    SET contribution_points = contribution_points + ?
    WHERE party_id = ? AND user_id = ?
  `).run(quantity, sharedOrder.party_id, userId);
}

/**
 * Get shared order contributions
 */
export function getSharedOrderContributions(db, sharedOrderId) {
  return db.prepare(`
    SELECT * FROM shared_order_contributions 
    WHERE shared_order_id = ?
    ORDER BY contributed_at
  `).all(sharedOrderId);
}

/**
 * Complete a shared order
 */
export function completeSharedOrder(db, sharedOrderId) {
  const now = nowTs();
  db.prepare("UPDATE shared_orders SET status = 'completed', completed_at = ? WHERE shared_order_id = ?")
    .run(now, sharedOrderId);
}

/**
 * Cancel a shared order
 */
export function cancelSharedOrder(db, sharedOrderId) {
  const now = nowTs();
  db.prepare("UPDATE shared_orders SET status = 'cancelled', completed_at = ? WHERE shared_order_id = ?")
    .run(now, sharedOrderId);
}

/**
 * Get active shared order for a party
 */
export function getActiveSharedOrderByParty(db, partyId) {
  return db.prepare("SELECT * FROM shared_orders WHERE party_id = ? AND status = 'active' LIMIT 1").get(partyId);
}

/* ------------------------------------------------------------------ */
/*  Anti-Exploitation Analytics (D6)                                   */
/* ------------------------------------------------------------------ */

/**
 * Track visit patterns for monitoring (not enforcement)
 */
export function logVisitActivity(serverState, visitorUserId, hostUserId) {
  if (!serverState.analytics) {
    serverState.analytics = { visit_log: [] };
  }
  
  const now = nowTs();
  serverState.analytics.visit_log.push({
    visitor: visitorUserId,
    host: hostUserId,
    timestamp: now
  });
  
  // Keep only last 1000 entries
  if (serverState.analytics.visit_log.length > 1000) {
    serverState.analytics.visit_log = serverState.analytics.visit_log.slice(-1000);
  }
  
  return serverState;
}

/**
 * Get visit pattern summary for analytics
 */
export function getVisitPatternSummary(serverState, userId, hours = 24) {
  if (!serverState.analytics?.visit_log) return { visits: 0, unique_hosts: 0 };
  
  const now = nowTs();
  const cutoff = now - (hours * 60 * 60 * 1000);
  
  const recentVisits = serverState.analytics.visit_log.filter(
    v => v.visitor === userId && v.timestamp >= cutoff
  );
  
  const uniqueHosts = new Set(recentVisits.map(v => v.host)).size;
  
  return {
    visits: recentVisits.length,
    unique_hosts: uniqueHosts
  };
}
