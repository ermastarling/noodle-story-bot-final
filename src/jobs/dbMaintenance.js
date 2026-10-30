import { cleanupExpiredIdempotency } from "../infra/idempotency.js";
import { cleanupExpiredLocks } from "../infra/locks.js";
import { runWithTelemetry } from "../infra/telemetry.js";

const DEFAULT_INTERVAL_MS = 60_000;

export function startDbMaintenanceScheduler(db, {
  intervalMs = DEFAULT_INTERVAL_MS,
  runOnStart = true
} = {}) {
  if (!db) return null;

  const runCleanup = (reason) => runWithTelemetry("database_maintenance", reason, () => {
    try {
      cleanupExpiredLocks(db);
      cleanupExpiredIdempotency(db);
      return true;
    } catch (error) {
      console.error("DB maintenance cleanup failed:", error?.stack ?? error);
      return false;
    }
  });

  if (runOnStart) void runCleanup("startup");
  return setInterval(() => {
    void runCleanup("interval");
  }, intervalMs);
}
