export function normalizeNewsClassification(value) {
  const raw = String(value ?? "player_update").trim().toLowerCase();
  if (raw === "internal_update") return "internal_update";
  return "player_update";
}

export function parseNewsDateMs(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeNewsVersion(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.startsWith("v") ? raw.toLowerCase() : `v${raw.toLowerCase()}`;
}

export function getLatestVisibleNewsEntry(newsContent, { includeInternal = false } = {}) {
  const sections = Array.isArray(newsContent?.sections) ? newsContent.sections : [];
  return sections
    .flatMap((section, sectionIndex) => {
      const entries = Array.isArray(section?.entries) ? section.entries : [];
      return entries.map((entry, entryIndex) => ({ entry, sectionIndex, entryIndex }));
    })
    .filter(({ entry }) => includeInternal || normalizeNewsClassification(entry?.classification) !== "internal_update")
    .sort((a, b) => {
      const diff = parseNewsDateMs(b.entry?.date) - parseNewsDateMs(a.entry?.date);
      if (diff !== 0) return diff;
      const sectionDiff = a.sectionIndex - b.sectionIndex;
      if (sectionDiff !== 0) return sectionDiff;
      return a.entryIndex - b.entryIndex;
    })[0] ?? null;
}

export function getLatestNewsVersionForPlayer(newsContent) {
  const latest = getLatestVisibleNewsEntry(newsContent, { includeInternal: false });
  if (latest?.entry) {
    return normalizeNewsVersion(latest.entry.version);
  }

  const pinned = newsContent?.pinned ?? {};
  if (normalizeNewsClassification(pinned?.classification) === "internal_update") {
    return "";
  }
  return normalizeNewsVersion(pinned?.version);
}

export function hasUnreadNewsUpdate(player, newsContent) {
  const latestVersion = getLatestNewsVersionForPlayer(newsContent);
  if (!latestVersion) return false;
  const seenVersion = normalizeNewsVersion(player?.notifications?.news_last_seen_version);
  return seenVersion !== latestVersion;
}

export function markNewsAsSeen(player, newsContent) {
  if (!player || typeof player !== "object") return false;
  const latestVersion = getLatestNewsVersionForPlayer(newsContent);
  if (!latestVersion) return false;

  if (!player.notifications || typeof player.notifications !== "object") {
    player.notifications = {};
  }

  const seenVersion = normalizeNewsVersion(player.notifications.news_last_seen_version);
  if (seenVersion === latestVersion) return false;

  player.notifications.news_last_seen_version = latestVersion;
  return true;
}
