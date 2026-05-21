#!/usr/bin/env node
import fs from "fs";
import path from "path";
import readline from "readline";

function parseArgs(argv) {
  const args = {
    file: "telemetry.log",
    routeLimit: 20,
    slowLimit: 10,
    json: false,
    windowHours: null
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file" || arg === "-f") {
      args.file = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--route-limit") {
      args.routeLimit = Number(argv[i + 1] || 20);
      i += 1;
      continue;
    }
    if (arg === "--slow-limit") {
      args.slowLimit = Number(argv[i + 1] || 10);
      i += 1;
      continue;
    }
    if (arg === "--window-hours") {
      args.windowHours = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node scripts/analyze-telemetry-report.js [options]",
      "",
      "Options:",
      "  -f, --file <path>          Path to telemetry JSONL file (default: telemetry.log)",
      "  --window-hours <n>         Analyze only the last N hours based on event ts",
      "  --route-limit <n>          Max routes in markdown table (default: 20)",
      "  --slow-limit <n>           Max slow-pattern rows in markdown table (default: 10)",
      "  --json                     Output JSON instead of markdown",
      "  -h, --help                 Show help"
    ].join("\n") + "\n"
  );
}

function r3(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 1000;
}

function percentile(values, p) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx];
}

function mean(values) {
  if (!values || values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function finite(arr) {
  return arr.filter((v) => Number.isFinite(v));
}

function summarizeEvents(events) {
  const totalMs = finite(events.map((e) => e.totalMs));
  const deferMs = finite(events.map((e) => e.deferMs));
  const dbReadMs = finite(events.map((e) => e.dbReadMs));
  const dbWriteMs = finite(events.map((e) => e.dbWriteMs));
  const lockAcquireMs = finite(events.map((e) => e.lockAcquireMs));
  const lockReleaseMs = finite(events.map((e) => e.lockReleaseMs));
  const dbReadCount = finite(events.map((e) => e.dbReadCount));
  const dbWriteCount = finite(events.map((e) => e.dbWriteCount));

  const lockBusySum = events.reduce(
    (sum, e) => sum + (Number.isFinite(e.lockBusyCount) ? e.lockBusyCount : 0),
    0
  );
  const errorCount = events.reduce((sum, e) => sum + (e.error ? 1 : 0), 0);

  return {
    count: events.length,
    totalMs: {
      p50: r3(percentile(totalMs, 50)),
      p95: r3(percentile(totalMs, 95)),
      p99: r3(percentile(totalMs, 99))
    },
    deferMs: {
      p50: r3(percentile(deferMs, 50)),
      p95: r3(percentile(deferMs, 95)),
      p99: r3(percentile(deferMs, 99))
    },
    dbReadMs: {
      p50: r3(percentile(dbReadMs, 50)),
      p95: r3(percentile(dbReadMs, 95)),
      p99: r3(percentile(dbReadMs, 99))
    },
    dbWriteMs: {
      p50: r3(percentile(dbWriteMs, 50)),
      p95: r3(percentile(dbWriteMs, 95)),
      p99: r3(percentile(dbWriteMs, 99))
    },
    lockAcquireMs: {
      p50: r3(percentile(lockAcquireMs, 50)),
      p95: r3(percentile(lockAcquireMs, 95)),
      p99: r3(percentile(lockAcquireMs, 99))
    },
    lockReleaseMs: {
      p50: r3(percentile(lockReleaseMs, 50)),
      p95: r3(percentile(lockReleaseMs, 95)),
      p99: r3(percentile(lockReleaseMs, 99))
    },
    dbReadCountAvg: r3(mean(dbReadCount)),
    dbWriteCountAvg: r3(mean(dbWriteCount)),
    lockBusySum,
    lockBusyRatePct: events.length ? r3((lockBusySum / events.length) * 100) : null,
    errorCount,
    errorRatePct: events.length ? r3((errorCount / events.length) * 100) : null
  };
}

function summarizeByRoute(events) {
  const byRoute = new Map();
  for (const e of events) {
    if (!byRoute.has(e.route)) byRoute.set(e.route, []);
    byRoute.get(e.route).push(e);
  }

  const rows = [];
  for (const [route, routeEvents] of byRoute.entries()) {
    const totalMs = finite(routeEvents.map((e) => e.totalMs));
    rows.push({
      route,
      count: routeEvents.length,
      p50: r3(percentile(totalMs, 50)),
      p95: r3(percentile(totalMs, 95)),
      p99: r3(percentile(totalMs, 99))
    });
  }
  rows.sort((a, b) => b.count - a.count);
  return rows;
}

function summarizeBySubroute(events) {
  const rows = [];
  const bySubroute = new Map();

  for (const e of events) {
    if (e.route !== "component:noodle") continue;
    const key = e.subroute || "unknown";
    if (!bySubroute.has(key)) bySubroute.set(key, []);
    bySubroute.get(key).push(e);
  }

  for (const [subroute, subEvents] of bySubroute.entries()) {
    const totals = finite(subEvents.map((e) => e.totalMs));
    rows.push({
      subroute,
      count: subEvents.length,
      p50: r3(percentile(totals, 50)),
      p95: r3(percentile(totals, 95)),
      p99: r3(percentile(totals, 99))
    });
  }

  rows.sort((a, b) => b.count - a.count);
  return rows;
}

function summarizeSlowEvents(events) {
  const byPattern = new Map();
  for (const e of events) {
    const route = e.route || "unknown";
    const subroute = e.subroute || "unknown";
    const customIdPrefix = e.customIdPrefix || "unknown";
    const key = `${route}|${subroute}|${customIdPrefix}`;
    if (!byPattern.has(key)) {
      byPattern.set(key, {
        route,
        subroute,
        customIdPrefix,
        count: 0,
        totalMs: []
      });
    }
    const row = byPattern.get(key);
    row.count += 1;
    if (Number.isFinite(e.totalMs)) row.totalMs.push(e.totalMs);
  }

  const rows = [];
  for (const row of byPattern.values()) {
    rows.push({
      route: row.route,
      subroute: row.subroute,
      customIdPrefix: row.customIdPrefix,
      count: row.count,
      p50: r3(percentile(row.totalMs, 50)),
      p95: r3(percentile(row.totalMs, 95)),
      max: r3(row.totalMs.length ? Math.max(...row.totalMs) : null)
    });
  }

  rows.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return (b.p95 ?? -Infinity) - (a.p95 ?? -Infinity);
  });
  return rows;
}

