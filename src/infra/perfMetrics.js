import { AsyncLocalStorage } from "node:async_hooks";

const perfStorage = new AsyncLocalStorage();

function normalizeMs(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 1000) / 1000;
}

function newPerfState() {
  return {
    dbReadMs: 0,
    dbReadCount: 0,
    dbWriteMs: 0,
    dbWriteCount: 0,
    lockAcquireMs: 0,
    lockAcquireCount: 0,
    lockReleaseMs: 0,
    lockReleaseCount: 0,
    lockBusyCount: 0
  };
}

function getState() {
  return perfStorage.getStore() ?? null;
}

export function withInteractionPerf(fn) {
  return perfStorage.run(newPerfState(), fn);
}

export function recordDbRead(ms) {
  const state = getState();
  if (!state) return;
  state.dbReadMs += normalizeMs(ms);
  state.dbReadCount += 1;
}

export function recordDbWrite(ms) {
  const state = getState();
  if (!state) return;
  state.dbWriteMs += normalizeMs(ms);
  state.dbWriteCount += 1;
}

export function recordLockAcquire(ms) {
  const state = getState();
  if (!state) return;
  state.lockAcquireMs += normalizeMs(ms);
  state.lockAcquireCount += 1;
}

export function recordLockRelease(ms) {
  const state = getState();
  if (!state) return;
  state.lockReleaseMs += normalizeMs(ms);
  state.lockReleaseCount += 1;
}

export function recordLockBusy() {
  const state = getState();
  if (!state) return;
  state.lockBusyCount += 1;
}

export function getInteractionPerfSnapshot() {
  const state = getState();
  return state ? { ...state } : null;
}
