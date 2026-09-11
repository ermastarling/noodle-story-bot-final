import test from "node:test";
import assert from "node:assert/strict";

import { noodleDevCommand } from "../src/commands/noodleDev.js";
import { runNoodle } from "../src/commands/noodle.js";
import { setPlayerShopLevel } from "../src/game/serve.js";
import { unlockSpecialization } from "../src/game/specialization.js";
import { getKitchenUnlockState, KITCHEN_UNLOCK_LEVEL } from "../src/game/kitchen.js";
import { unlockRecipeForPlayer } from "../src/game/discovery.js";

test("noodle-dev command schema includes admin control group", () => {
  const schema = noodleDevCommand.data.toJSON();
  const adminGroup = (schema.options ?? []).find((option) => option.name === "admin");

  assert.ok(adminGroup, "Expected admin subcommand group to exist");
  assert.equal(adminGroup.type, 2);

  const adminSubNames = (adminGroup.options ?? []).map((option) => option.name).sort();
  assert.deepEqual(adminSubNames, ["recipe", "season_event", "spec", "stat"]);

  const specSub = (adminGroup.options ?? []).find((option) => option.name === "spec");
  const recipeSub = (adminGroup.options ?? []).find((option) => option.name === "recipe");
  const seasonEventSub = (adminGroup.options ?? []).find((option) => option.name === "season_event");
  const specIdOption = (specSub?.options ?? []).find((option) => option.name === "spec_id");
  const recipeIdOption = (recipeSub?.options ?? []).find((option) => option.name === "recipe_id");
  const eventIdOption = (seasonEventSub?.options ?? []).find((option) => option.name === "event_id");

  assert.equal(specIdOption?.autocomplete, true);
  assert.equal(recipeIdOption?.autocomplete, true);
  assert.equal(eventIdOption?.autocomplete, true);
});

test("noodle-dev admin recipe autocomplete includes event recipes", async () => {
  const responses = [];
  const interaction = {
    options: {
      getSubcommandGroup: () => "admin",
      getSubcommand: () => "recipe",
      getFocused: () => ({ name: "recipe_id", value: "spring_blossoms_" })
    },
    respond: async (items) => {
      responses.push(items);
    }
  };

  await noodleDevCommand.autocomplete(interaction);

  const values = (responses[0] ?? []).map((item) => String(item.value || ""));
  assert.equal(values.some((value) => value.startsWith("spring_blossoms_")), true);
});

test("noodle-dev admin season_event autocomplete includes all configured events", async () => {
  const responses = [];
  const interaction = {
    options: {
      getSubcommandGroup: () => "admin",
      getSubcommand: () => "season_event",
      getFocused: () => ({ name: "event_id", value: "summer" })
    },
    respond: async (items) => {
      responses.push(items);
    }
  };

  await noodleDevCommand.autocomplete(interaction);

  const values = (responses[0] ?? []).map((item) => String(item.value || ""));
  assert.equal(values.includes("summer_solstice"), true);
});

test("runNoodle dev slash retries defer after token-unavailable and hydrates client token", async () => {
  const previousToken = process.env.DISCORD_TOKEN;
  process.env.DISCORD_TOKEN = "token-from-env";

  let deferCalls = 0;
  let editReplyCalls = 0;
  let replyCalls = 0;
  const interaction = {
    guildId: "guild-1",
    user: { id: "user-not-admin", tag: "user-not-admin#0001" },
    member: { id: "user-not-admin", user: { id: "user-not-admin", tag: "user-not-admin#0001" } },
    client: {
      token: "",
      user: { id: "bot-1", tag: "bot#0001" },
      guilds: { cache: new Map() }
    },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    isCommand: () => false,
    deferReply: async ({ ephemeral } = {}) => {
      deferCalls += 1;
      if (deferCalls === 1) {
        const error = new Error("Request to use token, but token was unavailable to the client.");
        error.code = 500;
        throw error;
      }
      interaction.deferred = true;
      interaction.ephemeral = Boolean(ephemeral);
      return { ok: true };
    },
    editReply: async (payload) => {
      editReplyCalls += 1;
      return { ok: true, payload };
    },
    reply: async (payload) => {
      replyCalls += 1;
      return { ok: true, payload };
    }
  };

  try {
    await runNoodle(interaction, { sub: "status", group: "dev" });
  } finally {
    if (previousToken === undefined) delete process.env.DISCORD_TOKEN;
    else process.env.DISCORD_TOKEN = previousToken;
  }

  assert.equal(deferCalls, 2);
  assert.equal(interaction.client.token, "token-from-env");
  assert.equal(editReplyCalls, 1);
  assert.equal(replyCalls, 0);
});

