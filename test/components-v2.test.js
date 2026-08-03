import test from "node:test";
import assert from "node:assert/strict";

import {
  buildComponentsV2ContainerMessage,
  buildComponentsV2MenuPayload,
  buildComponentsV2NoticeCardPayload,
  buildComponentsV2TextPayload,
  isComponentsV2Enabled,
  legacyEmbedsToV2TextComponents,
  MESSAGE_FLAG_IS_COMPONENTS_V2,
  replyOrEditInteraction,
  resolveComponentsV2TargetGuild
} from "../src/ui/componentsV2.js";
import { buildHelpPageV2Payload, buildMultiBuyPickerPayload } from "../src/commands/noodle.js";
import { composeV2FromLegacyEmbedsForTest } from "../src/commands/noodle.js";
import { normalizePayloadForReply as normalizeSocialPayloadForReply } from "../src/commands/noodleSocial.js";
import { normalizePayloadForReply as normalizeDecorPayloadForReply } from "../src/commands/noodleDecor.js";
import { normalizePayloadForReply as normalizeQuestsPayloadForReply } from "../src/commands/noodleQuests.js";
import { normalizePayloadForReply as normalizeStaffPayloadForReply } from "../src/commands/noodleStaff.js";
import { normalizePayloadForReply as normalizeUpgradesPayloadForReply } from "../src/commands/noodleUpgrades.js";

