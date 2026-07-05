import test from "node:test";
import assert from "node:assert/strict";

import { V2_SCENE_REGISTRY, isV2OwnerMismatch, parseV2CustomId } from "../src/ui/sceneRoutingV2.js";

test("V2 parser: parses valid route and args", () => {
  const parsed = parseV2CustomId("noodle:v2:orders.board:acc:123:tok123:argA:argB");

  assert.equal(parsed.isV2, true);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.sceneKey, "orders.board");
  assert.equal(parsed.actionKey, "acc");
  assert.equal(parsed.ownerId, "123");
  assert.deepEqual(parsed.args, ["argA", "argB"]);
});

test("V2 parser: rejects malformed IDs", () => {
  const parsed = parseV2CustomId("noodle:v2:orders.board:acc:123");

  assert.equal(parsed.isV2, true);
  assert.equal(parsed.valid, false);
  assert.equal(parsed.error, "missing_required_segments");
});

test("V2 parser: rejects unknown scene/action routes", () => {
  const parsed = parseV2CustomId("noodle:v2:unknown.scene:go:123:tok");

  assert.equal(parsed.isV2, true);
  assert.equal(parsed.valid, false);
  assert.equal(parsed.error, "unknown_scene_action");
});

test("V2 parser: owner mismatch helper returns true for non-owner", () => {
  const parsed = parseV2CustomId("noodle:v2:orders.board:acc:123:tok");

  assert.equal(parsed.valid, true);
  assert.equal(isV2OwnerMismatch(parsed, "999"), true);
  assert.equal(isV2OwnerMismatch(parsed, "123"), false);
});

test("V2 parser: accepts cook action from accept result scene", () => {
  const parsed = parseV2CustomId("noodle:v2:orders.accept_result:ck:123:tok");

  assert.equal(parsed.valid, true);
  assert.equal(parsed.sceneKey, "orders.accept_result");
  assert.equal(parsed.actionKey, "ck");
});

test("V2 parser: accepts accept picker page route", () => {
  const parsed = parseV2CustomId("noodle:v2:orders.accept_picker:pg:123:tok:next");

  assert.equal(parsed.valid, true);
  assert.equal(parsed.sceneKey, "orders.accept_picker");
  assert.equal(parsed.actionKey, "pg");
  assert.deepEqual(parsed.args, ["next"]);
});

test("V2 parser: accepts cook recipe picker qty route", () => {
  const parsed = parseV2CustomId("noodle:v2:cook.recipe_picker:qty:123:tok:p5");

  assert.equal(parsed.valid, true);
  assert.equal(parsed.sceneKey, "cook.recipe_picker");
  assert.equal(parsed.actionKey, "qty");
  assert.deepEqual(parsed.args, ["p5"]);
});

test("V2 parser: accepts cook minigame action route", () => {
  const parsed = parseV2CustomId("noodle:v2:cook.minigame:plate:123:tok");

  assert.equal(parsed.valid, true);
  assert.equal(parsed.sceneKey, "cook.minigame");
  assert.equal(parsed.actionKey, "plate");
});

test("V2 parser: accepts cook result action route", () => {
  const parsed = parseV2CustomId("noodle:v2:cook.result:cook:123:tok");

  assert.equal(parsed.valid, true);
  assert.equal(parsed.sceneKey, "cook.result");
  assert.equal(parsed.actionKey, "cook");
});

test("V2 parser: rejects unsupported serve order picker route", () => {
  const parsed = parseV2CustomId("noodle:v2:serve.order_picker:serve:123:tok");

  assert.equal(parsed.valid, false);
  assert.equal(parsed.error, "unknown_scene_action");
});

test("V2 parser: accepts serve order picker confirm route", () => {
  const parsed = parseV2CustomId("noodle:v2:serve.order_picker:cfm:123:tok");

  assert.equal(parsed.valid, true);
  assert.equal(parsed.sceneKey, "serve.order_picker");
  assert.equal(parsed.actionKey, "cfm");
});

test("V2 parser: accepts serve result route", () => {
  const parsed = parseV2CustomId("noodle:v2:serve.result:again:123:tok");

  assert.equal(parsed.valid, true);
  assert.equal(parsed.sceneKey, "serve.result");
  assert.equal(parsed.actionKey, "again");
});

test("V2 parser: accepts cancel picker route", () => {
  const parsed = parseV2CustomId("noodle:v2:orders.cancel_picker:cfm:123:tok");

  assert.equal(parsed.valid, true);
  assert.equal(parsed.sceneKey, "orders.cancel_picker");
  assert.equal(parsed.actionKey, "cfm");
});

test("V2 parser: accepts orders board buy route", () => {
  const parsed = parseV2CustomId("noodle:v2:orders.board:buy:123:tok");

  assert.equal(parsed.valid, true);
  assert.equal(parsed.sceneKey, "orders.board");
  assert.equal(parsed.actionKey, "buy");
});

test("V2 parser: accepts orders board pantry route", () => {
  const parsed = parseV2CustomId("noodle:v2:orders.board:pn:123:tok");

  assert.equal(parsed.valid, true);
  assert.equal(parsed.sceneKey, "orders.board");
  assert.equal(parsed.actionKey, "pn");
});

test("V2 parser: accepts orders board forage tutorial route", () => {
  const parsed = parseV2CustomId("noodle:v2:orders.board:fg:123:tok");

  assert.equal(parsed.valid, true);
  assert.equal(parsed.sceneKey, "orders.board");
  assert.equal(parsed.actionKey, "fg");
});

test("V2 parser: tutorial forage route accepts optional arg payload", () => {
  const parsed = parseV2CustomId("noodle:v2:orders.board:fg:123:tok:intro");

  assert.equal(parsed.valid, true);
  assert.equal(parsed.sceneKey, "orders.board");
  assert.equal(parsed.actionKey, "fg");
  assert.deepEqual(parsed.args, ["intro"]);
});

test("V2 parser: accepts all registered scene routes", () => {
  for (const [sceneKey, actionSet] of Object.entries(V2_SCENE_REGISTRY)) {
    for (const actionKey of actionSet) {
      const customId = `noodle:v2:${sceneKey}:${actionKey}:123:tok`;
      const parsed = parseV2CustomId(customId);
      assert.equal(parsed.valid, true, `expected valid parser result for ${customId}`);
      assert.equal(parsed.sceneKey, sceneKey);
      assert.equal(parsed.actionKey, actionKey);
    }
  }
});

test("V2 parser: rejects prototype scene keys without throwing", () => {
  const parsed = parseV2CustomId("noodle:v2:__proto__:has:123:tok");
  assert.equal(parsed.isV2, true);
  assert.equal(parsed.valid, false);
  assert.equal(parsed.error, "unknown_scene_action");
});
