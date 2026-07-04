import test from "node:test";
import assert from "node:assert/strict";

import { buildOrdersBoardV2Message } from "../src/ui/ordersBoardV2.js";
import { buildAcceptPickerV2Message, buildAcceptResultV2Message } from "../src/ui/acceptFlowV2.js";
import { buildCancelPickerV2Message } from "../src/ui/cancelFlowV2.js";
import {
  buildCookRecipePickerV2Message,
  buildCookMinigameV2Message,
  buildCookResultV2Message
} from "../src/ui/cookFlowV2.js";
import { buildServePickerV2Message, buildServeResultV2Message } from "../src/ui/serveFlowV2.js";

const USER_ID = "123456789012345678";
const TOKEN = "tok-fixed";

function snapshotScene(payload) {
  const container = payload.components?.[0]?.components ?? [];
  const textHeadings = container
    .filter((node) => node?.type === 10)
    .map((node) => String(node.content || "").trim())
    .filter((line) => line.startsWith("## "));

  const buttonIds = [];
  const selectIds = [];
  const stack = [...container];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;

    if (node.type === 2) {
      buttonIds.push(String(node.custom_id || ""));
    }

    if (node.type === 3) {
      selectIds.push(String(node.custom_id || ""));
    }

    if (Array.isArray(node.components)) stack.push(...node.components);
    if (node.accessory && typeof node.accessory === "object") stack.push(node.accessory);
  }

  buttonIds.sort();
  selectIds.sort();

  return {
    flags: payload.flags,
    heading: textHeadings[0] ?? null,
    buttonIds,
    selectIds
  };
}

test("Scene snapshots V2: orders.board", () => {
  const payload = buildOrdersBoardV2Message({
    userId: USER_ID,
    token: TOKEN,
    headerLines: ["Daily board"],
    acceptedEntries: [
      { shortId: "AB12", line: "AB12: Classic Soy", serveReady: true },
      { shortId: "CD34", line: "CD34: Miso Veg", serveReady: false }
    ],
    quickActions: [
      { label: "Accept", actionKey: "acc", style: 1, disabled: false },
      { label: "Cook", actionKey: "ck", style: 3, disabled: false },
      { label: "Serve", actionKey: "sv", style: 2, disabled: false },
      { label: "Quests", actionKey: "qs", style: 2, disabled: false }
    ]
  });

  assert.deepEqual(snapshotScene(payload), {
    flags: 32768,
    heading: null,
    buttonIds: [
      "noodle:v2:orders.board:acc:123456789012345678:tok-fixed",
      "noodle:v2:orders.board:ck:123456789012345678:tok-fixed",
      "noodle:v2:orders.board:qs:123456789012345678:tok-fixed",
      "noodle:v2:orders.board:sv:123456789012345678:tok-fixed",
      "noodle:v2:orders.board:sv:123456789012345678:tok-fixed:AB12"
    ],
    selectIds: []
  });
});

test("Scene snapshots V2: orders.accept_picker", () => {
  const payload = buildAcceptPickerV2Message({
    userId: USER_ID,
    token: TOKEN,
    entries: [
      { shortId: "AB12", line: "AB12: Classic Soy" },
      { shortId: "CD34", line: "CD34: Miso Veg" }
    ],
    selectedShortIds: ["AB12"],
    statusLine: "Select one.",
    currentPage: 0,
    totalPages: 2
  });

  assert.deepEqual(snapshotScene(payload), {
    flags: 32768,
    heading: null,
    buttonIds: [
      "noodle:v2:orders.accept_picker:bk:123456789012345678:tok-fixed",
      "noodle:v2:orders.accept_picker:cfm:123456789012345678:tok-fixed",
      "noodle:v2:orders.accept_picker:cnl:123456789012345678:tok-fixed",
      "noodle:v2:orders.accept_picker:pg:123456789012345678:tok-fixed:next",
      "noodle:v2:orders.accept_picker:pg:123456789012345678:tok-fixed:prev",
      "noodle:v2:orders.accept_picker:sel:123456789012345678:tok-fixed:AB12",
      "noodle:v2:orders.accept_picker:sel:123456789012345678:tok-fixed:CD34"
    ],
    selectIds: []
  });
});

test("Scene snapshots V2: orders.accept_result", () => {
  const payload = buildAcceptResultV2Message({
    userId: USER_ID,
    token: TOKEN,
    outcomeCode: "accepted",
    detailLine: "Accepted AB12"
  });

  assert.deepEqual(snapshotScene(payload), {
    flags: 32768,
    heading: "## Order Accepted",
    buttonIds: [
      "noodle:v2:orders.accept_result:ck:123456789012345678:tok-fixed",
      "noodle:v2:orders.accept_result:ord:123456789012345678:tok-fixed"
    ],
    selectIds: []
  });
});

test("Scene snapshots V2: orders.cancel_picker", () => {
  const payload = buildCancelPickerV2Message({
    userId: USER_ID,
    token: TOKEN,
    entries: [
      { shortId: "AB12", line: "AB12: Classic Soy" },
      { shortId: "CD34", line: "CD34: Miso Veg" }
    ],
    selectedShortIds: ["CD34"]
  });

  assert.deepEqual(snapshotScene(payload), {
    flags: 32768,
    heading: null,
    buttonIds: [
      "noodle:v2:orders.cancel_picker:bk:123456789012345678:tok-fixed",
      "noodle:v2:orders.cancel_picker:cfm:123456789012345678:tok-fixed",
      "noodle:v2:orders.cancel_picker:cnl:123456789012345678:tok-fixed",
      "noodle:v2:orders.cancel_picker:sel:123456789012345678:tok-fixed:AB12",
      "noodle:v2:orders.cancel_picker:sel:123456789012345678:tok-fixed:CD34"
    ],
    selectIds: []
  });
});

