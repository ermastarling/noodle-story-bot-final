import test from "node:test";
import assert from "node:assert/strict";

import {
  buildServePickerV2Message,
  buildServeResultV2Message,
  deriveServeOutcome
} from "../src/ui/serveFlowV2.js";

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
