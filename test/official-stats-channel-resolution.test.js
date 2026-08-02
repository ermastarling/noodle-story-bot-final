import test from "node:test";
import assert from "node:assert/strict";
import discordPkg from "discord.js";

import { resolvePreferredGuildId } from "../src/util/guildConfig.js";
import { resolveOfficialStatsChannelTarget } from "../src/util/officialStats.js";

const GUILD_VOICE_CHANNEL_TYPE = Number(
  discordPkg?.ChannelTypes?.GUILD_VOICE
  ?? discordPkg?.Constants?.ChannelTypes?.GUILD_VOICE
  ?? 2
);

test("resolvePreferredGuildId keeps the official-first precedence contract", () => {
  const env = {
    NOODLE_OFFICIAL_GUILD_ID: "official-guild",
    NOODLE_DEV_GUILD_ID: "dev-guild",
    DISCORD_GUILD_ID: "discord-guild"
  };

  assert.equal(resolvePreferredGuildId(env), "official-guild");
});

test("resolveOfficialStatsChannelTarget prefers the configured stats category when resolving by label", async () => {
  const inCategory = {
    id: "member-channel-in-category",
    name: "Server Members",
    type: GUILD_VOICE_CHANNEL_TYPE,
    parentId: "stats-category",
    position: 1
  };
  const fallbackMatch = {
    id: "member-channel-fallback",
    name: "Server Members",
    type: "GUILD_VOICE",
    parentId: "other-category",
    position: 2
  };
  const guild = {
    channels: {
      cache: new Map([
        [inCategory.id, inCategory],
        [fallbackMatch.id, fallbackMatch]
      ]),
      fetch: async () => null
    }
  };

  const result = await resolveOfficialStatsChannelTarget(guild, null, {
    label: "Server Members",
    preferredCategoryId: "stats-category"
  });

  assert.ok(result);
  assert.equal(result.channel.id, inCategory.id);
  assert.equal(result.source, "label-category");
});

test("resolveOfficialStatsChannelTarget falls back to the guild when the preferred category has no match", async () => {
  const fallbackMatch = {
    id: "member-channel-fallback",
    name: "Server Members",
    type: GUILD_VOICE_CHANNEL_TYPE,
    parentId: "other-category",
    position: 2
  };
  const guild = {
    channels: {
      cache: new Map([[fallbackMatch.id, fallbackMatch]]),
      fetch: async () => null
    }
  };

  const result = await resolveOfficialStatsChannelTarget(guild, null, {
    label: "Server Members",
    preferredCategoryId: "stats-category"
  });

  assert.ok(result);
  assert.equal(result.channel.id, fallbackMatch.id);
  assert.equal(result.source, "label-guild");
});

test("resolveOfficialStatsChannelTarget supports string channel type matches", async () => {
  const stringTypeMatch = {
    id: "member-channel-string-type",
    name: "Server Members",
    type: "GUILD_VOICE",
    parentId: "stats-category",
    position: 1
  };
  const guild = {
    channels: {
      cache: new Map([[stringTypeMatch.id, stringTypeMatch]]),
      fetch: async () => null
    }
  };

  const result = await resolveOfficialStatsChannelTarget(guild, null, {
    label: "Server Members",
    preferredCategoryId: "stats-category"
  });

  assert.ok(result);
  assert.equal(result.channel.id, stringTypeMatch.id);
  assert.equal(result.source, "label-category");
});

test("resolveOfficialStatsChannelTarget accepts configured channels with string voice type", async () => {
  const configuredStringType = {
    id: "configured-string-voice",
    name: "Server Members",
    type: "GUILD_VOICE",
    parentId: "stats-category",
    position: 1
  };
  const guild = {
    channels: {
      cache: new Map([[configuredStringType.id, configuredStringType]]),
      fetch: async () => configuredStringType
    }
  };

  const result = await resolveOfficialStatsChannelTarget(guild, configuredStringType.id, {
    label: "Server Members",
    preferredCategoryId: "stats-category"
  });

  assert.ok(result);
  assert.equal(result.channel.id, configuredStringType.id);
  assert.equal(result.source, "configured");
});
