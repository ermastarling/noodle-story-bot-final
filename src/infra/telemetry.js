import fs from "fs";
import path from "path";

const telemetryLogPath = process.env.NOODLE_TELEMETRY_LOG_PATH || path.join(process.cwd(), "telemetry.log");
const telemetryDisabled = process.env.NOODLE_TELEMETRY_LOG_DISABLED === "1";

let telemetryStream = null;
let telemetryInitFailed = false;

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
    telemetryStream = fs.createWriteStream(telemetryLogPath, { flags: "a" });
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
  const stream = getTelemetryStream();
  if (!stream) return;

  const safePayload = normalizeTelemetryValue(payload ? { ...payload } : {});
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    payload: safePayload
  });
  stream.write(`${line}\n`);
}
