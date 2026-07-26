import test from "node:test";
import assert from "node:assert/strict";

async function importSubscriptionsWithFreshEnv() {
  const nonce = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return import(`../src/game/subscriptions.js?nonce=${nonce}`);
}

test("Subscriptions caps: defaults remain 5/500 when env vars unset", async () => {
  const prevBase = process.env.NOODLE_ORDER_ACCEPT_CAP_BASE;
  const prevUnlimited = process.env.NOODLE_ORDER_ACCEPT_CAP_HOUSE_247;
  delete process.env.NOODLE_ORDER_ACCEPT_CAP_BASE;
  delete process.env.NOODLE_ORDER_ACCEPT_CAP_HOUSE_247;

  try {
    const mod = await importSubscriptionsWithFreshEnv();
    assert.equal(mod.ORDER_ACCEPT_CAP_BASE, 5);
    assert.equal(mod.ORDER_ACCEPT_CAP_HOUSE_247, 500);
  } finally {
    if (prevBase == null) delete process.env.NOODLE_ORDER_ACCEPT_CAP_BASE;
    else process.env.NOODLE_ORDER_ACCEPT_CAP_BASE = prevBase;
    if (prevUnlimited == null) delete process.env.NOODLE_ORDER_ACCEPT_CAP_HOUSE_247;
    else process.env.NOODLE_ORDER_ACCEPT_CAP_HOUSE_247 = prevUnlimited;
  }
});

test("Subscriptions caps: env vars override order caps", async () => {
  const prevBase = process.env.NOODLE_ORDER_ACCEPT_CAP_BASE;
  const prevUnlimited = process.env.NOODLE_ORDER_ACCEPT_CAP_HOUSE_247;
  process.env.NOODLE_ORDER_ACCEPT_CAP_BASE = "12";
  process.env.NOODLE_ORDER_ACCEPT_CAP_HOUSE_247 = "1200";

  try {
    const mod = await importSubscriptionsWithFreshEnv();
    assert.equal(mod.ORDER_ACCEPT_CAP_BASE, 12);
    assert.equal(mod.ORDER_ACCEPT_CAP_HOUSE_247, 1200);
  } finally {
    if (prevBase == null) delete process.env.NOODLE_ORDER_ACCEPT_CAP_BASE;
    else process.env.NOODLE_ORDER_ACCEPT_CAP_BASE = prevBase;
    if (prevUnlimited == null) delete process.env.NOODLE_ORDER_ACCEPT_CAP_HOUSE_247;
    else process.env.NOODLE_ORDER_ACCEPT_CAP_HOUSE_247 = prevUnlimited;
  }
});
