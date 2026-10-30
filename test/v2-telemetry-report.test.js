import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildGoNoGoRecommendation,
  buildTelemetrySuggestions,
  compareTelemetrySummary,
  detectHighTelemetryIssues,
  readTelemetryEvents,
  summarizeTelemetryEvents
} from "../src/infra/v2TelemetryReport.js";
import { buildReportText, resolveTelemetryAlertChannel } from "../src/jobs/v2TelemetryAlerts.js";

test("V2 telemetry alerts require a dedicated channel", () => {
  assert.deepEqual(resolveTelemetryAlertChannel("", "dev-alerts"), {
    ok: false,
    reason: "missing_telemetry_channel"
  });
  assert.deepEqual(resolveTelemetryAlertChannel("dev-alerts", "dev-alerts"), {
    ok: false,
    reason: "channel_not_separate"
  });
  assert.deepEqual(resolveTelemetryAlertChannel("telemetry", "dev-alerts"), {
    ok: true,
    channelId: "telemetry"
  });
});

test("V2 telemetry report: separates server interaction timing from V2 flow metrics", () => {
  const summary = summarizeTelemetryEvents({
    transitions: [{}, {}, {}, {}],
    errors: [{ reason: "expired" }, { reason: "expired" }, { reason: "owner_mismatch" }],
    bypasses: [{ reason: "rollout_disabled" }, { reason: "rollout_disabled" }],
    loops: [
      { module: "orders", clickCount: 3, completionMs: 1400 },
      { module: "orders", clickCount: 4, completionMs: 1800 },
      { module: "cook", clickCount: 5, completionMs: 2200 }
    ],
    interactions: [
      { route: "orders.accept", totalMs: 120, error: false },
      { route: "orders.accept", totalMs: 280, error: true },
      { route: "cook.complete", totalMs: 180, error: false },
      { route: "orders.accept", totalMs: "invalid", error: true }
    ],
    minigame: [{ outcome: "90%" }, { outcome: "90%" }, { outcome: "75%" }]
  });

  assert.equal(summary.transitions, 4);
  assert.equal(summary.errors, 3);
  assert.equal(summary.bypasses, 2);
  assert.equal(summary.errorRatePct, 75);
  assert.equal(summary.loops, 3);
  assert.equal(summary.clickAvg, 4);
  assert.equal(summary.loopTimeP95, 2200);
  assert.equal(summary.interactions, 3);
  assert.equal(summary.interactionEventRecords, 4);
  assert.equal(summary.invalidInteractionRecords, 1);
  assert.equal(summary.interactionErrors, 1);
  assert.equal(summary.interactionErrorRatePct, 33.33);
  assert.equal(summary.interactionTimeP50, 180);
  assert.equal(summary.interactionTimeP95, 280);
  assert.deepEqual(summary.interactionErrorsByRoute, [{ route: "orders.accept", count: 1 }]);
  assert.equal(summary.moduleRows[0].module, "orders");
  assert.equal(summary.errorsByReason[0].reason, "expired");
  assert.equal(summary.bypassByReason[0].reason, "rollout_disabled");
  assert.equal(summary.minigameDistribution[0].outcome, "90%");
});

test("V2 telemetry report: compares candidate to baseline and emits quantified deltas", () => {
  const baseline = {
    clickAvg: 4,
    loopTimeP50: 2000,
    loopTimeP95: 4000,
    interactionTimeP50: 1000,
    interactionTimeP95: 4000,
    interactionErrors: 4,
    interactionErrorRatePct: 8,
    errors: 8,
    errorRatePct: 5
  };
  const candidate = {
    clickAvg: 3,
    loopTimeP50: 1700,
    loopTimeP95: 3200,
    interactionTimeP50: 800,
    interactionTimeP95: 3200,
    interactionErrors: 2,
    interactionErrorRatePct: 5,
    errors: 5,
    errorRatePct: 3
  };

  const delta = compareTelemetrySummary(baseline, candidate);
  assert.equal(delta.clickAvgDelta, -1);
  assert.equal(delta.clickAvgDeltaPct, -25);
  assert.equal(delta.loopTimeP95Delta, -800);
  assert.equal(delta.loopTimeP95DeltaPct, -20);
  assert.equal(delta.interactionTimeP95Delta, -800);
  assert.equal(delta.interactionTimeP95DeltaPct, -20);
  assert.equal(delta.interactionErrorRateDeltaPct, -3);
  assert.equal(delta.errorCountDelta, -3);
  assert.equal(delta.errorRateDeltaPct, -2);
  const recommendation = buildGoNoGoRecommendation(delta, {
    summary: { interactions: 30, transitions: 20, loops: 30, errors: 5, interactionTimeP95: 3200 },
    issueCheck: { hasEnoughData: true, issues: [] }
  });
  assert.match(recommendation, /^IMPROVING:/);
  assert.match(recommendation, /server interaction p95 decreased 20%/);
});

