import test from "node:test";
import assert from "node:assert/strict";

process.env.NOODLE_SKIP_DB = "1";

const { dedupeComponentCustomIds, normalizeRawContainerPayload } = await import("../src/util/rawPayload.js");
const { normalizeComponentsForTest, noodleCommand } = await import("../src/commands/noodle.js");
const { buildProfileBadgesV2Message } = await import("../src/ui/profileBadgesV2.js");

function collectIds(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.custom_id) out.push(node.custom_id);
  for (const child of node.components ?? []) collectIds(child, out);
  if (node.accessory) collectIds(node.accessory, out);
  return out;
}

test("dedupeComponentCustomIds: suffixes repeated ids, keeps first and leaves unique ids untouched", () => {
  const rows = [
    { type: 1, components: [{ type: 2, custom_id: "noodle:nav:x:u:1" }, { type: 2, custom_id: "noodle:nav:x:u:1" }] },
    { type: 9, components: [], accessory: { type: 2, custom_id: "noodle:nav:x:u:1" } },
    { type: 1, components: [{ type: 2, custom_id: "noodle:nav:y:u" }] }
  ];
  const ids = collectIds({ components: dedupeComponentCustomIds(rows) });
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids[0], "noodle:nav:x:u:1");
  assert.ok(ids[1].startsWith("noodle:nav:x:u:1:"));
  assert.equal(ids[3], "noodle:nav:y:u");
});

test("dedupeComponentCustomIds: boundary lengths stay unique, <=100 chars and never truncate the route", () => {
  for (let length = 90; length <= 100; length += 1) {
    const original = `noodle:${"a".repeat(length - 7)}`;
    const out = dedupeComponentCustomIds([{ type: 1, components: [
      { type: 2, custom_id: original },
      { type: 2, custom_id: original },
      { type: 2, custom_id: original }
    ] }])[0].components;
    const ids = out.map((c) => c.custom_id);
    assert.equal(ids[0], original);
    assert.equal(new Set(ids).size, ids.length, `unique at length ${length}`);
    for (const id of ids) {
      assert.ok(id.length <= 100, `limit at length ${length}`);
      assert.ok(id.startsWith(original), `route preserved at length ${length}`);
      assert.match(id.slice(original.length), /^(:(dup)?\d+)?$/);
    }
  }
});

test("dedupeComponentCustomIds: an unfixable duplicate is dropped; a Section keeps its text", () => {
  const original = `noodle:${"a".repeat(93)}`;
  const out = dedupeComponentCustomIds([
    { type: 1, components: [{ type: 2, custom_id: original }, { type: 2, custom_id: original }] },
    { type: 9, components: [{ type: 10, content: "hi" }], accessory: { type: 2, custom_id: original } }
  ]);
  assert.equal(out[0].components.length, 1);
  assert.equal(out[0].components[0].custom_id, original);
  assert.deepEqual(out[1], { type: 10, content: "hi" });
});

test("Badges V2: a two-page menu produces unique custom ids once normalized for Discord", () => {
  const payload = buildProfileBadgesV2Message({ userId: "u1", entries: [], page: 0, totalPages: 2 });
  const raw = collectIds({ components: payload.components });
  assert.notEqual(new Set(raw).size, raw.length, "precondition: wrap-around nav duplicates ids on 2 pages");

  const normalized = normalizeRawContainerPayload(payload);
  const ids = collectIds({ components: normalized.components });
  assert.equal(new Set(ids).size, ids.length);
  const nextId = ids.find((id) => id.startsWith("noodle:nav:badges:u1:1:badges:"));
  assert.ok(nextId, "deduped button keeps the original route prefix");
});

test("Legacy nav rows: a two-page menu keeps both Prev and Next with unique ids that still route to the same page", () => {
  const userId = "123456789012345678";
  const [row] = normalizeComponentsForTest([
    {
      type: 1,
      components: [
        { type: 2, style: 2, label: "Prev", custom_id: `noodle:nav:buy:${userId}:1` },
        { type: 2, style: 2, label: "Next", custom_id: `noodle:nav:buy:${userId}:1` }
      ]
    }
  ], 0);
  const ids = row.components.map((c) => c.custom_id);
  assert.deepEqual(row.components.map((c) => c.label), ["Prev", "Next"]);
  assert.equal(new Set(ids).size, 2);
  for (const id of ids) {
    assert.ok(id.length <= 100);
    const parts = id.split(":");
    assert.deepEqual(parts.slice(0, 3), ["noodle", "nav", "buy"]);
    assert.equal(parts[3], userId);
    assert.equal(Number(parts[4]), 1);
  }
});

test("Legacy pagination: a deduped wrap-around button dispatches to its intended page", async () => {
  const userId = "123456789012345678";
  const [, nextButton] = normalizeComponentsForTest([
    {
      type: 1,
      components: [
        { type: 2, style: 2, label: "Prev", custom_id: `noodle:help:page:${userId}:1` },
        { type: 2, style: 2, label: "Next", custom_id: `noodle:help:page:${userId}:1` }
      ]
    }
  ], 0)[0].components;
  assert.match(nextButton.custom_id, /:1:dup2$/);

  const calls = [];
  const interaction = {
    customId: nextButton.custom_id,
    guildId: "12345678901234567",
    user: { id: userId, username: "tester" },
    member: { id: userId, user: { id: userId, username: "tester" }, displayName: "tester" },
    message: null,
    deferred: false,
    replied: false,
    isButton: () => true,
    isMessageComponent: () => true,
    update: async (payload) => {
      calls.push(payload);
      return payload;
    },
    editReply: async (payload) => {
      calls.push(payload);
      return payload;
    }
  };

  await noodleCommand.handleComponent(interaction);

  assert.equal(calls.length, 1);
  assert.match(JSON.stringify(calls[0]), /Page 2\/3/);
  assert.match(JSON.stringify(calls[0]), /Orders Menu/);
});
