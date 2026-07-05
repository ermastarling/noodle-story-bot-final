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

function buildReportText({ summary, delta, recommendation, windowHours, issues = [] } = {}) {
  const lines = [
    `Window: last ${windowHours}h`,
    `Transitions: ${safe(summary.transitions, "0")}`,
    `Errors: ${safe(summary.errors, "0")}`,
    `Error rate: ${formatPct(summary.errorRatePct)}`,
    `Loops: ${safe(summary.loops, "0")}`,
    `Avg clicks/loop: ${safe(summary.clickAvg)}`,
    `Loop p50: ${formatMs(summary.loopTimeP50)}`,
    `Loop p95: ${formatMs(summary.loopTimeP95)}`
  ];

  if (delta) {
    lines.push(
      "",
      "Vs previous window:",
      `Clicks delta: ${safe(delta.clickAvgDelta)} (${safe(delta.clickAvgDeltaPct)}%)`,
      `p50 delta: ${formatMs(delta.loopTimeP50Delta)} (${safe(delta.loopTimeP50DeltaPct)}%)`,
      `p95 delta: ${formatMs(delta.loopTimeP95Delta)} (${safe(delta.loopTimeP95DeltaPct)}%)`,
      `Error count delta: ${safe(delta.errorCountDelta)}`,
      `Error rate delta: ${safe(delta.errorRateDeltaPct)} pts`
    );
  }

  if (summary?.errorsByReason?.length) {
    const topReasons = summary.errorsByReason.slice(0, 3)
      .map((row) => `${row.reason}(${row.count})`)
      .join(", ");
    lines.push("", `Top error reasons: ${topReasons}`);
  }

  lines.push("", `Recommendation: ${recommendation}`);

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
      if (delta && Number.isFinite(delta.loopTimeP95DeltaPct) && delta.loopTimeP95DeltaPct > p95RegressionPctThreshold) {
        issues.push(`Loop p95 regression ${delta.loopTimeP95DeltaPct}% exceeds ${p95RegressionPctThreshold}% threshold.`);
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

      await sendAlert({
        title,
        description,
        footerText: `Reason: ${reason} | minLoops=${thresholds.minLoops}`,
        requireMention: highIssue,
        mentionUser: highIssue
      });
    } catch (error) {
      logger.error("V2 telemetry report scheduler failed:", error?.stack ?? error);
    } finally {
      running = false;
    }
  }

  runOnce("startup");
  const handle = setInterval(() => {
    runOnce("interval");
  }, intervalMs);
  handle.unref?.();

  logger.log(`INFO: V2 telemetry report scheduler enabled every ${Math.round(intervalMs / 1000)}s (window ${windowHours}h).`);
  return handle;
}
