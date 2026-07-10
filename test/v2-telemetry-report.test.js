import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGoNoGoRecommendation,
  compareTelemetrySummary,
  detectHighTelemetryIssues,
  summarizeTelemetryEvents
} from "../src/infra/v2TelemetryReport.js";

test("V2 telemetry report: summarizes core loop, error, and minigame metrics", () => {
  const summary = summarizeTelemetryEvents({
    transitions: [{}, {}, {}, {}],
    errors: [{ reason: "expired" }, { reason: "expired" }, { reason: "owner_mismatch" }],
    loops: [
      { module: "orders", clickCount: 3, completionMs: 1400 },
      { module: "orders", clickCount: 4, completionMs: 1800 },
      { module: "cook", clickCount: 5, completionMs: 2200 }
    ],
    minigame: [{ outcome: "90%" }, { outcome: "90%" }, { outcome: "75%" }]
  });

  assert.equal(summary.transitions, 4);
  assert.equal(summary.errors, 3);
  assert.equal(summary.errorRatePct, 75);
  assert.equal(summary.loops, 3);
  assert.equal(summary.clickAvg, 4);
  assert.equal(summary.loopTimeP95, 2200);
  assert.equal(summary.moduleRows[0].module, "orders");
  assert.equal(summary.errorsByReason[0].reason, "expired");
  assert.equal(summary.minigameDistribution[0].outcome, "90%");
});

test("V2 telemetry report: compares candidate to baseline and emits quantified deltas", () => {
  const baseline = {
    clickAvg: 4,
    loopTimeP50: 2000,
    loopTimeP95: 4000,
    errors: 8,
    errorRatePct: 5
  };
  const candidate = {
    clickAvg: 3,
    loopTimeP50: 1700,
    loopTimeP95: 3200,
    errors: 5,
    errorRatePct: 3
  };

  const delta = compareTelemetrySummary(baseline, candidate);
  assert.equal(delta.clickAvgDelta, -1);
  assert.equal(delta.clickAvgDeltaPct, -25);
  assert.equal(delta.loopTimeP95Delta, -800);
  assert.equal(delta.loopTimeP95DeltaPct, -20);
  assert.equal(delta.errorCountDelta, -3);
  assert.equal(delta.errorRateDeltaPct, -2);
  assert.match(buildGoNoGoRecommendation(delta), /^GO:/);
});

test("V2 telemetry report: high issue detection triggers only with enough data", () => {
  const lowData = detectHighTelemetryIssues(
    {
      loops: 3,
      loopTimeP95: 50000,
      clickAvg: 12,
      errorRatePct: 50
    },
    {
      minLoops: 10,
      loopP95ThresholdMs: 20000,
      clickAvgThreshold: 6,
      errorRateThresholdPct: 8
    }
  );

  assert.equal(lowData.hasEnoughData, false);
  assert.equal(lowData.issues.length, 0);

  const highIssues = detectHighTelemetryIssues(
    {
      loops: 30,
      loopTimeP95: 26000,
      clickAvg: 7.2,
      errorRatePct: 11
    },
    {
      minLoops: 10,
      loopP95ThresholdMs: 20000,
      clickAvgThreshold: 6,
      errorRateThresholdPct: 8
    }
  );

  assert.equal(highIssues.hasEnoughData, true);
  assert.equal(highIssues.issues.length, 3);
});

test("V2 telemetry report: p95 uses nearest-rank behavior on small samples", () => {
  const summary = summarizeTelemetryEvents({
    transitions: [{}, {}, {}],
    errors: [],
    loops: [
      { module: "orders", clickCount: 2, completionMs: 1000 },
      { module: "orders", clickCount: 2, completionMs: 2000 },
      { module: "orders", clickCount: 2, completionMs: 3000 }
    ],
    minigame: []
  });

  assert.equal(summary.loopTimeP95, 3000);
});