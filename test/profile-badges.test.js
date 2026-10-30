import test from "node:test";
import assert from "node:assert/strict";
import { newPlayerProfile } from "../src/game/player.js";
import {
  ensureDisplayedProfileBadges,
  getDefaultDisplayedProfileBadges,
  PROFILE_BADGE_CATEGORIES,
  PROFILE_BADGE_ROW_LIMIT,
  toggleDisplayedProfileBadge
} from "../src/game/profileBadges.js";
import { buildProfileBadgesV2Message, getProfileBadgePage } from "../src/ui/profileBadgesV2.js";
import { buildProfileEditV2Message } from "../src/ui/profileFlowV2.js";
import { renderProfileEmbed } from "../src/commands/noodle.js";

const eligible = {
  badges: Array.from({ length: 10 }, (_, index) => `badge_${index}`),
  achievements: Array.from({ length: 9 }, (_, index) => `achievement_${index}`),
  collections: ["collection_1", "collection_2"]
};

test("Profile badge rows initialize with eligible badges and enforce seven per category", () => {
  const player = newPlayerProfile("profile-badge-user");
  player.profile.featured_badge_id = "badge_8";
  const displayed = ensureDisplayedProfileBadges(player, eligible);

  assert.deepEqual(PROFILE_BADGE_CATEGORIES, ["badges", "achievements", "collections"]);
  assert.equal(displayed.badges.length, PROFILE_BADGE_ROW_LIMIT);
  assert.equal(displayed.badges[0], "badge_8");
  assert.equal(displayed.achievements.length, PROFILE_BADGE_ROW_LIMIT);
  assert.deepEqual(displayed.collections, eligible.collections);

  assert.deepEqual(toggleDisplayedProfileBadge(player, "badges", "badge_8", eligible), { ok: true, equipped: false });
  assert.deepEqual(toggleDisplayedProfileBadge(player, "badges", "badge_9", eligible), { ok: true, equipped: true });
  assert.equal(toggleDisplayedProfileBadge(player, "badges", "badge_6", eligible).reason, "row_full");
  assert.equal(player.profile.displayed_badges.badges.length, PROFILE_BADGE_ROW_LIMIT);
});

test("Profile badge display cleans stale selections and does not equip unearned items", () => {
  const player = newPlayerProfile("profile-badge-stale-user");
  player.profile.displayed_badges = {
    badges: ["badge_1", "missing", "badge_1"],
    achievements: ["achievement_2", "not_unlocked"],
    collections: ["collection_2"]
  };
  const displayed = ensureDisplayedProfileBadges(player, eligible);

  assert.deepEqual(displayed.badges, ["badge_1"]);
  assert.deepEqual(displayed.achievements, ["achievement_2"]);
  assert.deepEqual(displayed.collections, ["collection_2"]);
  assert.equal(toggleDisplayedProfileBadge(player, "collections", "not_completed", eligible).reason, "not_eligible");
  assert.deepEqual(getDefaultDisplayedProfileBadges(player, eligible), displayed);
});

test("Badges menu provides category tabs, equipped state, pagination, and Customize-only entry", () => {
  const userId = "12345678901234567";
  const entries = Array.from({ length: 12 }, (_, index) => ({
    id: `achievement_${index}`,
    name: `Achievement ${index}`,
    description: "Achievement badge placeholder."
  }));
  const page = getProfileBadgePage(entries, 1);
  const payload = buildProfileBadgesV2Message({
    userId,
    category: "achievements",
    entries: page.entries,
    selectedIds: ["achievement_10"],
    page: page.page,
    totalPages: page.totalPages
  });
  const components = payload.components[0].components;
  const text = JSON.stringify(components);

  assert.match(text, /1\/7 equipped in \*\*Achievements\*\*/);
  assert.match(text, /Page 2\/2/);
  assert.match(text, /achievement_10/);
  assert.match(text, /badge_category:12345678901234567:collections/);
  assert.match(text, /badge_toggle:12345678901234567:achievements:achievement_10/);
  assert.match(text, /Select the badges you want to display on your profile!/);
  assert.equal((text.match(/1\/7 equipped in \*\*Achievements\*\*/g) ?? []).length, 1);
  assert.match(text, /-# Page 2\/2/);
  assert.doesNotMatch(text, /Page 2\/2 • 1\/7 equipped/);

  for (const [category, count] of [["badges", 2], ["collections", 3]]) {
    const categoryPayload = buildProfileBadgesV2Message({
      userId,
      category,
      selectedIds: Array.from({ length: count }, (_, index) => `${category}_${index}`)
    });
    assert.ok(JSON.stringify(categoryPayload.components[0].components)
      .includes(`${count}/7 equipped in **${category[0].toUpperCase()}${category.slice(1)}**`));
  }

  const customize = buildProfileEditV2Message({ userId });
  assert.match(JSON.stringify(customize), /noodle:nav:badges:12345678901234567/);
});

test("Profile renders separate badge, achievement, and collection rows capped at seven", () => {
  const player = newPlayerProfile("profile-display-user");
  player.profile.badges = ["bowl_100", "bowl_250", "bowl_500", "bowl_1000", "bowl_2500", "bowl_5000", "bowl_10000"];
  const achievementIds = [
    "a_familiar_face",
    "a_bustling_shop",
    "beloved_by_all",
    "a_legendary_welcome",
    "first_savings",
    "a_comfortable_living",
    "prosperous_proprietor",
    "a_fortune_in_broth"
  ];
  player.achievements = {
    unlocked: Object.fromEntries(achievementIds.map((id) => [id, {}])),
    claimed_ids: []
  };
  player.collections.completed = [
    "npc_codex",
    "recipe_codex_common",
    "recipe_codex_rare",
    "recipe_codex_epic",
    "recipe_codex_seasonal",
    "recipe_codex_all",
    "bowl_ledger"
  ];
  player.profile.displayed_badges = {
    badges: player.profile.badges,
    achievements: Object.keys(player.achievements.unlocked),
    collections: player.collections.completed
  };

  const embed = renderProfileEmbed(player, "Chef", null, null);
  const fields = new Map(embed.fields.map((field) => [field.name.replace(/^.*?\s/, ""), field.value]));
  const countBadges = (text) => (text.match(/<a?:[^:]+:\d+>/g) ?? []).length;

  assert.equal(countBadges(fields.get("Badges")), PROFILE_BADGE_ROW_LIMIT);
  assert.equal(countBadges(fields.get("Achievements")), PROFILE_BADGE_ROW_LIMIT);
  assert.equal(countBadges(fields.get("Collections")), PROFILE_BADGE_ROW_LIMIT);
});
