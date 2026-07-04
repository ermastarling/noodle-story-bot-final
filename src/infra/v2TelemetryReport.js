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
  const idx = Math.floor((p / 100) * (nums.length - 1));
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
    loops: [],
    minigame: []
  };

  for await (const line of rl) {
    const raw = String(line || "").trim();
    if (!raw) continue;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    const ts = parseTs(parsed?.ts);
    if (Number.isFinite(startMs) && (!Number.isFinite(ts) || ts < startMs)) continue;
    if (Number.isFinite(endMs) && (!Number.isFinite(ts) || ts >= endMs)) continue;

    const event = String(parsed?.event || "").trim();
    const payload = parsed?.payload && typeof parsed.payload === "object" ? parsed.payload : {};

    if (event === "v2_scene_transition") {
      events.transitions.push(payload);
    } else if (event === "v2_scene_error") {
      events.errors.push(payload);
    } else if (event === "v2_loop_summary") {
      events.loops.push(payload);
    } else if (event === "v2_minigame_outcome") {
      events.minigame.push(payload);
    }
  }

  return events;
}

export function summarizeTelemetryEvents(events = {}) {
  const transitions = Array.isArray(events.transitions) ? events.transitions : [];
  const errors = Array.isArray(events.errors) ? events.errors : [];
  const loops = Array.isArray(events.loops) ? events.loops : [];
  const minigame = Array.isArray(events.minigame) ? events.minigame : [];

  const loopTimes = loops.map((row) => Number(row.completionMs));
  const clickCounts = loops.map((row) => Number(row.clickCount));

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

  const transitionCount = transitions.length;
  const errorCount = errors.length;

  return {
    transitions: transitionCount,
    errors: errorCount,
    loops: loops.length,
    minigameEvents: minigame.length,
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
      .sort((a, b) => b.count - a.count)
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
    loopTimeP50Delta: delta(baselineSummary.loopTimeP50, candidateSummary.loopTimeP50),
    loopTimeP50DeltaPct: pctDelta(baselineSummary.loopTimeP50, candidateSummary.loopTimeP50),
    loopTimeP95Delta: delta(baselineSummary.loopTimeP95, candidateSummary.loopTimeP95),
    loopTimeP95DeltaPct: pctDelta(baselineSummary.loopTimeP95, candidateSummary.loopTimeP95),
    errorCountDelta: delta(baselineSummary.errors, candidateSummary.errors),
    errorRateDeltaPct: delta(baselineSummary.errorRatePct, candidateSummary.errorRatePct)
  };
}

export function buildGoNoGoRecommendation(delta) {
  if (!delta) return "No baseline provided; recommendation is informational only.";

  const p95Improved = Number.isFinite(delta.loopTimeP95Delta) && delta.loopTimeP95Delta < 0;
  const errorsNotWorse = Number.isFinite(delta.errorCountDelta) ? delta.errorCountDelta <= 0 : true;
  const clicksNotWorse = Number.isFinite(delta.clickAvgDelta) ? delta.clickAvgDelta <= 0 : true;

  if (p95Improved && errorsNotWorse && clicksNotWorse) {
    return "GO: Candidate V2 sample improves or preserves loop efficiency and reliability.";
  }
  return "NO-GO / INVESTIGATE: Candidate V2 sample shows potential regressions in latency, click count, or errors.";
}

export function detectHighTelemetryIssues(summary, thresholds = {}) {
  const issues = [];

  const minLoops = Math.max(1, Math.floor(Number(thresholds.minLoops) || 20));
  const loopP95ThresholdMs = Number(thresholds.loopP95ThresholdMs);
  const clickAvgThreshold = Number(thresholds.clickAvgThreshold);
  const errorRateThresholdPct = Number(thresholds.errorRateThresholdPct);

  if ((summary?.loops || 0) < minLoops) {
    return {
      hasEnoughData: false,
      issues: [],
      note: `Insufficient loop samples (${summary?.loops || 0}/${minLoops}).`
    };
  }

  if (Number.isFinite(loopP95ThresholdMs) && Number.isFinite(summary?.loopTimeP95) && summary.loopTimeP95 > loopP95ThresholdMs) {
    issues.push(`Loop p95 high: ${summary.loopTimeP95}ms > ${loopP95ThresholdMs}ms threshold.`);
  }

  if (Number.isFinite(clickAvgThreshold) && Number.isFinite(summary?.clickAvg) && summary.clickAvg > clickAvgThreshold) {
    issues.push(`Clicks per loop high: ${summary.clickAvg} > ${clickAvgThreshold} threshold.`);
  }

  if (Number.isFinite(errorRateThresholdPct) && Number.isFinite(summary?.errorRatePct) && summary.errorRatePct > errorRateThresholdPct) {
    issues.push(`Error rate high: ${summary.errorRatePct}% > ${errorRateThresholdPct}% threshold.`);
  }

  return {
    hasEnoughData: true,
    issues,
    note: ""
  };
}
