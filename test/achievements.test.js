import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newPlayerProfile } from "../src/game/player.js";
import { buildAchievementsV2Message } from "../src/ui/achievementsV2.js";
import { buildComponentsV2NoticeCardPayload } from "../src/ui/componentsV2.js";
import { applyQuestProgress, ensureQuests } from "../src/game/quests.js";
import { grantBlessing } from "../src/game/social.js";
import {
  ACHIEVEMENTS_PER_PAGE,
  claimAchievementReward,
  evaluatePlayerAchievements,
  getAchievementPage,
  getVisibleAchievements,
  validateAchievementsContent
} from "../src/game/achievements.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const content = JSON.parse(fs.readFileSync(path.join(__dirname, "../content/achievements.json"), "utf8"));
const specializationsContent = JSON.parse(fs.readFileSync(path.join(__dirname, "../content/specializations.json"), "utf8"));

function countComponentsDeep(component) {
  if (!component || typeof component !== "object") return 0;
  return 1
    + (component.components ?? []).reduce((sum, child) => sum + countComponentsDeep(child), 0)
    + (component.accessory ? countComponentsDeep(component.accessory) : 0);
}

test("Achievement pages keep the menu compact and expose every visible achievement exactly once", () => {
  const visible = getVisibleAchievements(newPlayerProfile("achievement-pages"), content);
  const totalPages = Math.ceil(visible.length / ACHIEVEMENTS_PER_PAGE);
  const pages = Array.from({ length: totalPages }, (_, page) => getAchievementPage(visible, page));
  const listed = pages.flatMap((page) => page.entries);

  assert.ok(visible.length > ACHIEVEMENTS_PER_PAGE);
  assert.equal(pages.length, totalPages);
  assert.ok(pages.every((page) => page.entries.length <= ACHIEVEMENTS_PER_PAGE));
  assert.deepEqual(listed.map((entry) => entry.achievement_id), visible.map((entry) => entry.achievement_id));
  assert.ok(pages.every((page) => page.entries.map((entry) =>
    `• **${entry.name}** — Ready to claim\n  ${entry.description}`
  ).join("\n\n").length < 4096));
  assert.deepEqual(getAchievementPage(visible, 999).entries, pages.at(-1).entries);
  assert.equal(getAchievementPage([], 0).totalPages, 1);
});

test("A full claimable-achievement page stays within Discord's component limit", () => {
  const entries = Array.from({ length: ACHIEVEMENTS_PER_PAGE }, (_, index) => ({
    achievement_id: `claimable_${index}`,
    name: `Claimable ${index}`,
    description: "Ready to claim."
  }));
  const payload = buildAchievementsV2Message({
    userId: "12345678901234567",
    entries,
    unlocked: Object.fromEntries(entries.map((entry) => [entry.achievement_id, { unlocked_at: 1 }])),
    visibleCount: entries.length
  });
  const count = payload.components.reduce((sum, component) => sum + countComponentsDeep(component), 0);
  assert.equal(entries.length, 9);
  assert.ok(count <= 40, `expected at most 40 components, received ${count}`);
});

test("Achievement notice cards use the achievement banner and point to the achievements command", () => {
  const player = newPlayerProfile("achievement-notice-user");
  player.lifetime.coins_earned = 25_000;
  const result = evaluatePlayerAchievements(player, content, Date.now());
  const notice = player.notifications.pending_v2_notice_cards
    .find((entry) => entry.title.startsWith("Achievement unlocked:"));
  assert.ok(result.unlocked.length > 0);
  assert.ok(notice?.details.some((line) => line.includes("/noodle achievements")));

  const payload = buildComponentsV2NoticeCardPayload({
    title: notice.title,
    details: notice.details,
    tone: notice.tone
  });
  assert.match(JSON.stringify(payload), /Achievements\.png/);
});

