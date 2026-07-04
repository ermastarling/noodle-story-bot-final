import test from "node:test";
import assert from "node:assert/strict";

import { buildProfileHomeV2Message } from "../src/ui/profileFlowV2.js";

test("Profile flow V2: button emojis are normalized to emoji objects", () => {
  const payload = buildProfileHomeV2Message({
    userId: "123",
    viewingSelf: true,
    buttonEmoji: {
      orders: "<:orders:147000000000000000>",
      cart: "🛒"
    },
    embed: {
      title: "Profile",
      description: "desc",
      fields: []
    }
  });

  const container = payload.components?.[0]?.components ?? [];
  const rows = container.filter((node) => node?.type === 1);
  const buttons = rows.flatMap((row) => row.components ?? []);

  const ordersButton = buttons.find((button) => button?.custom_id === "noodle:nav:orders:123");
  assert.ok(ordersButton);
  assert.deepEqual(ordersButton.emoji, {
    name: "orders",
    id: "147000000000000000",
    animated: false
  });

  const buyButton = buttons.find((button) => button?.custom_id === "noodle:nav:buy:123");
  assert.ok(buyButton);
  assert.deepEqual(buyButton.emoji, { name: "🛒" });

  const statBlock = container.find((node) => node?.type === 10 && String(node?.content || "").includes("Bowls Served"));
  assert.ok(statBlock);
  assert.match(String(statBlock.content), /```/);
  assert.match(String(statBlock.content), /Bowls Served\s+\|\s+Level/);
  assert.match(String(statBlock.content), /REP\s+\|\s+Coins/);
  assert.equal(String(statBlock.content).includes("| Stat | Value |"), false);
});