function summarizeNavPhases(events) {
  const byKey = new Map();

  for (const e of events) {
    const subroute = e.subroute || "unknown";
    const resolvedSubroute = e.resolvedSubroute || "unknown";
    const customIdPrefix = e.customIdPrefix || "unknown";
    const key = `${subroute}|${resolvedSubroute}|${customIdPrefix}`;

    if (!byKey.has(key)) {
      byKey.set(key, {
        subroute,
        resolvedSubroute,
        customIdPrefix,
        count: 0,
        resolveMs: [],
        runMs: [],
        totalMs: [],
        errorCount: 0
      });
    }

    const row = byKey.get(key);
    row.count += 1;
    if (Number.isFinite(e.resolveMs)) row.resolveMs.push(e.resolveMs);
    if (Number.isFinite(e.runMs)) row.runMs.push(e.runMs);
    if (Number.isFinite(e.totalMs)) row.totalMs.push(e.totalMs);
    if (e.error) row.errorCount += 1;
  }

  const rows = [];
  for (const row of byKey.values()) {
    rows.push({
      subroute: row.subroute,
      resolvedSubroute: row.resolvedSubroute,
      customIdPrefix: row.customIdPrefix,
      count: row.count,
      resolveP50: r3(percentile(row.resolveMs, 50)),
      resolveP95: r3(percentile(row.resolveMs, 95)),
      runP50: r3(percentile(row.runMs, 50)),
      runP95: r3(percentile(row.runMs, 95)),
      runP99: r3(percentile(row.runMs, 99)),
      totalP95: r3(percentile(row.totalMs, 95)),
      maxTotal: r3(row.totalMs.length ? Math.max(...row.totalMs) : null),
      errorCount: row.errorCount
    });
  }

  rows.sort((a, b) => {
    const aRun = a.runP95 ?? -Infinity;
    const bRun = b.runP95 ?? -Infinity;
    if (bRun !== aRun) return bRun - aRun;
    return b.count - a.count;
  });

  return rows;
}

