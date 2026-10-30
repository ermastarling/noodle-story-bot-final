import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkPingPayload,
  resolveWorkPingSettings,
  WORK_PING_SCHEDULE,
  WORK_PING_TIMEZONE
} from "../src/jobs/workPings.js";
import { loadWorkPingContent } from "../src/content/index.js";

const ids = {
  dev: "12345678901234567",
  work: "22345678901234567",
  ping: "32345678901234567",
  role: "42345678901234567",
  guild: "52345678901234567"
};

test("Work ping is disabled until explicitly enabled and copy-approved", () => {
  assert.equal(resolveWorkPingSettings({}).reason, "disabled");
  assert.equal(resolveWorkPingSettings({
    NOODLE_WORK_PING_ENABLED: "1",
    NOODLE_WORK_CHANNEL_ID: ids.work
  }).reason, "copy_not_approved");
});

test("Work ping schedule uses exact two-hour UTC clock times", () => {
  assert.equal(WORK_PING_SCHEDULE, "0 0,2,4,6,8,10,12,14,16,18,20,22 * * *");
  assert.equal(WORK_PING_TIMEZONE, "UTC");
});

test("Work ping canary requires a verified private channel and suppresses role mentions", () => {
  const base = {
    NOODLE_WORK_PING_ENABLED: "1",
    NOODLE_WORK_PING_COPY_APPROVED: "1",
    NOODLE_OFFICIAL_GUILD_ID: ids.guild,
    NOODLE_WORK_CHANNEL_ID: ids.work,
    NOODLE_DEV_ALERT_CHANNEL_ID: ids.dev
  };
  assert.equal(resolveWorkPingSettings(base).reason, "canary_privacy_not_verified");
  const settings = resolveWorkPingSettings({
    ...base,
    NOODLE_OFFICIAL_FEATURE_CANARY_PRIVATE_VERIFIED: "1"
  });
  assert.equal(settings.ok, true);
  assert.equal(settings.channelId, ids.dev);
  assert.equal(settings.roleId, null);
  const payload = buildWorkPingPayload({ settings, copy: loadWorkPingContent() });
  assert.equal((payload.flags & (1 << 15)) !== 0, true);
  assert.equal(payload.components?.[0]?.type, 17);
  assert.equal(payload.content, undefined);
  assert.equal(payload.allowed_mentions.roles.length, 0);
  assert.match(JSON.stringify(payload), new RegExp(`<#${ids.work}>`));
});

test("Work ping production routing requires separate production approval and target role", () => {
  const base = {
    NOODLE_WORK_PING_ENABLED: "1",
    NOODLE_WORK_PING_COPY_APPROVED: "1",
    NOODLE_OFFICIAL_FEATURE_CANARY: "0",
    NOODLE_OFFICIAL_GUILD_ID: ids.guild,
    NOODLE_WORK_CHANNEL_ID: ids.work,
    NOODLE_WORK_PING_CHANNEL_ID: ids.ping
  };
  assert.equal(resolveWorkPingSettings(base).reason, "production_not_approved");
  assert.equal(resolveWorkPingSettings({
    ...base,
    NOODLE_WORK_PING_PRODUCTION_ENABLED: "1"
  }).reason, "missing_work_role");
  const settings = resolveWorkPingSettings({
    ...base,
    NOODLE_WORK_PING_PRODUCTION_ENABLED: "1",
    NOODLE_WORK_PING_ROLE_ID: ids.role
  });
  assert.equal(settings.ok, true);
  const payload = buildWorkPingPayload({ settings, copy: loadWorkPingContent() });
  assert.deepEqual(payload.allowed_mentions.roles, [ids.role]);
  const serialized = JSON.stringify(payload);
  assert.match(serialized, new RegExp(`<@&${ids.role}>`));
  assert.equal(serialized.split(`<@&${ids.role}>`).length - 1, 1);
  assert.equal(serialized.includes("<@work ping>"), false);
});
