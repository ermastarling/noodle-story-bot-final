import test from "node:test";
import assert from "node:assert/strict";

import { V2_SCENE_REGISTRY } from "../src/ui/sceneRoutingV2.js";
import { createSceneStateStore, getSceneTtlMs } from "../src/ui/sceneStateV2.js";

const SCENE_KEYS = Object.keys(V2_SCENE_REGISTRY);

test("Scene state V2: every migrated scene module has a positive TTL", () => {
  for (const sceneKey of SCENE_KEYS) {
    const ttl = getSceneTtlMs(sceneKey, {});
    assert.equal(Number.isInteger(ttl), true, `expected integer ttl for ${sceneKey}`);
    assert.equal(ttl > 0, true, `expected positive ttl for ${sceneKey}`);
  }
});

test("Scene state V2: stale expiry behavior is covered for every migrated scene module", () => {
  const store = createSceneStateStore({ maxEntries: 100 });
  const now = 1_000;

  for (const sceneKey of SCENE_KEYS) {
    const token = `tok-expire-${sceneKey}`;
    store.putState({
      sceneKey,
      ownerId: "u-owner",
      token,
      state: { sceneKey },
      ttlMs: 100,
      nowMs: now
    });

    const expired = store.getState({
      sceneKey,
      token,
      ownerId: "u-owner",
      nowMs: now + 101
    });

    assert.equal(expired.ok, false, `expected stale expiry for ${sceneKey}`);
    assert.equal(expired.stale, true, `expected stale=true for ${sceneKey}`);
    assert.equal(expired.reason, "expired", `expected expired reason for ${sceneKey}`);
  }
});

test("Scene state V2: owner mismatch behavior is covered for every migrated scene module", () => {
  const store = createSceneStateStore({ maxEntries: 100 });
  const now = 2_000;

  for (const sceneKey of SCENE_KEYS) {
    const token = `tok-owner-${sceneKey}`;
    store.putState({
      sceneKey,
      ownerId: "u-owner",
      token,
      state: { sceneKey },
      ttlMs: 60_000,
      nowMs: now
    });

    const mismatch = store.getState({
      sceneKey,
      token,
      ownerId: "u-other",
      nowMs: now + 1
    });

    assert.equal(mismatch.ok, false, `expected owner mismatch rejection for ${sceneKey}`);
    assert.equal(mismatch.stale, false, `expected stale=false for owner mismatch in ${sceneKey}`);
    assert.equal(mismatch.reason, "owner_mismatch", `expected owner_mismatch reason for ${sceneKey}`);
  }
});