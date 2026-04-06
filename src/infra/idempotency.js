import crypto from "crypto";
import { nowTs } from "../util/time.js";

const IDEMPOTENCY_CLEANUP_INTERVAL_MS = 60_000;
let lastIdempotencyCleanupAt = 0;

function maybeCleanupExpiredIdempotency(db, now) {
  if (now - lastIdempotencyCleanupAt < IDEMPOTENCY_CLEANUP_INTERVAL_MS) return;
  db.prepare("DELETE FROM idempotency WHERE expires_at <= ?").run(now);
  lastIdempotencyCleanupAt = now;
}

export function makeIdempotencyKey({ serverId, userId, action, interactionId }) {
  const raw = `${serverId}:${userId}:${action}:${interactionId}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function getIdempotentResult(db, key) {
  const now = nowTs();
  maybeCleanupExpiredIdempotency(db, now);
  const row = db.prepare("SELECT result_json, expires_at FROM idempotency WHERE key=?").get(key);
  if (!row) return null;
  if ((row.expires_at ?? 0) <= now) {
    db.prepare("DELETE FROM idempotency WHERE key=?").run(key);
    return null;
  }
  return JSON.parse(row.result_json);
}

export function putIdempotentResult(db, { key, userId, action, ttlSeconds, result }) {
  const now = nowTs();
  maybeCleanupExpiredIdempotency(db, now);
  const expiresAt = now + ttlSeconds*1000;
  db.prepare("INSERT OR REPLACE INTO idempotency(key,user_id,action,expires_at,result_json) VALUES (?,?,?,?,?)")
    .run(key, userId, action, expiresAt, JSON.stringify(result));
}
