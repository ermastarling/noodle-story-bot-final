import { strict as assert } from "assert";
import { test } from "node:test";

import {
	ensureDailyOrdersForPlayer,
	generateOrderPageForPlayer,
	getOrdersMeta,
	markOrderConsumed
} from "../src/game/orders.js";

// Minimal content to drive order generation deterministically
const content = {
	recipes: {
		classic_soy_ramen: { recipe_id: "classic_soy_ramen", tier: "common" },
		veggie_ramen: { recipe_id: "veggie_ramen", tier: "common" },
		shrimp_special: { recipe_id: "shrimp_special", tier: "rare" }
	},
	npcs: {
		traveler: { npc_id: "traveler", rarity: "common" },
		gourmand: { npc_id: "gourmand", rarity: "rare" }
	}
};

const settings = {
	ORDERS_BASE_COUNT: 5,
	ORDER_TIER_WEIGHTS_BASE: { common: 0.2, rare: 0.8 },
	NPC_RARITY_WEIGHTS: { common: 0.0001, rare: 1 },
	LIMITED_TIME_CHANCE: 0
};

test("Orders: unlocking recipe keeps consumed orders and adds to pool", () => {
	const playerState = {
		shop_level: 1,
		rep: 0,
		coins: 0,
		known_recipes: ["classic_soy_ramen", "veggie_ramen"],
		orders_consumed_indices: []
	};

	// Initialize for the day and consume two orders
	ensureDailyOrdersForPlayer(playerState, settings, content, "spring", "s1", "u1");
	markOrderConsumed(playerState, 0); // baseline
	markOrderConsumed(playerState, 1);

	const beforeMeta = getOrdersMeta(playerState);
	assert.equal(beforeMeta.totalCount, 5);
	assert.equal(beforeMeta.availableCount, 3);

	// Unlock a new rare recipe mid-day
	playerState.known_recipes.push("shrimp_special");
	ensureDailyOrdersForPlayer(playerState, settings, content, "spring", "s1", "u1");

	// Consumed indices should remain, not reset
	const afterMeta = getOrdersMeta(playerState);
	assert.equal(afterMeta.totalCount, 5);
	assert.equal(afterMeta.availableCount, 3);

	// New recipe should be eligible in subsequent generations without a reset
	const page = generateOrderPageForPlayer({
		playerState,
		settings,
		content,
		activeSeason: "spring",
		serverId: "s1",
		userId: "u1",
		page: 0,
		pageSize: 10
	});

	const recipeIds = page.orders.map((o) => o.recipe_id);
	assert.ok(recipeIds.includes("shrimp_special"), "Unlocked recipe should appear in the order board");
});
