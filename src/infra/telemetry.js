export function emitTelemetry(event, payload = {}) {
  const safePayload = payload ? { ...payload } : {};
  try {
    console.log(`[telemetry] ${event}`, JSON.stringify(safePayload));
  } catch {
    console.log(`[telemetry] ${event}`);
  }
}
