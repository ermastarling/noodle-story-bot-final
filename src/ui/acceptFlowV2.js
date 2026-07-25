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

function countComponentsDeep(component) {
  if (!component || typeof component !== "object") return 0;
  const children = Array.isArray(component.components) ? component.components : [];
  const accessory = component.accessory && typeof component.accessory === "object" ? [component.accessory] : [];
  return 1
    + children.reduce((sum, child) => sum + countComponentsDeep(child), 0)
    + accessory.reduce((sum, child) => sum + countComponentsDeep(child), 0);
}

function countListDeep(components = []) {
  return (components || []).reduce((sum, component) => sum + countComponentsDeep(component), 0);
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
  tutorialSingleAcceptMode = false,
  maxSelectable = null,
  hasAcceptedOrders = false
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
  const safeTotalPages = Math.max(1, Math.floor(Number(totalPages) || 1));
  const safePage = Math.max(0, Math.min(Math.floor(Number(currentPage) || 0), safeTotalPages - 1));
  const directAccept = Boolean(directAcceptMode);
  const visibleEntries = Array.isArray(entries) ? entries : [];
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

  const selectedCount = selectedSet.size;
  const safeMaxSelectable = Number.isFinite(maxSelectable)
    ? Math.max(0, Math.floor(Number(maxSelectable) || 0))
    : null;
  const selectionCapReached = safeMaxSelectable !== null && selectedCount >= safeMaxSelectable;
  const COMPONENT_BUDGET = 35;
  const confirmRowTemplate = {
    type: 1,
    components: [
      button({
        sceneKey,
        actionKey: "cfm",
        userId: safeUserId,
        token: safeToken,
        label: selectedCount > 0 ? `Accept Selected (${selectedCount})` : "Select Orders First",
        style: selectedCount > 0 ? 3 : 1,
        disabled: selectedCount <= 0
      }),
      button({ sceneKey, actionKey: "bk", userId: safeUserId, token: safeToken, label: "Back", style: hasAcceptedOrders ? 3 : 2 }),
      button({ sceneKey, actionKey: "cnl", userId: safeUserId, token: safeToken, label: "Cancel", style: 2 })
    ]
  };
  const paginationRowTemplate = {
    type: 1,
    components: [
      button({ sceneKey, actionKey: "pg", userId: safeUserId, token: safeToken, arg: "prev", label: "Prev", style: 2 }),
      button({ sceneKey, actionKey: "pg", userId: safeUserId, token: safeToken, arg: "next", label: "Next", style: 2 })
    ]
  };
  const overflowLineTemplate = text("_...and 1 more order(s)._");
  const confirmRowBudget = directAccept ? 0 : countComponentsDeep(confirmRowTemplate);
  const paginationRowBudget = safeTotalPages > 1 ? countComponentsDeep(paginationRowTemplate) : 0;
  const overflowLineBudget = countComponentsDeep(overflowLineTemplate);
  let runningBudget = countListDeep(components);
  let overflowCount = 0;

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
          style: directAccept ? 3 : (isSelected ? 3 : 1),
          disabled: !directAccept && !isSelected && selectionCapReached
        })
      };
      const sectionBudget = countComponentsDeep(section);
      const reserveBudget = confirmRowBudget + paginationRowBudget + overflowLineBudget;
      if (runningBudget + sectionBudget + reserveBudget > COMPONENT_BUDGET) {
        overflowCount += 1;
        continue;
      }
      components.push(section);
      runningBudget += sectionBudget;
    }

    if (overflowCount > 0) {
      components.push(text(`_...and ${overflowCount} more order(s)._`));
    }
  }

  if (!directAccept) {
    components.push(confirmRowTemplate);
  }

  if (safeTotalPages > 1) {
    components.push(paginationRowTemplate);
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
