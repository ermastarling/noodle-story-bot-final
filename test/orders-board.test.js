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

function withMockedNow(ts, fn) {
	const realNow = Date.now;
	Date.now = () => ts;
	try {
		return fn();
	} finally {
		Date.now = realNow;
	}
}

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

test("Orders: day rollover clears stale accepted pointers and resets consumed indices", () => {
	const day1 = Date.UTC(2026, 3, 21, 10, 0, 0, 0);
	const day2 = day1 + (24 * 60 * 60 * 1000);
	const playerState = {
		shop_level: 1,
		rep: 0,
		coins: 0,
		known_recipes: ["classic_soy_ramen", "veggie_ramen"],
		orders: { accepted: {} },
		orders_consumed_indices: []
	};

	withMockedNow(day1, () => {
		ensureDailyOrdersForPlayer(playerState, settings, content, "spring", "s1", "u1");
		const page = generateOrderPageForPlayer({
			playerState,
			settings,
			content,
			activeSeason: "spring",
			serverId: "s1",
			userId: "u1",
			page: 0,
			pageSize: 1
		});
		const first = page.orders[0];
		playerState.orders.accepted[first.order_id] = {
			accepted_at: day1,
			order: {
				order_id: first.order_id,
				order_index: first.order_index,
				recipe_id: first.recipe_id,
				tier: first.tier,
				npc_archetype: first.npc_archetype
			}
		};
		markOrderConsumed(playerState, 0);
		markOrderConsumed(playerState, 2);
	});

	assert.equal(Object.keys(playerState.orders.accepted).length, 1);
	assert.deepEqual(playerState.orders_consumed_indices, [0, 2]);

	withMockedNow(day2, () => {
		ensureDailyOrdersForPlayer(playerState, settings, content, "spring", "s1", "u1");
	});

	assert.deepEqual(playerState.orders_consumed_indices, []);
	assert.equal(Object.keys(playerState.orders.accepted).length, 0);
});

test("Orders: consumed indices are trimmed to valid range when board count shrinks", () => {
	const day = Date.UTC(2026, 3, 21, 12, 0, 0, 0);
	const playerState = {
		shop_level: 1,
		rep: 0,
		coins: 0,
		known_recipes: ["classic_soy_ramen", "veggie_ramen"],
		orders: { accepted: {} },
		orders_consumed_indices: []
	};

	withMockedNow(day, () => {
		ensureDailyOrdersForPlayer(playerState, settings, content, "spring", "s1", "u1");
	});

	playerState.orders_consumed_indices = [0, 1, 3, 4, 9];
	const smallerSettings = { ...settings, ORDERS_BASE_COUNT: 3 };

	withMockedNow(day, () => {
		ensureDailyOrdersForPlayer(playerState, smallerSettings, content, "spring", "s1", "u1");
	});

	assert.equal(playerState.orders_total_count, 3);
	assert.deepEqual(playerState.orders_consumed_indices, [0, 1]);
	markOrderConsumed(playerState, 99);
	assert.deepEqual(playerState.orders_consumed_indices, [0, 1]);
});
