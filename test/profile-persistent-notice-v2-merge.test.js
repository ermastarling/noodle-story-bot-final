import test from "node:test";
import assert from "node:assert/strict";

import { buildProfileHomeV2Message } from "../src/ui/profileFlowV2.js";
import {
  applyPersistentNoticeCardsForTest,
  convertLegacyEmbedPayloadToComponentsV2ForTest
} from "../src/commands/noodle.js";

function extractTextComponents(nodes = []) {
  const out = [];
  const stack = Array.isArray(nodes) ? [...nodes] : [];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Number(node.type) === 10 && typeof node.content === "string") {
      out.push(node.content);
    }
    if (Array.isArray(node.components)) {
      stack.push(...node.components);
    }
  }
  return out;
}

test("Profile V2 + persistent notice merge preserves profile body and avoids fallback text", () => {
  const v2ProfilePayload = buildProfileHomeV2Message({
    userId: "123456789012345678",
    ownerId: "123456789012345678",
    viewingSelf: false,
    embed: {
      title: "Profile",
      description: "Your cozy noodle shop status.",
      fields: [
        { name: "Bowls Served", value: "42", inline: true },
        { name: "Level", value: "4", inline: true },
        { name: "REP", value: "88", inline: true },
        { name: "Coins", value: "1234", inline: true }
      ]
    }
  });

  const merged = applyPersistentNoticeCardsForTest(v2ProfilePayload, [{
    title: "Tip Received",
    details: ["<@111> tipped you **100c**."],
    tone: "success"
  }]);

  assert.equal(Array.isArray(merged.mainComponents), true);
  assert.equal(Array.isArray(merged.notices), true);
  assert.equal(merged.notices.length, 1);

  const textBlob = extractTextComponents(merged.mainComponents).join("\n");
  assert.equal(textBlob.includes("Profile"), true);
  assert.equal(textBlob.includes("cozy noodle shop"), true);
  assert.equal(textBlob.includes("Status unavailable."), false);
});

test("Profile V2 conversion keeps main container when multiple notices are present", () => {
  const v2ProfilePayload = buildProfileHomeV2Message({
    userId: "123456789012345678",
    ownerId: "123456789012345678",
    viewingSelf: false,
    embed: {
      title: "Profile",
      description: "Persistent profile body should remain visible.",
      fields: [
        { name: "Bowls Served", value: "42", inline: true },
        { name: "Level", value: "4", inline: true },
        { name: "REP", value: "88", inline: true },
        { name: "Coins", value: "1234", inline: true }
      ]
    }
  });

  const payloadWithNotices = {
    ...v2ProfilePayload,
    notices: [
      {
        title: "Subscription Perks Unlocked",
        details: ["24/7 House unlocked.", "Take Out Counter unlocked."],
        tone: "success"
      },
      {
        title: "Blessing Received",
        details: ["Effect: Enhanced Discovery for 6h."],
        tone: "success"
      }
    ]
  };

  const converted = convertLegacyEmbedPayloadToComponentsV2ForTest(payloadWithNotices);
  assert.equal(Array.isArray(converted.components), true);

  const stack = [...converted.components];
  const textParts = [];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Number(node.type) === 10 && typeof node.content === "string") {
      textParts.push(node.content);
    }
    if (Array.isArray(node.components)) {
      stack.push(...node.components);
    }
  }

  const textBlob = textParts.join("\n");
  assert.equal(textBlob.includes("Persistent profile body should remain visible."), true);
  assert.equal(textBlob.includes("Status unavailable."), false);
});