function summarizeNavSubroutePhases(events) {
  const byKey = new Map();

  for (const e of events) {
    const subroute = e.subroute || "unknown";
    const mode = e.mode || "unknown";
    const customIdPrefix = e.customIdPrefix || "unknown";
    const key = `${subroute}|${mode}|${customIdPrefix}`;

    if (!byKey.has(key)) {
      byKey.set(key, {
        subroute,
        mode,
        customIdPrefix,
        count: 0,
        catchupMs: [],
        inventoryScanMs: [],
        paginationMs: [],
        persistMs: [],
        renderMs: [],
        totalMs: []
      });
    }

    const row = byKey.get(key);
    row.count += 1;
    if (Number.isFinite(e.catchupMs)) row.catchupMs.push(e.catchupMs);
    if (Number.isFinite(e.inventoryScanMs)) row.inventoryScanMs.push(e.inventoryScanMs);
    if (Number.isFinite(e.paginationMs)) row.paginationMs.push(e.paginationMs);
    if (Number.isFinite(e.persistMs)) row.persistMs.push(e.persistMs);
    if (Number.isFinite(e.renderMs)) row.renderMs.push(e.renderMs);
    if (Number.isFinite(e.totalMs)) row.totalMs.push(e.totalMs);
  }

  const rows = [];
  for (const row of byKey.values()) {
    rows.push({
      subroute: row.subroute,
      mode: row.mode,
      customIdPrefix: row.customIdPrefix,
      count: row.count,
      catchupP95: r3(percentile(row.catchupMs, 95)),
      scanP95: r3(percentile(row.inventoryScanMs, 95)),
      paginationP95: r3(percentile(row.paginationMs, 95)),
      persistP95: r3(percentile(row.persistMs, 95)),
      renderP95: r3(percentile(row.renderMs, 95)),
      totalP95: r3(percentile(row.totalMs, 95))
    });
  }

  rows.sort((a, b) => {
    const aTotal = a.totalP95 ?? -Infinity;
    const bTotal = b.totalP95 ?? -Infinity;
    if (bTotal !== aTotal) return bTotal - aTotal;
    return b.count - a.count;
  });

  return rows;
}

function mdValue(v, unit = "") {
  return v == null ? "N/A" : `${v}${unit}`;
}

