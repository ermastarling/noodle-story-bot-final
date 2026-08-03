import test from "node:test";
import assert from "node:assert/strict";

import { resolvePreferredGuildId, resolveRegistrationGuildId } from "../src/util/guildConfig.js";

test("resolvePreferredGuildId prefers the official guild over dev and Discord fallbacks", () => {
  const env = {
    NOODLE_OFFICIAL_GUILD_ID: "official-guild",
    NOODLE_DEV_GUILD_ID: "dev-guild",
    DISCORD_GUILD_ID: "discord-guild"
  };

  assert.equal(resolvePreferredGuildId(env), "official-guild");
});

test("resolvePreferredGuildId falls back through the configured guild order", () => {
  assert.equal(resolvePreferredGuildId({ NOODLE_DEV_GUILD_ID: "dev-guild" }), "dev-guild");
  assert.equal(resolvePreferredGuildId({ DISCORD_GUILD_ID: "discord-guild" }), "discord-guild");
  assert.equal(resolvePreferredGuildId({}), "");
});

test("resolveRegistrationGuildId prefers the explicit workflow guild over official and dev fallbacks", () => {
  const env = {
    DISCORD_GUILD_ID: "workflow-guild",
    NOODLE_OFFICIAL_GUILD_ID: "official-guild",
    NOODLE_DEV_GUILD_ID: "dev-guild"
  };

  assert.equal(resolveRegistrationGuildId(env), "workflow-guild");
});
