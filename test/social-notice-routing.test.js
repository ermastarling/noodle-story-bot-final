import test from "node:test";
import assert from "node:assert/strict";

import {
  isSharedOrderStartedNotice,
  shouldRetainPersistentPartyNotice
} from "../src/game/socialNoticeRouting.js";

test("shared-order start notice detection ignores emoji/noise", () => {
  assert.equal(
    isSharedOrderStartedNotice({ title: "🍜 Party Shared Order Started" }),
    true
  );
  assert.equal(
    isSharedOrderStartedNotice({ title: "Party Shared Order Completed" }),
    false
  );
});

test("stale shared-order start catch-up notice is dropped when no active order", () => {
  const keep = shouldRetainPersistentPartyNotice({
    notice: {
      title: "🍜 Party Shared Order Started",
      details: ["Your party started a shared order."]
    },
    hasActiveSharedOrder: false
  });
  assert.equal(keep, false);
});

test("shared-order start catch-up notice is kept when active order exists", () => {
  const keep = shouldRetainPersistentPartyNotice({
    notice: {
      title: "🍜 Party Shared Order Started",
      details: ["Your party started a shared order."]
    },
    hasActiveSharedOrder: true
  });
  assert.equal(keep, true);
});

test("non-start notices are retained regardless of active order", () => {
  const keep = shouldRetainPersistentPartyNotice({
    notice: {
      title: "🍜 Party Shared Order Completed",
      details: ["Reward granted."]
    },
    hasActiveSharedOrder: false
  });
  assert.equal(keep, true);
});
