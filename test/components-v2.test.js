import test from "node:test";
import assert from "node:assert/strict";

import {
  buildComponentsV2ContainerMessage,
  buildComponentsV2MenuPayload,
  buildComponentsV2NoticeCardPayload,
  isComponentsV2Enabled,
  MESSAGE_FLAG_IS_COMPONENTS_V2,
  replyOrEditInteraction,
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

test("Components V2: tutorial users default to V2 when tutorial gate is not explicitly configured", () => {
  const env = {
    NOODLE_COMPONENTS_V2_ENABLED: "1",
    NOODLE_DEV_GUILD_ID: "g1"
  };

  assert.equal(
    isComponentsV2Enabled({ guildId: "g1", userId: "u1", player: { tutorial: { active: true } }, env }),
    true
  );
  assert.equal(
    isComponentsV2Enabled({ guildId: "g1", userId: "u1", player: { tutorial: { active: false } }, env }),
    true
  );
});

test("Components V2: tutorial users can be explicitly disabled", () => {
  const env = {
    NOODLE_COMPONENTS_V2_ENABLED: "1",
    NOODLE_DEV_GUILD_ID: "g1",
    NOODLE_COMPONENTS_V2_TUTORIAL_ENABLED: "0"
  };

  assert.equal(
    isComponentsV2Enabled({ guildId: "g1", userId: "u1", player: { tutorial: { active: true } }, env }),
    false
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

test("Components V2: owner/tip footer is inserted below media and before action rows", () => {
  const payload = buildComponentsV2MenuPayload({
    ownerId: "123456789012345678",
    components: [
      { type: 10, content: "## Profile" },
      { type: 12, items: [{ media: { url: "https://example.com/decor.png" } }] },
      {
        type: 1,
        components: [{ type: 2, style: 3, label: "Go", custom_id: "noodle:v2:orders.board:acc:123456789012345678:tok" }]
      }
    ]
  });

  const nodes = payload.components?.[0]?.components ?? [];
  const mediaIdx = nodes.findIndex((node) => node?.type === 12);
  const footerIdx = nodes.findIndex((node) => node?.type === 10 && /menu owner:/i.test(String(node?.content || "")));
  const rowIdx = nodes.findIndex((node) => node?.type === 1);

  assert.equal(mediaIdx >= 0, true);
  assert.equal(footerIdx > mediaIdx, true);
  assert.equal(rowIdx > footerIdx, true);
});

test("Components V2: splits oversized menu payload into <=40-child containers", () => {
  const components = Array.from({ length: 41 }, (_, idx) => ({
    type: 10,
    content: `Line ${idx + 1}`
  }));

  const payload = buildComponentsV2MenuPayload({ components });
  const containers = Array.isArray(payload.components) ? payload.components : [];

  assert.equal(containers.length, 2);
  assert.equal(containers[0]?.type, 17);
  assert.equal(containers[1]?.type, 17);
  assert.equal((containers[0]?.components ?? []).length <= 40, true);
  assert.equal((containers[1]?.components ?? []).length <= 40, true);
  assert.equal((containers[0]?.components ?? []).length + (containers[1]?.components ?? []).length, 41);
});

test("Components V2: configured scene banner replaces heading text", () => {
  const payload = buildComponentsV2MenuPayload({
    components: [{ type: 10, content: "## about_profile\n\nBanner should replace this heading." }]
  });

  const nodes = payload.components?.[0]?.components ?? [];
  assert.equal(nodes[0]?.type, 12);
  assert.match(String(nodes[0]?.items?.[0]?.media?.url ?? ""), /^https?:\/\//);
  assert.equal(nodes[1]?.type, 10);
  assert.equal(String(nodes[1]?.content ?? "").includes("## about_profile"), false);
  assert.equal(String(nodes[1]?.content ?? "").includes("Banner should replace this heading."), true);
});

test("Components V2: banner replacement works when heading is nested inside a section component", () => {
  const payload = buildComponentsV2MenuPayload({
    components: [
      {
        type: 9,
        components: [{ type: 10, content: "## About\n\nNested section heading." }],
        accessory: { type: 11, media: { url: "https://example.com/thumb.png" } }
      }
    ]
  });

  const nodes = payload.components?.[0]?.components ?? [];
  assert.equal(nodes[0]?.type, 12);
  assert.match(String(nodes[0]?.items?.[0]?.media?.url ?? ""), /^https?:\/\//);
  assert.equal(nodes[1]?.type, 9);
  const sectionText = String(nodes[1]?.components?.[0]?.content ?? "");
  assert.equal(sectionText.includes("## About"), false);
  assert.equal(sectionText.includes("Nested section heading."), true);
});

test("Components V2: serve and take-out heading aliases resolve to correct scene banners", () => {
  const serveOrdersPayload = buildComponentsV2MenuPayload({
    components: [{ type: 10, content: "## Serve Orders\n\nServe picker view." }]
  });
  const ordersServedPayload = buildComponentsV2MenuPayload({
    components: [{ type: 10, content: "## Orders Served\n\nServe result view." }]
  });
  const takeOutPayload = buildComponentsV2MenuPayload({
    components: [{ type: 10, content: "## Take Out Counter\n\nShift controls." }]
  });
  const takeoutPayload = buildComponentsV2MenuPayload({
    components: [{ type: 10, content: "## Takeout Counter\n\nShift controls." }]
  });

  const serveOrdersUrl = String(serveOrdersPayload.components?.[0]?.components?.[0]?.items?.[0]?.media?.url ?? "");
  const ordersServedUrl = String(ordersServedPayload.components?.[0]?.components?.[0]?.items?.[0]?.media?.url ?? "");
  const takeOutUrl = String(takeOutPayload.components?.[0]?.components?.[0]?.items?.[0]?.media?.url ?? "");
  const takeoutUrl = String(takeoutPayload.components?.[0]?.components?.[0]?.items?.[0]?.media?.url ?? "");

  assert.equal(serveOrdersUrl.length > 0, true);
  assert.equal(takeOutUrl.length > 0, true);
  assert.equal(serveOrdersUrl, ordersServedUrl);
  assert.equal(takeOutUrl, takeoutUrl);
});

test("Components V2: explicit notice image keeps unlock title below the banner", () => {
  const payload = buildComponentsV2NoticeCardPayload({
    title: "Kitchen Unlocked",
    imageUrl: "https://example.com/kitchen.png",
    details: ["Simmer gold-star broths with /noodle kitchen."],
    tone: "success"
  });

  const nodes = payload.components?.[0]?.components ?? [];
  assert.equal(nodes[0]?.type, 12);
  assert.equal(String(nodes[0]?.items?.[0]?.media?.url ?? ""), "https://example.com/kitchen.png");
  assert.equal(nodes[1]?.type, 10);
  assert.equal(String(nodes[1]?.content ?? "").includes("Kitchen Unlocked"), true);
  assert.equal(String(nodes[1]?.content ?? "").includes("##"), false);
  assert.equal(nodes[2]?.type, 10);
  assert.equal(String(nodes[2]?.content ?? "").includes("Simmer gold-star broths"), true);
});

test("Components V2: replyOrEditInteraction prefers raw webhook edit for deferred V2 payloads", async () => {
  let editReplyCalls = 0;
  let patchCalls = 0;

  const interaction = {
    deferred: true,
    replied: false,
    applicationId: "app-1",
    token: "tok-1",
    client: {
      api: {
        webhooks: (applicationId, token) => ({
          messages: (messageId) => ({
            patch: async ({ data }) => {
              patchCalls += 1;
              assert.equal(applicationId, "app-1");
              assert.equal(token, "tok-1");
              assert.equal(messageId, "@original");
              return { ok: true, data };
            }
          })
        })
      }
    },
    editReply: async () => {
      editReplyCalls += 1;
      return { ok: false };
    },
    reply: async () => ({ ok: false })
  };

  const payload = buildComponentsV2ContainerMessage({ title: "Status", lines: ["Ready"] });
  const result = await replyOrEditInteraction(interaction, payload);

  assert.equal(patchCalls, 1);
  assert.equal(editReplyCalls, 0);
  assert.equal(result?.ok, true);
});

test("Components V2: replyOrEditInteraction falls back to editReply when raw webhook edit fails", async () => {
  let editReplyCalls = 0;
  let patchCalls = 0;

  const interaction = {
    deferred: true,
    replied: false,
    applicationId: "app-2",
    token: "tok-2",
    client: {
      api: {
        webhooks: () => ({
          messages: () => ({
            patch: async () => {
              patchCalls += 1;
              throw new Error("network");
            }
          })
        })
      }
    },
    editReply: async () => {
      editReplyCalls += 1;
      return { ok: true, mode: "editReply" };
    },
    reply: async () => ({ ok: false })
  };

  const payload = buildComponentsV2ContainerMessage({ title: "Status", lines: ["Retry"] });
  const result = await replyOrEditInteraction(interaction, payload);

  assert.equal(patchCalls, 1);
  assert.equal(editReplyCalls, 1);
  assert.equal(result?.mode, "editReply");
});

test("Components V2: replyOrEditInteraction retries raw webhook edit on INVALID_TYPE editReply error", async () => {
  let patchCalls = 0;

  const interaction = {
    deferred: true,
    replied: false,
    applicationId: "app-3",
    token: "tok-3",
    client: {
      api: {
        webhooks: () => ({
          messages: () => ({
            patch: async () => {
              patchCalls += 1;
              if (patchCalls === 1) {
                throw new Error("first raw webhook attempt fails");
              }
              return { ok: true, mode: "rawRetry" };
            }
          })
        })
      }
    },
    editReply: async () => {
      const error = new Error("value is not a valid MessageComponentType");
      error.code = "INVALID_TYPE";
      throw error;
    },
    reply: async () => ({ ok: false })
  };

  const payload = buildComponentsV2ContainerMessage({ title: "Status", lines: ["Fallback"] });
  const result = await replyOrEditInteraction(interaction, payload);

  assert.equal(patchCalls, 2);
  assert.equal(result?.mode, "rawRetry");
});

