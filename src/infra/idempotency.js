import crypto from "crypto";
import { nowTs } from "../util/time.js";

export function cleanupExpiredIdempotency(db, now = nowTs()) {
  if (!db) return 0;
  const result = db.prepare("DELETE FROM idempotency WHERE expires_at <= ?").run(now);
  return Number(result?.changes ?? 0);
}

export function makeIdempotencyKey({ serverId, userId, action, interactionId }) {
  const raw = `${serverId}:${userId}:${action}:${interactionId}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function getIdempotentResult(db, key) {
  const now = nowTs();
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
  const expiresAt = now + ttlSeconds*1000;
  db.prepare("INSERT OR REPLACE INTO idempotency(key,user_id,action,expires_at,result_json) VALUES (?,?,?,?,?)")
    .run(key, userId, action, expiresAt, JSON.stringify(result));
}
