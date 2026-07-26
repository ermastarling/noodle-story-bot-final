import test from "node:test";
import assert from "node:assert/strict";

import { createSceneStateStore } from "../src/ui/sceneStateV2.js";

test("Scene state V2: returns stored state before TTL expiry", () => {
  const store = createSceneStateStore({ maxEntries: 10 });
  const now = 1_000;

  const put = store.putState({
    sceneKey: "orders.board",
    ownerId: "u1",
    state: { page: 1 },
    token: "tok-1",
    ttlMs: 5_000,
    nowMs: now
  });

  assert.equal(put.token, "tok-1");

  const got = store.getState({
    sceneKey: "orders.board",
    token: "tok-1",
    ownerId: "u1",
    nowMs: now + 100
  });

  assert.equal(got.ok, true);
  assert.equal(got.stale, false);
  assert.deepEqual(got.value.state, { page: 1 });
});

test("Scene state V2: expires stale tokens after TTL", () => {
  const store = createSceneStateStore({ maxEntries: 10 });
  const now = 2_000;

  store.putState({
    sceneKey: "cook.minigame",
    ownerId: "u2",
    token: "tok-2",
    state: { turn: 1 },
    ttlMs: 500,
    nowMs: now
  });

  const expired = store.getState({
    sceneKey: "cook.minigame",
    token: "tok-2",
    ownerId: "u2",
    nowMs: now + 501
  });

  assert.equal(expired.ok, false);
  assert.equal(expired.stale, true);
  assert.equal(expired.reason, "expired");
});

test("Scene state V2: enforces max entries with eviction guardrail", () => {
  const store = createSceneStateStore({ maxEntries: 3 });

  store.putState({ sceneKey: "orders.board", ownerId: "u1", token: "a", state: {}, ttlMs: 60_000, nowMs: 10 });
  store.putState({ sceneKey: "orders.board", ownerId: "u1", token: "b", state: {}, ttlMs: 60_000, nowMs: 20 });
  store.putState({ sceneKey: "orders.board", ownerId: "u1", token: "c", state: {}, ttlMs: 60_000, nowMs: 30 });
  store.putState({ sceneKey: "orders.board", ownerId: "u1", token: "d", state: {}, ttlMs: 60_000, nowMs: 40 });

  const stats = store.getStats(40);
  assert.equal(stats.size <= 3, true);

  const oldest = store.getState({ sceneKey: "orders.board", token: "a", ownerId: "u1", nowMs: 50 });
  assert.equal(oldest.ok, false);
  assert.equal(oldest.stale, true);
});

test("Scene state V2: missing ownerId is rejected", () => {
  const store = createSceneStateStore({ maxEntries: 10 });
  const now = 3_000;

  store.putState({
    sceneKey: "orders.accept_picker",
    ownerId: "u3",
    token: "tok-owner",
    state: { selected: ["A1"] },
    ttlMs: 5_000,
    nowMs: now
  });

  const got = store.getState({
    sceneKey: "orders.accept_picker",
    token: "tok-owner",
    ownerId: "",
    nowMs: now + 100
  });

  assert.equal(got.ok, false);
  assert.equal(got.stale, false);
  assert.equal(got.reason, "missing_owner_id");
});
