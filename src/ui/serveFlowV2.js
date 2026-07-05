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

export function buildServePickerV2Message({
  userId,
  token,
  entries = [],
  selectedShortIds = [],
  readyOnly = false,
  statusLine = "",
  canServeAll = false
} = {}) {
  const safeUserId = String(userId || "").trim();
  const safeToken = String(token || "").trim();
  const sceneKey = "serve.order_picker";
  const onlyReady = Boolean(readyOnly);
  const selectedSet = new Set(
    (selectedShortIds || [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );
  const safeStatusLine = String(statusLine || "").trim();
  const safeCanServeAll = Boolean(canServeAll);

  const components = [
    text("## Serve Orders"),
    text("Select one or more orders, then tap Serve Selected.")
  ];
  const COMPONENT_BUDGET = 35;

  if (safeStatusLine) components.push(text(safeStatusLine));

  if ((entries || []).length === 0) {
    components.push(text(onlyReady
      ? "No ready orders are currently available to serve."
      : "No accepted orders are currently available to serve."));
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
          label: selectedCount > 0 ? `Serve Selected (${selectedCount})` : "Select Orders First",
          style: 3,
          disabled: selectedCount <= 0
        }),
        button({
          sceneKey,
          actionKey: "sfa",
          userId: safeUserId,
          token: safeToken,
          label: "Serve All",
          style: safeCanServeAll ? 3 : 2,
          disabled: !safeCanServeAll
        }),
        button({ sceneKey, actionKey: "bk", userId: safeUserId, token: safeToken, label: "Back", style: 2 })
      ]
    });
    const overflowLineBudget = countComponentsDeep(text("_...and 1 more order(s)._"));

    for (const entry of entries) {
      const shortId = String(entry?.shortId || "").trim();
      if (!shortId) continue;
      const isSelected = selectedSet.has(shortId);
      const section = {
        type: 9,
        components: [text(String(entry?.line || shortId))],
        accessory: button({
          sceneKey,
          actionKey: "sel",
          userId: safeUserId,
          token: safeToken,
          arg: shortId,
          label: isSelected ? "Selected" : "Select",
          style: isSelected ? 3 : 1,
          disabled: false
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
        label: selectedCount > 0 ? `Serve Selected (${selectedCount})` : "Select Orders First",
        style: 3,
        disabled: selectedCount <= 0
      }),
      button({
        sceneKey,
        actionKey: "sfa",
        userId: safeUserId,
        token: safeToken,
        label: "Serve All",
        style: safeCanServeAll ? 3 : 2,
        disabled: !safeCanServeAll
      }),
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
