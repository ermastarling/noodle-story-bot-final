import test from "node:test";
import assert from "node:assert/strict";

import { noodleQuestsHandler } from "../src/commands/noodleQuests.js";

function buildBaseInteraction({ userId, id, subcommand, webhookPatch, editReply, reply } = {}) {
  return {
    id,
    guildId: "g-quests",
    guild: { id: "g-quests" },
    channelId: "c-quests",
    user: { id: userId },
    token: `tok-${id}`,
    applicationId: "app-quests",
    deferred: false,
    replied: true,
    client: {
      api: {
        webhooks: () => ({
          messages: () => ({ patch: webhookPatch })
        })
      }
    },
    options: {
      getSubcommand: () => subcommand
    },
    editReply,
    reply,
    deferReply: async () => ({ ok: false })
  };
}

test("Quests command wrapper: acknowledged V2 payload falls back to editReply when raw webhook edit fails", async () => {
  let patchCalls = 0;
  let editReplyCalls = 0;

  const interaction = buildBaseInteraction({
    userId: "u-quests-wrap-1",
    id: `quests-wrap-${Date.now()}`,
    subcommand: "claim",
    webhookPatch: async () => {
      patchCalls += 1;
      throw new Error("raw webhook unavailable");
    },
    editReply: async () => {
      editReplyCalls += 1;
      return { ok: true, mode: "editReplyFallback" };
    },
    reply: async () => ({ ok: false })
  });

  const result = await noodleQuestsHandler(interaction);
  assert.equal(patchCalls, 1);
  assert.equal(editReplyCalls, 1);
  assert.equal(result?.mode, "editReplyFallback");
});

test("Quests command wrapper: INVALID_TYPE on editReply retries raw webhook edit", async () => {
  let patchCalls = 0;
  let editReplyCalls = 0;

  const interaction = buildBaseInteraction({
    userId: "u-quests-wrap-2",
    id: `quests-wrap-invalid-${Date.now()}`,
    subcommand: "claim",
    webhookPatch: async () => {
      patchCalls += 1;
      if (patchCalls === 1) {
        throw new Error("first raw webhook attempt fails");
      }
      return { ok: true, mode: "rawRetry" };
    },
    editReply: async () => {
      editReplyCalls += 1;
      const error = new Error("value is not a valid MessageComponentType");
      error.code = "INVALID_TYPE";
      throw error;
    },
    reply: async () => ({ ok: false })
  });

  const result = await noodleQuestsHandler(interaction);
  assert.equal(patchCalls, 2);
  assert.equal(editReplyCalls, 1);
  assert.equal(result?.mode, "rawRetry");
});
