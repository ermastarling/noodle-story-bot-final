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

export function deriveCancelOutcome({ targetOrderId, beforeAcceptedOrderIds = [], afterAcceptedOrderIds = [] } = {}) {
  const target = String(targetOrderId ?? "").trim();
  const before = new Set((beforeAcceptedOrderIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const after = new Set((afterAcceptedOrderIds || []).map((id) => String(id || "").trim()).filter(Boolean));

  if (!target) {
    return { code: "invalid", message: "Invalid order selection." };
  }

  if (before.has(target) && !after.has(target)) {
    return { code: "canceled", message: "Order canceled." };
  }

  if (!before.has(target)) {
    return { code: "missing", message: "That order is no longer accepted." };
  }

  return { code: "invalid", message: "Order could not be canceled." };
}

export function buildCancelPickerV2Message({
  userId,
  token,
  entries = [],
  selectedShortIds = [],
  statusLine = ""
} = {}) {
  const safeUserId = String(userId || "").trim();
  const safeToken = String(token || "").trim();
  const sceneKey = "orders.cancel_picker";
  const selectedSet = new Set(
    (selectedShortIds || [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );
  const safeStatusLine = String(statusLine || "").trim();

  const components = [
    text("## Cancel Orders"),
    text("Select one or more accepted orders, then tap Cancel Selected.")
  ];
  const COMPONENT_BUDGET = 35;

  if (safeStatusLine) components.push(text(safeStatusLine));

  if ((entries || []).length === 0) {
    components.push(text("No accepted orders are available to cancel."));
  } else {
    let overflowCount = 0;
    const selectedCount = selectedSet.size;
    const confirmRowBudget = countComponentsDeep({
      type: 1,
      components: [
        button({
          sceneKey,
          actionKey: "cfm",
          userId: safeUserId,
          token: safeToken,
          label: selectedCount > 0 ? `Cancel Selected (${selectedCount})` : "Select Orders First",
          style: 4,
          disabled: selectedCount <= 0
        }),
        button({ sceneKey, actionKey: "bk", userId: safeUserId, token: safeToken, label: "Back", style: 2 }),
        button({ sceneKey, actionKey: "cnl", userId: safeUserId, token: safeToken, label: "Orders", style: 2 })
      ]
    });
    const overflowLineBudget = countComponentsDeep(text("_...and 1 more order(s)._"));

    for (const entry of entries) {
      const shortId = String(entry?.shortId ?? "").trim();
      if (!shortId) continue;
      const isSelected = selectedSet.has(shortId);
      const section = {
        type: 9,
        components: [text(String(entry?.line ?? "").trim())],
        accessory: button({
          sceneKey,
          actionKey: "sel",
          userId: safeUserId,
          token: safeToken,
          arg: shortId,
          label: isSelected ? "Selected" : "Select",
          style: isSelected ? 4 : 2
        })
      };

      const sectionBudget = countComponentsDeep(section);
      const currentBudget = countListDeep(components);
      const reserveBudget = confirmRowBudget + overflowLineBudget;
      if (currentBudget + sectionBudget + reserveBudget > COMPONENT_BUDGET) {
        overflowCount += 1;
        continue;
      }

      components.push(section);
    }

    if (overflowCount > 0) {
      components.push(text(`_...and ${overflowCount} more order(s)._`));
    }
  }

  const selectedCount = selectedSet.size;
  components.push({
    type: 1,
    components: [
      button({
        sceneKey,
        actionKey: "cfm",
        userId: safeUserId,
        token: safeToken,
        label: selectedCount > 0 ? `Cancel Selected (${selectedCount})` : "Select Orders First",
        style: 4,
        disabled: selectedCount <= 0
      }),
      button({ sceneKey, actionKey: "bk", userId: safeUserId, token: safeToken, label: "Back", style: 2 }),
      button({ sceneKey, actionKey: "cnl", userId: safeUserId, token: safeToken, label: "Orders", style: 2 })
    ]
  });

  return buildComponentsV2MenuPayload({ components });
}