function toMarkdown(report, routeLimit, slowLimit) {
  const out = [];
  out.push("# Telemetry Report");
  out.push("");
  out.push("## Window");
  out.push(`- Source file: ${report.sourceFile}`);
  out.push(`- Events analyzed: ${report.totalEventCount}`);
  out.push(`- interaction_latency events analyzed: ${report.summary.count}`);
  out.push(`- Earliest ts: ${report.earliestTs || "N/A"}`);
  out.push(`- Latest ts: ${report.latestTs || "N/A"}`);
  out.push(`- Span hours: ${mdValue(report.spanHours)}`);
  if (report.windowHours != null) {
    out.push(`- Applied trailing window: last ${report.windowHours} hours`);
  }
  out.push("");

  out.push("## Overall Latency");
  out.push(`- totalMs p50/p95/p99: ${mdValue(report.summary.totalMs.p50, " ms")} / ${mdValue(report.summary.totalMs.p95, " ms")} / ${mdValue(report.summary.totalMs.p99, " ms")}`);
  out.push(`- deferMs p50/p95/p99: ${mdValue(report.summary.deferMs.p50, " ms")} / ${mdValue(report.summary.deferMs.p95, " ms")} / ${mdValue(report.summary.deferMs.p99, " ms")}`);
  out.push("");

  out.push("## Lock Phase");
  out.push(`- lockAcquireMs p50/p95/p99: ${mdValue(report.summary.lockAcquireMs.p50, " ms")} / ${mdValue(report.summary.lockAcquireMs.p95, " ms")} / ${mdValue(report.summary.lockAcquireMs.p99, " ms")}`);
  out.push(`- lockReleaseMs p50/p95/p99: ${mdValue(report.summary.lockReleaseMs.p50, " ms")} / ${mdValue(report.summary.lockReleaseMs.p95, " ms")} / ${mdValue(report.summary.lockReleaseMs.p99, " ms")}`);
  out.push(`- lockBusyCount total: ${report.summary.lockBusySum}`);
  out.push(`- lockBusy rate: ${mdValue(report.summary.lockBusyRatePct, "%")}`);
  out.push("");

  out.push("## DB Phase");
  out.push(`- dbReadMs p50/p95/p99: ${mdValue(report.summary.dbReadMs.p50, " ms")} / ${mdValue(report.summary.dbReadMs.p95, " ms")} / ${mdValue(report.summary.dbReadMs.p99, " ms")}`);
  out.push(`- dbWriteMs p50/p95/p99: ${mdValue(report.summary.dbWriteMs.p50, " ms")} / ${mdValue(report.summary.dbWriteMs.p95, " ms")} / ${mdValue(report.summary.dbWriteMs.p99, " ms")}`);
  out.push(`- dbReadCount avg: ${mdValue(report.summary.dbReadCountAvg)}`);
  out.push(`- dbWriteCount avg: ${mdValue(report.summary.dbWriteCountAvg)}`);
  out.push("");

  out.push("## Reliability");
  out.push(`- error count: ${report.summary.errorCount}`);
  out.push(`- error rate: ${mdValue(report.summary.errorRatePct, "%")}`);
  out.push("");

  out.push("## By Route (totalMs)");
  out.push("");
  out.push("| Route | Events | p50 totalMs | p95 totalMs | p99 totalMs |");
  out.push("|---|---:|---:|---:|---:|");
  for (const row of report.byRoute.slice(0, routeLimit)) {
    out.push(`| ${row.route} | ${row.count} | ${mdValue(row.p50)} | ${mdValue(row.p95)} | ${mdValue(row.p99)} |`);
  }

  out.push("");
  out.push("## component:noodle By Subroute (totalMs)");
  out.push("");
  out.push("| Subroute | Events | p50 totalMs | p95 totalMs | p99 totalMs |");
  out.push("|---|---:|---:|---:|---:|");
  for (const row of report.bySubroute.slice(0, routeLimit)) {
    out.push(`| ${row.subroute} | ${row.count} | ${mdValue(row.p50)} | ${mdValue(row.p95)} | ${mdValue(row.p99)} |`);
  }

  out.push("");
  out.push("## Slow Event Patterns (totalMs > 3000)");
  out.push("");
  out.push(`- Slow events: ${report.slowEventCount}`);
  out.push("| Route | Subroute | customId prefix | Events | p50 totalMs | p95 totalMs | max totalMs |");
  out.push("|---|---|---|---:|---:|---:|---:|");
  for (const row of report.slowPatterns.slice(0, slowLimit)) {
    out.push(`| ${row.route} | ${row.subroute} | ${row.customIdPrefix} | ${row.count} | ${mdValue(row.p50)} | ${mdValue(row.p95)} | ${mdValue(row.max)} |`);
  }

  out.push("");
  out.push("## Nav Dispatch Bottlenecks (component_nav_phase)");
  out.push("");
  out.push(`- Nav phase events: ${report.navPhaseCount}`);
  out.push("| Subroute | Resolved Subroute | customId prefix | Events | resolve p95 ms | run p95 ms | run p99 ms | total p95 ms | max total ms | errors |");
  out.push("|---|---|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of report.navBottlenecks.slice(0, routeLimit)) {
    out.push(`| ${row.subroute} | ${row.resolvedSubroute} | ${row.customIdPrefix} | ${row.count} | ${mdValue(row.resolveP95)} | ${mdValue(row.runP95)} | ${mdValue(row.runP99)} | ${mdValue(row.totalP95)} | ${mdValue(row.maxTotal)} | ${row.errorCount} |`);
  }

  out.push("");
  out.push("## Nav Subroute Phase Breakdown (component_nav_subroute_phase)");
  out.push("");
  out.push(`- Nav subroute phase events: ${report.navSubroutePhaseCount}`);
  out.push("| Subroute | Mode | customId prefix | Events | catchup p95 | scan p95 | pagination p95 | persist p95 | render p95 | total p95 |");
  out.push("|---|---|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of report.navSubrouteBottlenecks.slice(0, routeLimit)) {
    out.push(`| ${row.subroute} | ${row.mode} | ${row.customIdPrefix} | ${row.count} | ${mdValue(row.catchupP95)} | ${mdValue(row.scanP95)} | ${mdValue(row.paginationP95)} | ${mdValue(row.persistP95)} | ${mdValue(row.renderP95)} | ${mdValue(row.totalP95)} |`);
  }

  return out.join("\n") + "\n";
}

