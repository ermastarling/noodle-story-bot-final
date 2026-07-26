import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const indexPath = path.resolve(process.cwd(), "src/index.js");
const source = fs.readFileSync(indexPath, "utf8");

test("interaction defer regression: shared-order cancel/abort actions are pre-deferred", () => {
  const skipStart = source.indexOf("const skipDeferButtons =");
  assert.notEqual(skipStart, -1, "Missing skipDeferButtons declaration");

  const skipEnd = source.indexOf("if (!willShowModal && !skipDeferButtons", skipStart);
  assert.notEqual(skipEnd, -1, "Missing defer guard after skipDeferButtons");

  const skipBlock = source.slice(skipStart, skipEnd);

  assert.equal(
    skipBlock.includes("action:shared_order_confirm_complete"),
    true,
    "shared_order_confirm_complete should remain a skip-defer action"
  );

  assert.equal(
    skipBlock.includes("action:shared_order_abort_cancel"),
    false,
    "shared_order_abort_cancel should be pre-deferred in interactionCreate"
  );

  assert.equal(
    skipBlock.includes("action:shared_order_cancel_complete"),
    false,
    "shared_order_cancel_complete should be pre-deferred in interactionCreate"
  );
});
