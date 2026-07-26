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

test("Cook availability: event recipe is allowed when season matches", () => {
  const normalizeSeasonTagSource = sliceBetween(
    noodleSource,
    "function normalizeSeasonTag(",
    "function syncServerSeasonFromSettings("
  );
  const cookAvailabilitySource = sliceBetween(
    noodleSource,
    "function isRecipeCookAvailableForCurrentSeasonEvent(",
    "function migrateLegacyRecipeIds("
  );

  const createCheck = new Function(
    `${normalizeSeasonTagSource}; ${cookAvailabilitySource}; return isRecipeCookAvailableForCurrentSeasonEvent;`
  );
  const isRecipeCookAvailableForCurrentSeasonEvent = createCheck();

  const recipe = {
    recipe_id: "harvest_festival_hearth_stock",
    is_event_recipe: true,
    event_id: "harvest_festival",
    season: "autumn"
  };

  const allowed = isRecipeCookAvailableForCurrentSeasonEvent(recipe, {
    season: "autumn",
    active_event_id: null
  });

  assert.equal(allowed, true);
});

test("Cook availability: event recipe is blocked when season mismatch and event mismatch", () => {
  const normalizeSeasonTagSource = sliceBetween(
    noodleSource,
    "function normalizeSeasonTag(",
    "function syncServerSeasonFromSettings("
  );
  const cookAvailabilitySource = sliceBetween(
    noodleSource,
    "function isRecipeCookAvailableForCurrentSeasonEvent(",
    "function migrateLegacyRecipeIds("
  );

  const createCheck = new Function(
    `${normalizeSeasonTagSource}; ${cookAvailabilitySource}; return isRecipeCookAvailableForCurrentSeasonEvent;`
  );
  const isRecipeCookAvailableForCurrentSeasonEvent = createCheck();

  const recipe = {
    recipe_id: "harvest_festival_hearth_stock",
    is_event_recipe: true,
    event_id: "harvest_festival",
    season: "autumn"
  };

  const allowed = isRecipeCookAvailableForCurrentSeasonEvent(recipe, {
    season: "summer",
    active_event_id: "summer_solstice"
  });

  assert.equal(allowed, false);
});
