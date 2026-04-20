import { strict as assert } from "assert";
import { test } from "node:test";

import {
  resolveForageNavSub,
  resolveNavSubForTutorial,
  resolveTutorialGateValue,
  resolveTutorialProgressRowKey
} from "../src/game/tutorialRouting.js";

test("Forage nav routes to direct forage during intro_forage tutorial step", () => {
  const player = {
    tutorial: {
      active: true,
      queue: ["intro_forage"],
      completed: ["intro_order", "intro_market"]
    }
  };

  assert.equal(resolveForageNavSub(player), "forage");
  assert.equal(
    resolveNavSubForTutorial({ player, action: "forage", fallbackSub: "forage" }),
    "forage"
  );
});

test("Forage nav routes to forage menu outside intro_forage tutorial step", () => {
  const player = {
    tutorial: {
      active: true,
      queue: ["intro_cook"],
      completed: ["intro_order", "intro_market", "intro_forage"]
    }
  };

  assert.equal(resolveForageNavSub(player), "forage_menu");
  assert.equal(
    resolveNavSubForTutorial({ player, action: "forage", fallbackSub: "forage" }),
    "forage_menu"
  );
});

test("Forage nav routes to forage menu when tutorial is inactive", () => {
  const player = {
    tutorial: {
      active: false,
      queue: ["intro_forage"],
      completed: ["intro_order", "intro_market", "intro_forage", "intro_cook", "intro_serve"]
    }
  };

  assert.equal(resolveForageNavSub(player), "forage_menu");
});

test("Fishing nav always routes to fishing menu", () => {
  const tutorialPlayer = {
    tutorial: {
      active: true,
      queue: ["intro_forage"],
      completed: ["intro_order", "intro_market"]
    }
  };

  assert.equal(
    resolveNavSubForTutorial({ player: tutorialPlayer, action: "fishing", fallbackSub: "fishing" }),
    "fishing_menu"
  );
  assert.equal(
    resolveNavSubForTutorial({ player: null, action: "fishing", fallbackSub: "fishing" }),
    "fishing_menu"
  );
});

test("Unknown nav action falls back to requested sub", () => {
  assert.equal(
    resolveNavSubForTutorial({ player: null, action: "orders", fallbackSub: "orders" }),
    "orders"
  );
});

test("Market tutorial gates are resolved centrally", () => {
  const player = {
    tutorial: {
      active: true,
      queue: ["intro_market"],
      completed: ["intro_order"]
    }
  };

  assert.equal(
    resolveTutorialGateValue({ player, gate: "buyMenuShowSellButton", fallbackValue: true }),
    false
  );
  assert.equal(
    resolveTutorialGateValue({ player, gate: "showTutorialBuyRowAfterAccept", fallbackValue: false }),
    true
  );
  assert.equal(
    resolveTutorialGateValue({ player, gate: "limitMultiBuyToBuy1", fallbackValue: false }),
    true
  );
  assert.equal(
    resolveTutorialGateValue({ player, gate: "multiBuySelectionShowSellButton", fallbackValue: true }),
    false
  );
});

test("Forage/Cook/Serve tutorial gates are resolved centrally", () => {
  const foragePlayer = {
    tutorial: {
      active: true,
      queue: ["intro_forage"],
      completed: ["intro_order", "intro_market"]
    }
  };
  const cookPlayer = {
    tutorial: {
      active: true,
      queue: ["intro_cook"],
      completed: ["intro_order", "intro_market", "intro_forage"]
    }
  };
  const servePlayer = {
    tutorial: {
      active: true,
      queue: ["intro_serve"],
      completed: ["intro_order", "intro_market", "intro_forage", "intro_cook"]
    }
  };

  assert.equal(
    resolveTutorialGateValue({ player: foragePlayer, gate: "showTutorialForageRowAfterBuy", fallbackValue: false }),
    true
  );
  assert.equal(
    resolveTutorialGateValue({ player: cookPlayer, gate: "showTutorialCookRowAfterForage", fallbackValue: false }),
    true
  );
  assert.equal(
    resolveTutorialGateValue({ player: cookPlayer, gate: "cookPickerShowOrdersActions", fallbackValue: true }),
    false
  );
  assert.equal(
    resolveTutorialGateValue({ player: servePlayer, gate: "showTutorialServeRowAfterCook", fallbackValue: false }),
    true
  );
  assert.equal(
    resolveTutorialGateValue({ player: servePlayer, gate: "servePickerShowOrdersActions", fallbackValue: true }),
    false
  );
});

test("Tutorial gate defaults are used when no override exists", () => {
  const player = {
    tutorial: {
      active: true,
      queue: ["intro_order"],
      completed: []
    }
  };

  assert.equal(
    resolveTutorialGateValue({ player, gate: "buyMenuShowSellButton", fallbackValue: true }),
    true
  );
  assert.equal(
    resolveTutorialGateValue({ player, gate: "unknown_gate", fallbackValue: "fallback" }),
    "fallback"
  );
});

test("Tutorial progress row key is centralized by step", () => {
  const makePlayer = (stepId) => ({
    tutorial: {
      active: true,
      queue: [stepId],
      completed: []
    }
  });

  assert.equal(resolveTutorialProgressRowKey(makePlayer("intro_order")), "accept_only");
  assert.equal(resolveTutorialProgressRowKey(makePlayer("intro_market")), "buy");
  assert.equal(resolveTutorialProgressRowKey(makePlayer("intro_forage")), "forage");
  assert.equal(resolveTutorialProgressRowKey(makePlayer("intro_cook")), "cook");
  assert.equal(resolveTutorialProgressRowKey(makePlayer("intro_serve")), "serve");
});

test("Tutorial progress row key handles inactive and unknown steps", () => {
  assert.equal(resolveTutorialProgressRowKey({ tutorial: { active: false, queue: ["intro_order"], completed: [] } }), null);
  assert.equal(resolveTutorialProgressRowKey({ tutorial: { active: true, queue: ["unknown_step"], completed: [] } }), null);
  assert.equal(resolveTutorialProgressRowKey(null), null);
});