test("V2 telemetry report: p95 regressions recommend inspecting the slowest measured route", () => {
  const summary = {
    interactions: 30,
    interactionTimeP95: 6000,
    routeRows: [
      { route: "orders.accept", timeP95: 6000 },
      { route: "cook.complete", timeP95: 3200 }
    ]
  };
  const suggestions = buildTelemetrySuggestions(
    summary,
    {
      hasEnoughData: true,
      issues: ["Interaction p95 regression 50% exceeds 20% threshold."]
    },
    { interactionTimeP95DeltaPct: 50 }
  );
  assert.match(suggestions.join(" "), /REGRESSION ACTION/);
  assert.match(suggestions.join(" "), /orders.accept route/);
});

test("V2 telemetry report: high issue detection triggers only with enough data", () => {
  const lowData = detectHighTelemetryIssues(
    {
      interactions: 3,
      interactionTimeP95: 50000,
      clickAvg: 12,
      interactionErrorRatePct: 50
    },
    {
      minInteractions: 10,
      interactionP95ThresholdMs: 20000,
      clickAvgThreshold: 6,
      interactionErrorRateThresholdPct: 8
    }
  );

  assert.equal(lowData.hasEnoughData, false);
  assert.equal(lowData.issues.length, 0);

  const highIssues = detectHighTelemetryIssues(
    {
      interactions: 30,
      interactionTimeP95: 26000,
      clickAvg: 7.2,
      interactionErrorRatePct: 11
    },
    {
      minInteractions: 10,
      interactionP95ThresholdMs: 20000,
      clickAvgThreshold: 6,
      interactionErrorRateThresholdPct: 8
    }
  );

  assert.equal(highIssues.hasEnoughData, true);
  assert.equal(highIssues.issues.length, 3);
});

test("V2 telemetry report: p95 uses nearest-rank behavior on small samples", () => {
  const summary = summarizeTelemetryEvents({
    transitions: [{}, {}, {}],
    errors: [],
    interactions: [
      { route: "orders", totalMs: 1000 },
      { route: "orders", totalMs: 2000 },
      { route: "orders", totalMs: 3000 }
    ],
    loops: [
      { module: "orders", clickCount: 2, completionMs: 1000 },
      { module: "orders", clickCount: 2, completionMs: 2000 },
      { module: "orders", clickCount: 2, completionMs: 3000 }
    ],
    minigame: []
  });

  assert.equal(summary.interactionTimeP95, 3000);
  assert.equal(summary.loopTimeP95, 3000);
});

test("V2 telemetry report: surfaces data-quality warnings for dropped telemetry", () => {
  const summary = summarizeTelemetryEvents({
    transitions: [{}],
    errors: [],
    loops: [],
    minigame: [],
    dropSummaries: [
      { totalDrops: 5, droppedByBuffer: 2, droppedBySampling: 1, droppedByMode: 2, backpressureSignals: 1 }
    ]
  });

  assert.equal(summary.dataQuality.totalDrops, 5);
  assert.equal(summary.dataQuality.warnings.length > 0, true);
  assert.match(summary.dataQuality.warnings.join(" "), /drop/i);
});

test("bot health summary uses observed scheduled-job, gateway, and hard-failure events", () => {
  const summary = summarizeTelemetryEvents({
    jobRuns: [
      { job: "work_ping", outcome: "success", durationMs: 40 },
      { job: "work_ping", outcome: "failure", durationMs: 90 },
      { job: "database_backup", outcome: "skipped", durationMs: 2 }
    ],
    processStarts: [{}],
    gatewayEvents: [
      { kind: "ready" },
      { kind: "disconnect" },
      { kind: "reconnecting" },
      { kind: "resume" }
    ],
    hardFailures: [
      { event: "hard_failure_dm_send" },
      { event: "hard_failure_scheduled_job", job: "weekly_giveaways", stage: "delivery_unknown" }
    ]
  });

  assert.equal(summary.scheduledJobRuns, 3);
  assert.equal(summary.successfulJobRuns, 1);
  assert.equal(summary.failedJobRuns, 1);
  assert.equal(summary.skippedJobRuns, 1);
  assert.deepEqual(summary.jobRunRows[0], {
    job: "work_ping",
    runs: 2,
    successes: 1,
    failures: 1,
    skipped: 0,
    durationP95: 90
  });
  assert.equal(summary.processStarts, 1);
  assert.equal(summary.gatewayEventCount, 4);
  assert.deepEqual(summary.gatewayEventCounts, [
    { kind: "ready", count: 1 },
    { kind: "disconnect", count: 1 },
    { kind: "reconnecting", count: 1 },
    { kind: "resume", count: 1 }
  ]);
  assert.equal(summary.hardFailures, 2);
  assert.deepEqual(summary.hardFailuresByType, [
    { event: "hard_failure_dm_send", count: 1 },
    { event: "hard_failure_scheduled_job", count: 1 }
  ]);
  assert.deepEqual(summary.hardFailureRows, [
    { source: "hard_failure_dm_send", count: 1 },
    { source: "weekly_giveaways:delivery_unknown", count: 1 }
  ]);
  assert.match(summary.dataQuality.warnings.join(" "), /No external heartbeat/);
});

