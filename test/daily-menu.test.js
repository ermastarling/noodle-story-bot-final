import test from "node:test";
import assert from "node:assert/strict";
import { setDailyOrderMenu, shouldCommitDailyOrderMenu } from "../src/game/dailyMenu.js";
import { ensureDailyOrdersForPlayer, generateOrderPageForPlayer } from "../src/game/orders.js";
import { newPlayerProfile } from "../src/game/player.js";
import { buildDailyMenuV2Message } from "../src/ui/dailyMenuV2.js";

test("Daily order menu picker renders as an ephemeral Components V2 container", () => {
  const userId = "12345678901234567";
  const payload = buildDailyMenuV2Message({
    userId,
    notice: "Pick the recipes you would like to see.",
    nextChangeAt: "You can change your selected menu once per day.",
    currentMenu: ["Classic Soy Ramen"],
    pickerRows: [{
      type: 1,
      components: [{
        type: 3,
        custom_id: `noodle:daily_menu:menu_select:${userId}:0`,
        options: [{ label: "Classic Soy Ramen", value: "classic_soy_ramen" }]
      }]
    }],
    ephemeral: true
  });
  const container = payload.components?.[0];

  assert.equal((payload.flags & (1 << 15)) !== 0, true);
  assert.equal((payload.flags & (1 << 6)) !== 0, true);
  assert.equal("embeds" in payload, false);
  assert.equal(container?.type, 17);
  assert.ok(JSON.stringify(container.components).includes("Menu.png"));
  assert.ok(container.components.some((component) => component.type === 1
    && component.components?.some((child) => child.type === 3)));
  assert.ok(container.components.some((component) => component.type === 10
    && component.content.includes("Menu owner: <@12345678901234567>")));
});

test("Daily order menu draft retains cross-page selections until explicit save", () => {
  const userId = "12345678901234567";
  const payload = buildDailyMenuV2Message({
    userId,
    notice: "Menu draft saved.",
    currentMenu: ["Classic Soy Ramen"],
    draftSelectionCount: 3,
    showSaveButton: true,
    pickerRows: [{
      type: 1,
      components: [{ type: 3, custom_id: `noodle:daily_menu:menu_select:${userId}:1` }]
    }],
    ephemeral: true
  });
  const container = payload.components?.[0];
  const saveRow = container?.components.find((component) => component.type === 1
    && component.components?.some((child) => child.custom_id === `noodle:pick:daily_menu_confirm:${userId}`));
  const cancelButton = saveRow?.components?.find((child) => child.custom_id === `noodle:pick:daily_menu_cancel:${userId}`);

  assert.ok(container.components.some((component) => component.type === 10
    && component.content.includes("Menu draft: 3/10 selected")));
  assert.equal(saveRow?.components?.[0]?.label, "Save Menu");
  assert.equal(saveRow?.components?.[0]?.style, 3);
  assert.equal(cancelButton?.label, "Cancel Draft");
});

test("Daily order menu changes commit only for direct requests or confirmed drafts", () => {
  assert.equal(shouldCommitDailyOrderMenu(), true);
  assert.equal(shouldCommitDailyOrderMenu({ draftSelection: true }), false);
  assert.equal(shouldCommitDailyOrderMenu({ draftSelection: true, confirmed: true }), true);
  assert.equal(shouldCommitDailyOrderMenu({ confirmed: true }), true);
});

test("Daily order menu can change once per day and preserves accepted orders and consumed orders", () => {
  const player = newPlayerProfile("daily-menu-user");
  player.known_recipes = ["classic_soy_ramen", "ginger_broth", "miso_bowl"];
  player.orders_day = "2026-10-21";
  player.orders_seed = "before-menu";
  player.orders_consumed_indices = [0, 2];
  player.orders.accepted.order_1 = { accepted_at: 1, order: { recipe_id: "classic_soy_ramen" } };

  const result = setDailyOrderMenu(player, ["ginger_broth", "miso_bowl"], {
    availableRecipeIds: player.known_recipes,
    dayKey: "2026-10-21",
    serverId: "guild",
    userId: player.user_id
  });
  assert.equal(result.ok, true);
  assert.notEqual(player.orders_seed, "before-menu");
  assert.deepEqual(player.orders_consumed_indices, [0, 2]);
  assert.deepEqual(player.orders.accepted.order_1.order, { recipe_id: "classic_soy_ramen" });

  assert.deepEqual(setDailyOrderMenu(player, ["classic_soy_ramen"], {
    availableRecipeIds: player.known_recipes,
    dayKey: "2026-10-21"
  }), { ok: false, reason: "change_limit_reached" });
});

test("Daily order menu rejects unknown, empty, and oversized selections", () => {
  const player = newPlayerProfile("daily-menu-validation-user");
  assert.deepEqual(setDailyOrderMenu(player, ["unknown"], {
    availableRecipeIds: ["known"],
    dayKey: "2026-10-21"
  }), { ok: false, reason: "unavailable_recipe" });
  assert.deepEqual(setDailyOrderMenu(player, [], {
    availableRecipeIds: ["known"],
    dayKey: "2026-10-21"
  }), { ok: false, reason: "menu_empty" });
  assert.deepEqual(setDailyOrderMenu(player, Array.from({ length: 11 }, (_, index) => `r${index}`), {
    availableRecipeIds: Array.from({ length: 11 }, (_, index) => `r${index}`),
    dayKey: "2026-10-21"
  }), { ok: false, reason: "menu_too_large" });
});

test("Daily order generation uses selected menu without rewriting accepted-order snapshots", () => {
  const player = newPlayerProfile("daily-menu-orders-user");
  player.known_recipes = ["classic_soy_ramen", "ginger_broth"];
  player.daily_order_menu_recipe_ids = ["ginger_broth"];
  player.orders = { accepted: { locked: { order: { recipe_id: "classic_soy_ramen" } } } };
  const settings = {
    ORDERS_BASE_COUNT: 5,
    ORDER_TIER_WEIGHTS_BASE: { common: 1 },
    NPC_RARITY_WEIGHTS: { common: 1 },
    LIMITED_TIME_CHANCE: 0
  };
  const content = {
    recipes: {
      classic_soy_ramen: { recipe_id: "classic_soy_ramen", tier: "common" },
      ginger_broth: { recipe_id: "ginger_broth", tier: "common" }
    },
    npcs: {
      sleepy_traveler: { npc_id: "sleepy_traveler", rarity: "common" }
    }
  };
  ensureDailyOrdersForPlayer(player, settings, content, "spring", "guild", player.user_id);
  const orders = generateOrderPageForPlayer({
    playerState: player,
    settings,
    content,
    activeSeason: "spring",
    serverId: "guild",
    userId: player.user_id,
    pageSize: 10
  }).orders;
  assert.ok(orders.length > 0);
  assert.ok(orders.every((order) => order.recipe_id === "ginger_broth"));
  assert.deepEqual(player.orders.accepted.locked.order, { recipe_id: "classic_soy_ramen" });
});
