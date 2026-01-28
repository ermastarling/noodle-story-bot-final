import { nowTs } from "../util/time.js";

export async function withLock(db, key, owner, ttlMs, fn) {
  // clean expired
  db.prepare("DELETE FROM locks WHERE expires_at <= ?").run(nowTs());

  const existing = db.prepare("SELECT owner, expires_at FROM locks WHERE key=?").get(key);
  if (!existing) {
    db.prepare("INSERT INTO locks(key,owner,expires_at) VALUES (?,?,?)").run(key, owner, nowTs() + ttlMs);
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
