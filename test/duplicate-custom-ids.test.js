import test from "node:test";
import assert from "node:assert/strict";

import { dedupeComponentCustomIds, normalizeRawContainerPayload } from "../src/util/rawPayload.js";
import { buildProfileBadgesV2Message } from "../src/ui/profileBadgesV2.js";

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