test("observed job failures trigger an alert recommendation even with few interactions", () => {
  const summary = summarizeTelemetryEvents({
    jobRuns: [{ job: "database_backup", outcome: "failure", durationMs: 10 }]
  });
  const check = detectHighTelemetryIssues(summary, { minInteractions: 20 });
  const recommendation = buildGoNoGoRecommendation(null, { summary, issueCheck: check });

  assert.equal(check.hasEnoughData, false);
  assert.match(check.issues.join(" "), /Scheduled job failures observed/);
  assert.match(recommendation, /^ACTION NEEDED:/);
});

test("gateway disconnect evidence is surfaced without claiming availability", () => {
  const summary = summarizeTelemetryEvents({
    gatewayEvents: [{ kind: "disconnect" }, { kind: "shard_error" }]
  });
  const recommendation = buildGoNoGoRecommendation(null, { summary });

  assert.equal(summary.gatewayDisruptions, 2);
  assert.match(recommendation, /^WATCH:/);
  assert.match(recommendation, /cannot calculate Discord availability/);
});

test("V2 telemetry reader reports malformed and out-of-scope records", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noodle-telemetry-test-"));
  const filePath = path.join(directory, "telemetry.log");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(filePath, [
    JSON.stringify({ ts: "2026-10-22T00:30:00.000Z", event: "interaction_latency", payload: { route: "orders", totalMs: 42 } }),
    JSON.stringify({ ts: "2026-10-22T00:30:00.000Z", event: "v2_scene_transition", payload: {} }),
    JSON.stringify({ ts: "2026-10-22T00:30:00.000Z", event: "scheduled_job_run", payload: { job: "work_ping", outcome: "success" } }),
    JSON.stringify({ ts: "2026-10-22T00:30:00.000Z", event: "process_start", payload: {} }),
    JSON.stringify({ ts: "2026-10-22T00:30:00.000Z", event: "discord_gateway_event", payload: { kind: "ready" } }),
    JSON.stringify({ ts: "2026-10-22T00:30:00.000Z", event: "hard_failure_dm_send", payload: {} }),
    JSON.stringify({ ts: "2026-10-22T00:30:00.000Z", event: "other_event", payload: {} }),
    JSON.stringify({ ts: "invalid", event: "v2_scene_error", payload: {} }),
    "{not-json"
  ].join("\n"));

  const events = await readTelemetryEvents({
    filePath,
    startMs: Date.parse("2026-10-22T00:00:00.000Z"),
    endMs: Date.parse("2026-10-22T01:00:00.000Z")
  });
  const summary = summarizeTelemetryEvents(events);

  assert.equal(summary.transitions, 1);
  assert.equal(summary.interactions, 1);
  assert.equal(summary.scheduledJobRuns, 1);
  assert.equal(summary.processStarts, 1);
  assert.equal(summary.gatewayEventCounts[0].kind, "ready");
  assert.equal(summary.hardFailures, 1);
  assert.equal(summary.interactionTimeP95, 42);
  assert.equal(summary.recordsInWindow, 7);
  assert.equal(summary.dataQuality.warnings.some((warning) => warning.includes("malformed log lines")), true);
  assert.equal(summary.dataQuality.warnings.some((warning) => warning.includes("invalid timestamps")), true);
  assert.equal(summary.dataQuality.warnings.some((warning) => warning.includes("other event types")), true);
});

