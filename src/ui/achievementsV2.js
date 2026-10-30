import { buildComponentsV2MenuPayload } from "./componentsV2.js";
import { getButtonEmoji, getIcon, normalizeComponentEmoji } from "./icons.js";

export function buildAchievementsV2Message({
  userId,
  entries = [],
  page = 0,
  totalPages = 1,
  visibleCount = 0,
  category = "in_progress",
  inProgressCount = 0,
  claimedCount = 0,
  unlocked = {},
  claimedIds = []
} = {}) {
  const safeUserId = String(userId ?? "").trim();
  if (!safeUserId) throw new Error("userId is required");

  const safeEntries = Array.isArray(entries) ? entries : [];
  const safeCategory = category === "claimed" ? "claimed" : "in_progress";
  const safeTotalPages = Math.max(1, Math.floor(Number(totalPages) || 1));
  const safePage = Math.min(Math.max(Math.floor(Number(page) || 0), 0), safeTotalPages - 1);
  const claimed = claimedIds instanceof Set ? claimedIds : new Set(Array.isArray(claimedIds) ? claimedIds : []);
  const components = [
    { type: 10, content: `## ${getIcon("sparkle")} Achievements` }
  ];

  if (!safeEntries.length) {
    components.push({
      type: 10,
      content: safeCategory === "claimed" ? "_No claimed achievements yet._" : "_No achievements are in progress._"
    });
  } else {
    for (const achievement of safeEntries) {
      const achievementId = String(achievement?.achievement_id ?? "").trim();
      const isUnlocked = Boolean(unlocked?.[achievementId]);
      const isClaimed = claimed.has(achievementId);
      const status = isClaimed ? "Claimed" : isUnlocked ? "Ready to claim" : "In progress";
      const entryText = `**${getIcon(achievementId, getIcon("badges"))} ${String(achievement?.name ?? "Achievement")}** — ${status}\n${String(achievement?.description ?? "")}`;
      if (isUnlocked && !isClaimed) {
        const emoji = normalizeComponentEmoji(getButtonEmoji("daily_reward"));
        components.push({
          type: 9,
          components: [{ type: 10, content: entryText }],
          accessory: {
            type: 2,
            style: 3,
            label: "Claim",
            custom_id: `noodle:action:achievement_claim:${safeUserId}:${achievementId}:${safeCategory}:${safePage}`,
            ...(emoji ? { emoji } : {})
          }
        });
      } else {
        components.push({ type: 10, content: entryText });
      }
    }
  }

  components.push({
    type: 10,
    content: `-# Page ${safePage + 1}/${safeTotalPages} • ${Math.max(0, Math.floor(Number(visibleCount) || 0))} ${safeCategory === "claimed" ? "claimed" : "in progress"} achievements`
  });

  const backEmoji = normalizeComponentEmoji(getButtonEmoji("back"));
  const nextEmoji = normalizeComponentEmoji(getButtonEmoji("next"));
  components.push({
    type: 1,
    components: [
      {
        type: 2,
        style: safeCategory === "claimed" ? 1 : 2,
        label: `Claimed (${Math.max(0, Math.floor(Number(claimedCount) || 0))})`,
        custom_id: `noodle:action:achievement_category:${safeUserId}:claimed`
      },
      {
        type: 2,
        style: safeCategory === "in_progress" ? 1 : 2,
        label: `In Progress (${Math.max(0, Math.floor(Number(inProgressCount) || 0))})`,
        custom_id: `noodle:action:achievement_category:${safeUserId}:in_progress`
      }
    ]
  });

  if (safeTotalPages > 1) {
    components.push({
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          label: "Previous",
          custom_id: `noodle:nav:achievements:${safeUserId}:${safePage > 0 ? safePage - 1 : safeTotalPages - 1}:${safeCategory}`,
          ...(backEmoji ? { emoji: backEmoji } : {})
        },
        {
          type: 2,
          style: 2,
          label: "Next",
          custom_id: `noodle:nav:achievements:${safeUserId}:${safePage < safeTotalPages - 1 ? safePage + 1 : 0}:${safeCategory}`,
          ...(nextEmoji ? { emoji: nextEmoji } : {})
        }
      ]
    });
  }
  components.push({
    type: 1,
    components: [{
      type: 2,
      style: 2,
      label: "Back",
      custom_id: `noodle-social:nav:stats:${safeUserId}`,
      ...(backEmoji ? { emoji: backEmoji } : {})
    }]
  });

  return buildComponentsV2MenuPayload({ components, ownerId: safeUserId });
}