test("Achievements container places claim actions inline and keeps pagination with the owner footer", () => {
  const userId = "12345678901234567";
  const payload = buildAchievementsV2Message({
    userId,
    entries: [
      { achievement_id: "ready", name: "Ready Achievement", description: "Ready description." },
      { achievement_id: "claimed", name: "Claimed Achievement", description: "Claimed description." }
    ],
    page: 1,
    totalPages: 3,
    visibleCount: 22,
    category: "in_progress",
    inProgressCount: 18,
    claimedCount: 4,
    unlocked: { ready: { unlocked_at: 1 }, claimed: { unlocked_at: 1 } },
    claimedIds: ["claimed"]
  });

  const nodes = [];
  const visit = (items) => {
    for (const item of items ?? []) {
      nodes.push(item);
      visit(item.components);
      if (item.accessory) visit([item.accessory]);
    }
  };
  visit(payload.components);

  assert.equal((payload.flags & (1 << 15)) !== 0, true);
  assert.ok(nodes.some((node) => node.type === 9 && node.accessory?.label === "Claim"
    && node.accessory.custom_id === `noodle:action:achievement_claim:${userId}:ready:in_progress:1`
    && node.accessory.emoji?.name === "daily_reward"));
  assert.equal(nodes.some((node) => node.type === 3), false);
  assert.ok(nodes.some((node) => node.type === 10
    && node.content.includes("-# Page 2/3 • 22 in progress achievements • Menu owner: <@12345678901234567> • Tip: Tap the green button(s) to continue.")));
  assert.ok(nodes.some((node) => node.type === 2 && node.label === "Previous"
    && node.custom_id === `noodle:nav:achievements:${userId}:0:in_progress`));
  assert.ok(nodes.some((node) => node.type === 2 && node.label === "Next"
    && node.custom_id === `noodle:nav:achievements:${userId}:2:in_progress`));
  const categoryRow = nodes.find((node) => node.type === 1
    && node.components?.some((button) => button.custom_id === `noodle:action:achievement_category:${userId}:claimed`));
  const navigationRow = nodes.find((node) => node.type === 1
    && node.components?.some((button) => button.label === "Previous"));
  assert.ok(categoryRow);
  assert.ok(navigationRow);
  assert.ok(nodes.indexOf(categoryRow) < nodes.indexOf(navigationRow));
});

test("Achievements evaluate requested progression categories and deduplicate unlocks", () => {
  const player = newPlayerProfile("achievement-user");
  player.created_at = 1;
  player.lifetime.npc_seen = { npc_a: true, npc_b: true, npc_c: true, npc_d: true, npc_e: true };
  player.lifetime.coins_earned = 25_000;
  player.lifetime.fish_caught = 100;
  player.lifetime.coins_tipped_out = 5_000;
  player.lifetime.coins_tipped_in = 1;
  player.lifetime.quests_completed_by_type = { daily: 10, weekly: 5 };
  player.lifetime.shared_order_ids = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`order-${i}`, true]));
  player.daily.streak_days = 7;
  const first = evaluatePlayerAchievements(player, content, 100_000_000);
  assert.ok(first.unlocked.some((entry) => entry.achievement_id === "a_familiar_face"));
  assert.ok(first.unlocked.some((entry) => entry.achievement_id === "first_savings"));
  assert.ok(first.unlocked.some((entry) => entry.achievement_id === "a_patient_cast"));
  assert.ok(first.unlocked.some((entry) => entry.achievement_id === "the_first_offering"));
  assert.ok(first.unlocked.some((entry) => entry.achievement_id === "a_helping_hand"));
  assert.ok(first.retroactiveNotice);
  assert.equal(player.notifications.pending_v2_notice_cards.length, 1);
  assert.deepEqual(evaluatePlayerAchievements(player, content, 100_000_001).unlocked, []);
});

test("Quest and blessing events update the achievement counters", () => {
  const player = newPlayerProfile("achievement-tracking-user");
  const now = Date.now();
  const emptyQuests = {
    counts: { daily: 0, weekly: 0, monthly: 0, story: 0, seasonal: 0 },
    quests: []
  };
  ensureQuests(player, emptyQuests, player.user_id, now);
  player.quests.active.test_daily = {
    instance_id: "test_daily",
    quest_id: "test_daily",
    cadence: "daily",
    type: "test_event",
    target: 1,
    progress: 0,
    completed_at: null
  };
  const completed = applyQuestProgress(player, emptyQuests, player.user_id, { type: "test_event" }, now);
  assert.equal(completed.length, 1);
  assert.equal(player.lifetime.quests_completed_by_type.daily, 1);

  const blessed = newPlayerProfile("blessed-player");
  grantBlessing(blessed, "host-player", "discovery_chance_add");
  assert.equal(blessed.lifetime.blessings_received, 1);
});

