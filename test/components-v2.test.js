import test from "node:test";
import assert from "node:assert/strict";

import {
  buildComponentsV2ContainerMessage,
  isComponentsV2Enabled,
  MESSAGE_FLAG_IS_COMPONENTS_V2,
  resolveComponentsV2TargetGuild
} from "../src/ui/componentsV2.js";

test("Components V2: resolves target guild from NOODLE_DEV_GUILD_ID first", () => {
  const target = resolveComponentsV2TargetGuild({
    NOODLE_DEV_GUILD_ID: "1500003904585470024",
    DISCORD_GUILD_ID: "111111111111111111"
  });
  assert.equal(target, "1500003904585470024");
});

test("Components V2: only enabled when env flag is on and guild matches", () => {
  const env = {
    NOODLE_COMPONENTS_V2_ENABLED: "1",
    NOODLE_DEV_GUILD_ID: "1500003904585470024"
  };

  assert.equal(isComponentsV2Enabled({ guildId: "1500003904585470024", userId: "u1", env }), true);
  assert.equal(isComponentsV2Enabled({ guildId: "999999999999999999", userId: "u1", env }), false);
});

test("Components V2: supports explicit guild and user allowlists", () => {
  const env = {
    NOODLE_COMPONENTS_V2_ENABLED: "1",
    NOODLE_COMPONENTS_V2_GUILD_ALLOWLIST: "g1,g2",
    NOODLE_COMPONENTS_V2_USER_ALLOWLIST: "u2"
  };

  assert.equal(isComponentsV2Enabled({ guildId: "g1", userId: "u2", env }), true);
  assert.equal(isComponentsV2Enabled({ guildId: "g1", userId: "u9", env }), false);
  assert.equal(isComponentsV2Enabled({ guildId: "g9", userId: "u2", env }), false);
});

test("Components V2: tutorial users default to V1 until tutorial gate enabled", () => {
  const env = {
    NOODLE_COMPONENTS_V2_ENABLED: "1",
    NOODLE_DEV_GUILD_ID: "g1"
  };

  assert.equal(
    isComponentsV2Enabled({ guildId: "g1", userId: "u1", player: { tutorial: { active: true } }, env }),
    false
  );
  assert.equal(
    isComponentsV2Enabled({ guildId: "g1", userId: "u1", player: { tutorial: { active: false } }, env }),
    true
  );
});

test("Components V2: tutorial-user allowlist can segment tutorial rollout", () => {
  const env = {
    NOODLE_COMPONENTS_V2_ENABLED: "1",
    NOODLE_DEV_GUILD_ID: "g1",
    NOODLE_COMPONENTS_V2_TUTORIAL_USER_ALLOWLIST: "u5"
  };

  assert.equal(
    isComponentsV2Enabled({ guildId: "g1", userId: "u5", player: { tutorial: { active: true } }, env }),
    true
  );
  assert.equal(
    isComponentsV2Enabled({ guildId: "g1", userId: "u6", player: { tutorial: { active: true } }, env }),
    false
  );
});

test("Components V2: rollback switch disables all V2 traffic immediately", () => {
  const env = {
    NOODLE_COMPONENTS_V2_ENABLED: "0",
    NOODLE_DEV_GUILD_ID: "g1",
    NOODLE_COMPONENTS_V2_TUTORIAL_ENABLED: "1"
  };

  assert.equal(isComponentsV2Enabled({ guildId: "g1", userId: "u1", env }), false);
  assert.equal(
    isComponentsV2Enabled({ guildId: "g1", userId: "u1", player: { tutorial: { active: true } }, env }),
    false
  );
});

test("Components V2: builds container payload with required V2 flag", () => {
  const payload = buildComponentsV2ContainerMessage({
    title: "Status",
    lines: ["Line one", "Line two"],
    accentColor: 0xE2B86B
  });

  assert.equal(payload.flags, MESSAGE_FLAG_IS_COMPONENTS_V2);
  assert.equal(Array.isArray(payload.components), true);
  assert.equal(payload.components.length, 1);
  assert.equal(payload.components[0].type, 17);
  assert.equal(payload.components[0].components[0].type, 10);
  assert.match(payload.components[0].components[0].content, /Line one/);
});