test("V2 telemetry report: recommendations point to measured module and error cause", () => {
  const summary = {
    interactions: 40,
    interactionTimeP95: 26000,
    interactionErrors: 8,
    interactionErrorRatePct: 20,
    transitions: 40,
    loops: 30,
    errors: 8,
    errorRatePct: 20,
    moduleRows: [
      { module: "orders", timeP95: 26000, clickAvg: 7 },
      { module: "cook", timeP95: 9000, clickAvg: 4 }
    ],
    routeRows: [
      { route: "orders.accept", interactions: 10, timeP95: 26000 },
      { route: "cook.complete", interactions: 4, timeP95: 9000 }
    ],
    interactionErrorsByRoute: [{ route: "orders.accept", count: 5 }],
    errorsByReason: [{ reason: "expired", count: 5 }]
  };
  const thresholds = {
    minInteractions: 10,
    interactionP95ThresholdMs: 20000,
    clickAvgThreshold: 6,
    interactionErrorRateThresholdPct: 8,
    routeErrorRateThresholdPct: 8
  };
  const issueCheck = detectHighTelemetryIssues(summary, thresholds);
  const recommendation = buildGoNoGoRecommendation(null, { summary, issueCheck, thresholds });
  assert.match(recommendation, /LATENCY ACTION/);
  assert.match(recommendation, /orders.accept route/);
  assert.match(recommendation, /ERROR ACTION/);
  assert.match(recommendation, /orders.accept has the most failed interactions/);
  assert.match(recommendation, /V2 ROUTE ACTION/);
  assert.match(recommendation, /expired/);
});

test("V2 telemetry report: empty and low-data windows do not imply health", () => {
  const emptyRecommendation = buildGoNoGoRecommendation(null, {
    summary: { interactions: 0, slowInteractions: 0, transitions: 0, loops: 0, errors: 0 }
  });
  assert.match(emptyRecommendation, /^NO SAMPLES:/);

  const limitedRecommendation = buildGoNoGoRecommendation(null, {
    summary: { interactions: 3, transitions: 8, loops: 3, errors: 0 },
    issueCheck: { hasEnoughData: false, note: "Insufficient measured interactions (3/20)." }
  });
  assert.match(limitedRecommendation, /^LIMITED DATA:/);
});

test("V2 telemetry report does not call slow-only data healthy or empty", () => {
  const summary = { interactions: 0, slowInteractions: 4, transitions: 0, loops: 0, errors: 0 };
  const recommendation = buildGoNoGoRecommendation(null, {
    summary,
    issueCheck: { hasEnoughData: false, note: "Insufficient measured interactions (0/20)." }
  });
  assert.match(recommendation, /^LIMITED DATA:/);
});

test("V2 telemetry report: alert text explains scope, samples, and error metric meaning", () => {
  const text = buildReportText({
    summary: {
      interactions: 12,
      interactionEventRecords: 12,
      interactionErrors: 1,
      interactionErrorRatePct: 8.3,
      interactionTimeP50: 1200,
      interactionTimeP95: 2600,
      slowInteractions: 2,
      recordsInWindow: 40,
      transitions: 12,
      errors: 1,
      bypasses: 0,
      errorRatePct: 8.3,
      loops: 5,
      clickAvg: 3,
      loopTimeP50: 1200,
      loopTimeP95: 2600
    },
    delta: null,
    recommendation: "STABLE: No configured threshold was crossed.",
    windowHours: 24,
    issues: [],
    issueCheck: { hasEnoughData: true, issues: [] },
    telemetryMode: "all",
    sampleRate: 1
  });

  assert.match(text, /sampled bot interactions, instrumented scheduled-job runs, and V2 diagnostics/);
  assert.match(text, /12 seen; 12 had valid durations/);
  assert.match(text, /Log records in this window: 40/);
  assert.match(text, /Failed interactions: 1 \(8.3%\)/);
  assert.match(text, /Server response time p50 \/ p95: 1200ms \/ 2600ms/);
  assert.match(text, /continuous uptime: not measured/);
  assert.match(text, /Scheduled-job runs: 0 \(0 succeeded, 0 failed, 0 skipped\)/);
  assert.match(text, /not server latency/);
  assert.match(text, /Suggested next step:/);
});
test("buildReportText stays within the Discord limit and keeps recommendation and issues", async () => {
  const { buildReportText } = await import("../src/jobs/v2TelemetryAlerts.js");
  const longWarnings = Array.from({ length: 60 }, (_, i) => `Warning number ${i} ${"x".repeat(80)}`);
  const text = buildReportText({
    summary: { dataQuality: { warnings: longWarnings } },
    recommendation: "ACTION NEEDED: keep me",
    windowHours: 24,
    issues: ["Issue that must survive."]
  });
  assert.ok(text.length <= 3600);
  assert.match(text, /Recommendation: ACTION NEEDED: keep me/);
  assert.match(text, /Issue that must survive/);
  assert.match(text, /trimmed to fit/);
});
