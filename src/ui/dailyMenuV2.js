import { theme } from "./theme.js";
import { buildComponentsV2MenuPayload } from "./componentsV2.js";

export function buildDailyMenuV2Message({
  userId,
  notice = "",
  nextChangeAt = "",
  currentMenu = [],
  pickerRows = [],
  draftSelectionCount = 0,
  showSaveButton = false,
  ephemeral = false
} = {}) {
  const safeUserId = String(userId ?? "").trim();
  if (!safeUserId) throw new Error("userId is required");

  const menuText = Array.isArray(currentMenu) && currentMenu.length
    ? currentMenu.map((recipe) => `• ${String(recipe ?? "").trim()}`).filter(Boolean).join("\n")
    : "_No menu has been set!_";
  const details = [
    String(notice ?? "").trim(),
    "Choose up to 10 learned recipes for your shop's order board menu. Changing your menu will update your order board instantly and if you have any accepted orders, they will remain until you serve them.",
    showSaveButton
      ? `**Menu draft: ${Math.max(0, Math.floor(Number(draftSelectionCount) || 0))}/10 selected.** Continue across pages, then save to apply your change.`
      : "",
    String(nextChangeAt ?? "").trim(),
    `**Current menu**\n${menuText}`
  ].filter(Boolean);
  const components = [
    { type: 10, content: "## Daily Order Board Menu" },
    { type: 10, content: details.join("\n\n") },
    ...(Array.isArray(pickerRows)
      ? pickerRows.map((row) => row?.toJSON?.() ?? row).filter(Boolean)
      : []),
    ...(showSaveButton
      ? [{
          type: 1,
          components: [
            {
              type: 2,
              style: 3,
              label: "Save Menu",
              custom_id: `noodle:pick:daily_menu_confirm:${safeUserId}`
            },
            {
              type: 2,
              style: 2,
              label: "Cancel Draft",
              custom_id: `noodle:pick:daily_menu_cancel:${safeUserId}`
            }
          ]
        }]
      : []),
    {
      type: 1,
      components: [{
        type: 2,
        style: 2,
        label: "Back",
        custom_id: `noodle:nav:orders:${safeUserId}`
      }]
    }
  ];

  return buildComponentsV2MenuPayload({
    components,
    ownerId: safeUserId,
    ephemeral,
    accentColor: theme.colors.success
  });
}
