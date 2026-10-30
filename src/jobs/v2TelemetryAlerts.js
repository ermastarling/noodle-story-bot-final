import path from "path";
import { runWithTelemetry } from "../infra/telemetry.js";
import {
  buildGoNoGoRecommendation,
  compareTelemetrySummary,
  detectHighTelemetryIssues,
  buildTelemetrySuggestions,
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

export function resolveTelemetryAlertChannel(telemetryChannelId, devAlertChannelId) {
  const telemetryId = String(telemetryChannelId || "").trim();
  const devId = String(devAlertChannelId || "").trim();
  if (!telemetryId) return { ok: false, reason: "missing_telemetry_channel" };
  if (telemetryId === devId) return { ok: false, reason: "channel_not_separate" };
  return { ok: true, channelId: telemetryId };
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

function formatCountPer100(value) {
  return Number.isFinite(value) ? `${String(value)} per 100` : safe(value);
}

const REPORT_TEXT_BUDGET = 3600;

export function buildReportText({
  summary = {},
  baselineSummary = null,
  delta,
  recommendation,
  windowHours,
  issues = [],
  issueCheck = null,
  thresholds = {},
  telemetryMode = "all",
  sampleRate = 1
} = {}) {
  const metricSummary = summary && typeof summary === "object" ? summary : {};
  const lines = [
    `Window: last ${windowHours}h`,
    "Scope: sampled bot interactions, instrumented scheduled-job runs, and V2 diagnostics. This is measured activity, not continuous uptime or Discord availability.",
    "",
    "What was observed:",
    `- Log records in this window: ${safe(metricSummary.recordsInWindow, "0")}`,
    `- Bot interaction latency records: ${safe(metricSummary.interactionEventRecords, safe(metricSummary.interactions, "0"))} seen; ${safe(metricSummary.interactions, "0")} had valid durations`,
    `- Failed interactions: ${safe(metricSummary.interactionErrors, "0")} (${formatPct(metricSummary.interactionErrorRatePct)})`,
    `- Server response time p50 / p95: ${formatMs(metricSummary.interactionTimeP50)} / ${formatMs(metricSummary.interactionTimeP95)}`,
    `- Interactions over the slow-event threshold: ${safe(metricSummary.slowInteractions, "0")}`,
    `- Scheduled-job runs: ${safe(metricSummary.scheduledJobRuns, "0")} (${safe(metricSummary.successfulJobRuns, "0")} succeeded, ${safe(metricSummary.failedJobRuns, "0")} failed, ${safe(metricSummary.skippedJobRuns, "0")} skipped)`,
    `- Hard operation/delivery failures recorded: ${safe(metricSummary.hardFailures, "0")}`,
    `- Process start events observed: ${safe(metricSummary.processStarts, "0")}; continuous uptime: not measured`,
    `- Discord gateway events: ${safe(metricSummary.gatewayEventCounts?.find((row) => row.kind === "ready")?.count, "0")} ready, ${safe(metricSummary.gatewayEventCounts?.find((row) => row.kind === "disconnect")?.count, "0")} disconnect, ${safe(metricSummary.gatewayEventCounts?.find((row) => row.kind === "shard_error")?.count, "0")} shard errors, ${safe(metricSummary.gatewayEventCounts?.find((row) => row.kind === "reconnecting")?.count, "0")} reconnecting, ${safe(metricSummary.gatewayEventCounts?.find((row) => row.kind === "resume")?.count, "0")} resumed`,
    `- V2 scene transitions / completed flows: ${safe(metricSummary.transitions, "0")} / ${safe(metricSummary.loops, "0")}`,
    `- V2 route-error signals per 100 scene transitions: ${formatCountPer100(metricSummary.errorRatePct)} (diagnostic ratio, not a command failure rate)`,
    `- Gate bypasses: ${safe(metricSummary.bypasses, "0")}`,
    `- V2 average clicks per completed flow: ${safe(metricSummary.clickAvg)}`,
    `- V2 flow elapsed p50 / p95: ${formatMs(metricSummary.loopTimeP50)} / ${formatMs(metricSummary.loopTimeP95)} (includes time between player clicks; not server latency)`,
    `- Data collection: mode=${safe(telemetryMode)}, sample rate=${formatPct(Number(sampleRate) * 100)}`
  ];

  if (delta) {
    lines.push(
      "",
      `Compared with previous ${windowHours}h window:`,
      `- Interactions measured: ${safe(baselineSummary?.interactions, "0")} before → ${safe(metricSummary.interactions, "0")} now`,
      `- Failed interactions: ${safe(baselineSummary?.interactionErrors, "0")} before → ${safe(metricSummary.interactionErrors, "0")} now`,
      `- Server response p95 change: ${formatMs(delta.interactionTimeP95Delta)} (${safe(delta.interactionTimeP95DeltaPct)}%)`,
      `- Interaction error-rate change: ${safe(delta.interactionErrorRateDeltaPct)} percentage points`,
      `- Failed scheduled-job runs: ${safe(baselineSummary?.failedJobRuns, "0")} before → ${safe(metricSummary.failedJobRuns, "0")} now`,
      `- Hard send failures: ${safe(baselineSummary?.hardFailures, "0")} before → ${safe(metricSummary.hardFailures, "0")} now`,
      `- V2 flow elapsed p95 change: ${formatMs(delta.loopTimeP95Delta)} (${safe(delta.loopTimeP95DeltaPct)}%)`,
      `- V2 route-error signal change: ${formatCountPer100(delta.errorRateDeltaPct)}`
    );
  } else {
    lines.push("", "Comparison:", "- No prior window data available; changes cannot be assessed.");
  }

  if (metricSummary?.errorsByReason?.length) {
    const topReasons = metricSummary.errorsByReason.slice(0, 3)
      .map((row) => `${row.reason}(${row.count})`)
      .join(", ");
    lines.push("", `Top V2 route-error signals (may include expected stale/ownership rejections): ${topReasons}`);
  }

  if (metricSummary?.interactionErrorsByRoute?.length) {
    const topRoutes = metricSummary.interactionErrorsByRoute.slice(0, 3)
      .map((row) => `${row.route}(${row.count})`)
      .join(", ");
    lines.push("", `Most failed interaction routes: ${topRoutes}`);
  }

  if (metricSummary?.jobRunRows?.length) {
    const jobRows = metricSummary.jobRunRows.slice(0, 5)
      .map((row) => `${row.job}(${row.runs} runs, ${row.failures} failed)`)
      .join(", ");
    lines.push("", `Scheduled-job outcomes: ${jobRows}`);
  }

  if (metricSummary?.hardFailuresByType?.length) {
    const failureTypes = metricSummary.hardFailuresByType.slice(0, 4)
      .map((row) => `${row.event}(${row.count})`)
      .join(", ");
    lines.push("", `Hard failure signals: ${failureTypes}`);
  }
  if (metricSummary?.hardFailureRows?.length) {
    const failureSources = metricSummary.hardFailureRows.slice(0, 5)
      .map((row) => `${row.source}(${row.count})`)
      .join(", ");
    lines.push(`Affected operation sources: ${failureSources}`);
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

  const headLines = lines.splice(0, lines.length);
  lines.push("", `Recommendation: ${recommendation}`);

  const suggestions = buildTelemetrySuggestions(metricSummary, issueCheck, delta, thresholds);
  lines.push("", "Suggested next step:", ...suggestions.map((suggestion) => `- ${suggestion}`));

  if (issues.length) {
    lines.push("", "Detected issues:", ...issues.map((issue) => `- ${issue}`));
  }

  // Discord caps one Components V2 message at 4000 text characters shared with header, footer and ping,
  // so trim the diagnostic detail first and always keep the recommendation, next steps and issues.
  const tail = lines.join("\n");
  const headBudget = Math.max(0, REPORT_TEXT_BUDGET - tail.length);
  let head = headLines.join("\n");
  if (head.length > headBudget) {
    head = `${head.slice(0, Math.max(0, headBudget - 40)).trimEnd()}\n… (details trimmed to fit Discord limit)`;
  }
  return `${head}${tail}`.slice(0, REPORT_TEXT_BUDGET);
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
    minInteractions: Math.max(1, parseIntEnv(
      env.NOODLE_V2_TELEMETRY_ALERT_MIN_INTERACTIONS,
      parseIntEnv(env.NOODLE_V2_TELEMETRY_ALERT_MIN_LOOPS, 20)
    )),
    interactionP95ThresholdMs: parseNumEnv(
      env.NOODLE_V2_TELEMETRY_ALERT_INTERACTION_P95_MS,
      20000
    ),
    clickAvgThreshold: parseNumEnv(env.NOODLE_V2_TELEMETRY_ALERT_CLICK_AVG, 6),
    interactionErrorRateThresholdPct: parseNumEnv(
      env.NOODLE_V2_TELEMETRY_ALERT_INTERACTION_ERROR_RATE_PCT,
      8
    ),
    routeErrorRateThresholdPct: parseNumEnv(
      env.NOODLE_V2_TELEMETRY_ALERT_ROUTE_ERROR_RATE_PCT,
      parseNumEnv(env.NOODLE_V2_TELEMETRY_ALERT_ERROR_RATE_PCT, 8)
    )
  };

  const p95RegressionPctThreshold = parseNumEnv(env.NOODLE_V2_TELEMETRY_ALERT_P95_REGRESSION_PCT, 20);
  const telemetryMode = String(env.NOODLE_TELEMETRY_MODE || "all").trim().toLowerCase();
  const sampleRate = Math.max(0, Math.min(1, parseNumEnv(env.NOODLE_TELEMETRY_SAMPLE_RATE, 1)));
  let running = false;

  async function runOnce(reason = "interval") {
    if (running) return "skipped";
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
      const issueCheck = detectHighTelemetryIssues(candidateSummary, thresholds);
      const issues = [...issueCheck.issues];
      if (
        issueCheck.hasEnoughData
        && delta
        && Number.isFinite(delta.interactionTimeP95DeltaPct)
        && delta.interactionTimeP95DeltaPct > p95RegressionPctThreshold
      ) {
        const regressionIssue = `Interaction p95 regression ${delta.interactionTimeP95DeltaPct}% exceeds ${p95RegressionPctThreshold}% threshold.`;
        issues.push(regressionIssue);
        issueCheck.issues.push(regressionIssue);
      }
      if (!issueCheck.hasEnoughData && issueCheck.note) {
        issues.push(issueCheck.note);
      }
      if (telemetryMode === "slow") {
        candidateSummary.dataQuality.warnings.push("Telemetry mode is 'slow'; ordinary interaction latency, scheduled-job outcomes, gateway lifecycle events, V2 transitions, and loop summaries are omitted, so health coverage is incomplete.");
      }
      if (sampleRate < 1) {
        candidateSummary.dataQuality.warnings.push(`Telemetry sampling is ${Math.round(sampleRate * 100)}%; some measured activity may be missing.`);
      }
      const recommendation = buildGoNoGoRecommendation(delta, {
        summary: candidateSummary,
        issueCheck,
        thresholds
      });

      const highIssue = (issueCheck.hasEnoughData && issues.length > 0)
        || candidateSummary.failedJobRuns > 0
        || candidateSummary.hardFailures > 0;
      const title = highIssue ? "Bot Health Alert" : "Bot Health Report";
      const description = buildReportText({
        summary: candidateSummary,
        baselineSummary,
        delta,
        recommendation,
        windowHours,
        issues,
        issueCheck,
        thresholds,
        telemetryMode,
        sampleRate
      });

      // Avoid replay-style startup chatter when there is no actionable telemetry issue.
      if (reason !== "startup" || highIssue) {
        await sendAlert({
          title,
          description,
          footerText: `Window: ${windowHours}h | Minimum interactions: ${thresholds.minInteractions} | Mode: ${telemetryMode}`,
          requireMention: highIssue,
          mentionUser: highIssue
        });
      }
      return true;
    } catch (error) {
      logger.error("Bot health report scheduler failed:", error?.stack ?? error);
      return false;
    } finally {
      running = false;
    }
  }

  const handle = setInterval(() => {
    void runWithTelemetry("telemetry_report", "interval", () => runOnce("interval"));
  }, intervalMs);
  handle.unref?.();

  logger.log(`INFO: Bot health report scheduler enabled every ${Math.round(intervalMs / 1000)}s (window ${windowHours}h).`);
  return handle;
}
