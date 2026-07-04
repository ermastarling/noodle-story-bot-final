import test from "node:test";
import assert from "node:assert/strict";

import { buildAcceptPickerV2Message, buildAcceptResultV2Message, deriveAcceptOutcome } from "../src/ui/acceptFlowV2.js";

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

test("Accept flow V2: invalid target order is rejected", () => {
  const outcome = deriveAcceptOutcome({
    targetOrderId: "",
    cap: 3,
    beforeAcceptedOrderIds: [],
    afterAcceptedOrderIds: []
  });

  assert.equal(outcome.code, "invalid");
});

test("Accept flow V2: cap reached outcome is detected", () => {
  const outcome = deriveAcceptOutcome({
    targetOrderId: "order-1",
    cap: 1,
    beforeAcceptedOrderIds: ["order-2"],
    afterAcceptedOrderIds: ["order-2"]
  });

  assert.equal(outcome.code, "cap");
});

test("Accept flow V2: duplicate accept outcome is detected", () => {
  const outcome = deriveAcceptOutcome({
    targetOrderId: "order-1",
    cap: 5,
    beforeAcceptedOrderIds: ["order-1"],
    afterAcceptedOrderIds: ["order-1"]
  });

  assert.equal(outcome.code, "duplicate");
});

test("Accept flow V2: successful accept outcome is detected", () => {
  const outcome = deriveAcceptOutcome({
    targetOrderId: "order-3",
    cap: 5,
    beforeAcceptedOrderIds: ["order-1"],
    afterAcceptedOrderIds: ["order-1", "order-3"]
  });

  assert.equal(outcome.code, "accepted");
});

test("Accept flow V2: result message includes Cook action", () => {
  const payload = buildAcceptResultV2Message({
    userId: "123",
    token: "tok",
    outcomeCode: "accepted",
    detailLine: "ok"
  });

  const rows = payload.components?.[0]?.components?.filter((component) => component?.type === 1) ?? [];
  const actionRow = rows[0] ?? { components: [] };
  const customIds = actionRow.components.map((component) => component.custom_id);
  assert.ok(customIds.some((id) => String(id || "").includes(":orders.accept_result:ck:")));
});

test("Accept flow V2: picker includes Accept Selected action", () => {
  const payload = buildAcceptPickerV2Message({
    userId: "123",
    token: "tok",
    entries: [{ shortId: "A1", line: "Order A1" }],
    selectedShortIds: ["A1"]
  });

  const rows = payload.components?.[0]?.components?.filter((component) => component?.type === 1) ?? [];
  const customIds = rows.flatMap((row) => row.components.map((component) => component.custom_id));
  assert.ok(customIds.some((id) => String(id || "").includes(":orders.accept_picker:cfm:")));
});

test("Accept flow V2: picker respects Discord 40-component limit", () => {
  const entries = Array.from({ length: 20 }, (_, idx) => ({
    shortId: `A${idx + 1}`,
    line: `Order A${idx + 1}`
  }));
  const payload = buildAcceptPickerV2Message({
    userId: "123",
    token: "tok",
    entries,
    currentPage: 0,
    totalPages: 2
  });

  assert.equal(countPayloadComponents(payload) <= 40, true);
});

test("Accept flow V2: direct accept mode uses one-click cfm action", () => {
  const payload = buildAcceptPickerV2Message({
    userId: "123",
    token: "tok",
    entries: [{ shortId: "A1", line: "Order A1" }],
    directAcceptMode: true
  });

  const rows = payload.components?.[0]?.components?.filter((component) => component?.type === 1) ?? [];
  const section = payload.components?.[0]?.components?.find((component) => component?.type === 9);
  const sectionActionId = String(section?.accessory?.custom_id ?? "");
  const rowActionIds = rows.flatMap((row) => row.components.map((component) => String(component.custom_id ?? "")));

  assert.equal(sectionActionId.includes(":orders.accept_picker:cfm:"), true);
  assert.equal(rowActionIds.some((id) => id.includes(":orders.accept_picker:cfm:")), false);
});
