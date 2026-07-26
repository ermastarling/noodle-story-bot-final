import test from "node:test";
import assert from "node:assert/strict";

import { getKitchenUnlockState, acknowledgeKitchenUnlock, KITCHEN_UNLOCK_LEVEL } from "../src/game/kitchen.js";

test("kitchen unlock state is not consumed until it is explicitly acknowledged", () => {
  const player = {
    shop_level: KITCHEN_UNLOCK_LEVEL,
    kitchen: {
      active_batches: [],
      unlock_seen_level: KITCHEN_UNLOCK_LEVEL - 1
    }
  };

  const first = getKitchenUnlockState(player);
  const second = getKitchenUnlockState(player);

  assert.equal(first.unlocked, true);
  assert.equal(first.justUnlocked, true);
  assert.equal(second.justUnlocked, true);

  acknowledgeKitchenUnlock(player);

  const afterAck = getKitchenUnlockState(player);
  assert.equal(afterAck.justUnlocked, false);
});