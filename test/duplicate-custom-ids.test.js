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

test("dedupeComponentCustomIds: never exceeds Discord's 100 char custom_id limit", () => {
  const long = `noodle:${"a".repeat(93)}`;
  const out = dedupeComponentCustomIds([{ type: 2, custom_id: long }, { type: 2, custom_id: long }]);
  assert.ok(out[1].custom_id.length <= 100);
  assert.notEqual(out[0].custom_id, out[1].custom_id);
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