test("Scene snapshots V2: cook.recipe_picker", () => {
  const payload = buildCookRecipePickerV2Message({
    userId: USER_ID,
    token: TOKEN,
    entries: [
      { recipeId: "classic_soy_ramen", recipeName: "Classic Soy Ramen", tier: "standard", ready: 1, cookable: 5, short: 0, line: "Classic Soy" },
      { recipeId: "veggie_miso_bowl", recipeName: "Veggie Miso Bowl", tier: "seasonal", ready: 0, cookable: 3, short: 1, line: "Veggie Miso" }
    ],
    selectedRecipeId: "classic_soy_ramen",
    quantity: 2,
    currentPage: 0,
    totalPages: 2,
    needLines: ["Need: noodles"]
  });

  assert.deepEqual(snapshotScene(payload), {
    flags: 32768,
    heading: null,
    buttonIds: [
      "noodle:v2:cook.recipe_picker:bk:123456789012345678:tok-fixed",
      "noodle:v2:cook.recipe_picker:cfa:123456789012345678:tok-fixed",
      "noodle:v2:cook.recipe_picker:go:123456789012345678:tok-fixed",
      "noodle:v2:cook.recipe_picker:pg:123456789012345678:tok-fixed:next",
      "noodle:v2:cook.recipe_picker:pg:123456789012345678:tok-fixed:prev",
      "noodle:v2:cook.recipe_picker:qty:123456789012345678:tok-fixed:m1",
      "noodle:v2:cook.recipe_picker:qty:123456789012345678:tok-fixed:m5",
      "noodle:v2:cook.recipe_picker:qty:123456789012345678:tok-fixed:p1",
      "noodle:v2:cook.recipe_picker:qty:123456789012345678:tok-fixed:p5"
    ],
    selectIds: ["noodle:v2:cook.recipe_picker:sel:123456789012345678:tok-fixed"]
  });
});

test("Scene snapshots V2: cook.minigame", () => {
  const payload = buildCookMinigameV2Message({
    userId: USER_ID,
    token: TOKEN,
    recipeName: "Classic Soy Ramen",
    quantity: 2,
    turnIndex: 2,
    totalTurns: 8,
    score: 2,
    misses: 1,
    targetAction: "heat",
    turnMs: 2200,
    graceMs: 650,
    lastTurnStatus: "hit"
  });

  assert.deepEqual(snapshotScene(payload), {
    flags: 32768,
    heading: null,
    buttonIds: [
      "noodle:v2:cook.minigame:bk:123456789012345678:tok-fixed",
      "noodle:v2:cook.minigame:heat:123456789012345678:tok-fixed",
      "noodle:v2:cook.minigame:plate:123456789012345678:tok-fixed",
      "noodle:v2:cook.minigame:prep:123456789012345678:tok-fixed",
      "noodle:v2:cook.minigame:serve:123456789012345678:tok-fixed"
    ],
    selectIds: []
  });
});

test("Scene snapshots V2: cook.result", () => {
  const payload = buildCookResultV2Message({
    userId: USER_ID,
    token: TOKEN,
    summaryLines: ["Cooked 2 bowls"]
  });

  assert.deepEqual(snapshotScene(payload), {
    flags: 32768,
    heading: null,
    buttonIds: [
      "noodle:v2:cook.result:cook:123456789012345678:tok-fixed",
      "noodle:v2:cook.result:ord:123456789012345678:tok-fixed",
      "noodle:v2:cook.result:serve:123456789012345678:tok-fixed"
    ],
    selectIds: []
  });
});

test("Scene snapshots V2: serve.order_picker", () => {
  const payload = buildServePickerV2Message({
    userId: USER_ID,
    token: TOKEN,
    entries: [
      { shortId: "AB12", line: "AB12: Classic Soy" },
      { shortId: "CD34", line: "CD34: Miso Veg" }
    ],
    selectedShortIds: ["AB12"],
    readyOnly: false
  });

  assert.deepEqual(snapshotScene(payload), {
    flags: 32768,
    heading: null,
    buttonIds: [
      "noodle:v2:serve.order_picker:bk:123456789012345678:tok-fixed",
      "noodle:v2:serve.order_picker:cfm:123456789012345678:tok-fixed",
      "noodle:v2:serve.order_picker:sel:123456789012345678:tok-fixed:AB12",
      "noodle:v2:serve.order_picker:sel:123456789012345678:tok-fixed:CD34",
      "noodle:v2:serve.order_picker:sfa:123456789012345678:tok-fixed"
    ],
    selectIds: []
  });
});

test("Scene snapshots V2: serve.result", () => {
  const payload = buildServeResultV2Message({
    userId: USER_ID,
    token: TOKEN,
    outcomeCode: "served",
    detailLine: "Served AB12"
  });

  assert.deepEqual(snapshotScene(payload), {
    flags: 32768,
    heading: null,
    buttonIds: [
      "noodle:v2:serve.result:again:123456789012345678:tok-fixed",
      "noodle:v2:serve.result:cook:123456789012345678:tok-fixed",
      "noodle:v2:serve.result:ord:123456789012345678:tok-fixed"
    ],
    selectIds: []
  });
});