test("runNoodle dev slash falls back to reply when defer cannot be recovered", async () => {
  const previousToken = process.env.DISCORD_TOKEN;
  process.env.DISCORD_TOKEN = "token-from-env";

  let deferCalls = 0;
  let editReplyCalls = 0;
  let replyCalls = 0;
  const interaction = {
    guildId: "guild-1",
    user: { id: "user-not-admin", tag: "user-not-admin#0001" },
    member: { id: "user-not-admin", user: { id: "user-not-admin", tag: "user-not-admin#0001" } },
    client: {
      token: "",
      user: { id: "bot-1", tag: "bot#0001" },
      guilds: { cache: new Map() }
    },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    isCommand: () => false,
    deferReply: async () => {
      deferCalls += 1;
      const error = new Error("Request to use token, but token was unavailable to the client.");
      error.code = 500;
      throw error;
    },
    editReply: async (payload) => {
      editReplyCalls += 1;
      return { ok: true, payload };
    },
    reply: async (payload) => {
      replyCalls += 1;
      return { ok: true, payload };
    }
  };

  try {
    await runNoodle(interaction, { sub: "status", group: "dev" });
  } finally {
    if (previousToken === undefined) delete process.env.DISCORD_TOKEN;
    else process.env.DISCORD_TOKEN = previousToken;
  }

  assert.equal(deferCalls, 2);
  assert.equal(interaction.client.token, "token-from-env");
  assert.equal(editReplyCalls, 0);
  assert.equal(replyCalls, 1);
});

test("setPlayerShopLevel reconciles shop level and SXP state", () => {
  const player = {
    shop_level: 1,
    sxp_total: 0,
    sxp_progress: 0
  };

  const result = setPlayerShopLevel(player, 4);

  assert.equal(result.targetLevel, 4);
  assert.equal(result.leveled, 3);
  assert.equal(player.shop_level, 4);
  assert.equal(player.sxp_progress, 0);
  assert.equal(player.sxp_total, result.totalRequiredSxp);
  assert.ok(player.sxp_total > 0);
});

test("setPlayerShopLevel re-arms kitchen unlock notice after lowering below threshold", () => {
  const player = {
    shop_level: KITCHEN_UNLOCK_LEVEL,
    sxp_total: 0,
    sxp_progress: 0,
    kitchen: {
      active_batches: [],
      unlock_seen_level: KITCHEN_UNLOCK_LEVEL
    }
  };

  setPlayerShopLevel(player, KITCHEN_UNLOCK_LEVEL - 1);
  assert.equal(player.shop_level, KITCHEN_UNLOCK_LEVEL - 1);
  assert.ok((player.kitchen?.unlock_seen_level ?? 0) < KITCHEN_UNLOCK_LEVEL);

  setPlayerShopLevel(player, KITCHEN_UNLOCK_LEVEL);
  const unlockState = getKitchenUnlockState(player);

  assert.equal(unlockState.unlocked, true);
  assert.equal(unlockState.justUnlocked, true);
});

test("unlockSpecialization adds unique ids without touching seen state", () => {
  const player = {
    shop_level: 12,
    profile: {
      specialization: {
        active_spec_id: null,
        chosen_at: null,
        change_cooldown_expires_at: null,
        unlocked_spec_ids: ["spec_a"],
        last_seen_shop_level: 12,
        seen_unlocked_spec_ids: ["spec_a"]
      }
    }
  };

  const first = unlockSpecialization(player, "spec_a");
  const second = unlockSpecialization(player, "spec_b");

  assert.equal(first.added, false);
  assert.equal(second.added, true);
  assert.deepEqual(player.profile.specialization.unlocked_spec_ids, ["spec_a", "spec_b"]);
  assert.deepEqual(player.profile.specialization.seen_unlocked_spec_ids, ["spec_a"]);
  assert.equal(player.profile.specialization.active_spec_id, null);
});

test("unlockRecipeForPlayer validates and dedupes known recipes", () => {
  const content = {
    recipes: {
      simple_broth: { name: "Simple Broth" }
    }
  };
  const player = {
    known_recipes: [],
    clues_owned: {
      simple_broth: { count: 1 }
    }
  };

  const first = unlockRecipeForPlayer(player, content, "simple_broth");
  const second = unlockRecipeForPlayer(player, content, "simple_broth");

  assert.equal(first.ok, true);
  assert.equal(first.added, true);
  assert.deepEqual(player.known_recipes, ["simple_broth"]);
  assert.equal(player.clues_owned.simple_broth, undefined);

  assert.equal(second.ok, true);
  assert.equal(second.added, false);
  assert.deepEqual(player.known_recipes, ["simple_broth"]);
});