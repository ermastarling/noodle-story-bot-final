import { nowTs } from "../util/time.js";

const LOCK_CLEANUP_INTERVAL_MS = 60_000;
let lastLockCleanupAt = 0;

function maybeCleanupExpiredLocks(db, now) {
  if (now - lastLockCleanupAt < LOCK_CLEANUP_INTERVAL_MS) return;
  db.prepare("DELETE FROM locks WHERE expires_at <= ?").run(now);
  lastLockCleanupAt = now;
}

export async function withLock(db, key, owner, ttlMs, fn) {
  const now = nowTs();
  maybeCleanupExpiredLocks(db, now);

  const existing = db.prepare("SELECT owner, expires_at FROM locks WHERE key=?").get(key);
  if (!existing) {
    db.prepare("INSERT INTO locks(key,owner,expires_at) VALUES (?,?,?)").run(key, owner, now + ttlMs);
  } else if ((existing.expires_at ?? 0) <= now) {
    db.prepare("UPDATE locks SET owner=?, expires_at=? WHERE key=?").run(owner, now + ttlMs, key);
  } else {
    const err = new Error("LOCK_BUSY");
    err.code = "ERR_LOCK_BUSY";
    err.retryable = true;
    throw err;
  }

  try {
    return await fn();
  } finally {
    db.prepare("DELETE FROM locks WHERE key=? AND owner=?").run(key, owner);
  }
}
