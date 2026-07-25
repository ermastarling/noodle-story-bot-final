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

test("Takeout menu season guard: filter excludes out-of-season recipes", () => {
  const normalizeSeasonTagSource = sliceBetween(
    noodleSource,
    "function normalizeSeasonTag(",
    "function syncServerSeasonFromSettings("
  );
  const filterFnSource = sliceBetween(
    noodleSource,
    "function filterRecipeIdsByActiveSeasonEvent(",
    "function migrateLegacyRecipeIds("
  );

  const content = {
    recipes: {
      spring_seasonal: { tier: "seasonal", season: "spring" },
      summer_seasonal: { tier: "seasonal", season: "summer" },
      always_common: { tier: "common" }
    }
  };

  const createFilter = new Function(
    "content",
    `${normalizeSeasonTagSource}; ${filterFnSource}; return filterRecipeIdsByActiveSeasonEvent;`
  );
  const filterRecipeIdsByActiveSeasonEvent = createFilter(content);

  const filtered = filterRecipeIdsByActiveSeasonEvent(
    ["spring_seasonal", "summer_seasonal", "always_common"],
    { season: "summer", active_event_id: null }
  );

  assert.deepEqual(
    filtered,
    ["summer_seasonal", "always_common"],
    "Out-of-season seasonal recipes should be excluded from takeout-eligible options"
  );
});

test("Takeout menu season guard: filter normalizes season tags", () => {
  const normalizeSeasonTagSource = sliceBetween(
    noodleSource,
    "function normalizeSeasonTag(",
    "function syncServerSeasonFromSettings("
  );
  const filterFnSource = sliceBetween(
    noodleSource,
    "function filterRecipeIdsByActiveSeasonEvent(",
    "function migrateLegacyRecipeIds("
  );

  const content = {
    recipes: {
      summer_seasonal: { tier: "seasonal", season: "summer" },
      always_common: { tier: "common" }
    }
  };

  const createFilter = new Function(
    "content",
    `${normalizeSeasonTagSource}; ${filterFnSource}; return filterRecipeIdsByActiveSeasonEvent;`
  );
  const filterRecipeIdsByActiveSeasonEvent = createFilter(content);

  const filtered = filterRecipeIdsByActiveSeasonEvent(
    ["summer_seasonal", "always_common"],
    { season: " Summer ", active_event_id: null }
  );

  assert.deepEqual(filtered, ["summer_seasonal", "always_common"]);
});

test("Takeout menu season guard: takeout flow uses filtered recipe ids", () => {
  const takeoutBlock = sliceBetween(
    noodleSource,
    "if (sub === \"takeout\" || sub === \"takeout_menu\" || sub === \"takeout_open\" || sub === \"takeout_claim\" || sub === \"takeout_cook\" || sub === \"takeout_serve\" || sub === \"takeout_needs\") {",
    "/* ---------------- RECIPES ---------------- */\nif (sub === \"recipes\") {"
  );

  assert.match(
    takeoutBlock,
    /const availableRecipeIds = filterRecipeIdsByActiveSeasonEvent\(getValidAvailableRecipeIds\(p\), s\);/,
    "Takeout menu options should be based on season/event-filtered recipe ids"
  );
});
