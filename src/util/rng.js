import crypto from "crypto";

export function makeStreamRng({
  mode = "secure",
  seed = null,
  streamName = "default",
  serverId = "0",
  dayKey = "1970-01-01",
  userId = null,
  extra = null
}) {
  // secure mode: non-deterministic
  if (mode !== "seeded") {
    return () => crypto.randomInt(0, 2 ** 31) / (2 ** 31);
  }

  // seeded mode: deterministic stream; optionally varies per userId
  const hasher = crypto
    .createHash("sha256")
    .update(String(seed))
    .update(streamName)
    .update(String(serverId))
    .update(String(dayKey));

  if (userId !== null && userId !== undefined) {
    hasher.update(String(userId));
  }

  if (extra !== null && extra !== undefined) {
    hasher.update(String(extra));
  }

  const h = hasher.digest();
  let state = h.readUInt32LE(0) >>> 0;

  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17; state >>>= 0;
    state ^= state << 5;  state >>>= 0;
    return (state >>> 0) / 2 ** 32;
  };
}

export function rngBetween(rng, min, max) {
  return min + (max - min) * rng();
}

export function weightedPick(rng, weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}