test("Components V2: resolves target guild from NOODLE_OFFICIAL_GUILD_ID first", () => {
  const target = resolveComponentsV2TargetGuild({
    NOODLE_OFFICIAL_GUILD_ID: "2200003904585470024",
    NOODLE_DEV_GUILD_ID: "1500003904585470024",
    DISCORD_GUILD_ID: "111111111111111111"
  });
  assert.equal(target, "2200003904585470024");
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

test("Components V2: builds a direct V2 payload from a simple menu spec", () => {
  const payload = buildComponentsV2TextPayload({
    title: "Quest Rewards",
    description: "You unlocked a new reward.",
    fields: [{ name: "Status", value: "Ready" }],
    components: [{
      type: 1,
      components: [{ type: 2, style: 3, label: "Claim", custom_id: "noodle:quests:claim:123456789012345678" }]
    }],
    ownerId: "123456789012345678",
    ephemeral: true
  });

  assert.equal(payload.flags & MESSAGE_FLAG_IS_COMPONENTS_V2, MESSAGE_FLAG_IS_COMPONENTS_V2);
  assert.equal(Array.isArray(payload.components), true);
  const nodes = payload.components?.[0]?.components ?? [];
  assert.ok(nodes.some((node) => Number(node?.type) === 10 && String(node?.content ?? "").includes("Quest Rewards")));
  assert.ok(nodes.some((node) => Number(node?.type) === 10 && String(node?.content ?? "").includes("You unlocked a new reward.")));
  assert.ok(nodes.some((node) => Number(node?.type) === 1));
});

test("Components V2: builds a direct text menu payload without an embed bridge", () => {
  const payload = buildComponentsV2MenuPayload({
    components: [
      { type: 10, content: "## Daily Rewards Reminder" },
      { type: 10, content: "Reminders are now on." },
      {
        type: 1,
        components: [{ type: 2, style: 3, label: "Open", custom_id: "noodle:dm:reminders_toggle:123" }]
      }
    ],
    ownerId: "123456789012345678"
  });

  const topContainer = payload.components?.[0];
  const nodes = topContainer?.components ?? [];
  assert.equal(payload.flags & MESSAGE_FLAG_IS_COMPONENTS_V2, MESSAGE_FLAG_IS_COMPONENTS_V2);
  assert.equal(topContainer?.type, 17);
  assert.equal(nodes[0]?.type, 10);
  assert.match(String(nodes[0]?.content ?? ""), /Daily Rewards Reminder/);
  assert.equal(nodes[1]?.type, 10);
  assert.match(String(nodes[1]?.content ?? ""), /Reminders are now on\./);
  const actionRow = nodes.find((node) => Number(node?.type) === 1);
  assert.ok(actionRow);
  assert.equal(actionRow?.components?.[0]?.custom_id, "noodle:dm:reminders_toggle:123");
});

test("Components V2: help page builds a direct V2 payload without legacy embed conversion", () => {
  const payload = buildHelpPageV2Payload({
    title: "Help",
    description: "Use /noodle help to get started.",
    footerText: "Page 1/2 • owner",
    ownerId: "123456789012345678",
    components: [
      {
        type: 1,
        components: [{ type: 2, style: 3, label: "Next", custom_id: "noodle:help:page:123456789012345678:1" }]
      }
    ]
  });

  assert.equal(payload.flags & MESSAGE_FLAG_IS_COMPONENTS_V2, MESSAGE_FLAG_IS_COMPONENTS_V2);
  assert.equal(Array.isArray(payload.components), true);
  const nodes = payload.components?.[0]?.components ?? [];
  assert.ok(nodes.some((node) => Number(node?.type) === 10 && String(node?.content ?? "").includes("Help")));
  assert.ok(nodes.some((node) => Number(node?.type) === 10 && String(node?.content ?? "").includes("Use /noodle help to get started.")));
  assert.ok(nodes.some((node) => Number(node?.type) === 1));
});

test("Components V2: builds direct text payloads without legacy conversion helpers", () => {
  const payload = buildComponentsV2TextPayload({
    title: "Status",
    description: "Everything is ready.",
    fields: [{ name: "Status", value: "Ready" }],
    ownerId: "123456789012345678",
    ephemeral: true
  });

  assert.equal(payload.flags & MESSAGE_FLAG_IS_COMPONENTS_V2, MESSAGE_FLAG_IS_COMPONENTS_V2);
  assert.equal(Array.isArray(payload.components), true);
  const nodes = payload.components?.[0]?.components ?? [];
  assert.ok(nodes.some((node) => Number(node?.type) === 10 && String(node?.content ?? "").includes("Status")));
  assert.ok(nodes.some((node) => Number(node?.type) === 10 && String(node?.content ?? "").includes("Everything is ready.")));
  assert.equal(payload.mainComponents, undefined);
  assert.equal(payload.notices, undefined);
});

test("Components V2: multi-buy picker returns a direct V2 payload", () => {
  const payload = buildMultiBuyPickerPayload({
    userId: "123456789012345678",
    p: {
      inv_ingredients: {},
      market_stock: {},
      coins: 0,
      orders: { accepted: {} }
    },
    s: {
      market_prices: {},
      market_day: "20240101"
    },
    ownerUser: { id: "123456789012345678", username: "chef" },
    showSellButton: false
  });

  assert.equal(payload.flags & MESSAGE_FLAG_IS_COMPONENTS_V2, MESSAGE_FLAG_IS_COMPONENTS_V2);
  assert.equal(Array.isArray(payload.components), true);
  assert.equal(payload.mainComponents, undefined);
  assert.equal(payload.notices, undefined);
  const nodes = payload.components?.flatMap((container) => container?.components ?? []) ?? [];
  assert.equal(nodes.some((node) => Number(node?.type) === 10), true);
  assert.equal(nodes.some((node) => Number(node?.type) === 1), true);
});

test("Components V2: quests converter preserves prebuilt V2 payloads and native mainComponents/notices", () => {
  const prebuilt = {
    flags: MESSAGE_FLAG_IS_COMPONENTS_V2,
    components: [{ type: 17, components: [{ type: 10, content: "## Keep me" }] }]
  };
  const untouched = normalizeQuestsPayloadForReply({ user: { id: "u2" } }, prebuilt);
  assert.equal(untouched, prebuilt);

  const nativePayload = {
    mainComponents: [{ type: 10, content: "## Native" }],
    notices: [{ title: "Notice", details: ["A"], tone: "info" }],
    components: [
      {
        type: 1,
        components: [{ type: 2, style: 2, label: "Back", custom_id: "noodle:nav:profile:u2" }]
      }
    ]
  };
  const normalizedNative = normalizeQuestsPayloadForReply({ user: { id: "u2" } }, nativePayload);
  const nodes = normalizedNative.components?.flatMap((container) => container?.components ?? []) ?? [];
  assert.equal(nodes.some((node) => Number(node?.type) === 10 && String(node?.content ?? "").includes("Native")), true);
  assert.equal(nodes.some((node) => Number(node?.type) === 1), true);
});

test("Components V2: social converter preserves prebuilt V2 payloads and native mainComponents/notices", () => {
  const prebuilt = {
    flags: MESSAGE_FLAG_IS_COMPONENTS_V2,
    components: [{ type: 17, components: [{ type: 10, content: "## Keep social" }] }]
  };
  const untouched = normalizeSocialPayloadForReply({ user: { id: "u3" } }, prebuilt);
  assert.equal(untouched, prebuilt);

  const nativePayload = {
    mainComponents: [{ type: 10, content: "## Social Native" }],
    notices: [{ title: "Heads up", details: ["Info"], tone: "info" }],
    components: [
      {
        type: 1,
        components: [{ type: 2, style: 2, label: "Back", custom_id: "noodle-social:nav:menu:u3" }]
      }
    ]
  };
  const normalizedNative = normalizeSocialPayloadForReply({ user: { id: "u3" } }, nativePayload);
  const nodes = normalizedNative.components?.flatMap((container) => container?.components ?? []) ?? [];
  assert.equal(nodes.some((node) => Number(node?.type) === 10 && String(node?.content ?? "").includes("Social Native")), true);
  assert.equal(nodes.some((node) => Number(node?.type) === 1), true);
});

test("Components V2: social converter preserves plain text replies", () => {
  const normalized = normalizeSocialPayloadForReply({ user: { id: "u4" } }, {
    content: "Database unavailable in this environment."
  });

  const nodes = normalized.components?.flatMap((container) => container?.components ?? []) ?? [];
  assert.equal(nodes.some((node) => Number(node?.type) === 10 && String(node?.content ?? "").includes("Database unavailable in this environment.")), true);
});

test("Components V2: staff and upgrades converters preserve prebuilt V2 payloads without re-wrapping", () => {
  const prebuiltStaffPayload = {
    flags: MESSAGE_FLAG_IS_COMPONENTS_V2,
    components: [{ type: 17, components: [{ type: 10, content: "## Keep staff V2" }] }],
    trace: "staff-v2"
  };
  const prebuiltUpgradesPayload = {
    flags: MESSAGE_FLAG_IS_COMPONENTS_V2,
    components: [{ type: 17, components: [{ type: 10, content: "## Keep upgrades V2" }] }],
    trace: "upgrades-v2"
  };

  const staffResult = normalizeStaffPayloadForReply({ user: { id: "u5" } }, prebuiltStaffPayload);
  const upgradesResult = normalizeUpgradesPayloadForReply({ user: { id: "u6" } }, prebuiltUpgradesPayload);

  assert.equal(staffResult, prebuiltStaffPayload);
  assert.equal(upgradesResult, prebuiltUpgradesPayload);
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

test("Components V2: decor, quests, staff, and upgrades modules normalize legacy replies into shared V2 payloads", () => {
  const decorPayload = normalizeDecorPayloadForReply({ user: { id: "u1" } }, {
    embeds: [{ title: "Decor", description: "Owned items" }],
    ephemeral: true
  });
  const questsPayload = normalizeQuestsPayloadForReply({ user: { id: "u2" } }, {
    embeds: [{ title: "Quests", description: "Daily reward ready" }]
  });
  const staffPayload = normalizeStaffPayloadForReply({ user: { id: "u3" } }, {
    embeds: [{ title: "Staff", description: "Upgrade available" }]
  });
  const upgradesPayload = normalizeUpgradesPayloadForReply({ user: { id: "u4" } }, {
    embeds: [{ title: "Upgrades", description: "New perk available" }]
  });

  for (const payload of [decorPayload, questsPayload, staffPayload, upgradesPayload]) {
    assert.equal(payload.flags & MESSAGE_FLAG_IS_COMPONENTS_V2, MESSAGE_FLAG_IS_COMPONENTS_V2);
    assert.ok(Array.isArray(payload.components));
    assert.equal(payload.embeds, undefined);
  }
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

test("Components V2: legacy embed text conversion chunks long content and strips owner footers", () => {
  const components = legacyEmbedsToV2TextComponents([
    {
      toJSON() {
        return {
          title: "Status",
          description: `Line one\n${"A".repeat(4000)}\nLine two`,
          footer: { text: "Owner: Example • Keep this note" }
        };
      }
    }
  ]);

  assert.equal(Array.isArray(components), true);
  assert.equal(components.length > 1, true);
  assert.equal(components.some((entry) => String(entry?.content ?? "").includes("Owner:")), false);
  assert.equal(components.some((entry) => String(entry?.content ?? "").includes("Keep this note")), true);
  assert.equal(components.some((entry) => String(entry?.content ?? "").includes("Status")), true);
  assert.equal(components.some((entry) => String(entry?.content ?? "").includes("Line two")), true);
});

test("Components V2: legacy embed composer returns a merge-safe spec", () => {
  const payload = composeV2FromLegacyEmbedsForTest([
    {
      toJSON() {
        return {
          title: "Status",
          description: "Ready",
          footer: { text: "Owner: chef" }
        };
      }
    },
    {
      toJSON() {
        return {
          title: "Notice",
          description: "Heads up"
        };
      }
    }
  ], " 123 ");

  assert.equal(Array.isArray(payload.mainComponents), true);
  assert.equal(Array.isArray(payload.notices), true);
  assert.equal(payload.components, undefined);
  assert.equal(payload.flags, undefined);
  assert.equal(payload.ownerId, undefined);
  assert.equal(payload.mainComponents.some((entry) => String(entry?.content ?? "").includes("Status")), true);
  assert.equal(payload.notices.some((notice) => String(notice?.title ?? "").includes("Notice")), true);
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

