import test from "node:test";
import assert from "node:assert/strict";

// Keep the test off the on-disk game database.
process.env.NOODLE_SKIP_DB = "1";

const { noodleCommand } = await import("../src/commands/noodle.js");
const { putSceneState } = await import("../src/ui/sceneStateV2.js");

function buildInteraction({ customId, userId }) {
  const calls = [];
  const record = (name) => async (payload) => {
    calls.push({ name, payload });
    return { id: "msg-1" };
  };
  const interaction = {
    customId,
    user: { id: userId, username: "tester" },
    member: { id: userId, user: { id: userId, username: "tester" }, displayName: "tester" },
    guildId: "guild-menu-test",
    channelId: "chan-1",
    message: { id: "m-1", flags: 0 },
    deferred: true,
    replied: false,
    isButton: () => true,
    isMessageComponent: () => true,
    options: { getString: () => null, getInteger: () => null, getBoolean: () => null },
    reply: record("reply"),
    editReply: record("editReply"),
    update: record("update"),
    followUp: record("followUp"),
    deferUpdate: async () => {}
  };
  return { interaction, calls };
}

test("Orders board V2: Menu click with live scene state opens the daily menu, not the unwired fallback", async () => {
  const userId = "u-menu-1";
  const { token } = putSceneState({
    sceneKey: "orders.board",
    ownerId: userId,
    state: {},
    ttlMs: 60_000
  });
  const { interaction, calls } = buildInteraction({
    customId: `noodle:v2:orders.board:dm:${userId}:${token}`,
    userId
  });

  await noodleCommand.handleComponent(interaction);

  const serialized = JSON.stringify(calls);
  assert.ok(calls.length > 0, "expected the handler to respond");
  assert.ok(!serialized.includes("not wired yet"), "Menu click must not hit the unwired fallback");
  assert.ok(!serialized.includes("expired or is invalid"), "Menu click must not be rejected as invalid");
});
