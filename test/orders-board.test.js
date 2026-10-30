import { strict as assert } from "assert";
import { test } from "node:test";

import {
	ensureDailyOrdersForPlayer,
	ensureUnlimitedOrdersBuffer,
	generateOrderPageForPlayer,
	findOrderByToken,
	getOrdersMeta,
	isOrderBoardExhausted,
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

test("Orders: tutorial boards never generate limited-time orders", () => {
	const timedSettings = { ...settings, LIMITED_TIME_CHANCE: 1 };
	const playerState = {
		shop_level: 1,
		rep: 0,
		coins: 0,
		known_recipes: ["classic_soy_ramen", "veggie_ramen"],
		tutorial: {
			active: true,
			queue: ["intro_serve"],
			completed: ["intro_order", "intro_market", "intro_forage", "intro_cook"]
		},
		orders_consumed_indices: []
	};

	ensureDailyOrdersForPlayer(playerState, timedSettings, content, "spring", "s1", "u1");
	const page = generateOrderPageForPlayer({
		playerState,
		settings: timedSettings,
		content,
		activeSeason: "spring",
		serverId: "s1",
		userId: "u1",
		page: 0,
		pageSize: 10
	});

	assert.ok(page.orders.length > 0);
	assert.ok(page.orders.every((order) => order.is_limited_time === false));
	assert.ok(page.orders.every((order) => order.expires_at === null));

	const regularPlayer = {
		...playerState,
		tutorial: { active: false, queue: [], completed: [] },
		orders: { accepted: {} },
		orders_day: null,
		orders_seed: null,
		orders_consumed_indices: []
	};
	ensureDailyOrdersForPlayer(regularPlayer, timedSettings, content, "spring", "s1", "u2");
	const regularPage = generateOrderPageForPlayer({
		playerState: regularPlayer,
		settings: timedSettings,
		content,
		activeSeason: "spring",
		serverId: "s1",
		userId: "u2",
		page: 0,
		pageSize: 10
	});
	assert.ok(regularPage.orders.some((order) => order.is_limited_time === true));
});

test("Orders: day rollover preserves accepted tutorial orders", () => {
	const day1 = Date.UTC(2026, 3, 21, 10, 0, 0, 0);
	const day2 = day1 + (24 * 60 * 60 * 1000);
	const playerState = {
		shop_level: 1,
		rep: 0,
		coins: 0,
		known_recipes: ["classic_soy_ramen", "veggie_ramen"],
		tutorial: { active: true, queue: ["intro_serve"], completed: [] },
		orders: {
			accepted: {
				"2026-04-21-o0-123": {
					accepted_at: day1,
					expires_at: null,
					order: { order_id: "2026-04-21-o0-123", order_index: 0, recipe_id: "classic_soy_ramen" }
				}
			}
		},
		orders_day: "2026-04-21",
		orders_seed: "s1-u1-day-2026-04-21",
		order_seed_version: 5,
		orders_consumed_indices: [0]
	};

	withMockedNow(day2, () => {
		ensureDailyOrdersForPlayer(playerState, settings, content, "spring", "s1", "u1");
	});

	assert.equal(Object.keys(playerState.orders.accepted).length, 1);
	assert.deepEqual(playerState.orders_consumed_indices, []);
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

test("Orders: temporary recipe pool changes keep consumed progress mid-day", () => {
	const playerState = {
		shop_level: 1,
		rep: 0,
		coins: 0,
		known_recipes: ["classic_soy_ramen", "veggie_ramen"],
		resilience: { temp_recipes: ["simple_broth"] },
		orders_consumed_indices: []
	};

	ensureDailyOrdersForPlayer(playerState, settings, content, "spring", "s1", "u1");
	markOrderConsumed(playerState, 0);
	markOrderConsumed(playerState, 2);

	const duringRescue = getOrdersMeta(playerState);
	assert.equal(duringRescue.totalCount, 5);
	assert.equal(duringRescue.availableCount, 3);

	playerState.resilience.temp_recipes = [];
	ensureDailyOrdersForPlayer(playerState, settings, content, "spring", "s1", "u1");

	const afterRecovery = getOrdersMeta(playerState);
	assert.equal(afterRecovery.totalCount, 5);
	assert.equal(afterRecovery.availableCount, 3);
	assert.deepEqual(playerState.orders_consumed_indices, [0, 2]);
});

test("Orders: unavailable menu recipes fall back to learned recipes and rescue recipes take priority", () => {
	const seasonalContent = {
		recipes: {
			classic_soy_ramen: { recipe_id: "classic_soy_ramen", tier: "common" },
			summer_special: { recipe_id: "summer_special", tier: "seasonal", season: "summer" },
			simple_broth: { recipe_id: "simple_broth", tier: "common" }
		},
		npcs: { traveler: { npc_id: "traveler", rarity: "common" } }
	};
	const playerState = {
		known_recipes: ["classic_soy_ramen"],
		daily_order_menu_recipe_ids: ["summer_special"],
		orders_consumed_indices: []
	};
	ensureDailyOrdersForPlayer(playerState, settings, seasonalContent, "winter", "s1", "menu-user");
	const fallbackOrders = generateOrderPageForPlayer({
		playerState,
		settings,
		content: seasonalContent,
		activeSeason: "winter",
		serverId: "s1",
		userId: "menu-user",
		pageSize: 10
	}).orders;
	assert.ok(fallbackOrders.length > 0);
	assert.ok(fallbackOrders.every((order) => order.recipe_id === "classic_soy_ramen"));

	playerState.resilience = { temp_recipes: ["simple_broth"] };
	ensureDailyOrdersForPlayer(playerState, settings, seasonalContent, "winter", "s1", "menu-user");
	const rescueOrders = generateOrderPageForPlayer({
		playerState,
		settings,
		content: seasonalContent,
		activeSeason: "winter",
		serverId: "s1",
		userId: "menu-user",
		pageSize: 10
	}).orders;
	assert.ok(rescueOrders.length > 0);
	assert.ok(rescueOrders.every((order) => order.recipe_id === "simple_broth"));
});

test("Orders: a depleted board provides a tutorial-only replay order without restoring regular availability", () => {
	const dayKey = "2026-10-30";
	const playerState = {
		known_recipes: ["classic_soy_ramen"],
		tutorial: { active: true, queue: ["intro_order"], completed: [] },
		orders_day: dayKey,
		orders_seed: "s1-user-day",
		order_seed_version: 5,
		orders_total_count: 5,
		orders_consumed_indices: [0, 1, 2, 3, 4],
		orders_depleted_day: dayKey,
		orders: { accepted: {} }
	};
	const meta = getOrdersMeta(playerState);
	assert.equal(meta.availableCount, 1);
	assert.equal(meta.tutorialReplayAvailable, true);

	const replay = generateOrderPageForPlayer({
		playerState,
		settings,
		content,
		activeSeason: "spring",
		serverId: "s1",
		userId: "user",
		pageSize: 10
	}).orders[0];
	assert.ok(replay);
	assert.equal(replay.recipe_id, "classic_soy_ramen");
	assert.equal(findOrderByToken({
		playerState,
		settings,
		content,
		activeSeason: "spring",
		serverId: "s1",
		userId: "user",
		token: replay.order_id
	})?.order_id, replay.order_id);
	assert.equal(findOrderByToken({
		playerState,
		settings,
		content,
		activeSeason: "spring",
		serverId: "s1",
		userId: "user",
		token: "TR0001"
	})?.order_id, replay.order_id);
	assert.deepEqual(playerState.orders_consumed_indices, [0, 1, 2, 3, 4]);
	assert.equal(playerState.orders_depleted_day, dayKey);

	playerState.tutorial.active = false;
	assert.equal(getOrdersMeta(playerState).availableCount, 0);
	assert.deepEqual(generateOrderPageForPlayer({
		playerState,
		settings,
		content,
		activeSeason: "spring",
		serverId: "s1",
		userId: "user",
		pageSize: 10
	}).orders, []);
});

test("Orders: accepted-but-unserved orders do not permanently deplete the board", () => {
	const dayKey = "2026-10-30";
	const accept = (index) => ({ order: { order_index: index, order_id: `${dayKey}-o${index}-1` } });
	const playerState = {
		known_recipes: ["classic_soy_ramen"],
		orders_day: dayKey,
		orders_total_count: 4,
		orders_consumed_indices: [0],
		orders: { accepted: { a1: accept(1), a2: accept(2), a3: accept(3) } }
	};
	assert.equal(getOrdersMeta(playerState).availableCount, 0);
	assert.equal(isOrderBoardExhausted(playerState), false);

	delete playerState.orders.accepted.a3;
	assert.equal(getOrdersMeta(playerState).availableCount, 1);
	assert.equal(isOrderBoardExhausted(playerState), false);

	markOrderConsumed(playerState, 1);
	markOrderConsumed(playerState, 2);
	assert.equal(isOrderBoardExhausted(playerState), false);
	markOrderConsumed(playerState, 3);
	assert.equal(isOrderBoardExhausted(playerState), true);
	assert.equal(playerState.orders_depleted_day, dayKey);
	assert.equal(isOrderBoardExhausted({ orders_total_count: 0, orders_consumed_indices: [] }), false);
});

test("Orders: tutorial replay is offered when accepted orders occupy every remaining slot", () => {
	const dayKey = "2026-10-30";
	const playerState = {
		known_recipes: ["classic_soy_ramen"],
		tutorial: { active: true, queue: ["intro_order"], completed: [] },
		orders_day: dayKey,
		orders_total_count: 2,
		orders_consumed_indices: [0],
		orders: { accepted: { a1: { order: { order_index: 1, order_id: `${dayKey}-o1-1` } } } }
	};
	const meta = getOrdersMeta(playerState);
	assert.equal(meta.tutorialReplayAvailable, true);
	assert.equal(meta.availableCount, 1);
	assert.equal(meta.depletedForCurrentDay, false);

	playerState.tutorial.queue = ["intro_market"];
	assert.equal(getOrdersMeta(playerState).availableCount, 0);
	assert.equal(getOrdersMeta({ ...playerState, orders_total_count: 0, tutorial: { active: true, queue: ["intro_order"] } }).tutorialReplayAvailable, false);
});

test("Orders: depleted day marker keeps board complete for the rest of the day", () => {
	const playerState = {
		shop_level: 1,
		rep: 0,
		coins: 0,
		known_recipes: ["classic_soy_ramen", "veggie_ramen"],
		orders_consumed_indices: []
	};

	ensureDailyOrdersForPlayer(playerState, settings, content, "spring", "s1", "u1");
	playerState.orders_depleted_day = playerState.orders_day;
	playerState.orders_consumed_indices = [];

	const meta = getOrdersMeta(playerState);
	assert.equal(meta.availableCount, 0);

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
	assert.equal(page.availableCount, 0);
	assert.deepEqual(page.orders, []);

	const tokenMatch = findOrderByToken({
		playerState,
		settings,
		content,
		activeSeason: "spring",
		serverId: "s1",
		userId: "u1",
		token: "ABCD"
	});
	assert.equal(tokenMatch, null);
});

test("Orders: unlimited buffer keeps at least 10 pages available", () => {
	const playerState = {
		orders_total_count: 260,
		orders_consumed_indices: Array.from({ length: 30 }, (_, idx) => idx),
		orders_day: "20260725",
		orders_depleted_day: null
	};

	const result = ensureUnlimitedOrdersBuffer(playerState, { minVisibleOrders: 250 });

	assert.equal(result.changed, true);
	assert.equal(playerState.orders_total_count, 280);
	assert.equal(result.availableCount, 250);
});
