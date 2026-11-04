import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

delete process.env.NOODLE_SKIP_DB;

const { openDb, getPlayer, upsertPlayer } = await import("../src/db/index.js");
const { newPlayerProfile } = await import("../src/game/player.js");
const { createParty, joinParty, createSharedOrder, contributeToSharedOrder, getSharedOrderContributions } = await import("../src/game/social.js");
const { noodleSocialCommand, sharedOrderModalStateForTest } = await import("../src/commands/noodleSocial.js");

const db = openDb();
const RECIPE_ID = "simple_broth";
const INGREDIENT_ID = "scallions";
const REQUIRED = 15;
const createdServers = [];

after(() => {
  for (const serverId of createdServers) {
    const partyIds = db.prepare("SELECT party_id FROM guild_parties WHERE server_id = ?").all(serverId).map((row) => row.party_id);
    for (const partyId of partyIds) {
      db.prepare("DELETE FROM shared_order_contributions WHERE shared_order_id IN (SELECT shared_order_id FROM shared_orders WHERE party_id = ?)").run(partyId);
      db.prepare("DELETE FROM shared_orders WHERE party_id = ?").run(partyId);
      db.prepare("DELETE FROM party_members WHERE party_id = ?").run(partyId);
      db.prepare("DELETE FROM guild_parties WHERE party_id = ?").run(partyId);
    }
    db.prepare("DELETE FROM players WHERE server_id = ?").run(serverId);
  }
});

function setupParty() {
  const suffix = crypto.randomUUID().slice(0, 8);
  const serverId = `solo-guild-${suffix}`;
  const leaderId = `solo-leader-${suffix}`;
  const memberId = `solo-member-${suffix}`;
  createdServers.push(serverId);
  for (const userId of [leaderId, memberId]) {
    const player = newPlayerProfile(userId);
    player.inv_ingredients = { [INGREDIENT_ID]: 100 };
    upsertPlayer(db, serverId, userId, player, null, player.schema_version);
  }
  const { partyId } = createParty(db, serverId, leaderId, "Solo Test");
  joinParty(db, serverId, partyId, memberId);
  const { sharedOrderId } = createSharedOrder(db, partyId, RECIPE_ID, serverId, 5);
  return { serverId, leaderId, memberId, sharedOrderId };
}

function buildInteraction({ serverId, userId, customId, fields }) {
  const calls = [];
  const record = (name) => async (payload) => {
    calls.push({ name, payload });
    return { id: "msg-1" };
  };
  const interaction = {
    id: `i-${crypto.randomUUID()}`,
    customId,
    guildId: serverId,
    channelId: "chan-1",
    user: { id: userId, username: "tester" },
    member: { id: userId, user: { id: userId, username: "tester" }, displayName: "tester" },
    message: { id: "m-1", flags: 0 },
    deferred: true,
    replied: false,
    isButton: () => !fields,
    isModalSubmit: () => Boolean(fields),
    isMessageComponent: () => !fields,
    isSelectMenu: () => false,
    fields: fields ? { getTextInputValue: () => fields.quantity } : undefined,
    reply: record("reply"),
    editReply: record("editReply"),
    update: record("update"),
    followUp: record("followUp"),
    deferUpdate: async () => {},
    deleteReply: async () => {}
  };
  return { interaction, calls };
}

const routes = {
  "quantity button": ({ serverId, userId, quantity }) => buildInteraction({
    serverId,
    userId,
    customId: `noodle-social:action:shared_order_contribute_qty:${userId}:${INGREDIENT_ID}:${quantity}`
  }),
  modal: ({ serverId, userId, quantity }) => {
    const modalId = crypto.randomUUID();
    sharedOrderModalStateForTest.set(modalId, { ownerId: userId, ingredientId: INGREDIENT_ID, sourceMessageId: "m-1", sourceChannelId: "chan-1" });
    return buildInteraction({
      serverId,
      userId,
      customId: `noodle-social:modal:shared_order:${modalId}`,
      fields: { quantity: String(quantity) }
    });
  }
};

function snapshot(serverId, userId, sharedOrderId) {
  return {
    owned: getPlayer(db, serverId, userId).inv_ingredients?.[INGREDIENT_ID] ?? 0,
    contributions: JSON.stringify(getSharedOrderContributions(db, sharedOrderId))
  };
}

for (const [routeName, buildRoute] of Object.entries(routes)) {
  test(`Shared order (${routeName}): leader cannot make the final contribution before a non-leader helps`, async () => {
    const { serverId, leaderId, sharedOrderId } = setupParty();
    const before = snapshot(serverId, leaderId, sharedOrderId);
    const { interaction, calls } = buildRoute({ serverId, userId: leaderId, quantity: REQUIRED });
    await noodleSocialCommand.handleComponent(interaction);

    assert.deepEqual(snapshot(serverId, leaderId, sharedOrderId), before, "inventory and contribution rows are unchanged");
    assert.match(JSON.stringify(calls), /other party member must contribute/);
  });

  test(`Shared order (${routeName}): leader can contribute part of the order`, async () => {
    const { serverId, leaderId, sharedOrderId } = setupParty();
    const { interaction } = buildRoute({ serverId, userId: leaderId, quantity: REQUIRED - 1 });
    await noodleSocialCommand.handleComponent(interaction);

    const after = snapshot(serverId, leaderId, sharedOrderId);
    assert.equal(after.owned, 100 - (REQUIRED - 1));
    assert.equal(getSharedOrderContributions(db, sharedOrderId).find((c) => c.user_id === leaderId)?.quantity, REQUIRED - 1);
  });

  test(`Shared order (${routeName}): leader can make the final contribution once a non-leader has helped`, async () => {
    const { serverId, leaderId, memberId, sharedOrderId } = setupParty();
    contributeToSharedOrder(db, sharedOrderId, memberId, INGREDIENT_ID, 1);
    const { interaction, calls } = buildRoute({ serverId, userId: leaderId, quantity: REQUIRED - 1 });
    await noodleSocialCommand.handleComponent(interaction);

    assert.equal(snapshot(serverId, leaderId, sharedOrderId).owned, 100 - (REQUIRED - 1));
    assert.doesNotMatch(JSON.stringify(calls), /other party member must contribute/);

    const completion = buildInteraction({
      serverId,
      userId: leaderId,
      customId: `noodle-social:action:shared_order_complete:${leaderId}`
    });
    completion.interaction.message = null;
    await noodleSocialCommand.handleComponent(completion.interaction);
    assert.match(JSON.stringify(completion.calls), /shared_order_confirm_complete/);

    const confirmation = buildInteraction({
      serverId,
      userId: leaderId,
      customId: `noodle-social:action:shared_order_confirm_complete:${leaderId}`
    });
    confirmation.interaction.message = null;
    await noodleSocialCommand.handleComponent(confirmation.interaction);
    assert.equal(
      db.prepare("SELECT status FROM shared_orders WHERE shared_order_id = ?").get(sharedOrderId).status,
      "completed"
    );
    assert.ok(confirmation.calls.length > 0, "completion returns a response");
  });
}
