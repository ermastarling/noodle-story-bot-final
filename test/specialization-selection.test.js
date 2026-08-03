import { strict as assert } from "assert";
import { test } from "node:test";

import { selectSpecialization } from "../src/game/specialization.js";

test("selectSpecialization records the provided selection timestamp", () => {
  const player = { profile: {}, shop_level: 5, rep: 100, lifetime: { bowls_served_total: 50 } };
  const specializationsContent = {
    specializations: [
      {
        spec_id: "spec_test",
        name: "Test Spec",
        requirements: {}
      }
    ]
  };

  const selectionTs = 1234567890;
  const result = selectSpecialization(player, specializationsContent, "spec_test", selectionTs);

  assert.equal(result.ok, true);
  assert.equal(player.profile.specialization.active_spec_id, "spec_test");
  assert.equal(player.profile.specialization.chosen_at, selectionTs);
  assert.equal(player.profile.specialization.change_cooldown_expires_at, null);
});

test("selectSpecialization sets a numeric timestamp when omitted", () => {
  const player = { profile: {}, shop_level: 5, rep: 100, lifetime: { bowls_served_total: 50 } };
  const specializationsContent = {
    specializations: [
      {
        spec_id: "spec_test",
        name: "Test Spec",
        requirements: {}
      }
    ]
  };

  const result = selectSpecialization(player, specializationsContent, "spec_test");

  assert.equal(result.ok, true);
  assert.equal(Number.isFinite(player.profile.specialization.chosen_at), true);
});
