import test from "node:test";
import assert from "node:assert/strict";

import {
  buildQualityCountsForBias,
  buildCookMinigameTargetActions,
  buildCookMinigameV2Message,
  buildCookRecipePickerV2Message,
  buildCookResultV2Message,
  createCookRunToken,
  deriveCookMinigamePerformance,
  evaluateCookMinigameTurn,
  resolveCookOutcomeForFlow
} from "../src/ui/cookFlowV2.js";

test("Cook flow V2: renders quantity controls and cook action", () => {
  const payload = buildCookRecipePickerV2Message({
    userId: "123",
    token: "tok",
    entries: [
      { recipeId: "ramen", line: "Ramen line" },
      { recipeId: "udon", line: "Udon line" }
    ],
    selectedRecipeId: "ramen",
    quantity: 3
  });

  const container = payload.components?.[0]?.components ?? [];
  const rows = container.filter((c) => c?.type === 1);
  assert.ok(rows.length >= 2);

  const qtyRow = rows.find((row) => row.components?.some((btn) => String(btn?.custom_id || "").includes(":qty:")));
  assert.ok(qtyRow, "expected qty row");
  const qtyIds = qtyRow.components.map((btn) => btn.custom_id);
  assert.ok(qtyIds.some((id) => id.endsWith(":m5")));
  assert.ok(qtyIds.some((id) => id.endsWith(":m1")));
  assert.ok(qtyIds.some((id) => id.endsWith(":p1")));
  assert.ok(qtyIds.some((id) => id.endsWith(":p5")));

  const actionRow = rows.find((row) => row.components?.some((btn) => String(btn?.custom_id || "").includes(":go:")));
  assert.ok(actionRow, "expected action row");
  const cookButton = actionRow.components.find((btn) => String(btn?.custom_id || "").includes(":go:"));
  assert.equal(cookButton.disabled, false);
  const cookAllButton = actionRow.components.find((btn) => String(btn?.custom_id || "").includes(":cfa:"));
  assert.equal(Boolean(cookAllButton), true);
});

test("Cook flow V2: disables cook action when no recipe entries exist", () => {
  const payload = buildCookRecipePickerV2Message({
    userId: "123",
    token: "tok",
    entries: [],
    selectedRecipeId: null,
    quantity: 1
  });

  const container = payload.components?.[0]?.components ?? [];
  const rows = container.filter((c) => c?.type === 1);
  const actionRow = rows.find((row) => row.components?.some((btn) => String(btn?.custom_id || "").includes(":go:")));
  assert.ok(actionRow, "expected action row");
  const cookButton = actionRow.components.find((btn) => String(btn?.custom_id || "").includes(":go:"));
  assert.equal(cookButton.disabled, true);
});

test("Cook flow V2: performance mapping perfect boundary", () => {
  const perf = deriveCookMinigamePerformance({ score: 9, totalTurns: 10, quantity: 10 });
  assert.equal(perf.bucket, "perfect");
  assert.equal(perf.qualityBias, "excellent");
  assert.equal(perf.successBowls, 10);
  assert.equal(perf.failBowls, 0);
});

test("Cook flow V2: performance mapping great boundary", () => {
  const perf = deriveCookMinigamePerformance({ score: 8, totalTurns: 10, quantity: 10 });
  assert.equal(perf.bucket, "great");
  assert.equal(perf.qualityBias, "great");
  assert.equal(perf.successBowls, 9);
  assert.equal(perf.failBowls, 1);
});

test("Cook flow V2: performance mapping okay boundary", () => {
  const perf = deriveCookMinigamePerformance({ score: 5, totalTurns: 10, quantity: 10 });
  assert.equal(perf.bucket, "okay");
  assert.equal(perf.qualityBias, "good");
  assert.equal(perf.successBowls, 7);
  assert.equal(perf.failBowls, 3);
});

test("Cook flow V2: performance mapping failure case", () => {
  const perf = deriveCookMinigamePerformance({ score: 2, totalTurns: 10, quantity: 10 });
  assert.equal(perf.bucket, "rough");
  assert.equal(perf.qualityBias, "salvage");
  assert.equal(perf.successBowls, 4);
  assert.equal(perf.failBowls, 6);
});

test("Cook flow V2: result scene exposes next actions", () => {
  const payload = buildCookResultV2Message({
    userId: "123",
    token: "tok",
    summaryLines: ["line"]
  });

  const rows = payload.components?.[0]?.components?.filter((component) => component?.type === 1) ?? [];
  const actionRow = rows[0] ?? { components: [] };
  const customIds = actionRow.components.map((component) => component.custom_id);
  assert.ok(customIds.some((id) => String(id || "").includes(":cook.result:ord:")));
  assert.ok(customIds.some((id) => String(id || "").includes(":cook.result:cook:")));
  assert.ok(customIds.some((id) => String(id || "").includes(":cook.result:serve:")));
});

