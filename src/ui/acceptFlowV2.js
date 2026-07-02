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

export function buildAcceptPickerV2Message({ userId, token, entries = [] } = {}) {
  const safeUserId = String(userId || "").trim();
  const safeToken = String(token || "").trim();
  const sceneKey = "orders.accept_picker";

  const components = [
    text("## Accept Orders"),
    text("Pick an order to accept immediately.")
  ];

  if ((entries || []).length === 0) {
    components.push(text("No orders are currently available to accept."));
  } else {
    for (const entry of entries) {
      components.push({
        type: 9,
        components: [text(String(entry?.line ?? "").trim())],
        accessory: button({
          sceneKey,
          actionKey: "sel",
          userId: safeUserId,
          token: safeToken,
          arg: String(entry?.shortId ?? "").trim(),
          label: "Select",
          style: 1
        })
      });
    }
  }

  components.push({
    type: 1,
    components: [
      button({ sceneKey, actionKey: "bk", userId: safeUserId, token: safeToken, label: "Back", style: 2 }),
      button({ sceneKey, actionKey: "cnl", userId: safeUserId, token: safeToken, label: "Cancel", style: 2 })
    ]
  });

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
