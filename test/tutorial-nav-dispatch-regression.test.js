import { strict as assert } from "assert";
import { test } from "node:test";

import { resolveComponentNavSub } from "../src/commands/navDispatch.js";

test("Component nav dispatch keeps tutorial forage as direct forage during intro_forage", () => {
  const player = {
    tutorial: {
      active: true,
      queue: ["intro_forage"],
      completed: ["intro_order", "intro_market"]
    }
  };

  assert.equal(
    resolveComponentNavSub({ player, sub: "forage" }),
    "forage"
  );
});

test("Component nav dispatch routes forage to forage_menu outside intro_forage", () => {
  const player = {
    tutorial: {
      active: true,
      queue: ["intro_cook"],
      completed: ["intro_order", "intro_market", "intro_forage"]
    }
  };

  assert.equal(
    resolveComponentNavSub({ player, sub: "forage" }),
    "forage_menu"
  );
});

test("Component nav dispatch routes forage to forage_menu for inactive tutorial", () => {
  const player = {
    tutorial: {
      active: false,
      queue: ["intro_forage"],
      completed: ["intro_order", "intro_market", "intro_forage", "intro_cook", "intro_serve"]
    }
  };

  assert.equal(
    resolveComponentNavSub({ player, sub: "forage" }),
    "forage_menu"
  );
});