test("Cook flow V2: result scene prefers serve action when all bowls are ready", () => {
  const payload = buildCookResultV2Message({
    userId: "123",
    token: "tok",
    summaryLines: ["line"],
    preferServe: true
  });

  const rows = payload.components?.[0]?.components?.filter((component) => component?.type === 1) ?? [];
  const actionRow = rows[0] ?? { components: [] };
  const cookButton = actionRow.components.find((component) => String(component?.custom_id || "").includes(":cook.result:cook:"));
  const serveButton = actionRow.components.find((component) => String(component?.custom_id || "").includes(":cook.result:serve:"));
  assert.equal(Number(cookButton?.style || 0), 2);
  assert.equal(Number(serveButton?.style || 0), 3);
});

test("Cook flow V2: tutorial result scene shows only next tutorial step action", () => {
  const payload = buildCookResultV2Message({
    userId: "123",
    token: "tok",
    summaryLines: ["line"],
    tutorialNextOnly: true,
    tutorialNextLabel: "Next Tutorial Step"
  });

  const rows = payload.components?.[0]?.components?.filter((component) => component?.type === 1) ?? [];
  const actionRow = rows[0] ?? { components: [] };
  const customIds = actionRow.components.map((component) => component.custom_id);
  assert.equal(customIds.length, 1);
  assert.ok(String(customIds[0] || "").includes(":cook.result:nxt:"));
});

test("Cook flow V2: target pattern is deterministic per run token", () => {
  const token = createCookRunToken({ userId: "u1", recipeId: "ramen", quantity: 3, nowMs: 1700000000000 });
  const seqA = buildCookMinigameTargetActions({ recipeId: "ramen", runToken: token, totalTurns: 8 });
  const seqB = buildCookMinigameTargetActions({ recipeId: "ramen", runToken: token, totalTurns: 8 });
  assert.deepEqual(seqA, seqB);
});

test("Cook flow V2: target pattern varies across run tokens", () => {
  const seqA = buildCookMinigameTargetActions({ recipeId: "ramen", runToken: "tokA", totalTurns: 8 });
  const seqB = buildCookMinigameTargetActions({ recipeId: "ramen", runToken: "tokB", totalTurns: 8 });
  assert.notDeepEqual(seqA, seqB);
});

test("Cook flow V2: turn evaluation allows grace window", () => {
  const result = evaluateCookMinigameTurn({
    action: "prep",
    targetAction: "prep",
    turnStartedAt: 1000,
    nowMs: 1000 + 2200 + 600,
    turnMs: 2200,
    graceMs: 650
  });
  assert.equal(result.isHit, true);
  assert.equal(result.status, "hit");
});

test("Cook flow V2: turn evaluation marks late taps as miss", () => {
  const result = evaluateCookMinigameTurn({
    action: "prep",
    targetAction: "prep",
    turnStartedAt: 1000,
    nowMs: 1000 + 2200 + 651,
    turnMs: 2200,
    graceMs: 650
  });
  assert.equal(result.isHit, false);
  assert.equal(result.status, "late");
});

test("Cook flow V2: outcome resolver bypasses random roll callback for minigame flow", () => {
  const outcome = resolveCookOutcomeForFlow({
    v2MinigameCook: true,
    batchOutput: 10,
    minigameScore: 9,
    minigameTurns: 10,
    rollBatchOutcomeFn: () => {
      throw new Error("random roll should not execute in v2 minigame flow");
    }
  });

  assert.equal(outcome.success, 10);
  assert.equal(outcome.failed, 0);
});

test("Cook flow V2: quality bias maps to known quality keys and preserves success sum", () => {
  const allowedKeys = new Set(["standard", "good", "excellent", "salvage"]);
  const cases = [
    { bias: "excellent", success: 5 },
    { bias: "great", success: 7 },
    { bias: "good", success: 9 },
    { bias: "salvage", success: 6 }
  ];

  for (const row of cases) {
    const counts = buildQualityCountsForBias({ success: row.success, bias: row.bias });
    const keys = Object.keys(counts);
    const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);

    assert.ok(keys.length > 0, `expected counts for bias ${row.bias}`);
    for (const key of keys) {
      assert.ok(allowedKeys.has(key), `unexpected quality key ${key} for bias ${row.bias}`);
    }
    assert.equal(total, row.success, `quality counts must sum to success for bias ${row.bias}`);
  }
});

test("Cook flow V2: tutorial mode includes forgiving timer guidance and future 10s note", () => {
  const payload = buildCookMinigameV2Message({
    userId: "123",
    token: "tok",
    recipeName: "Classic Soy Ramen",
    quantity: 1,
    turnIndex: 0,
    totalTurns: 6,
    score: 0,
    misses: 0,
    targetAction: "prep",
    turnMs: 18000,
    graceMs: 3000,
    tutorialMode: true,
    coachingLine: "Tutorial mode: generous timing is enabled for this step. Future kitchen turns use a **10s** order window."
  });

  const nodes = payload.components?.[0]?.components ?? [];
  const allText = nodes
    .filter((node) => node?.type === 10)
    .map((node) => String(node?.content ?? ""))
    .join("\n");

  assert.match(allText, /generous timing/i);
  assert.match(allText, /10s/i);
});
