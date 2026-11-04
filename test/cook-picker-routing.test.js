import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const noodlePath = path.resolve(process.cwd(), "src/commands/noodle.js");
const noodleSource = fs.readFileSync(noodlePath, "utf8");

function sliceBetween(source, startToken, endToken) {
  const startIdx = source.indexOf(startToken);
  assert.notEqual(startIdx, -1, `Missing token: ${startToken}`);
  const endIdx = source.indexOf(endToken, startIdx + startToken.length);
  assert.notEqual(endIdx, -1, `Missing token: ${endToken}`);
  return source.slice(startIdx, endIdx);
}

test("Every normal Cook button opens the same V2 recipe picker scene", () => {
  assert.equal(noodleSource.includes("function buildCookPickerPayload("), false, "legacy cook picker layout must stay removed");
  const body = sliceBetween(
    noodleSource,
    "if (action === \"cook\") {\n  const p = ensurePlayer(serverId, userId);",
    "if (action === \"takeout_cook\") {"
  );
  assert.match(body, /buildCookRecipePickerScenePayload\(/, "noodle:pick:cook should use the V2 recipe picker scene");
});

test("Cook picker options list recipe ingredients like the kitchen broth picker", () => {
  const body = sliceBetween(
    noodleSource,
    "function buildCookIngredientOptionDescription(",
    "function buildCookRecipePickerSceneEntries("
  );
  assert.match(body, /\(opt\)/);
  assert.match(body, /\| Max \$\{cookable\}/);
  assert.match(noodleSource, /optionDescription: buildCookIngredientOptionDescription\(/);
});

test("Takeout cook picker uses takeout cook select custom id", () => {
  const body = sliceBetween(
    noodleSource,
    "function buildTakeoutCookPickerPayload(",
    "function buildTakeoutServePickerPayload("
  );
  assert.match(
    body,
    /setCustomId\(`noodle:pick:takeout_cook_select:\$\{userId\}:\$\{safePage\}:\$\{Date\.now\(\)\.toString\(36\)\}`\)/,
    "Takeout cook picker should emit noodle:pick:takeout_cook_select"
  );
  assert.doesNotMatch(
    body,
    /setCustomId\(`noodle:pick:cook_select:/,
    "Takeout cook picker should not emit normal cook custom id"
  );
});

test("Cook select handlers exist for both normal and takeout routes", () => {
  assert.match(
    noodleSource,
    /if \(cid\.startsWith\("noodle:pick:cook_select:"\)\)/,
    "Missing normal cook select handler"
  );
  assert.match(
    noodleSource,
    /if \(cid\.startsWith\("noodle:pick:takeout_cook_select:"\)\)/,
    "Missing takeout cook select handler"
  );
});

test("Takeout serve does not consume main order board slots", () => {
  const body = sliceBetween(
    noodleSource,
    "if (sub === \"takeout_serve\") {",
    "if (sub === \"takeout_claim\") {"
  );
  assert.doesNotMatch(
    body,
    /markOrderConsumed\(/,
    "Takeout serve should not mark main order board slots as consumed"
  );
});
