import { nowTs } from "../util/time.js";
import { performance } from "node:perf_hooks";
import { recordLockAcquire, recordLockBusy, recordLockRelease } from "./perfMetrics.js";

export function cleanupExpiredLocks(db, now = nowTs()) {
  if (!db) return 0;
  const result = db.prepare("DELETE FROM locks WHERE expires_at <= ?").run(now);
  return Number(result?.changes ?? 0);
}

export async function withLock(db, key, owner, ttlMs, fn) {
  const now = nowTs();
  const acquireStart = performance.now();
  const expiresAt = now + ttlMs;

  const inserted = db.prepare("INSERT OR IGNORE INTO locks(key,owner,expires_at) VALUES (?,?,?)")
    .run(key, owner, expiresAt);

  if ((Number(inserted?.changes ?? 0)) === 0) {
    const takeover = db.prepare("UPDATE locks SET owner=?, expires_at=? WHERE key=? AND expires_at<=?")
      .run(owner, expiresAt, key, now);
    if ((Number(takeover?.changes ?? 0)) === 0) {
      recordLockAcquire(performance.now() - acquireStart);
      recordLockBusy();
      const err = new Error("LOCK_BUSY");
      err.code = "ERR_LOCK_BUSY";
      err.retryable = true;
      throw err;
    }
  }

  recordLockAcquire(performance.now() - acquireStart);

  try {
    return await fn();
  } finally {
    const releaseStart = performance.now();
    db.prepare("DELETE FROM locks WHERE key=? AND owner=?").run(key, owner);
    recordLockRelease(performance.now() - releaseStart);
  }
}
