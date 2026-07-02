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

export function buildOrdersBoardV2Message({
  userId,
  token,
  headerLines = [],
  acceptedEntries = [],
  quickActions = []
} = {}) {
  const safeUserId = String(userId ?? "").trim();
  const safeToken = String(token ?? "").trim();
  if (!safeUserId || !safeToken) {
    throw new Error("userId and token are required");
  }

  const components = [];
  const uniqueQuickActions = dedupeQuickActions(quickActions);

  const normalizedHeader = (headerLines || []).map((line) => String(line ?? "").trim()).filter(Boolean);
  if (normalizedHeader.length > 0) {
    components.push(asText(normalizedHeader.join("\n")));
  }

  if ((acceptedEntries || []).length > 0) {
    components.push(asText("**Your Accepted Orders**"));
    for (const entry of acceptedEntries) {
      const line = String(entry?.line ?? "").trim();
      if (!line) continue;
      if (entry?.serveReady) {
        components.push({
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
        });
      } else {
        components.push(asText(line));
      }
    }
  } else {
    components.push(asText("**Your Accepted Orders**\n_None right now._"));
  }

  if (uniqueQuickActions.length > 0) {
    const buttonRows = [];
    for (let i = 0; i < uniqueQuickActions.length; i += 5) {
      const chunk = uniqueQuickActions.slice(i, i + 5);
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

    components.push(...buttonRows);
  }

  return buildComponentsV2MenuPayload({ components });
}
