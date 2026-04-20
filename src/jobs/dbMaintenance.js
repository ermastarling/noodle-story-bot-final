import { cleanupExpiredIdempotency } from "../infra/idempotency.js";
import { cleanupExpiredLocks } from "../infra/locks.js";

const DEFAULT_INTERVAL_MS = 60_000;

export function startDbMaintenanceScheduler(db, {
  intervalMs = DEFAULT_INTERVAL_MS,
  runOnStart = true
} = {}) {
  if (!db) return null;

  const runCleanup = () => {
    try {
      cleanupExpiredLocks(db);
      cleanupExpiredIdempotency(db);
    } catch (error) {
      console.error("DB maintenance cleanup failed:", error?.stack ?? error);
    }
  };

  if (runOnStart) runCleanup();
  return setInterval(runCleanup, intervalMs);
}
