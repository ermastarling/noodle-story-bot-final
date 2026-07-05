import { buildComponentsV2MenuPayload } from "./componentsV2.js";

function text(content) {
  return { type: 10, content: String(content ?? "").trim() || "-" };
}

function button({ sceneKey, actionKey, userId, token, arg, label, style = 2, disabled = false } = {}) {
  const customId = arg
    ? `noodle:v2:${sceneKey}:${actionKey}:${userId}:${token}:${arg}`
    : `noodle:v2:${sceneKey}:${actionKey}:${userId}:${token}`;
  return {
    type: 2,
    style,
    label,
    custom_id: customId,
    disabled: Boolean(disabled)
  };
}

export function deriveAcceptOutcome({ targetOrderId, cap, beforeAcceptedOrderIds = [], afterAcceptedOrderIds = [] } = {}) {
  const target = String(targetOrderId ?? "").trim();
  const before = new Set((beforeAcceptedOrderIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const after = new Set((afterAcceptedOrderIds || []).map((id) => String(id || "").trim()).filter(Boolean));

  if (!target) {
    return { code: "invalid", message: "Invalid order selection." };
  }

  if (after.has(target) && !before.has(target)) {
    return { code: "accepted", message: "Order accepted." };
  }

  if (before.has(target) && after.has(target)) {
    return { code: "duplicate", message: "That order is already accepted." };
  }

  if (Number.isFinite(cap) && before.size >= cap) {
    return { code: "cap", message: `Order cap reached (${cap}).` };
  }

  return { code: "invalid", message: "Order is no longer available." };
}

export function buildAcceptPickerV2Message({
  userId,
  token,
  entries = [],
  selectedShortIds = [],
  statusLine = "",
  currentPage = 0,
  totalPages = 1,
  directAcceptMode = false,
  tutorialSingleAcceptMode = false
} = {}) {
  const safeUserId = String(userId || "").trim();
  const safeToken = String(token || "").trim();
  const sceneKey = "orders.accept_picker";
  const selectedSet = new Set(
    (selectedShortIds || [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );
  const safeStatusLine = String(statusLine || "").trim();
  const safePage = Math.max(0, Math.floor(Number(currentPage) || 0));
  const safeTotalPages = Math.max(1, Math.floor(Number(totalPages) || 1));
  const directAccept = Boolean(directAcceptMode);
  const MAX_VISIBLE_ENTRIES = 7;
  const pageStart = safePage * MAX_VISIBLE_ENTRIES;
  const visibleEntries = (entries || []).slice(pageStart, pageStart + MAX_VISIBLE_ENTRIES);

  const components = [
    text("## Accept Orders"),
    text(tutorialSingleAcceptMode
      ? "Tutorial step: accept this order to continue."
      : "Select one or more orders, then tap Accept Selected.")
  ];
  if (safeStatusLine) components.push(text(safeStatusLine));
  if (safeTotalPages > 1) {
    components.push(text(`Page **${safePage + 1}/${safeTotalPages}**`));
  }

  if (visibleEntries.length === 0) {
    components.push(text("No orders are currently available to accept."));
  } else {
    for (const entry of visibleEntries) {
      const shortId = String(entry?.shortId ?? "").trim();
      if (!shortId) continue;
      const isSelected = selectedSet.has(shortId);
      const section = {
        type: 9,
        components: [text(String(entry?.line ?? "").trim())],
        accessory: button({
          sceneKey,
          actionKey: directAccept ? "cfm" : "sel",
          userId: safeUserId,
          token: safeToken,
          arg: shortId,
          label: directAccept ? "Accept" : (isSelected ? "Selected" : "Select"),
          style: directAccept ? 3 : (isSelected ? 3 : 1)
        })
      };

      components.push(section);
    }
  }

  if (!directAccept) {
    const selectedCount = selectedSet.size;
    components.push({
      type: 1,
      components: [
        button({
          sceneKey,
          actionKey: "cfm",
          userId: safeUserId,
          token: safeToken,
          label: selectedCount > 0 ? `Accept Selected (${selectedCount})` : "Select Orders First",
          style: 1,
          disabled: selectedCount <= 0
        }),
        button({ sceneKey, actionKey: "bk", userId: safeUserId, token: safeToken, label: "Back", style: 3 }),
        button({ sceneKey, actionKey: "cnl", userId: safeUserId, token: safeToken, label: "Cancel", style: 2 })
      ]
    });
  }

  if (safeTotalPages > 1) {
    components.push({
      type: 1,
      components: [
        button({ sceneKey, actionKey: "pg", userId: safeUserId, token: safeToken, arg: "prev", label: "Prev", style: 2 }),
        button({ sceneKey, actionKey: "pg", userId: safeUserId, token: safeToken, arg: "next", label: "Next", style: 2 })
      ]
    });
  }

  return buildComponentsV2MenuPayload({ components });
}

export function buildAcceptConfirmV2Message({ userId, token, selectedLine, selectedShortId } = {}) {
  const safeUserId = String(userId || "").trim();
  const safeToken = String(token || "").trim();
  const safeShort = String(selectedShortId || "").trim();
  const sceneKey = "orders.accept_result";

  return buildComponentsV2MenuPayload({
    components: [
      text("## Confirm Accept"),
      text(String(selectedLine || "Selected order.")),
      {
        type: 1,
        components: [
          button({ sceneKey, actionKey: "cfm", userId: safeUserId, token: safeToken, arg: safeShort, label: "Confirm", style: 3 }),
          button({ sceneKey, actionKey: "cnl", userId: safeUserId, token: safeToken, label: "Cancel", style: 2 }),
          button({ sceneKey, actionKey: "bk", userId: safeUserId, token: safeToken, label: "Back", style: 2 })
        ]
      }
    ]
  });
}

export function buildAcceptResultV2Message({ userId, token, outcomeCode, detailLine } = {}) {
  const safeUserId = String(userId || "").trim();
  const safeToken = String(token || "").trim();
  const sceneKey = "orders.accept_result";

  const title = outcomeCode === "accepted" ? "## Order Accepted" : "## Accept Result";

  return buildComponentsV2MenuPayload({
    components: [
      text(title),
      text(String(detailLine || "Result unavailable.")),
      {
        type: 1,
        components: [
          button({ sceneKey, actionKey: "ord", userId: safeUserId, token: safeToken, label: "Orders", style: 1 }),
          button({ sceneKey, actionKey: "ck", userId: safeUserId, token: safeToken, label: "Cook", style: 3 })
        ]
      }
    ]
  });
}
