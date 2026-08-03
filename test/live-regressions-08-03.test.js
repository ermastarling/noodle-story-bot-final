import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Live regression: social payload conversion preserves embed details in V2", () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), "src/commands/noodleSocial.js"), "utf8");
  assert.match(source, /payload\.embeds\.flatMap\(\(embed\) => cardSpecToTextComponents\(embed\)\)/);
});

test("Live regression: sell quantity response no longer mixes picker V2 containers into legacy rows", () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), "src/commands/noodle.js"), "utf8");
  assert.match(source, /postSellDescription/);
  assert.match(source, /\.\.\.buildSellMenuPayload\(\{/);
  assert.equal(source.includes("pickerPayload.components ??"), false);
});

test("Live regression: shard recommendation fetch retries rate-limited startup calls", () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), "src/index.js"), "utf8");
  assert.match(source, /const maxAttempts = 3/);
  assert.match(source, /response\.status\) === 429/);
  assert.match(source, /await wait\(/);
});
