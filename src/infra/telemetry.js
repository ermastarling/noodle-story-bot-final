import fs from "fs";
import path from "path";

const telemetryLogPath = process.env.NOODLE_TELEMETRY_LOG_PATH || path.join(process.cwd(), "telemetry.log");
const telemetryDisabled = process.env.NOODLE_TELEMETRY_LOG_DISABLED === "1";
const telemetryMode = String(process.env.NOODLE_TELEMETRY_MODE || "all").toLowerCase();

function parseNumberEnv(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) ? raw : fallback;
}

const telemetrySampleRateRaw = parseNumberEnv("NOODLE_TELEMETRY_SAMPLE_RATE", 1);
const telemetrySampleRate = Math.max(0, Math.min(1, telemetrySampleRateRaw));
const telemetryMaxBufferBytes = Math.max(8192, parseNumberEnv("NOODLE_TELEMETRY_MAX_BUFFER_BYTES", 262144));
const noisyEvents = new Set(["interaction_latency", "component_nav_phase", "component_nav_subroute_phase"]);

let telemetryStream = null;
let telemetryInitFailed = false;
let droppedByBuffer = 0;
let droppedBySampling = 0;
let droppedByMode = 0;
let lastDropLogAt = 0;

function shouldEmitByMode(event) {
  if (telemetryMode === "off" || telemetryMode === "none") return false;
  if (telemetryMode !== "slow") return true;
  return event === "interaction_slow_event" || event === "rate_limited";
}

function shouldSampleEvent(event) {
  if (telemetrySampleRate >= 1) return true;
  if (!noisyEvents.has(event)) return true;
  return Math.random() < telemetrySampleRate;
}

function maybeLogDropSummary() {
  const now = Date.now();
  if (now - lastDropLogAt < 60000) return;
  const totalDrops = droppedByBuffer + droppedBySampling + droppedByMode;
  if (totalDrops <= 0) return;
  lastDropLogAt = now;
  console.warn(
    `Telemetry drops: total=${totalDrops} buffer=${droppedByBuffer} sampling=${droppedBySampling} mode=${droppedByMode}`
  );
}

function roundTelemetryNumber(value) {
  if (!Number.isFinite(value)) return value;
  if (Number.isInteger(value)) return value;
  return Math.round(value * 1000) / 1000;
}

function normalizeTelemetryValue(value) {
  if (typeof value === "number") return roundTelemetryNumber(value);
  if (Array.isArray(value)) return value.map((item) => normalizeTelemetryValue(item));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = normalizeTelemetryValue(inner);
    }
    return out;
  }
  return value;
}

function getTelemetryStream() {
  if (telemetryDisabled) return null;
  if (telemetryStream) return telemetryStream;
  if (telemetryInitFailed) return null;

  try {
    const dir = path.dirname(telemetryLogPath);
    fs.mkdirSync(dir, { recursive: true });
    telemetryStream = fs.createWriteStream(telemetryLogPath, {
      flags: "a",
      highWaterMark: telemetryMaxBufferBytes
    });
    telemetryStream.on("error", (error) => {
      telemetryInitFailed = true;
      telemetryStream = null;
      console.error("Telemetry stream error:", error?.message ?? error);
    });
    return telemetryStream;
  } catch (error) {
    telemetryInitFailed = true;
    console.error("Failed to initialize telemetry log file:", error?.message ?? error);
    return null;
  }
}

export function emitTelemetry(event, payload = {}) {
  if (!shouldEmitByMode(event)) {
    droppedByMode += 1;
    maybeLogDropSummary();
    return;
  }

  if (!shouldSampleEvent(event)) {
    droppedBySampling += 1;
    maybeLogDropSummary();
    return;
  }

  const stream = getTelemetryStream();
  if (!stream) return;

  if (stream.writableNeedDrain || stream.writableLength >= telemetryMaxBufferBytes) {
    droppedByBuffer += 1;
    maybeLogDropSummary();
    return;
  }

  const safePayload = normalizeTelemetryValue(payload ? { ...payload } : {});
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    payload: safePayload
  });
  const accepted = stream.write(`${line}\n`);
  if (!accepted) {
    droppedByBuffer += 1;
    maybeLogDropSummary();
  }
}
