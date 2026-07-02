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

export function deriveServeOutcome({
  targetOrderId,
  beforeAcceptedOrderIds = [],
  afterAcceptedOrderIds = [],
  beforeBowlCount = 0,
  afterBowlCount = 0,
  wasExpiredBefore = false
} = {}) {
  const target = String(targetOrderId || "").trim();
  const before = new Set((beforeAcceptedOrderIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const after = new Set((afterAcceptedOrderIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const beforeBowls = Math.max(0, Math.floor(Number(beforeBowlCount) || 0));
  const afterBowls = Math.max(0, Math.floor(Number(afterBowlCount) || 0));

  if (!target) {
    return { code: "invalid", message: "Invalid serve selection." };
  }

  if (!before.has(target)) {
    return { code: "unavailable", message: "That order is no longer accepted." };
  }

  if (after.has(target)) {
    return { code: "missing_bowl", message: "No matching bowl was ready, so nothing was served." };
  }

  if (wasExpiredBefore) {
    return { code: "expired", message: "That order expired before it could be served." };
  }

  if (afterBowls < beforeBowls) {
    return { code: "served", message: "Order served." };
  }

  return { code: "unavailable", message: "That order was no longer serveable." };
}

export function buildServePickerV2Message({ userId, token, entries = [], selectedShortId = null } = {}) {
  const safeUserId = String(userId || "").trim();
  const safeToken = String(token || "").trim();
  const sceneKey = "serve.order_picker";

  const components = [
    text("## Serve Orders"),
    text("Tap Serve on an order to serve it immediately.")
  ];

  if ((entries || []).length === 0) {
    components.push(text("No accepted orders are currently available to serve."));
  } else {
    for (const entry of entries) {
      const shortId = String(entry?.shortId || "").trim();
      if (!shortId) continue;
      components.push({
        type: 9,
        components: [text(String(entry?.line || shortId))],
        accessory: button({
          sceneKey,
          actionKey: "serve",
          userId: safeUserId,
          token: safeToken,
          arg: shortId,
          label: "Serve",
          style: 3,
          disabled: false
        })
      });
    }
  }

  components.push({
    type: 1,
    components: [
      button({ sceneKey, actionKey: "bk", userId: safeUserId, token: safeToken, label: "Back", style: 2 })
    ]
  });

  return buildComponentsV2MenuPayload({ components });
}

export function buildServeResultV2Message({ userId, token, outcomeCode, detailLine } = {}) {
  const safeUserId = String(userId || "").trim();
  const safeToken = String(token || "").trim();
  const sceneKey = "serve.result";

  const title = outcomeCode === "served" ? "## Order Served" : "## Serve Result";

  return buildComponentsV2MenuPayload({
    components: [
      text(title),
      text(String(detailLine || "Result unavailable.")),
      {
        type: 1,
        components: [
          button({ sceneKey, actionKey: "ord", userId: safeUserId, token: safeToken, label: "Orders", style: 1 }),
          button({ sceneKey, actionKey: "cook", userId: safeUserId, token: safeToken, label: "Cook", style: 3 }),
          button({ sceneKey, actionKey: "again", userId: safeUserId, token: safeToken, label: "Serve More", style: 2 })
        ]
      }
    ]
  });
}
