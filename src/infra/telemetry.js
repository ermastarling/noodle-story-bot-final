import fs from "fs";
import path from "path";

const logDir = path.join(process.cwd(), "noodle-logs");
const telemetryLogPath = (() => {
  const configuredPath = process.env.NOODLE_TELEMETRY_LOG_PATH;
  if (!configuredPath || !String(configuredPath).trim()) return path.join(logDir, "telemetry.log");
  const normalized = String(configuredPath).trim();
  if (path.isAbsolute(normalized)) return normalized;
  return path.join(logDir, normalized);
})();
const telemetryDisabled = process.env.NOODLE_TELEMETRY_LOG_DISABLED === "1";
const telemetryMode = String(process.env.NOODLE_TELEMETRY_MODE || "all").trim().toLowerCase();
const TELEMETRY_MAX_BUFFER_BYTES_CAP = 4 * 1024 * 1024;

function parseNumberEnv(name, fallback) {
  const rawValue = process.env[name];
  if (rawValue == null) return fallback;
  const normalized = String(rawValue).trim();
  if (!normalized) return fallback;
  const raw = Number(normalized);
  return Number.isFinite(raw) ? raw : fallback;
}

const telemetrySampleRateRaw = parseNumberEnv("NOODLE_TELEMETRY_SAMPLE_RATE", 1);
const telemetrySampleRate = Math.max(0, Math.min(1, telemetrySampleRateRaw));
const telemetryMaxBufferBytesRaw = parseNumberEnv("NOODLE_TELEMETRY_MAX_BUFFER_BYTES", 262144);
const telemetryMaxBufferBytesInt = Math.trunc(telemetryMaxBufferBytesRaw);
const telemetryMaxBufferBytes = Math.min(
  TELEMETRY_MAX_BUFFER_BYTES_CAP,
  Math.max(8192, telemetryMaxBufferBytesInt)
);
const telemetryMaxBufferWasNormalized =
  !telemetryDisabled
  && (telemetryMaxBufferBytesRaw !== telemetryMaxBufferBytesInt || telemetryMaxBufferBytesInt !== telemetryMaxBufferBytes);
const noisyEvents = new Set(["interaction_latency", "component_nav_phase", "component_nav_subroute_phase"]);

let telemetryStream = null;
let telemetryInitFailed = false;
let droppedByBuffer = 0;
let droppedBySampling = 0;
let droppedByMode = 0;
let backpressureSignals = 0;
let lastDropLogAt = 0;
let telemetryBackpressureActive = false;
let telemetryNormalizationNoticePending = telemetryMaxBufferWasNormalized;

function shouldEmitByMode(event) {
  if (telemetryMode !== "slow") return true;
  return event === "interaction_slow_event" || event === "rate_limited";
}

function shouldSampleEvent(event) {
  if (telemetrySampleRate >= 1) return true;
  if (!noisyEvents.has(event)) return true;
  return Math.random() < telemetrySampleRate;
}

function writeTelemetryMeta(event, payload = {}) {
  const stream = getTelemetryStream();
  if (!stream) return;
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      event,
      payload
    });
    stream.write(`${line}\n`);
  } catch {
    // Ignore telemetry metadata write failures.
  }
}

function maybeLogDropSummary() {
  const now = Date.now();
  if (now - lastDropLogAt < 60000) return;
  const totalDrops = droppedByBuffer + droppedBySampling + droppedByMode;
  if (totalDrops <= 0 && backpressureSignals <= 0) return;
  lastDropLogAt = now;
  writeTelemetryMeta("telemetry_drop_summary", {
    totalDrops,
    droppedByBuffer,
    droppedBySampling,
    droppedByMode,
    backpressureSignals
  });
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
      telemetryBackpressureActive = false;
      console.error("Telemetry stream error:", error?.message ?? error);
    });
    telemetryStream.on("drain", () => {
      telemetryBackpressureActive = false;
    });
    if (telemetryNormalizationNoticePending) {
      telemetryNormalizationNoticePending = false;
      writeTelemetryMeta("telemetry_config_notice", {
        name: "NOODLE_TELEMETRY_MAX_BUFFER_BYTES",
        message: `normalized to ${telemetryMaxBufferBytes} (requested ${telemetryMaxBufferBytesRaw}; integer ${telemetryMaxBufferBytesInt}; bounds 8192-${TELEMETRY_MAX_BUFFER_BYTES_CAP})`
      });
    }
    return telemetryStream;
  } catch (error) {
    telemetryInitFailed = true;
    console.error("Failed to initialize telemetry log file:", error?.message ?? error);
    return null;
  }
}

export function emitTelemetry(event, payload = {}) {
  if (telemetryDisabled) return;
  if (telemetryMode === "off" || telemetryMode === "none") return;

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

  const safePayload = normalizeTelemetryValue(payload ? { ...payload } : {});
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    payload: safePayload
  });
  const lineBytes = Buffer.byteLength(line) + 1;

  if (telemetryBackpressureActive || stream.writableNeedDrain || (stream.writableLength + lineBytes) > telemetryMaxBufferBytes) {
    droppedByBuffer += 1;
    maybeLogDropSummary();
    return;
  }

  const accepted = stream.write(`${line}\n`);
  if (!accepted) {
    telemetryBackpressureActive = true;
    backpressureSignals += 1;
    maybeLogDropSummary();
  }
}
