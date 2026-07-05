import test from "node:test";
import assert from "node:assert/strict";

import {
  buildServePickerV2Message,
  buildServeResultV2Message,
  deriveServeOutcome
} from "../src/ui/serveFlowV2.js";

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

test("Serve flow V2: successful serve outcome is detected", () => {
  const outcome = deriveServeOutcome({
    targetOrderId: "ord-1",
    beforeAcceptedOrderIds: ["ord-1"],
    afterAcceptedOrderIds: [],
    beforeBowlCount: 1,
    afterBowlCount: 0,
    wasExpiredBefore: false
  });

  assert.equal(outcome.code, "served");
});

test("Serve flow V2: missing bowl outcome is detected", () => {
  const outcome = deriveServeOutcome({
    targetOrderId: "ord-1",
    beforeAcceptedOrderIds: ["ord-1"],
    afterAcceptedOrderIds: ["ord-1"],
    beforeBowlCount: 0,
    afterBowlCount: 0,
    wasExpiredBefore: false
  });

  assert.equal(outcome.code, "missing_bowl");
});

test("Serve flow V2: expired outcome is detected", () => {
  const outcome = deriveServeOutcome({
    targetOrderId: "ord-1",
    beforeAcceptedOrderIds: ["ord-1"],
    afterAcceptedOrderIds: [],
    beforeBowlCount: 0,
    afterBowlCount: 0,
    wasExpiredBefore: true
  });

  assert.equal(outcome.code, "expired");
});

test("Serve flow V2: expired outcome takes precedence over missing bowl", () => {
  const outcome = deriveServeOutcome({
    targetOrderId: "ord-1",
    beforeAcceptedOrderIds: ["ord-1"],
    afterAcceptedOrderIds: ["ord-1"],
    beforeBowlCount: 0,
    afterBowlCount: 0,
    wasExpiredBefore: true
  });

  assert.equal(outcome.code, "expired");
});

test("Serve flow V2: picker message includes serve selected action", () => {
  const payload = buildServePickerV2Message({
    userId: "123",
    token: "tok",
    entries: [{ shortId: "AB12", line: "Order AB12" }],
    selectedShortIds: ["AB12"]
  });

  const rows = payload.components?.[0]?.components?.filter((component) => component?.type === 1) ?? [];
  const customIds = rows.flatMap((row) => row.components.map((component) => component.custom_id));
  assert.ok(customIds.some((id) => String(id || "").includes(":serve.order_picker:cfm:")));
  assert.ok(customIds.some((id) => String(id || "").includes(":serve.order_picker:sfa:")));
});

test("Serve flow V2: serve all action is disabled when not all orders are ready", () => {
  const payload = buildServePickerV2Message({
    userId: "123",
    token: "tok",
    entries: [{ shortId: "AB12", line: "Order AB12" }],
    selectedShortIds: ["AB12"],
    canServeAll: false
  });

  const rows = payload.components?.[0]?.components?.filter((component) => component?.type === 1) ?? [];
  const buttons = rows.flatMap((row) => row.components);
  const serveAllButton = buttons.find((component) => String(component?.custom_id || "").includes(":serve.order_picker:sfa:"));
  assert.equal(Boolean(serveAllButton), true);
  assert.equal(Boolean(serveAllButton?.disabled), true);
});

test("Serve flow V2: serve all action is green when all orders are ready", () => {
  const payload = buildServePickerV2Message({
    userId: "123",
    token: "tok",
    entries: [{ shortId: "AB12", line: "Order AB12" }],
    selectedShortIds: [],
    canServeAll: true
  });

  const rows = payload.components?.[0]?.components?.filter((component) => component?.type === 1) ?? [];
  const buttons = rows.flatMap((row) => row.components);
  const serveAllButton = buttons.find((component) => String(component?.custom_id || "").includes(":serve.order_picker:sfa:"));
  assert.equal(Boolean(serveAllButton), true);
  assert.equal(Boolean(serveAllButton?.disabled), false);
  assert.equal(Number(serveAllButton?.style || 0), 3);
});

test("Serve flow V2: result message includes next actions", () => {
  const payload = buildServeResultV2Message({
    userId: "123",
    token: "tok",
    outcomeCode: "served",
    detailLine: "ok"
  });

  const rows = payload.components?.[0]?.components?.filter((component) => component?.type === 1) ?? [];
  const actionRow = rows[0] ?? { components: [] };
  const customIds = actionRow.components.map((component) => component.custom_id);
  assert.ok(customIds.some((id) => String(id || "").includes(":serve.result:ord:")));
  assert.ok(customIds.some((id) => String(id || "").includes(":serve.result:cook:")));
  assert.ok(customIds.some((id) => String(id || "").includes(":serve.result:again:")));
});

test("Serve flow V2: picker respects Discord 40-component limit", () => {
  const entries = Array.from({ length: 20 }, (_, idx) => ({
    shortId: `S${idx + 1}`,
    line: `Order S${idx + 1}`
  }));
  const payload = buildServePickerV2Message({
    userId: "123",
    token: "tok",
    entries
  });

  assert.equal(countPayloadComponents(payload) <= 40, true);
});

test("Serve flow V2: picker confirm count ignores stale selected IDs", () => {
  const payload = buildServePickerV2Message({
    userId: "123",
    token: "tok",
    entries: [{ shortId: "AB12", line: "Order AB12" }],
    selectedShortIds: ["AB12", "ZZ99"]
  });

  const rows = payload.components?.[0]?.components?.filter((component) => component?.type === 1) ?? [];
  const actionRow = rows[0] ?? { components: [] };
  const confirmButton = actionRow.components.find((component) => String(component?.custom_id || "").includes(":serve.order_picker:cfm:"));
  assert.equal(confirmButton?.label, "Serve Selected (1)");
});
