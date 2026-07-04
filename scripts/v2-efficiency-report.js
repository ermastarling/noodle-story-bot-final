#!/usr/bin/env node
import path from "path";
import {
  buildGoNoGoRecommendation,
  compareTelemetrySummary,
  getTelemetryWindowRange,
  readTelemetryEvents,
  summarizeTelemetryEvents
} from "../src/infra/v2TelemetryReport.js";

function parseArgs(argv) {
  const args = {
    baseline: null,
    candidate: path.join("noodle-logs", "telemetry.log"),
    windowHours: null
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--baseline" || arg === "-b") {
      args.baseline = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (arg === "--candidate" || arg === "-c") {
      args.candidate = argv[i + 1] || args.candidate;
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--window-hours" || arg === "-w") {
      args.windowHours = Number(argv[i + 1] || 0) || null;
      i += 1;
      continue;
    }
  }

  return args;
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/v2-efficiency-report.js [options]",
    "",
    "Options:",
    "  -b, --baseline <path>   Baseline telemetry JSONL file (optional)",
    "  -c, --candidate <path>  Candidate telemetry JSONL file (default: noodle-logs/telemetry.log)",
    "  -w, --window-hours <n>  Optional rolling window for both files (last N hours)",
    "  -h, --help              Show help"
  ].join("\n") + "\n");
}

function printSummary(label, summary) {
  process.stdout.write(`\n${label}\n`);
  process.stdout.write(`- transitions: ${summary.transitions}\n`);
  process.stdout.write(`- errors: ${summary.errors}\n`);
  process.stdout.write(`- loops: ${summary.loops}\n`);
  process.stdout.write(`- minigame events: ${summary.minigameEvents}\n`);
  process.stdout.write(`- avg clicks/loop: ${summary.clickAvg ?? "n/a"}\n`);
  process.stdout.write(`- loop p50 (ms): ${summary.loopTimeP50 ?? "n/a"}\n`);
  process.stdout.write(`- loop p95 (ms): ${summary.loopTimeP95 ?? "n/a"}\n`);

  if (summary.moduleRows.length) {
    process.stdout.write("- by module:\n");
    for (const row of summary.moduleRows) {
      process.stdout.write(`  - ${row.module}: loops=${row.loops}, clicks(avg)=${row.clickAvg ?? "n/a"}, p50=${row.timeP50 ?? "n/a"}ms, p95=${row.timeP95 ?? "n/a"}ms\n`);
    }
  }

  if (summary.minigameDistribution.length) {
    process.stdout.write("- minigame outcomes:\n");
    for (const row of summary.minigameDistribution) {
      process.stdout.write(`  - ${row.outcome}: ${row.count}\n`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const window = Number.isFinite(args.windowHours) && args.windowHours > 0
    ? getTelemetryWindowRange({ windowHours: args.windowHours })
    : null;

  const candidateEvents = await readTelemetryEvents({
    filePath: args.candidate,
    startMs: window?.startMs,
    endMs: window?.endMs
  });
  const candidateSummary = summarizeTelemetryEvents(candidateEvents);

  let baselineSummary = null;
  if (args.baseline) {
    const baselineEvents = await readTelemetryEvents({
      filePath: args.baseline,
      startMs: window?.startMs,
      endMs: window?.endMs
    });
    baselineSummary = summarizeTelemetryEvents(baselineEvents);
  }

  if (window) {
    process.stdout.write(`Window: last ${Math.floor(args.windowHours)}h\n`);
  }

  printSummary("Candidate V2 Summary", candidateSummary);
  if (baselineSummary) printSummary("Baseline Summary", baselineSummary);

  const delta = compareTelemetrySummary(baselineSummary, candidateSummary);
  if (delta) {
    process.stdout.write("\nComparison Delta (candidate - baseline)\n");
    process.stdout.write(`- avg clicks/loop: ${delta.clickAvgDelta ?? "n/a"}\n`);
    process.stdout.write(`- avg clicks/loop (%): ${delta.clickAvgDeltaPct ?? "n/a"}\n`);
    process.stdout.write(`- loop p50 (ms): ${delta.loopTimeP50Delta ?? "n/a"}\n`);
    process.stdout.write(`- loop p50 (%): ${delta.loopTimeP50DeltaPct ?? "n/a"}\n`);
    process.stdout.write(`- loop p95 (ms): ${delta.loopTimeP95Delta ?? "n/a"}\n`);
    process.stdout.write(`- loop p95 (%): ${delta.loopTimeP95DeltaPct ?? "n/a"}\n`);
    process.stdout.write(`- error count: ${delta.errorCountDelta ?? "n/a"}\n`);
    process.stdout.write(`- error rate (% points): ${delta.errorRateDeltaPct ?? "n/a"}\n`);
  }

  process.stdout.write(`\nRecommendation\n- ${buildGoNoGoRecommendation(delta)}\n`);
}

main().catch((error) => {
  process.stderr.write(`v2-efficiency-report failed: ${error?.message || error}\n`);
  process.exit(1);
});
