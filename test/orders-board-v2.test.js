import test from "node:test";
import assert from "node:assert/strict";

import { buildOrdersBoardV2Message } from "../src/ui/ordersBoardV2.js";

function flattenComponents(payload) {
  const container = payload.components?.[0];
  return container?.components ?? [];
}

test("Orders board V2: inline Serve Ready appears only for serveable accepted orders", () => {
  const payload = buildOrdersBoardV2Message({
    userId: "u1",
    token: "tok-1",
    headerLines: ["Orders"],
    acceptedEntries: [
      { shortId: "AB12", line: "Order AB12", serveReady: true },
      { shortId: "CD34", line: "Order CD34", serveReady: false }
    ],
    quickActions: []
  });

  const components = flattenComponents(payload);
  const serveSections = components.filter((c) => c.type === 9 && c.accessory?.custom_id?.includes(":sv:"));

  assert.equal(serveSections.length, 1);
  assert.match(serveSections[0].accessory.custom_id, /:AB12$/);
});

test("Orders board V2: quick actions are deduplicated by action key", () => {
  const payload = buildOrdersBoardV2Message({
    userId: "u1",
    token: "tok-2",
    acceptedEntries: [],
    quickActions: [
      { label: "Refresh", actionKey: "rf", style: 2, disabled: false },
      { label: "Refresh Again", actionKey: "rf", style: 2, disabled: false },
      { label: "Cook", actionKey: "ck", style: 2, disabled: false }
    ]
  });

  const components = flattenComponents(payload);
  const rows = components.filter((c) => c.type === 1);
  const buttonIds = rows.flatMap((row) => row.components.map((btn) => btn.custom_id));

  const refreshButtons = buttonIds.filter((id) => id.includes(":rf:"));
  const cookButtons = buttonIds.filter((id) => id.includes(":ck:"));

  assert.equal(refreshButtons.length, 1);
  assert.equal(cookButtons.length, 1);
});
