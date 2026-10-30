import test from "node:test";
import assert from "node:assert/strict";

process.env.NOODLE_SKIP_DB = "1";

const { componentCommitForTest, replyInitialForTest } = await import("../src/commands/noodleSocial.js");

function buildInteraction() {
  const callbacks = [];
  const interaction = {
    id: "i-1",
    token: "tok",
    applicationId: "app-1",
    guildId: "g-1",
    user: { id: "u-1", username: "tester" },
    message: { id: "m-1" },
    deferred: false,
    replied: false,
    isButton: () => true,
    isMessageComponent: () => true,
    client: {
      token: "bot",
      user: { id: "app-1" },
      api: { interactions: () => ({ callback: { post: async (arg) => { callbacks.push(arg); } } }) }
    },
    // discord.js v13 rejects Components V2 types here
    reply: async () => {
      const err = new TypeError("Supplied data.type is not a valid MessageComponentType.");
      err.code = "INVALID_TYPE";
      throw err;
    }
  };
  return { interaction, callbacks };
}

test("Social: ephemeral Components V2 reply goes through the raw interaction callback", async () => {
  const { interaction, callbacks } = buildInteraction();
  await componentCommitForTest(interaction, {
    mainComponents: [{ type: 10, content: "Not enough ingredients." }],
    notices: [],
    ephemeral: true
  });
  assert.equal(callbacks.length, 1);
  assert.equal(callbacks[0].data.type, 4);
  assert.equal(callbacks[0].data.data.components[0].type, 17);
  const flags = callbacks[0].data.data.flags;
  assert.ok((flags & 64) !== 0, "ephemeral flag kept");
  assert.ok((flags & (1 << 15)) !== 0, "Components V2 flag kept");
  assert.equal(interaction.replied, true);
});

function collectText(node, out = []) {
  if (Array.isArray(node)) node.forEach((child) => collectText(child, out));
  else if (node && typeof node === "object") {
    if (node.type === 10 && typeof node.content === "string") out.push(node.content);
    Object.values(node).forEach((child) => collectText(child, out));
  }
  return out;
}

test("Social: plain error text containing a scene keyword is not replaced by the scene banner", async () => {
  for (const text of [
    "You've reached your max ingredient slots for this shared order. Ask teammates to cover another ingredient.",
    "You're not in a party.",
    "You've already contributed your full share of this shared order (**8/8** items)."
  ]) {
    const { interaction, callbacks } = buildInteraction();
    await componentCommitForTest(interaction, { content: text, ephemeral: true });
    const rendered = collectText(callbacks[0].data.data.components).join("\n");
    assert.ok(rendered.includes(text), `message text must survive: ${text}`);
  }
});

test("Social: initial slash-command replies with V2 payloads use the raw callback, classic ones use reply()", async () => {
  const { interaction, callbacks } = buildInteraction();
  await replyInitialForTest(interaction, {
    components: [{ type: 17, components: [{ type: 10, content: "Removed member." }] }],
    flags: (1 << 15) | 64
  });
  assert.equal(callbacks.length, 1);
  assert.equal(callbacks[0].data.type, 4);

  const classic = buildInteraction();
  let called = 0;
  classic.interaction.reply = async () => { called += 1; };
  await replyInitialForTest(classic.interaction, { content: "hi", ephemeral: true });
  assert.equal(called, 1);
  assert.equal(classic.callbacks.length, 0);
});
