import { buildComponentsV2MenuPayload } from "./componentsV2.js";

function asText(content) {
  return { type: 10, content: String(content ?? "").trim() || "-" };
}

function actionButton({ label, actionKey, userId, token, arg, style = 2, disabled = false, emoji } = {}) {
  const customId = arg
    ? `noodle:v2:orders.board:${actionKey}:${userId}:${token}:${arg}`
    : `noodle:v2:orders.board:${actionKey}:${userId}:${token}`;

  const button = {
    type: 2,
    style,
    label,
    custom_id: customId,
    disabled: Boolean(disabled)
  };

  if (typeof emoji === "string" && emoji.trim()) {
    button.emoji = { name: emoji.trim() };
  } else if (emoji?.id || emoji?.name) {
    button.emoji = emoji;
  }

  return button;
}

function dedupeQuickActions(actions = []) {
  const seen = new Set();
  const out = [];
  for (const action of actions) {
    const key = String(action?.actionKey ?? "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(action);
  }
  return out;
}

function countComponentsDeep(component) {
  if (!component || typeof component !== "object") return 0;
  const children = Array.isArray(component.components) ? component.components : [];
  const accessory = component.accessory && typeof component.accessory === "object" ? [component.accessory] : [];
  return 1 + children.reduce((sum, child) => sum + countComponentsDeep(child), 0)
    + accessory.reduce((sum, child) => sum + countComponentsDeep(child), 0);
}

function countListDeep(components = []) {
  return (components || []).reduce((sum, component) => sum + countComponentsDeep(component), 0);
}

export function buildOrdersBoardV2Message({
  userId,
  token,
  headerLines = [],
  acceptedEntries = [],
  showAcceptedSection = true,
  quickActions = []
} = {}) {
  const safeUserId = String(userId ?? "").trim();
  const safeToken = String(token ?? "").trim();
  if (!safeUserId || !safeToken) {
    throw new Error("userId and token are required");
  }

  const components = [];
  const uniqueQuickActions = dedupeQuickActions(quickActions);
  const COMPONENT_BUDGET = 38;
  const QUICK_ACTIONS_PER_ROW = 4;

  components.push(asText("## Orders Board"));

  const normalizedHeader = (headerLines || []).map((line) => String(line ?? "").trim()).filter(Boolean);
  if (normalizedHeader.length > 0) {
    components.push(asText(normalizedHeader.join("\n")));
  }

  const buttonRows = [];
  if (uniqueQuickActions.length > 0) {
    for (let i = 0; i < uniqueQuickActions.length; i += QUICK_ACTIONS_PER_ROW) {
      const chunk = uniqueQuickActions.slice(i, i + QUICK_ACTIONS_PER_ROW);
      buttonRows.push({
        type: 1,
        components: chunk.map((action) =>
          actionButton({
            label: action.label,
            actionKey: action.actionKey,
            userId: safeUserId,
            token: safeToken,
            style: action.style,
            disabled: action.disabled,
            emoji: action.emoji
          })
        )
      });
    }
  }

  if (showAcceptedSection) {
    if ((acceptedEntries || []).length > 0) {
      const acceptedList = Array.isArray(acceptedEntries) ? acceptedEntries : [];
      components.push(asText("**Your Accepted Orders**"));

      let overflowCount = 0;
      const baseCount = countListDeep(components) + countListDeep(buttonRows);
      let runningCount = baseCount;

      for (const entry of acceptedList) {
        const line = String(entry?.line ?? "").trim();
        if (!line) continue;
        const candidate = entry?.serveReady
          ? {
              type: 9,
              components: [asText(line)],
              accessory: actionButton({
                label: "Serve Ready",
                actionKey: "sv",
                userId: safeUserId,
                token: safeToken,
                arg: String(entry.shortId ?? "").trim(),
                style: 3,
                disabled: false
              })
            }
          : asText(line);

        const candidateCount = countComponentsDeep(candidate);
        const reserveForOverflow = overflowCount > 0 ? 0 : countComponentsDeep(asText("_...and 1 more accepted order(s)._"));
        if (runningCount + candidateCount + reserveForOverflow > COMPONENT_BUDGET) {
          overflowCount += 1;
          continue;
        }

        components.push(candidate);
        runningCount += candidateCount;
      }

      if (overflowCount > 0) {
        components.push(asText(`_...and ${overflowCount} more accepted order(s)._`));
      }
    } else {
      components.push(asText("**Your Accepted Orders**\n_None right now._"));
    }
  }

  if (buttonRows.length > 0) components.push(...buttonRows);

  return buildComponentsV2MenuPayload({ components });
}
