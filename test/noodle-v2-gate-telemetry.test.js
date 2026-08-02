import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const noodlePath = path.resolve(process.cwd(), "src/commands/noodle.js");
const noodleSource = fs.readFileSync(noodlePath, "utf8");

test("Noodle V2 gate telemetry: bypass emit occurs after route/owner validation", () => {
  const blockStart = noodleSource.indexOf("if (v2Parsed.isV2) {");
  assert.notEqual(blockStart, -1, "Missing V2 parser block");

  const blockEnd = noodleSource.indexOf("const sceneState = getSceneState({", blockStart);
  assert.notEqual(blockEnd, -1, "Missing scene state lookup in V2 block");

  const block = noodleSource.slice(blockStart, blockEnd);
  const invalidGuardIdx = block.indexOf("if (!v2Parsed.valid) {");
  const ownerGuardIdx = block.indexOf("if (isV2OwnerMismatch(v2Parsed, userId)) {");
  const bypassIdx = block.indexOf('emitTelemetry("v2_scene_gate_bypass"');

  assert.notEqual(invalidGuardIdx, -1, "Missing invalid-route guard");
  assert.notEqual(ownerGuardIdx, -1, "Missing owner-mismatch guard");
  assert.equal(
    bypassIdx,
    -1,
    "V2 rollout bypass telemetry should no longer be emitted"
  );
});
