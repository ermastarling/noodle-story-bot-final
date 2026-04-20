import fs from "fs";
import path from "path";

const telemetryLogPath = process.env.NOODLE_TELEMETRY_LOG_PATH || path.join(process.cwd(), "telemetry.log");
const telemetryDisabled = process.env.NOODLE_TELEMETRY_LOG_DISABLED === "1";

let telemetryStream = null;
let telemetryInitFailed = false;

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

  const safePayload = payload ? { ...payload } : {};
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    payload: safePayload
  });
  stream.write(`${line}\n`);
}
