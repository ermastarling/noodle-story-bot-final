import { buildComponentsV2MenuPayload } from "./componentsV2.js";
import { getButtonEmoji, getIcon, normalizeComponentEmoji } from "./icons.js";
import { PROFILE_BADGE_ROW_LIMIT } from "../game/profileBadges.js";

const CATEGORY_LABELS = {
  badges: "Badges",
  achievements: "Achievements",
  collections: "Collections"
};
const PAGE_SIZE = 10;

export function buildProfileBadgesV2Message({
  userId,
  category = "badges",
  entries = [],
  selectedIds = [],
  page = 0,
  totalPages = 1,
  ownerId
} = {}) {
  const safeUserId = String(userId ?? "").trim();
  if (!safeUserId) throw new Error("userId is required");
  const safeCategory = Object.hasOwn(CATEGORY_LABELS, category) ? category : "badges";
  const safeEntries = Array.isArray(entries) ? entries : [];
  const selected = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  const safeTotalPages = Math.max(1, Math.floor(Number(totalPages) || 1));
  const safePage = Math.min(Math.max(0, Math.floor(Number(page) || 0), 0), safeTotalPages - 1);

  const components = [
    { type: 10, content: `## ${getIcon("badges")} Badges` },
    {
      type: 10,
      content: "Select the badges you want to display on your profile!"
    },
    {
      type: 10,
      content: `${selected.size}/${PROFILE_BADGE_ROW_LIMIT} equipped in **${CATEGORY_LABELS[safeCategory]}**.`
    },
    {
      type: 1,
      components: Object.entries(CATEGORY_LABELS).map(([id, label]) => ({
        type: 2,
        style: id === safeCategory ? 1 : 2,
        label,
        custom_id: `noodle:action:badge_category:${safeUserId}:${id}`
      }))
    }
  ];

  if (!safeEntries.length) {
    components.push({ type: 10, content: `_No ${CATEGORY_LABELS[safeCategory].toLowerCase()} are available to display yet._` });
  } else {
    for (const entry of safeEntries) {
      const id = String(entry?.id ?? "").trim();
      if (!id) continue;
      const isSelected = selected.has(id);
      const label = String(entry?.name ?? id);
      const description = String(entry?.description ?? "").trim();
      components.push({
        type: 9,
        components: [{
          type: 10,
          content: `**${getIcon(entry?.icon, getIcon("badges"))} ${label}**${description ? `\n${description}` : ""}`
        }],
        accessory: {
          type: 2,
          style: isSelected ? 3 : 2,
          label: isSelected ? "Equipped" : "Equip",
          custom_id: `noodle:action:badge_toggle:${safeUserId}:${safeCategory}:${id}`,
          ...(normalizeComponentEmoji(getButtonEmoji(isSelected ? "status_complete" : "badges"))
            ? { emoji: normalizeComponentEmoji(getButtonEmoji(isSelected ? "status_complete" : "badges")) }
            : {})
        }
      });
    }
  }

  components.push({
    type: 10,
    content: `-# Page ${safePage + 1}/${safeTotalPages}`
  });

  const backEmoji = normalizeComponentEmoji(getButtonEmoji("back"));
  const nextEmoji = normalizeComponentEmoji(getButtonEmoji("next"));
  if (safeTotalPages > 1) {
    components.push({
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          label: "Previous",
          custom_id: `noodle:nav:badges:${safeUserId}:${safePage > 0 ? safePage - 1 : safeTotalPages - 1}:${safeCategory}`,
          ...(backEmoji ? { emoji: backEmoji } : {})
        },
        {
          type: 2,
          style: 2,
          label: "Next",
          custom_id: `noodle:nav:badges:${safeUserId}:${safePage < safeTotalPages - 1 ? safePage + 1 : 0}:${safeCategory}`,
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
      custom_id: `noodle:nav:profile_edit:${safeUserId}`,
      ...(backEmoji ? { emoji: backEmoji } : {})
    }]
  });

  return buildComponentsV2MenuPayload({
    components,
    ownerId: String(ownerId ?? safeUserId).trim()
  });
}

export function getProfileBadgePage(entries = [], requestedPage = 0) {
  const list = Array.isArray(entries) ? entries : [];
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const rawPage = Number(requestedPage);
  const page = Number.isFinite(rawPage)
    ? Math.min(Math.max(Math.floor(rawPage), 0), totalPages - 1)
    : 0;
  return {
    page,
    totalPages,
    entries: list.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  };
}
