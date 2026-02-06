import { nowTs } from "../util/time.js";

const WINDOW_MS = 10_000;

const userBuckets = new Map();
const serverBuckets = new Map();

function prune(bucket, now) {
  if (!bucket || bucket.length === 0) return [];
  const cutoff = now - WINDOW_MS;
  let idx = 0;
  while (idx < bucket.length && bucket[idx] <= cutoff) idx += 1;
  if (idx > 0) bucket.splice(0, idx);
  return bucket;
}

function recordHit(buckets, key, now) {
  const bucket = prune(buckets.get(key) ?? [], now);
  bucket.push(now);
  buckets.set(key, bucket);
  return bucket;
}

function wouldExceed(buckets, key, limit, now) {
  const bucket = prune(buckets.get(key) ?? [], now);
  const exceeded = bucket.length >= limit;
  const retryAfterMs = exceeded ? Math.max(0, bucket[0] + WINDOW_MS - now) : 0;
  return { exceeded, retryAfterMs, count: bucket.length };
}

export function checkRateLimit({
  userId,
  serverId,
  userLimit = 5,
  serverLimit = 40,
  now = nowTs()
} = {}) {
  if (!userId) return { allowed: true };

  const userCheck = wouldExceed(userBuckets, userId, userLimit, now);
  if (userCheck.exceeded) {
    return {
      allowed: false,
      scope: "user",
      retryAfterMs: userCheck.retryAfterMs,
      limit: userLimit,
      count: userCheck.count
    };
  }

  if (serverId) {
    const serverCheck = wouldExceed(serverBuckets, serverId, serverLimit, now);
    if (serverCheck.exceeded) {
      return {
        allowed: false,
        scope: "server",
        retryAfterMs: serverCheck.retryAfterMs,
        limit: serverLimit,
        count: serverCheck.count
      };
    }
  }

  recordHit(userBuckets, userId, now);
  if (serverId) recordHit(serverBuckets, serverId, now);

  return { allowed: true };
}
