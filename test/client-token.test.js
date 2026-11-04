import test from "node:test";
import assert from "node:assert/strict";
import { ensureClientToken } from "../src/util/clientToken.js";

test("ensureClientToken hydrates a missing client token from DISCORD_TOKEN", () => {
  const client = {};
  assert.equal(ensureClientToken(client, { DISCORD_TOKEN: " abc " }), true);
  assert.equal(client.token, "abc");
});

test("ensureClientToken keeps an existing token and reports when none is available", () => {
  const client = { token: "existing" };
  assert.equal(ensureClientToken(client, { DISCORD_TOKEN: "other" }), true);
  assert.equal(client.token, "existing");
  assert.equal(ensureClientToken({}, {}), false);
});
