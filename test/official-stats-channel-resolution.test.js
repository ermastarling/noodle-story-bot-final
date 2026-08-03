import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import discordPkg from "discord.js";

import { resolvePreferredGuildId } from "../src/util/guildConfig.js";
import { resolveOfficialStatsChannelTarget } from "../src/util/officialStats.js";

const GUILD_VOICE_CHANNEL_TYPE_SOURCE = discordPkg?.ChannelTypes?.GUILD_VOICE
  ?? discordPkg?.Constants?.ChannelTypes?.GUILD_VOICE;
const GUILD_VOICE_CHANNEL_TYPE = typeof GUILD_VOICE_CHANNEL_TYPE_SOURCE === "number"
  ? GUILD_VOICE_CHANNEL_TYPE_SOURCE
  : 2;

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

test("official stats member events coalesce refresh requests instead of awaiting per-event updates", () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), "src/index.js"), "utf8");
  const officialStatsSource = fs.readFileSync(path.resolve(process.cwd(), "src/util/officialStats.js"), "utf8");

  assert.match(source, /let\s+memberStatsRefreshPending\s*=\s*false;/);
  assert.match(source, /let\s+memberStatsRefreshRunning\s*=\s*false;/);
  assert.match(source, /function\s+requestOfficialMemberStatsRefresh\s*\(/);
  assert.match(source, /while\s*\(memberStatsRefreshPending\)\s*{/);
  assert.match(source, /client\.on\("guildMemberAdd",\s*\(member\)\s*=>\s*{[\s\S]*requestOfficialMemberStatsRefresh\("memberAdd"\);/m);
  assert.match(source, /client\.on\("guildMemberRemove",\s*\(member\)\s*=>\s*{[\s\S]*requestOfficialMemberStatsRefresh\("memberRemove"\);/m);
  assert.doesNotMatch(source, /client\.on\("guildMemberAdd",\s*async\s*\(member\)[\s\S]*await\s+updateOfficialStatsChannels\(/m);
  assert.doesNotMatch(source, /client\.on\("guildMemberRemove",\s*async\s*\(member\)[\s\S]*await\s+updateOfficialStatsChannels\(/m);
  assert.match(source, /isGuildVoiceCounterChannelType/);
  assert.match(source, /import\("\.\/util\/officialStats\.js"\)/);
  assert.match(officialStatsSource, /GUILD_VOICE_CHANNEL_TYPE_SOURCE/);
  assert.match(officialStatsSource, /typeof\s+GUILD_VOICE_CHANNEL_TYPE_SOURCE\s*===\s*"number"/);
});
