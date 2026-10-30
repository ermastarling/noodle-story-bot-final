import fs from "fs";
import path from "path";
import readline from "readline";

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values) {
  const nums = values.filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

function percentile(values, p) {
  const nums = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const boundedP = Math.max(0, Math.min(100, Number(p) || 0));
  const idx = Math.max(0, Math.min(nums.length - 1, Math.ceil((boundedP / 100) * nums.length) - 1));
  return nums[idx];
}

function pctDelta(base, next) {
  if (!Number.isFinite(base) || !Number.isFinite(next) || base === 0) return null;
  return round(((next - base) / Math.abs(base)) * 100);
}

function parseTs(value) {
  if (!value) return null;
  const ts = Date.parse(String(value));
  return Number.isFinite(ts) ? ts : null;
}

export function getTelemetryWindowRange({ nowMs = Date.now(), windowHours = 24, offsetWindows = 0 } = {}) {
  const safeHours = Math.max(1, Math.floor(Number(windowHours) || 24));
  const safeOffset = Math.max(0, Math.floor(Number(offsetWindows) || 0));
  const windowMs = safeHours * 60 * 60 * 1000;
  const endMs = nowMs - (safeOffset * windowMs);
  const startMs = endMs - windowMs;
  return { startMs, endMs, windowMs };
}

export async function readTelemetryEvents({ filePath, startMs = null, endMs = null } = {}) {
  const absPath = path.resolve(String(filePath || ""));
  if (!fs.existsSync(absPath)) {
    throw new Error(`Telemetry file not found: ${absPath}`);
  }

  const stream = fs.createReadStream(absPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const events = {
    transitions: [],
    errors: [],
    bypasses: [],
    loops: [],
    interactions: [],
    slowInteractions: [],
    minigame: [],
    jobRuns: [],
    processStarts: [],
    gatewayEvents: [],
    hardFailures: [],
    dropSummaries: [],
    fileStats: {
      malformedLines: 0,
      invalidTimestampLines: 0,
      unrecognizedEvents: 0,
      recordsInWindow: 0
    }
  };

  for await (const line of rl) {
    const raw = String(line || "").trim();
    if (!raw) continue;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      events.fileStats.malformedLines += 1;
      continue;
    }

    const ts = parseTs(parsed?.ts);
    if (!Number.isFinite(ts)) {
      events.fileStats.invalidTimestampLines += 1;
      continue;
    }
    if (Number.isFinite(startMs) && ts < startMs) continue;
    if (Number.isFinite(endMs) && ts >= endMs) continue;
    events.fileStats.recordsInWindow += 1;

    const event = String(parsed?.event || "").trim();
    const payload = parsed?.payload && typeof parsed.payload === "object" ? parsed.payload : {};

    if (event === "v2_scene_transition") {
      events.transitions.push(payload);
    } else if (event === "v2_scene_error") {
      events.errors.push(payload);
    } else if (event === "v2_scene_gate_bypass") {
      events.bypasses.push(payload);
    } else if (event === "v2_loop_summary") {
      events.loops.push(payload);
    } else if (event === "interaction_latency") {
      events.interactions.push(payload);
    } else if (event === "interaction_slow_event") {
      events.slowInteractions.push(payload);
    } else if (event === "v2_minigame_outcome") {
      events.minigame.push(payload);
    } else if (event === "scheduled_job_run") {
      events.jobRuns.push(payload);
    } else if (event === "process_start") {
      events.processStarts.push(payload);
    } else if (event === "discord_gateway_event") {
      events.gatewayEvents.push(payload);
    } else if (event.startsWith("hard_failure_")) {
      events.hardFailures.push({ ...payload, event });
    } else if (event === "telemetry_drop_summary") {
      events.dropSummaries.push(payload);
    } else {
      events.fileStats.unrecognizedEvents += 1;
    }
  }

  return events;
}

export function summarizeTelemetryEvents(events = {}) {
  const transitions = Array.isArray(events.transitions) ? events.transitions : [];
  const errors = Array.isArray(events.errors) ? events.errors : [];
  const bypasses = Array.isArray(events.bypasses) ? events.bypasses : [];
  const loops = Array.isArray(events.loops) ? events.loops : [];
  const interactions = Array.isArray(events.interactions) ? events.interactions : [];
  const slowInteractions = Array.isArray(events.slowInteractions) ? events.slowInteractions : [];
  const minigame = Array.isArray(events.minigame) ? events.minigame : [];
  const jobRuns = Array.isArray(events.jobRuns) ? events.jobRuns : [];
  const processStarts = Array.isArray(events.processStarts) ? events.processStarts : [];
  const gatewayEvents = Array.isArray(events.gatewayEvents) ? events.gatewayEvents : [];
  const hardFailures = Array.isArray(events.hardFailures) ? events.hardFailures : [];
  const dropSummaries = Array.isArray(events.dropSummaries) ? events.dropSummaries : [];
  const fileStats = events.fileStats && typeof events.fileStats === "object" ? events.fileStats : {};

  const loopTimes = loops.map((row) => Number(row.completionMs));
  const clickCounts = loops.map((row) => Number(row.clickCount));
  const validInteractions = interactions.filter((row) => Number.isFinite(Number(row.totalMs)));
  const invalidInteractionRecords = interactions.length - validInteractions.length;
  const interactionTimes = validInteractions.map((row) => Number(row.totalMs));
  const interactionErrors = validInteractions.filter((row) => Boolean(row.error));
  const routeTimes = new Map();
  const interactionErrorsByRoute = new Map();
  for (const row of validInteractions) {
    const route = String(row.route || row.subroute || "unknown");
    if (!routeTimes.has(route)) routeTimes.set(route, []);
    routeTimes.get(route).push(Number(row.totalMs));
    if (row.error) interactionErrorsByRoute.set(route, (interactionErrorsByRoute.get(route) || 0) + 1);
  }
  const routeRows = [...routeTimes.entries()].map(([route, times]) => ({
    route,
    interactions: times.filter(Number.isFinite).length,
    timeP50: round(percentile(times, 50)),
    timeP95: round(percentile(times, 95))
  })).sort((a, b) => b.interactions - a.interactions);

  const byModule = new Map();
  for (const row of loops) {
    const module = String(row.module || "unknown");
    if (!byModule.has(module)) byModule.set(module, []);
    byModule.get(module).push(row);
  }

  const moduleRows = [...byModule.entries()].map(([module, rows]) => {
    const times = rows.map((r) => Number(r.completionMs));
    const clicks = rows.map((r) => Number(r.clickCount));
    return {
      module,
      loops: rows.length,
      clickAvg: round(mean(clicks)),
      timeP50: round(percentile(times, 50)),
      timeP95: round(percentile(times, 95))
    };
  }).sort((a, b) => b.loops - a.loops);

  const minigameOutcome = new Map();
  for (const row of minigame) {
    const outcome = String(row.outcome || "unknown").toLowerCase();
    minigameOutcome.set(outcome, (minigameOutcome.get(outcome) || 0) + 1);
  }

  const errorsByReason = new Map();
  for (const row of errors) {
    const reason = String(row.reason || "unknown").toLowerCase();
    errorsByReason.set(reason, (errorsByReason.get(reason) || 0) + 1);
  }

  const bypassByReason = new Map();
  for (const row of bypasses) {
    const reason = String(row.reason || "unknown").toLowerCase();
    bypassByReason.set(reason, (bypassByReason.get(reason) || 0) + 1);
  }

  const transitionCount = transitions.length;
  const errorCount = errors.length;
  const jobRows = new Map();
  for (const row of jobRuns) {
    const job = String(row.job || "unknown");
    if (!jobRows.has(job)) jobRows.set(job, []);
    jobRows.get(job).push(row);
  }
  const jobRunRows = [...jobRows.entries()].map(([job, rows]) => {
    const durations = rows.map((row) => Number(row.durationMs));
    return {
      job,
      runs: rows.length,
      successes: rows.filter((row) => String(row.outcome).toLowerCase() === "success").length,
      failures: rows.filter((row) => ["failure", "error"].includes(String(row.outcome).toLowerCase())).length,
      skipped: rows.filter((row) => String(row.outcome).toLowerCase() === "skipped").length,
      durationP95: round(percentile(durations, 95))
    };
  }).sort((a, b) => b.failures - a.failures || b.runs - a.runs);
  const failedJobRuns = jobRunRows.reduce((sum, row) => sum + row.failures, 0);
  const gatewayEventCounts = new Map();
  for (const row of gatewayEvents) {
    const kind = String(row.kind || "unknown").toLowerCase();
    gatewayEventCounts.set(kind, (gatewayEventCounts.get(kind) || 0) + 1);
  }
  const hardFailuresByType = new Map();
  const hardFailuresBySource = new Map();
  for (const row of hardFailures) {
    const type = String(row.event || "unknown");
    hardFailuresByType.set(type, (hardFailuresByType.get(type) || 0) + 1);
    const source = String(row.job || row.route || type);
    const stage = String(row.stage || "");
    const label = stage ? `${source}:${stage}` : source;
    hardFailuresBySource.set(label, (hardFailuresBySource.get(label) || 0) + 1);
  }
  const gatewayEventCount = [...gatewayEventCounts.values()].reduce((sum, count) => sum + count, 0);
  const gatewayDisruptions = (gatewayEventCounts.get("disconnect") || 0)
    + (gatewayEventCounts.get("shard_error") || 0);
  const totalDrops = dropSummaries.reduce((sum, row) => sum + (Number(row?.totalDrops) || 0), 0);
  const warnings = [];
  if (
    transitionCount === 0 && loops.length === 0 && validInteractions.length === 0 && errorCount === 0
    && jobRuns.length === 0 && hardFailures.length === 0 && gatewayEventCount === 0 && processStarts.length === 0
  ) {
    warnings.push("No valid interaction-duration, scheduled-job, hard-failure, or V2 scene activity was recorded; this report cannot establish bot health.");
  }
  warnings.push("Scheduled-job results include only emitted run records; disabled or gated jobs, unobserved downtime, and Discord availability cannot be inferred.");
  warnings.push("No external heartbeat is available, so process uptime percentage and periods when the bot was offline are not measured.");
  if (totalDrops > 0) {
    warnings.push(`Telemetry dropped ${totalDrops} events in the sampled window; report accuracy may be reduced.`);
  }
  if (Number(fileStats.malformedLines) > 0) {
    warnings.push(`${fileStats.malformedLines} malformed log lines were found while scanning; they cannot be assigned to a time window.`);
  }
  if (Number(fileStats.invalidTimestampLines) > 0) {
    warnings.push(`${fileStats.invalidTimestampLines} log records had invalid timestamps and were excluded.`);
  }
  if (invalidInteractionRecords > 0) {
    warnings.push(`${invalidInteractionRecords} interaction latency records had invalid durations and were excluded from timing and error-rate metrics.`);
  }
  if (Number(fileStats.unrecognizedEvents) > 0) {
    warnings.push(`${fileStats.unrecognizedEvents} other event types were present in this window but are not included in V2 metrics.`);
  }
  if (bypasses.length > 0) {
    warnings.push(`Rollout bypass events were observed (${bypasses.length}); inspect gate behavior before rollout changes.`);
  }

  return {
    transitions: transitionCount,
    errors: errorCount,
    bypasses: bypasses.length,
    loops: loops.length,
    interactions: validInteractions.length,
    interactionEventRecords: interactions.length,
    invalidInteractionRecords,
    interactionErrors: interactionErrors.length,
    interactionErrorRatePct: validInteractions.length
      ? round((interactionErrors.length / validInteractions.length) * 100)
      : null,
    interactionTimeP50: round(percentile(interactionTimes, 50)),
    interactionTimeP95: round(percentile(interactionTimes, 95)),
    slowInteractions: slowInteractions.length,
    routeRows,
    interactionErrorsByRoute: [...interactionErrorsByRoute.entries()]
      .map(([route, count]) => ({ route, count }))
      .sort((a, b) => b.count - a.count),
    minigameEvents: minigame.length,
    scheduledJobRuns: jobRuns.length,
    successfulJobRuns: jobRunRows.reduce((sum, row) => sum + row.successes, 0),
    failedJobRuns,
    skippedJobRuns: jobRunRows.reduce((sum, row) => sum + row.skipped, 0),
    jobRunRows,
    processStarts: processStarts.length,
    gatewayEventCount,
    gatewayEventCounts: [...gatewayEventCounts.entries()].map(([kind, count]) => ({ kind, count })),
    gatewayDisruptions,
    hardFailures: hardFailures.length,
    hardFailuresByType: [...hardFailuresByType.entries()]
      .map(([event, count]) => ({ event, count }))
      .sort((a, b) => b.count - a.count),
    hardFailureRows: [...hardFailuresBySource.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count),
    recordsInWindow: Number(fileStats.recordsInWindow) || 0,
    clickAvg: round(mean(clickCounts)),
    loopTimeP50: round(percentile(loopTimes, 50)),
    loopTimeP95: round(percentile(loopTimes, 95)),
    errorRatePct: transitionCount > 0 ? round((errorCount / transitionCount) * 100) : null,
    moduleRows,
    minigameDistribution: [...minigameOutcome.entries()]
      .map(([outcome, count]) => ({ outcome, count }))
      .sort((a, b) => b.count - a.count),
    errorsByReason: [...errorsByReason.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    bypassByReason: [...bypassByReason.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    dataQuality: {
      totalDrops,
      warnings
    }
  };
}

export function compareTelemetrySummary(baselineSummary, candidateSummary) {
  if (!baselineSummary) return null;
  const delta = (a, b) => {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return round(b - a);
  };

  return {
    clickAvgDelta: delta(baselineSummary.clickAvg, candidateSummary.clickAvg),
    clickAvgDeltaPct: pctDelta(baselineSummary.clickAvg, candidateSummary.clickAvg),
    interactionTimeP50Delta: delta(baselineSummary.interactionTimeP50, candidateSummary.interactionTimeP50),
    interactionTimeP50DeltaPct: pctDelta(baselineSummary.interactionTimeP50, candidateSummary.interactionTimeP50),
    interactionTimeP95Delta: delta(baselineSummary.interactionTimeP95, candidateSummary.interactionTimeP95),
    interactionTimeP95DeltaPct: pctDelta(baselineSummary.interactionTimeP95, candidateSummary.interactionTimeP95),
    interactionErrorCountDelta: delta(baselineSummary.interactionErrors, candidateSummary.interactionErrors),
    interactionErrorRateDeltaPct: delta(baselineSummary.interactionErrorRatePct, candidateSummary.interactionErrorRatePct),
    loopTimeP50Delta: delta(baselineSummary.loopTimeP50, candidateSummary.loopTimeP50),
    loopTimeP50DeltaPct: pctDelta(baselineSummary.loopTimeP50, candidateSummary.loopTimeP50),
    loopTimeP95Delta: delta(baselineSummary.loopTimeP95, candidateSummary.loopTimeP95),
    loopTimeP95DeltaPct: pctDelta(baselineSummary.loopTimeP95, candidateSummary.loopTimeP95),
    errorCountDelta: delta(baselineSummary.errors, candidateSummary.errors),
    errorRateDeltaPct: delta(baselineSummary.errorRatePct, candidateSummary.errorRatePct),
    scheduledJobRunDelta: delta(baselineSummary.scheduledJobRuns, candidateSummary.scheduledJobRuns),
    failedJobRunDelta: delta(baselineSummary.failedJobRuns, candidateSummary.failedJobRuns)
  };
}

export function buildGoNoGoRecommendation(delta, { summary, issueCheck, thresholds = {} } = {}) {
  if (Number(summary?.failedJobRuns) > 0 || Number(summary?.hardFailures) > 0) {
    return `ACTION NEEDED: ${Number(summary.failedJobRuns) || 0} scheduled job run(s) failed and ${Number(summary.hardFailures) || 0} hard operation/delivery failure(s) were recorded in this window. Inspect affected jobs and logs; uptime and unobserved job runs are not measured.`;
  }
  if (Number(summary?.gatewayDisruptions) > 0) {
    return `WATCH: ${summary.gatewayDisruptions} Discord gateway disconnect or shard error event(s) were observed. Review connection logs; this report cannot calculate Discord availability or continuous uptime.`;
  }
  if (!summary || (
    summary.interactions === 0
    && summary.slowInteractions === 0
    && summary.transitions === 0
    && summary.loops === 0
    && summary.errors === 0
    && (Number(summary.scheduledJobRuns) || 0) === 0
    && (Number(summary.hardFailures) || 0) === 0
    && (Number(summary.gatewayEventCount) || 0) === 0
    && (Number(summary.processStarts) || 0) === 0
  )) {
    return "NO SAMPLES: No instrumented interactions, scheduled-job runs, or V2 activity were recorded. Check telemetry logging and routing; do not interpret an empty report as healthy.";
  }
  if (issueCheck && !issueCheck.hasEnoughData) {
    return `LIMITED DATA: ${issueCheck.note} Wait for a representative sample before deciding whether performance changed.`;
  }
  if (issueCheck?.issues?.length) {
    const suggestions = buildTelemetrySuggestions(summary, issueCheck, delta, thresholds);
    return `ACTION NEEDED: ${suggestions.join(" ")}`;
  }
  if (!delta) return "BASELINE NEEDED: No prior window is available for comparison; treat current metrics as descriptive, not as evidence of improvement or health.";

  const increases = [];
  const decreases = [];
  if (Number.isFinite(delta.interactionTimeP95DeltaPct) && delta.interactionTimeP95DeltaPct !== 0) {
    (delta.interactionTimeP95DeltaPct > 0 ? increases : decreases).push(
      `server interaction p95 ${delta.interactionTimeP95DeltaPct > 0 ? "increased" : "decreased"} ${Math.abs(delta.interactionTimeP95DeltaPct)}%`
    );
  }
  if (Number.isFinite(delta.interactionErrorRateDeltaPct) && delta.interactionErrorRateDeltaPct !== 0) {
    (delta.interactionErrorRateDeltaPct > 0 ? increases : decreases).push(
      `failed interaction rate ${delta.interactionErrorRateDeltaPct > 0 ? "increased" : "decreased"} by ${Math.abs(delta.interactionErrorRateDeltaPct)} percentage points`
    );
  }
  if (Number.isFinite(delta.clickAvgDelta) && delta.clickAvgDelta !== 0) {
    (delta.clickAvgDelta > 0 ? increases : decreases).push(
      `average clicks ${delta.clickAvgDelta > 0 ? "increased" : "decreased"} by ${Math.abs(delta.clickAvgDelta)}`
    );
  }
  if (increases.length && decreases.length) {
    return `MIXED: ${increases.join("; ")}; ${decreases.join("; ")}. Review the affected module before changing rollout decisions.`;
  }
  if (increases.length) {
    return `WATCH: ${increases.join("; ")} versus the previous window. Check the module and error reasons below, then compare the next window before attributing cause.`;
  }
  if (decreases.length) {
    return `IMPROVING: ${decreases.join("; ")} versus the previous window. Keep monitoring; this report measures emitted bot activity, not continuous uptime or Discord availability.`;
  }
  const interactionP95 = Number.isFinite(summary.interactionTimeP95) ? `${summary.interactionTimeP95}ms` : "unavailable";
  return `NO THRESHOLD BREACH: No configured interaction threshold was crossed; server interaction p95 is ${interactionP95} across ${summary.interactions} measured interactions. Continue monitoring representative traffic; this does not establish continuous uptime or Discord availability.`;
}

export function buildTelemetrySuggestions(summary, issueCheck, delta = null, thresholds = {}) {
  const suggestions = [];
  if (Number(summary?.failedJobRuns) > 0 || Number(summary?.hardFailures) > 0) {
    const failedJobs = (summary?.jobRunRows ?? [])
      .filter((row) => row.failures > 0)
      .slice(0, 3)
      .map((row) => `${row.job}(${row.failures})`)
      .join(", ");
    suggestions.push(`JOB ACTION: investigate ${Number(summary?.failedJobRuns) || 0} failed scheduled run(s) and ${Number(summary?.hardFailures) || 0} hard operation/delivery failure(s)${failedJobs ? `; affected jobs: ${failedJobs}` : ""}. This report only sees jobs that emitted run records.`);
  }
  if (!issueCheck?.hasEnoughData) {
    suggestions.push(
      `COLLECT MORE DATA: ${issueCheck?.note || "The sample is below the minimum."} Wait for representative bot interaction and scheduled-job evidence before making a performance or rollout decision.`
    );
    return suggestions;
  }

  const issues = Array.isArray(issueCheck.issues) ? issueCheck.issues : [];
  if (issues.some((issue) => issue.startsWith("Interaction p95 high"))) {
    const slowest = [...(summary?.routeRows ?? [])]
      .filter((row) => Number.isFinite(row.timeP95))
      .sort((a, b) => b.timeP95 - a.timeP95)[0];
    suggestions.push(
      `LATENCY ACTION: server interaction p95 exceeds ${thresholds.interactionP95ThresholdMs}ms. Inspect the ${slowest?.route ?? "highest-latency"} route first; compare its defer, database, and external-service time.`
    );
  }
  if (issues.some((issue) => issue.startsWith("Interaction error rate high"))) {
    const topReason = summary?.interactionErrorsByRoute?.[0];
    suggestions.push(
      topReason
        ? `ERROR ACTION: ${topReason.route} has the most failed interactions (${topReason.count}). Review its logged error codes and recent code changes.`
        : "ERROR ACTION: Review interaction error codes and route-level logs for unexpected failures."
    );
  }
  if (issues.some((issue) => issue.startsWith("V2 route-error signal rate high"))) {
    const topReason = summary?.errorsByReason?.[0];
    suggestions.push(
      topReason
        ? `V2 ROUTE ACTION: "${topReason.reason}" is the most common route-error signal (${topReason.count}). Confirm whether these are expected stale/ownership rejections or unexpected failures.`
        : "V2 ROUTE ACTION: Inspect V2 route-error signals and determine whether they are expected stale/ownership rejections or unexpected failures."
    );
  }
  if (issues.some((issue) => issue.startsWith("Clicks per loop high"))) {
    const mostClicks = [...(summary?.moduleRows ?? [])]
      .filter((row) => Number.isFinite(row.clickAvg))
      .sort((a, b) => b.clickAvg - a.clickAvg)[0];
    suggestions.push(
      `FLOW ACTION: average clicks exceed ${thresholds.clickAvgThreshold}. Review the ${mostClicks?.module ?? "highest-click"} interaction path for unnecessary steps or stale-view recovery.`
    );
  }
  if (issues.some((issue) => issue.startsWith("Interaction p95 regression"))) {
    const slowest = [...(summary?.routeRows ?? [])]
      .filter((row) => Number.isFinite(row.timeP95))
      .sort((a, b) => b.timeP95 - a.timeP95)[0];
    suggestions.push(
      `REGRESSION ACTION: server interaction p95 is up ${delta?.interactionTimeP95DeltaPct}% versus baseline. Compare recent changes in the ${slowest?.route ?? "highest-latency"} route and recheck after the next comparable window.`
    );
  }
  if (!suggestions.length) {
    suggestions.push("No configured alert threshold was crossed. Continue collecting representative traffic and compare the next window.");
  }
  return suggestions;
}

export function detectHighTelemetryIssues(summary, thresholds = {}) {
  const issues = [];
  const failedJobRuns = Math.max(0, Number(summary?.failedJobRuns) || 0);
  if (failedJobRuns > 0) {
    issues.push(`Scheduled job failures observed: ${failedJobRuns}.`);
  }
  const hardFailures = Math.max(0, Number(summary?.hardFailures) || 0);
  if (hardFailures > 0) {
    issues.push(`Hard send failures observed: ${hardFailures}.`);
  }

  const minInteractions = Math.max(1, Math.floor(Number(thresholds.minInteractions) || 20));
  const interactionP95ThresholdMs = Number(thresholds.interactionP95ThresholdMs);
  const clickAvgThreshold = Number(thresholds.clickAvgThreshold);
  const errorRateThresholdPct = Number(thresholds.interactionErrorRateThresholdPct);
  const routeErrorRateThresholdPct = Number(thresholds.routeErrorRateThresholdPct);

  if ((summary?.interactions || 0) < minInteractions) {
    return {
      hasEnoughData: false,
      issues,
      note: `Insufficient measured interactions (${summary?.interactions || 0}/${minInteractions}).`
    };
  }

  if (Number.isFinite(interactionP95ThresholdMs) && Number.isFinite(summary?.interactionTimeP95) && summary.interactionTimeP95 > interactionP95ThresholdMs) {
    issues.push(`Interaction p95 high: ${summary.interactionTimeP95}ms > ${interactionP95ThresholdMs}ms threshold.`);
  }

  if (Number.isFinite(clickAvgThreshold) && Number.isFinite(summary?.clickAvg) && summary.clickAvg > clickAvgThreshold) {
    issues.push(`Clicks per loop high: ${summary.clickAvg} > ${clickAvgThreshold} threshold.`);
  }

  if (Number.isFinite(errorRateThresholdPct) && Number.isFinite(summary?.interactionErrorRatePct) && summary.interactionErrorRatePct > errorRateThresholdPct) {
    issues.push(`Interaction error rate high: ${summary.interactionErrorRatePct}% > ${errorRateThresholdPct}% threshold.`);
  }
  if (
    (summary?.transitions || 0) > 0
    && Number.isFinite(routeErrorRateThresholdPct)
    && Number.isFinite(summary?.errorRatePct)
    && summary.errorRatePct > routeErrorRateThresholdPct
  ) {
    issues.push(`V2 route-error signal rate high: ${summary.errorRatePct}% > ${routeErrorRateThresholdPct}% threshold.`);
  }

  return {
    hasEnoughData: true,
    issues,
    note: ""
  };
}
