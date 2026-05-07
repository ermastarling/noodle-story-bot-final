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

function parseSemver(value) {
  const normalized = normalizeNewsVersion(value);
  if (!normalized) return null;

  const match = normalized.match(/^v(\d+)\.(\d+)\.(\d+)(?:-([0-9a-z.-]+))?$/);
  if (!match) return null;

  const [, major, minor, patch, prerelease = ""] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease
  };
}

function comparePrerelease(a, b) {
  const aParts = a.split(".").filter(Boolean);
  const bParts = b.split(".").filter(Boolean);
  const maxLen = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < maxLen; i += 1) {
    const left = aParts[i];
    const right = bParts[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;

    const leftIsNum = /^\d+$/.test(left);
    const rightIsNum = /^\d+$/.test(right);
    if (leftIsNum && rightIsNum) {
      const diff = Number(left) - Number(right);
      if (diff !== 0) return diff > 0 ? 1 : -1;
      continue;
    }
    if (leftIsNum !== rightIsNum) {
      return leftIsNum ? -1 : 1;
    }
    return left.localeCompare(right);
  }

  return 0;
}

export function compareNewsVersions(leftValue, rightValue) {
  const left = normalizeNewsVersion(leftValue);
  const right = normalizeNewsVersion(rightValue);
  if (left === right) return 0;
  if (!left && right) return -1;
  if (left && !right) return 1;
  if (!left && !right) return 0;

  const leftSemver = parseSemver(left);
  const rightSemver = parseSemver(right);
  if (!leftSemver || !rightSemver) {
    return null;
  }

  const majorDiff = leftSemver.major - rightSemver.major;
  if (majorDiff !== 0) return majorDiff > 0 ? 1 : -1;
  const minorDiff = leftSemver.minor - rightSemver.minor;
  if (minorDiff !== 0) return minorDiff > 0 ? 1 : -1;
  const patchDiff = leftSemver.patch - rightSemver.patch;
  if (patchDiff !== 0) return patchDiff > 0 ? 1 : -1;

  const leftPrerelease = leftSemver.prerelease;
  const rightPrerelease = rightSemver.prerelease;
  if (!leftPrerelease && !rightPrerelease) return 0;
  if (!leftPrerelease) return 1;
  if (!rightPrerelease) return -1;

  const prereleaseDiff = comparePrerelease(leftPrerelease, rightPrerelease);
  if (prereleaseDiff !== 0) return prereleaseDiff > 0 ? 1 : -1;
  return 0;
}

export function formatNewsVersion(rawValue, fallback = "v0.0.0") {
  const normalized = normalizeNewsVersion(rawValue);
  if (!normalized) return fallback;

  const parsed = parseSemver(normalized);
  if (!parsed) return normalized;

  return parsed.prerelease
    ? `v${parsed.major}.${parsed.minor}.${parsed.patch}-${parsed.prerelease}`
    : `v${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

export function getVisibleSortedNewsEntries(newsContent, { includeInternal = false } = {}) {
  const sections = Array.isArray(newsContent?.sections) ? newsContent.sections : [];
  return sections
    .flatMap((section, sectionIndex) => {
      const entries = Array.isArray(section?.entries) ? section.entries : [];
      return entries
        .filter((entry) => includeInternal || normalizeNewsClassification(entry?.classification) !== "internal_update")
        .map((entry, entryIndex) => ({
          entry,
          sectionTitle: String(section?.title ?? "Updates").trim() || "Updates",
          sectionIndex,
          entryIndex
        }));
    })
    .sort((a, b) => {
      const diff = parseNewsDateMs(b.entry?.date) - parseNewsDateMs(a.entry?.date);
      if (diff !== 0) return diff;
      const sectionDiff = a.sectionIndex - b.sectionIndex;
      if (sectionDiff !== 0) return sectionDiff;
      return a.entryIndex - b.entryIndex;
    });
}

export function getLatestVisibleNewsEntry(newsContent, { includeInternal = false } = {}) {
  return getVisibleSortedNewsEntries(newsContent, { includeInternal })[0] ?? null;
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
  if (!seenVersion) return true;
  const comparison = compareNewsVersions(latestVersion, seenVersion);
  // If versions are non-semver/non-comparable, fall back to direct inequality.
  return comparison === null ? latestVersion !== seenVersion : comparison > 0;
}

export function markNewsAsSeen(player, newsContent) {
  if (!player || typeof player !== "object") return false;
  const latestVersion = getLatestNewsVersionForPlayer(newsContent);
  if (!latestVersion) return false;

  if (!player.notifications || typeof player.notifications !== "object") {
    player.notifications = {};
  }

  const seenVersion = normalizeNewsVersion(player.notifications.news_last_seen_version);
  const comparison = compareNewsVersions(latestVersion, seenVersion);
  if (comparison !== null && comparison <= 0) return false;
  if (comparison === null && seenVersion === latestVersion) return false;

  player.notifications.news_last_seen_version = latestVersion;
  return true;
}
