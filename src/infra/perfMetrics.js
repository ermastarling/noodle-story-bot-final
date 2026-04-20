import { AsyncLocalStorage } from "node:async_hooks";

const perfStorage = new AsyncLocalStorage();

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
  state.dbReadMs += Number(ms) || 0;
  state.dbReadCount += 1;
}

export function recordDbWrite(ms) {
  const state = getState();
  if (!state) return;
  state.dbWriteMs += Number(ms) || 0;
  state.dbWriteCount += 1;
}

export function recordLockAcquire(ms) {
  const state = getState();
  if (!state) return;
  state.lockAcquireMs += Number(ms) || 0;
  state.lockAcquireCount += 1;
}

export function recordLockRelease(ms) {
  const state = getState();
  if (!state) return;
  state.lockReleaseMs += Number(ms) || 0;
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
