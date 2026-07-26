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

test("Prep Chef summary aggregates duplicate ingredient entries and uses ingredient xN formatting", () => {
  const formatterSource = sliceBetween(
    noodleSource,
    "function formatPrepChefPurchasedItems(",
    "function normalizeIngredientType("
  );
  const summarizerSource = sliceBetween(
    noodleSource,
    "function summarizePrepChefMessages(",
    "async function handleComponent("
  );

  const factory = new Function(
    "displayItemName",
    "getIcon",
    `${formatterSource}\n${summarizerSource}\nreturn { formatPrepChefPurchasedItems, summarizePrepChefMessages };`
  );

  const { formatPrepChefPurchasedItems, summarizePrepChefMessages } = factory(
    (id) => ({ noodles_a: "Chunky Noodles", broth_a: "Mixed Broth" }[id] ?? id),
    () => "[chef]"
  );

  assert.equal(
    formatPrepChefPurchasedItems({ noodles_a: 2, broth_a: 1 }),
    "**Chunky Noodles x2** · **Mixed Broth x1**"
  );

  const summary = summarizePrepChefMessages([
    "[chef] Prep Chef auto-bought: Chunky Noodles x2 · Mixed Broth x1 (Total **9c**).",
    "[chef] Prep Chef auto-bought: Chunky Noodles x3 · Mixed Broth x2 (Total **12c**)."
  ]);

  assert.deepEqual(summary, [
    "[chef] Prep Chef auto-bought: Chunky Noodles x5 · Mixed Broth x3 (Total **21c**)."
  ]);
});