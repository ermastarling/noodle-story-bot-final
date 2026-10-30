import test from "node:test";
import assert from "node:assert/strict";

process.env.NOODLE_SKIP_DB = "1";

const { buildServeFailurePayloadForTest: buildServeFailurePayload, noodleProfileEditRowForTest } =
  await import("../src/commands/noodle.js");

function findButtons(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.type === 2) out.push(node);
  for (const child of node.components ?? []) findButtons(child, out);
  return out;
}

const embed = { title: "Orders Served", description: "You don't have a bowl ready." };

test("All-failed serve keeps both action rows after V2 conversion", () => {
  const userId = "u-serve-1";
  const payload = buildServeFailurePayload({ userId, embed, hasAcceptedOrders: true, useV2: true });
  const buttons = findButtons({ components: payload.components });
  const ids = buttons.map((b) => b.custom_id);
  for (const id of [`noodle:pick:accept:${userId}`, `noodle:pick:cook:${userId}`, `noodle:pick:serve:${userId}`,
    `noodle:nav:orders:${userId}`, `noodle:nav:buy:${userId}`, `noodle:nav:pantry:${userId}`, `noodle:nav:profile:${userId}`]) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
  assert.notEqual(buttons.find((b) => b.custom_id === `noodle:pick:serve:${userId}`).disabled, true);
});

test("All-failed serve disables Serve when no accepted orders remain", () => {
  const userId = "u-serve-2";
  const payload = buildServeFailurePayload({ userId, embed, hasAcceptedOrders: false, useV2: true });
  const buttons = findButtons({ components: payload.components });
  assert.equal(buttons.find((b) => b.custom_id === `noodle:pick:serve:${userId}`).disabled, true);
  assert.ok(buttons.some((b) => b.custom_id === `noodle:nav:orders:${userId}`));
});

test("Fallback Customize row puts Badges before Store", () => {
  const labels = noodleProfileEditRowForTest("u1").toJSON().components.map((b) => b.label);
  assert.deepEqual(labels.slice(-2), ["Badges", "Store"]);
});