async function main() {
  const args = parseArgs(process.argv);
  const filePath = path.isAbsolute(args.file) ? args.file : path.join(process.cwd(), args.file);
  if (!fs.existsSync(filePath)) {
    process.stderr.write(`File not found: ${filePath}\n`);
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  const events = [];
  const slowEvents = [];
  const navPhaseEvents = [];
  const navSubroutePhaseEvents = [];
  let minTsAny = null;
  let maxTsAny = null;

  for await (const line of rl) {
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = Date.parse(obj.ts);
    if (!Number.isFinite(ts)) continue;
    if (minTsAny == null || ts < minTsAny) minTsAny = ts;
    if (maxTsAny == null || ts > maxTsAny) maxTsAny = ts;

    if (obj?.event === "interaction_slow_event") {
      const p = obj.payload || {};
      slowEvents.push({
        ts,
        route: p.route || "unknown",
        subroute: p.subroute || null,
        customIdPrefix: p.customIdPrefix || null,
        totalMs: Number(p.totalMs),
        deferMs: Number(p.deferMs),
        dbReadCount: Number(p.dbReadCount),
        dbWriteCount: Number(p.dbWriteCount),
        lockAcquireCount: Number(p.lockAcquireCount),
        lockReleaseCount: Number(p.lockReleaseCount),
        lockBusyCount: Number(p.lockBusyCount)
      });
      continue;
    }

    if (obj?.event === "component_nav_phase") {
      const p = obj.payload || {};
      navPhaseEvents.push({
        ts,
        route: p.route || "unknown",
        subroute: p.subroute || null,
        resolvedSubroute: p.resolvedSubroute || null,
        customIdPrefix: p.customIdPrefix || null,
        resolveMs: Number(p.resolveMs),
        runMs: Number(p.runMs),
        totalMs: Number(p.totalMs),
        error: p.error
      });
      continue;
    }

    if (obj?.event === "component_nav_subroute_phase") {
      const p = obj.payload || {};
      navSubroutePhaseEvents.push({
        ts,
        route: p.route || "unknown",
        subroute: p.subroute || null,
        customIdPrefix: p.customIdPrefix || null,
        mode: p.mode || null,
        catchupMs: Number(p.catchupMs),
        inventoryScanMs: Number(p.inventoryScanMs),
        paginationMs: Number(p.paginationMs),
        persistMs: Number(p.persistMs),
        renderMs: Number(p.renderMs),
        totalMs: Number(p.totalMs)
      });
      continue;
    }

    if (obj?.event !== "interaction_latency") continue;

    const p = obj.payload || {};
    const event = {
      ts,
      route: p.route || "unknown",
      subroute: p.subroute || null,
      customIdPrefix: p.customIdPrefix || null,
      totalMs: Number(p.totalMs),
      deferMs: Number(p.deferMs),
      dbReadMs: Number(p.dbReadMs),
      dbReadCount: Number(p.dbReadCount),
      dbWriteMs: Number(p.dbWriteMs),
      dbWriteCount: Number(p.dbWriteCount),
      lockAcquireMs: Number(p.lockAcquireMs),
      lockAcquireCount: Number(p.lockAcquireCount),
      lockReleaseMs: Number(p.lockReleaseMs),
      lockReleaseCount: Number(p.lockReleaseCount),
      lockBusyCount: Number(p.lockBusyCount),
      error: p.error
    };

    events.push(event);
  }

  if (events.length === 0 && slowEvents.length === 0 && navPhaseEvents.length === 0 && navSubroutePhaseEvents.length === 0) {
    process.stderr.write("No telemetry events found in file.\n");
    process.exit(1);
  }

  let filtered = events;
  let slowFiltered = slowEvents;
  let navPhaseFiltered = navPhaseEvents;
  let navSubroutePhaseFiltered = navSubroutePhaseEvents;
  if (Number.isFinite(args.windowHours) && args.windowHours > 0) {
    const latest = maxTsAny;
    if (!Number.isFinite(latest)) {
      process.stderr.write("No timestamped telemetry events available for the requested window.\n");
      process.exit(1);
    }
    const start = latest - (args.windowHours * 60 * 60 * 1000);
    filtered = events.filter((e) => e.ts >= start && e.ts <= latest);
    slowFiltered = slowEvents.filter((e) => e.ts >= start && e.ts <= latest);
    navPhaseFiltered = navPhaseEvents.filter((e) => e.ts >= start && e.ts <= latest);
    navSubroutePhaseFiltered = navSubroutePhaseEvents.filter((e) => e.ts >= start && e.ts <= latest);
  }

  let totalEventCount = 0;
  let earliest = null;
  let latest = null;
  const includeTs = (items) => {
    for (const item of items) {
      const ts = item.ts;
      if (!Number.isFinite(ts)) continue;
      totalEventCount += 1;
      if (earliest == null || ts < earliest) earliest = ts;
      if (latest == null || ts > latest) latest = ts;
    }
  };

  includeTs(filtered);
  includeTs(slowFiltered);
  includeTs(navPhaseFiltered);
  includeTs(navSubroutePhaseFiltered);

  if (totalEventCount === 0 || earliest == null || latest == null) {
    process.stderr.write("No telemetry events found in the requested analysis window.\n");
    process.exit(1);
  }

  const summary = summarizeEvents(filtered);
  const byRoute = summarizeByRoute(filtered);
  const bySubroute = summarizeBySubroute(filtered);
  const slowPatterns = summarizeSlowEvents(slowFiltered);
  const navBottlenecks = summarizeNavPhases(navPhaseFiltered);
  const navSubrouteBottlenecks = summarizeNavSubroutePhases(navSubroutePhaseFiltered);

  const report = {
    sourceFile: filePath,
    windowHours: Number.isFinite(args.windowHours) && args.windowHours > 0 ? args.windowHours : null,
    totalEventCount,
    earliestTs: new Date(earliest).toISOString(),
    latestTs: new Date(latest).toISOString(),
    spanHours: r3((latest - earliest) / (60 * 60 * 1000)),
    summary,
    byRoute,
    bySubroute,
    slowEventCount: slowFiltered.length,
    slowPatterns,
    navPhaseCount: navPhaseFiltered.length,
    navBottlenecks,
    navSubroutePhaseCount: navSubroutePhaseFiltered.length,
    navSubrouteBottlenecks
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write(toMarkdown(report, args.routeLimit, args.slowLimit));
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err}\n`);
  process.exit(1);
});
