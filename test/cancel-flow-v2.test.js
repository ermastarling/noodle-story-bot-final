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
