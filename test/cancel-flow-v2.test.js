import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCancelPickerV2Message,
  deriveCancelOutcome
} from "../src/ui/cancelFlowV2.js";

function flattenContainer(payload) {
  const container = payload.components?.[0];
  return container?.components ?? [];
}

function countComponentsDeep(component) {
  if (!component || typeof component !== "object") return 0;
  const children = Array.isArray(component.components) ? component.components : [];
  const accessory = component.accessory && typeof component.accessory === "object" ? [component.accessory] : [];
  return 1
    + children.reduce((sum, child) => sum + countComponentsDeep(child), 0)
    + accessory.reduce((sum, child) => sum + countComponentsDeep(child), 0);
}

function countListDeep(components = []) {
  return (components || []).reduce((sum, component) => sum + countComponentsDeep(component), 0);
}

test("Cancel flow V2: picker includes Cancel Selected action", () => {
  const payload = buildCancelPickerV2Message({
    userId: "u1",
    token: "tok-1",
    entries: [
      { shortId: "AB12", line: "Order AB12" },
      { shortId: "CD34", line: "Order CD34" }
    ],
    selectedShortIds: ["AB12"]
  });

  const components = flattenContainer(payload);
  const actionRows = components.filter((component) => component.type === 1);
  const buttonIds = actionRows.flatMap((row) => row.components.map((button) => button.custom_id));

  assert.equal(buttonIds.some((id) => id.includes(":orders.cancel_picker:cfm:")), true);
});

test("Cancel flow V2: outcome detects canceled order", () => {
  const outcome = deriveCancelOutcome({
    targetOrderId: "OID-123",
    beforeAcceptedOrderIds: ["OID-123", "OID-456"],
    afterAcceptedOrderIds: ["OID-456"]
  });

  assert.equal(outcome.code, "canceled");
});

test("Cancel flow V2: outcome detects missing order", () => {
  const outcome = deriveCancelOutcome({
    targetOrderId: "OID-999",
    beforeAcceptedOrderIds: ["OID-123"],
    afterAcceptedOrderIds: ["OID-123"]
  });

  assert.equal(outcome.code, "missing");
});

test("Cancel flow V2: picker respects component budget with overflow line", () => {
  const entries = Array.from({ length: 40 }, (_, idx) => ({
    shortId: `ID${String(idx + 1).padStart(2, "0")}`,
    line: `Order ${idx + 1}`
  }));

  const payload = buildCancelPickerV2Message({
    userId: "u1",
    token: "tok-1",
    entries,
    selectedShortIds: []
  });

  const components = flattenContainer(payload);
  const totalComponentCount = countListDeep(components);
  assert.ok(totalComponentCount <= 40);

  const overflowLine = components.find((component) =>
    component?.type === 10 && String(component?.content || "").includes("...and")
  );
  assert.ok(Boolean(overflowLine));
});
