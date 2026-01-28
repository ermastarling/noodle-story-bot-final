import crypto from "crypto";
import { nowTs } from "../util/time.js";

export function makeIdempotencyKey({ serverId, userId, action, interactionId }) {
  const raw = `${serverId}:${userId}:${action}:${interactionId}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function getIdempotentResult(db, key) {
  db.prepare("DELETE FROM idempotency WHERE expires_at <= ?").run(nowTs());
  const row = db.prepare("SELECT result_json FROM idempotency WHERE key=?").get(key);
  return row ? JSON.parse(row.result_json) : null;
}

export function putIdempotentResult(db, { key, userId, action, ttlSeconds, result }) {
  const expiresAt = nowTs() + ttlSeconds*1000;
  db.prepare("INSERT OR REPLACE INTO idempotency(key,user_id,action,expires_at,result_json) VALUES (?,?,?,?,?)")
    .run(key, userId, action, expiresAt, JSON.stringify(result));
}
