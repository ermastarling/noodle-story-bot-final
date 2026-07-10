import test from "node:test";
import assert from "node:assert/strict";

import { buildOrdersBoardV2Message } from "../src/ui/ordersBoardV2.js";

function countComponentsDeep(component) {
  if (!component || typeof component !== "object") return 0;
  const children = Array.isArray(component.components) ? component.components : [];
  const accessory = component.accessory && typeof component.accessory === "object" ? [component.accessory] : [];
  return 1
    + children.reduce((sum, child) => sum + countComponentsDeep(child), 0)
    + accessory.reduce((sum, child) => sum + countComponentsDeep(child), 0);
}

function countPayloadComponents(payload) {
  return (payload.components || []).reduce((sum, component) => sum + countComponentsDeep(component), 0);
}

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

test("Orders board V2: second row keeps Main Menu, Buy, Pantry, then Quests", () => {
  const payload = buildOrdersBoardV2Message({
    userId: "u1",
    token: "tok-3",
    acceptedEntries: [],
    quickActions: [
      { label: "Accept", actionKey: "acc", style: 1, disabled: false },
      { label: "Cook", actionKey: "ck", style: 2, disabled: false },
      { label: "Serve", actionKey: "sv", style: 1, disabled: false },
      { label: "Cancel", actionKey: "cnl", style: 2, disabled: false },
      { label: "Main Menu", actionKey: "nm", style: 2, disabled: false },
      { label: "Buy", actionKey: "buy", style: 2, disabled: false },
      { label: "Pantry", actionKey: "pn", style: 2, disabled: false },
      { label: "Quests", actionKey: "qs", style: 2, disabled: false }
    ]
  });

  const components = flattenComponents(payload);
  const rows = components.filter((c) => c.type === 1);
  assert.equal(rows.length >= 2, true);
  const secondRowIds = rows[1].components.map((btn) => btn.custom_id);
  assert.equal(secondRowIds.length, 4);
  assert.equal(secondRowIds[0].includes(":nm:"), true);
  assert.equal(secondRowIds[1].includes(":buy:"), true);
  assert.equal(secondRowIds[2].includes(":pn:"), true);
  assert.equal(secondRowIds[3].includes(":qs:"), true);
});

test("Orders board V2: accepted summary lines render below accepted orders", () => {
  const payload = buildOrdersBoardV2Message({
    userId: "u1",
    token: "tok-4",
    headerLines: ["Orders"],
    acceptedEntries: [
      { shortId: "AB12", line: "Order AB12", serveReady: true }
    ],
    acceptedSummaryLines: [
      "Bowls Ready\n• Classic Soy Ramen — 1 bowl",
      "Ingredients Needed\n• Soy Broth — You have: 0, you need 2"
    ],
    quickActions: []
  });

  const components = flattenComponents(payload);
  const textBlocks = components
    .filter((component) => component?.type === 10)
    .map((component) => String(component?.content || ""));

  assert.equal(textBlocks.some((line) => line.includes("Bowls Ready")), true);
  assert.equal(textBlocks.some((line) => line.includes("Ingredients Needed")), true);
});

test("Orders board V2: accepted summary lines are budgeted to keep payload within Discord limit", () => {
  const acceptedEntries = Array.from({ length: 20 }, (_, idx) => ({
    shortId: `ID${idx + 1}`,
    line: `Order ${idx + 1}`,
    serveReady: idx % 2 === 0
  }));

  const acceptedSummaryLines = Array.from({ length: 10 }, (_, idx) => `Summary ${idx + 1}\n• detail`);

  const payload = buildOrdersBoardV2Message({
    userId: "u1",
    token: "tok-5",
    headerLines: ["Orders"],
    acceptedEntries,
    acceptedSummaryLines,
    quickActions: [
      { label: "Accept", actionKey: "acc", style: 1, disabled: false },
      { label: "Cook", actionKey: "ck", style: 2, disabled: false },
      { label: "Serve", actionKey: "sv", style: 1, disabled: false },
      { label: "Cancel", actionKey: "cnl", style: 2, disabled: false }
    ]
  });

  assert.equal(countPayloadComponents(payload) <= 40, true);
});
