import test from "node:test";
import assert from "node:assert/strict";

import { normalizeAcceptPickerSelectedShortIds } from "../src/commands/noodle.js";

test("Accept picker selection state: retains valid cross-page selections and drops stale ids", () => {
  const normalized = normalizeAcceptPickerSelectedShortIds({
    selectedShortIds: ["P1A", "STALE", "P2B", "P1A"],
    orderTokenByShortId: {
      P1A: "order-page-1-a",
      P2B: "order-page-2-b",
      P2C: "order-page-2-c"
    }
  });

  assert.deepEqual(normalized, ["P1A", "P2B"]);
});
