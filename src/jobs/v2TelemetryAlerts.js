import path from "path";
import {
  buildGoNoGoRecommendation,
  compareTelemetrySummary,
  detectHighTelemetryIssues,
  getTelemetryWindowRange,
  readTelemetryEvents,
  summarizeTelemetryEvents
} from "../infra/v2TelemetryReport.js";

function parseIntEnv(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function parseNumEnv(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function asBool(value) {
  return String(value || "").trim() === "1";
}

function safe(v, fallback = "n/a") {
  return v == null ? fallback : String(v);
}

function formatPct(value) {
  if (value == null) return "n/a";
  return `${String(value)}%`;
}

function formatMs(value) {
  return Number.isFinite(value) ? `${String(value)}ms` : safe(value);
}

export function buildReportText({ summary = {}, delta, recommendation, windowHours, issues = [] } = {}) {
  const metricSummary = summary && typeof summary === "object" ? summary : {};
  const lines = [
    `Window: last ${windowHours}h`,
    `Metric: transitions - ${safe(metricSummary.transitions, "0")} transitions recorded in this window.`,
    `Metric: errors - ${safe(metricSummary.errors, "0")} scene errors captured; meaning: runtime failures still need inspection if counts spike.`,
    `Metric: gate bypasses - ${safe(metricSummary.bypasses, "0")} bypasses; meaning: rollout gating was skipped for these routes.`,
    `Metric: error rate - ${formatPct(metricSummary.errorRatePct)}; meaning: the share of transitions that ended in error.`,
    `Metric: loops - ${safe(metricSummary.loops, "0")} loop summaries; meaning: enough samples exist to compare efficiency trends.`,
    `Metric: avg clicks/loop - ${safe(metricSummary.clickAvg)}; meaning: interaction effort per loop.`,
    `Metric: loop p50 - ${formatMs(metricSummary.loopTimeP50)}; meaning: typical runtime latency for the middle of the sample.`,
    `Metric: loop p95 - ${formatMs(metricSummary.loopTimeP95)}; meaning: worst-case latency tail for the current window.`
  ];

  if (delta) {
    lines.push(
      "",
      "Baseline comparison:",
      `Meaning: click cost changed by ${safe(delta.clickAvgDelta)} (${safe(delta.clickAvgDeltaPct)}%) versus the previous window.`,
      `Meaning: median loop latency changed by ${formatMs(delta.loopTimeP50Delta)} (${safe(delta.loopTimeP50DeltaPct)}%).`,
      `Meaning: tail latency changed by ${formatMs(delta.loopTimeP95Delta)} (${safe(delta.loopTimeP95DeltaPct)}%).`,
      `Meaning: error volume changed by ${safe(delta.errorCountDelta)} events and ${safe(delta.errorRateDeltaPct)} percentage points.`,
      `Action: inspect the affected flow when deltas move materially from baseline.`,
      `Threshold: compare against the previous window and the configured alert thresholds.`
    );
  } else {
    lines.push("", "Baseline comparison:", "Meaning: no baseline window was available for comparison.", "Action: inspect the current window directly and compare against later runs.");
  }

  if (metricSummary?.errorsByReason?.length) {
    const topReasons = metricSummary.errorsByReason.slice(0, 3)
      .map((row) => `${row.reason}(${row.count})`)
      .join(", ");
    lines.push("", `Top error reasons: ${topReasons}`);
  }

  if (metricSummary?.dataQuality?.warnings?.length) {
    lines.push("", "Data quality warnings:", ...metricSummary.dataQuality.warnings.map((warning) => `- ${warning}`));
  }

  if (metricSummary?.bypassByReason?.length) {
    const topBypassReasons = metricSummary.bypassByReason.slice(0, 3)
      .map((row) => `${row.reason}(${row.count})`)
      .join(", ");
    lines.push("", `Top bypass reasons: ${topBypassReasons}`);
  }

  lines.push("", `Recommendation: ${recommendation}`);
  lines.push("Action: follow the recommendation as an investigate-first signal, not a hard release gate.");

  if (issues.length) {
    lines.push("", "Detected issues:", ...issues.map((issue) => `- ${issue}`));
  }

  return lines.join("\n").slice(0, 4000);
}

export function startV2TelemetryAlertScheduler({ sendAlert, env = process.env, logger = console } = {}) {
  if (typeof sendAlert !== "function") {
    throw new Error("startV2TelemetryAlertScheduler requires sendAlert callback");
  }

  if (!asBool(env.NOODLE_V2_TELEMETRY_REPORTS_ENABLED)) {
    return null;
  }

  const telemetryPath = path.resolve(
    env.NOODLE_TELEMETRY_LOG_PATH && String(env.NOODLE_TELEMETRY_LOG_PATH).trim()
      ? String(env.NOODLE_TELEMETRY_LOG_PATH).trim()
      : path.join(process.cwd(), "noodle-logs", "telemetry.log")
  );
  const intervalMs = Math.max(5 * 60 * 1000, parseIntEnv(env.NOODLE_V2_TELEMETRY_REPORT_INTERVAL_MS, 6 * 60 * 60 * 1000));
  const windowHours = Math.max(1, parseIntEnv(env.NOODLE_V2_TELEMETRY_REPORT_WINDOW_HOURS, 24));

  const thresholds = {
    minLoops: Math.max(1, parseIntEnv(env.NOODLE_V2_TELEMETRY_ALERT_MIN_LOOPS, 20)),
    loopP95ThresholdMs: parseNumEnv(env.NOODLE_V2_TELEMETRY_ALERT_LOOP_P95_MS, 20000),
    clickAvgThreshold: parseNumEnv(env.NOODLE_V2_TELEMETRY_ALERT_CLICK_AVG, 6),
    errorRateThresholdPct: parseNumEnv(env.NOODLE_V2_TELEMETRY_ALERT_ERROR_RATE_PCT, 8)
  };

  const p95RegressionPctThreshold = parseNumEnv(env.NOODLE_V2_TELEMETRY_ALERT_P95_REGRESSION_PCT, 20);
  let running = false;

  async function runOnce(reason = "interval") {
    if (running) return;
    running = true;
    try {
      const nowMs = Date.now();
      const candidateWindow = getTelemetryWindowRange({ nowMs, windowHours, offsetWindows: 0 });
      const baselineWindow = getTelemetryWindowRange({ nowMs, windowHours, offsetWindows: 1 });

      const [candidateEvents, baselineEvents] = await Promise.all([
        readTelemetryEvents({ filePath: telemetryPath, startMs: candidateWindow.startMs, endMs: candidateWindow.endMs }),
        readTelemetryEvents({ filePath: telemetryPath, startMs: baselineWindow.startMs, endMs: baselineWindow.endMs })
      ]);

      const candidateSummary = summarizeTelemetryEvents(candidateEvents);
      const baselineSummary = summarizeTelemetryEvents(baselineEvents);
      const delta = compareTelemetrySummary(baselineSummary, candidateSummary);
      const recommendation = buildGoNoGoRecommendation(delta);

      const issueCheck = detectHighTelemetryIssues(candidateSummary, thresholds);
      const issues = [...issueCheck.issues];
      if (
        issueCheck.hasEnoughData
        && delta
        && Number.isFinite(delta.loopTimeP95DeltaPct)
        && delta.loopTimeP95DeltaPct > p95RegressionPctThreshold
      ) {
        issues.push(`Loop p95 regression ${delta.loopTimeP95DeltaPct}% exceeds ${p95RegressionPctThreshold}% threshold.`);
      }
      if (!issueCheck.hasEnoughData && issueCheck.note) {
        issues.push(issueCheck.note);
      }

      const highIssue = issueCheck.hasEnoughData && issues.length > 0;
      const title = highIssue ? "V2 Telemetry Alert" : "V2 Telemetry Report";
      const description = buildReportText({
        summary: candidateSummary,
        delta,
        recommendation,
        windowHours,
        issues
      });

      // Avoid replay-style startup chatter when there is no actionable telemetry issue.
      if (reason !== "startup" || highIssue) {
        await sendAlert({
          title,
          description,
          footerText: `Reason: ${reason} | minLoops=${thresholds.minLoops}`,
          requireMention: highIssue,
          mentionUser: highIssue
        });
      }
    } catch (error) {
      logger.error("V2 telemetry report scheduler failed:", error?.stack ?? error);
    } finally {
      running = false;
    }
  }

  const handle = setInterval(() => {
    runOnce("interval");
  }, intervalMs);
  handle.unref?.();

  logger.log(`INFO: V2 telemetry report scheduler enabled every ${Math.round(intervalMs / 1000)}s (window ${windowHours}h).`);
  return handle;
}