test("Hidden specialization achievements stay hidden until unlocked and rewards are claimable once", () => {
  const player = newPlayerProfile("achievement-secret-user");
  evaluatePlayerAchievements(player, content, Date.now());
  const hiddenSpecializations = specializationsContent.specializations
    .filter((specialization) => specialization.hidden_until_unlocked);
  const hiddenAchievementIds = content.achievements
    .filter((achievement) => achievement.category === "hidden_specializations")
    .map((achievement) => achievement.criteria.value);

  assert.equal(content.achievements.some((achievement) => achievement.achievement_id === "the_night_owl"), false);
  assert.deepEqual(new Set(hiddenAchievementIds), new Set(hiddenSpecializations.map((specialization) => specialization.spec_id)));
  assert.ok(getVisibleAchievements(player, content)
    .every((achievement) => achievement.category !== "hidden_specializations"));

  player.profile.specialization.unlocked_spec_ids.push("golden_hearth");
  const unlocked = evaluatePlayerAchievements(player, content, Date.now() + 1);
  assert.ok(unlocked.unlocked.some((achievement) => achievement.achievement_id === "golden_hearth_revealed"));
  assert.ok(getVisibleAchievements(player, content)
    .some((achievement) => achievement.achievement_id === "golden_hearth_revealed"));

  const coinsBefore = player.coins;
  const claim = claimAchievementReward(player, "golden_hearth_revealed", content);
  assert.equal(claim.ok, true);
  assert.equal(player.coins, coinsBefore + 500);
  assert.equal(claimAchievementReward(player, "golden_hearth_revealed", content).reason, "already_claimed");
  assert.equal(player.coins, coinsBefore + 500);
});

test("Retroactive achievement scan emits one shortened notice for existing profiles", () => {
  const player = newPlayerProfile("retro-user");
  player.created_at = 100;
  player.lifetime.bowls_served_total = 100;
  const result = evaluatePlayerAchievements(player, content, 10_000_000_000);
  assert.equal(result.retroactiveNotice, true);
  assert.equal(player.notifications.pending_v2_notice_cards.length, 1);
  assert.equal(player.notifications.pending_v2_notice_cards[0].details.length, 1);
});

test("Approved gardening and broth achievements unlock from lifetime metrics", () => {
  const player = newPlayerProfile("garden-broth-achievement-user");
  player.created_at = Date.now();
  player.lifetime.garden_items_harvested = 100;
  player.lifetime.broth_servings_simmered = 100;

  const result = evaluatePlayerAchievements(player, content, Date.now());
  assert.ok(result.unlocked.some((entry) => entry.achievement_id === "sprout_of_promise"));
  assert.ok(result.unlocked.some((entry) => entry.achievement_id === "the_first_simmer"));
  assert.equal(content.achievements.filter((entry) => entry.category === "gardening").length, 12);
  assert.equal(content.achievements.filter((entry) => entry.category === "broth_simmering").length, 8);
});

test("Blessing achievement copy refers to chefs rather than visitors", () => {
  const blessingAchievements = content.achievements.filter((achievement) => achievement.category === "blessings");
  assert.ok(blessingAchievements.length > 0);
  assert.ok(blessingAchievements.every((achievement) => !/visitor/i.test(achievement.description)));
  assert.ok(blessingAchievements.some((achievement) => achievement.description.includes("another chef")));
  assert.ok(blessingAchievements.some((achievement) => achievement.description.includes("other chefs")));
});

test("Achievement content rejects duplicate IDs and malformed rewards", () => {
  assert.throws(() => validateAchievementsContent({ achievements: [
    { achievement_id: "x", name: "X", description: "x", criteria: { type: "metric", path: "coins", threshold: 1 }, reward: { coins: 1 } },
    { achievement_id: "x", name: "X2", description: "x", criteria: { type: "metric", path: "coins", threshold: 1 }, reward: { coins: 1 } }
  ] }), /unique/);
  assert.throws(() => validateAchievementsContent({ achievements: [
    { achievement_id: "x", name: "X", description: "x", criteria: { type: "metric", path: "coins", threshold: 1 }, reward: { coins: 0 } }
  ] }), /reward/);
});
