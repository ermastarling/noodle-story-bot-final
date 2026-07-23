const SHARED_ORDER_STARTED_NOTICE_TOKEN = "party shared order started";

function normalizeNoticeTitleToken(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isSharedOrderStartedNotice(notice) {
  if (!notice || typeof notice !== "object") return false;
  const token = normalizeNoticeTitleToken(notice.title);
  return token.includes(SHARED_ORDER_STARTED_NOTICE_TOKEN);
}

export function shouldRetainPersistentPartyNotice({ notice, hasActiveSharedOrder = false } = {}) {
  if (!notice || typeof notice !== "object") return false;
  if (isSharedOrderStartedNotice(notice) && !hasActiveSharedOrder) return false;
  return true;
}
