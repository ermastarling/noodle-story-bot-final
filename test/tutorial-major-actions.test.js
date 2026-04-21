import { strict as assert } from "assert";
import { test } from "node:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { ensureTutorial, getCurrentTutorialStep, advanceTutorial } from "../src/game/tutorial.js";
import { resolveTutorialGateValue, resolveTutorialProgressRowKey } from "../src/game/tutorialRouting.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function freshPlayer() {
  return {};
}

function loadTutorialSteps() {
  const tutorialPath = path.join(__dirname, "..", "content", "tutorial.steps.json");
  return JSON.parse(fs.readFileSync(tutorialPath, "utf-8")).steps ?? [];
}


test("Accept contract: intro_order picker gating and post-accept Buy handoff", () => {
  const player = freshPlayer();
  ensureTutorial(player);

  assert.equal(getCurrentTutorialStep(player)?.id, "intro_order");
  assert.equal(
    resolveTutorialGateValue({ player, gate: "acceptPickerShowBackButton", fallbackValue: true }),
    false
  );

  const result = advanceTutorial(player, "accept");
  assert.equal(result.progressed, true);
  assert.equal(getCurrentTutorialStep(player)?.id, "intro_market");

  assert.equal(
    resolveTutorialGateValue({ player, gate: "showTutorialBuyRowAfterAccept", fallbackValue: false }),
    true
  );
});

test("Buy contract: wrong event does not progress, correct event advances to forage handoff", () => {
  const player = freshPlayer();
  ensureTutorial(player);

  advanceTutorial(player, "accept");
  assert.equal(getCurrentTutorialStep(player)?.id, "intro_market");

  const wrong = advanceTutorial(player, "forage");
  assert.equal(wrong.progressed, false);
  assert.equal(getCurrentTutorialStep(player)?.id, "intro_market");

  const ok = advanceTutorial(player, "buy");
  assert.equal(ok.progressed, true);
  assert.equal(getCurrentTutorialStep(player)?.id, "intro_forage");

  assert.equal(
    resolveTutorialGateValue({ player, gate: "showTutorialForageRowAfterBuy", fallbackValue: false }),
    true
  );
  assert.equal(
    resolveTutorialGateValue({ player, gate: "buyMenuShowSellButton", fallbackValue: true }),
    true
  );
});

test("Cook contract: intro_cook hides picker actions, post-cook hands off to serve", () => {
  const player = freshPlayer();
  ensureTutorial(player);

  advanceTutorial(player, "accept");
  advanceTutorial(player, "buy");
  advanceTutorial(player, "forage");
  assert.equal(getCurrentTutorialStep(player)?.id, "intro_cook");

  assert.equal(
    resolveTutorialGateValue({ player, gate: "cookPickerShowOrdersActions", fallbackValue: true }),
    false
  );

  const ok = advanceTutorial(player, "cook");
  assert.equal(ok.progressed, true);
  assert.equal(getCurrentTutorialStep(player)?.id, "intro_serve");

  assert.equal(
    resolveTutorialGateValue({ player, gate: "showTutorialServeRowAfterCook", fallbackValue: false }),
    true
  );
  assert.equal(
    resolveTutorialGateValue({ player, gate: "servePickerShowOrdersActions", fallbackValue: true }),
    false
  );
});

test("Major action tutorial gates return defaults outside active tutorial", () => {
  const player = {
    tutorial: {
      active: false,
      queue: ["intro_market"],
      completed: ["intro_order", "intro_market", "intro_forage", "intro_cook", "intro_serve"]
    }
  };

  assert.equal(
    resolveTutorialGateValue({ player, gate: "showTutorialBuyRowAfterAccept", fallbackValue: false }),
    false
  );
  assert.equal(
    resolveTutorialGateValue({ player, gate: "showTutorialForageRowAfterBuy", fallbackValue: false }),
    false
  );
  assert.equal(
    resolveTutorialGateValue({ player, gate: "showTutorialServeRowAfterCook", fallbackValue: false }),
    false
  );
  assert.equal(
    resolveTutorialGateValue({ player, gate: "cookPickerShowOrdersActions", fallbackValue: true }),
    true
  );
  assert.equal(
    resolveTutorialGateValue({ player, gate: "servePickerShowOrdersActions", fallbackValue: true }),
    true
  );
});

test("Tutorial sequence: accept -> buy -> forage -> cook -> serve completes with finished=true", () => {
  const player = freshPlayer();
  ensureTutorial(player);

  const sequence = ["accept", "buy", "forage", "cook", "serve"];
  let last = null;

  for (const eventName of sequence) {
    last = advanceTutorial(player, eventName);
    assert.equal(last.progressed, true);
  }

  assert.equal(last?.finished, true);
  assert.equal(player.tutorial?.active, false);
  assert.equal(getCurrentTutorialStep(player), null);
});

test("Tutorial content contract: each step has valid complete_on and a mapped progress row", () => {
  const allowedEvents = new Set(["accept", "buy", "forage", "cook", "serve"]);
  const steps = loadTutorialSteps();

  assert.ok(steps.length > 0);

  for (const step of steps) {
    assert.ok(typeof step.id === "string" && step.id.length > 0);
    assert.ok(allowedEvents.has(step.complete_on), `Unexpected complete_on for ${step.id}: ${step.complete_on}`);

    const player = { tutorial: { active: true, queue: [step.id], completed: [] } };
    assert.notEqual(resolveTutorialProgressRowKey(player), null, `Missing progress-row mapping for ${step.id}`);
  }
});

test("Out-of-order action matrix: tutorial step only progresses on its matching action", () => {
  const steps = loadTutorialSteps();
  const actions = ["accept", "buy", "forage", "cook", "serve"];

  for (const step of steps) {
    const mismatchedActions = actions.filter((a) => a !== step.complete_on);
    for (const action of mismatchedActions) {
      const player = { tutorial: { active: true, queue: [step.id], completed: [] } };
      const before = getCurrentTutorialStep(player)?.id;
      const result = advanceTutorial(player, action);
      const after = getCurrentTutorialStep(player)?.id;

      assert.equal(result.progressed, false, `Step ${step.id} unexpectedly progressed on ${action}`);
      assert.equal(result.finished, false, `Step ${step.id} unexpectedly finished on ${action}`);
      assert.equal(after, before, `Step changed for ${step.id} on ${action}`);
    }
  }
});

