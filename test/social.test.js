import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  grantBlessing,
  hasActiveBlessing,
  getActiveBlessing,
  clearExpiredBlessings,
  createParty,
  joinParty,
  leaveParty,
  getParty,
  getUserActiveParty,
  transferTip,
  getUserTipStats,
  updateNpcAffinity,
  getNpcAffinity,
  updateCommunityEvent,
  checkEventMilestones,
  BLESSING_DURATION_HOURS,
  BLESSING_COOLDOWN_HOURS,
  MIN_TIP_AMOUNT,
  MAX_TIP_AMOUNT
} from "../src/game/social.js";
import { nowTs } from "../src/util/time.js";

function setupTestDb() {
  const db = new Database(":memory:");
  const schemaPath = path.join(__dirname, "..", "src", "db", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");
  db.exec(schema);
  return db;
}

function mockPlayer(userId, coins = 100) {
  return {
    user_id: userId,
    coins,
    lifetime: {},
    social: {}
  };
}

function mockServer(serverId) {
  return {
    server_id: serverId,
    npc_affinity: {},
    community_events: {},
    analytics: { visit_log: [] }
  };
}

test("Blessing: grant blessing successfully", () => {
  const player = mockPlayer("user1");
  const result = grantBlessing(player, "host1", "discovery_chance_add");
  
  assert.ok(result.social.active_blessing);
  assert.equal(result.social.active_blessing.type, "discovery_chance_add");
  assert.equal(result.social.active_blessing.granted_by, "host1");
  assert.ok(result.social.active_blessing.expires_at > nowTs());
});

test("Blessing: cannot have multiple active blessings", () => {
  const player = mockPlayer("user1");
  grantBlessing(player, "host1", "discovery_chance_add");
  
  assert.throws(() => {
    grantBlessing(player, "host2", "quality_shift");
  }, /already have an active blessing/);
});

test("Blessing: cooldown prevents too frequent blessings", () => {
  const player = mockPlayer("user1");
  player.social.last_blessing_at = nowTs();
  
  assert.throws(() => {
    grantBlessing(player, "host1", "discovery_chance_add");
  }, /cooldown active/);
});

test("Blessing: invalid blessing type throws error", () => {
  const player = mockPlayer("user1");
  
  assert.throws(() => {
    grantBlessing(player, "host1", "invalid_blessing");
  }, /Invalid blessing type/);
});

test("Blessing: hasActiveBlessing works correctly", () => {
  const player = mockPlayer("user1");
  assert.equal(hasActiveBlessing(player), false);
  
  grantBlessing(player, "host1", "discovery_chance_add");
  assert.equal(hasActiveBlessing(player), true);
  assert.equal(hasActiveBlessing(player, "discovery_chance_add"), true);
  assert.equal(hasActiveBlessing(player, "quality_shift"), false);
});

test("Blessing: clearExpiredBlessings removes expired blessings", () => {
  const player = mockPlayer("user1");
  player.social.active_blessing = {
    type: "discovery_chance_add",
    granted_by: "host1",
    granted_at: nowTs() - (10 * 60 * 60 * 1000), // 10 hours ago
    expires_at: nowTs() - (1 * 60 * 60 * 1000) // expired 1 hour ago
  };
  
  const result = clearExpiredBlessings(player);
  assert.equal(result.social.active_blessing, undefined);
});

test("Party: create party successfully", () => {
  const db = setupTestDb();
  const result = createParty(db, "server1", "leader1", "Test Party");
  
  assert.ok(result.partyId);
  assert.equal(result.partyName, "Test Party");
  
  const party = getParty(db, result.partyId);
  assert.equal(party.party_name, "Test Party");
  assert.equal(party.leader_user_id, "leader1");
  assert.equal(party.members.length, 1);
  assert.equal(party.members[0].user_id, "leader1");
  
  db.close();
});

test("Party: join party successfully", () => {
  const db = setupTestDb();
  const { partyId } = createParty(db, "server1", "leader1", "Test Party");
  
  joinParty(db, partyId, "user2");
  
  const party = getParty(db, partyId);
  assert.equal(party.members.length, 2);
  assert.ok(party.members.find(m => m.user_id === "user2"));
  
  db.close();
});

test("Party: cannot join full party", () => {
  const db = setupTestDb();
  const { partyId } = createParty(db, "server1", "leader1", "Test Party");
  
  // Fill the party (max 4 members)
  joinParty(db, partyId, "user2");
  joinParty(db, partyId, "user3");
  joinParty(db, partyId, "user4");
  
  assert.throws(() => {
    joinParty(db, partyId, "user5");
  }, /Party is full/);
  
  db.close();
});

test("Party: leave party successfully", () => {
  const db = setupTestDb();
  const { partyId } = createParty(db, "server1", "leader1", "Test Party");
  joinParty(db, partyId, "user2");
  
  leaveParty(db, partyId, "user2");
  
  const party = getParty(db, partyId);
  assert.equal(party.members.length, 1);
  assert.equal(party.members[0].user_id, "leader1");
  
  db.close();
});

test("Party: leader leaving promotes another member", () => {
  const db = setupTestDb();
  const { partyId } = createParty(db, "server1", "leader1", "Test Party");
  joinParty(db, partyId, "user2");
  
  leaveParty(db, partyId, "leader1");
  
  const party = getParty(db, partyId);
  assert.equal(party.leader_user_id, "user2");
  assert.equal(party.members.length, 1);
  
  db.close();
});

test("Party: getUserActiveParty returns correct party", () => {
  const db = setupTestDb();
  const { partyId } = createParty(db, "server1", "leader1", "Test Party");
  
  const userParty = getUserActiveParty(db, "leader1");
  assert.ok(userParty);
  assert.equal(userParty.party_id, partyId);
  
  const noParty = getUserActiveParty(db, "nouser");
  assert.equal(noParty, null);
  
  db.close();
});

test("Tip: transfer coins successfully", () => {
  const db = setupTestDb();
  const sender = mockPlayer("user1", 100);
  const receiver = mockPlayer("user2", 50);
  
  const result = transferTip(db, "server1", sender, receiver, 20, "Great service!");
  
  assert.equal(result.sender.coins, 80);
  assert.equal(result.receiver.coins, 70);
  assert.equal(result.sender.lifetime.coins_tipped_out, 20);
  assert.equal(result.receiver.lifetime.coins_tipped_in, 20);
  assert.ok(result.tipId);
  
  db.close();
});

test("Tip: cannot tip self", () => {
  const db = setupTestDb();
  const player = mockPlayer("user1", 100);
  
  assert.throws(() => {
    transferTip(db, "server1", player, player, 10);
  }, /Cannot tip yourself/);
  
  db.close();
});

test("Tip: insufficient coins throws error", () => {
  const db = setupTestDb();
  const sender = mockPlayer("user1", 10);
  const receiver = mockPlayer("user2", 50);
  
  assert.throws(() => {
    transferTip(db, "server1", sender, receiver, 20);
  }, /Insufficient coins/);
  
  db.close();
});

test("Tip: validates amount range", () => {
  const db = setupTestDb();
  const sender = mockPlayer("user1", 100);
  const receiver = mockPlayer("user2", 50);
  
  assert.throws(() => {
    transferTip(db, "server1", sender, receiver, 0);
  }, /must be between/);
  
  assert.throws(() => {
    transferTip(db, "server1", sender, receiver, 20000);
  }, /must be between/);
  
  db.close();
});

test("Tip: getUserTipStats returns correct statistics", () => {
  const db = setupTestDb();
  const sender = mockPlayer("user1", 200);
  const receiver = mockPlayer("user2", 50);
  
  transferTip(db, "server1", sender, receiver, 20);
  transferTip(db, "server1", sender, receiver, 30);
  
  const stats = getUserTipStats(db, "server1", "user1");
  assert.equal(stats.sent.count, 2);
  assert.equal(stats.sent.total, 50);
  assert.equal(stats.received.count, 0);
  assert.equal(stats.received.total, 0);
  
  const receiverStats = getUserTipStats(db, "server1", "user2");
  assert.equal(receiverStats.sent.count, 0);
  assert.equal(receiverStats.received.count, 2);
  assert.equal(receiverStats.received.total, 50);
  
  db.close();
});

test("NPC Affinity: update and get affinity", () => {
  const server = mockServer("server1");
  
  updateNpcAffinity(server, "sleepy_traveler", 10);
  assert.equal(getNpcAffinity(server, "sleepy_traveler"), 10);
  
  updateNpcAffinity(server, "sleepy_traveler", 5);
  assert.equal(getNpcAffinity(server, "sleepy_traveler"), 15);
  
  updateNpcAffinity(server, "sleepy_traveler", -20);
  assert.equal(getNpcAffinity(server, "sleepy_traveler"), 0); // Cannot go below 0
});

test("Community Event: update contributions", () => {
  const server = mockServer("server1");
  
  updateCommunityEvent(server, "event1", 100);
  assert.equal(server.community_events.event1.total_contributions, 100);
  
  updateCommunityEvent(server, "event1", 50);
  assert.equal(server.community_events.event1.total_contributions, 150);
});

test("Community Event: check and unlock milestones", () => {
  const server = mockServer("server1");
  updateCommunityEvent(server, "event1", 100);
  
  const milestones = [
    { id: "m1", threshold: 50, reward: "badge" },
    { id: "m2", threshold: 100, reward: "cosmetic" },
    { id: "m3", threshold: 200, reward: "story" }
  ];
  
  const unlocked = checkEventMilestones(server, "event1", milestones);
  assert.equal(unlocked.length, 2);
  assert.equal(unlocked[0].id, "m1");
  assert.equal(unlocked[1].id, "m2");
  
  // Check again - should not unlock already unlocked
  const unlocked2 = checkEventMilestones(server, "event1", milestones);
  assert.equal(unlocked2.length, 0);
  
  // Add more contributions
  updateCommunityEvent(server, "event1", 100);
  const unlocked3 = checkEventMilestones(server, "event1", milestones);
  assert.equal(unlocked3.length, 1);
  assert.equal(unlocked3[0].id, "m3");
});
