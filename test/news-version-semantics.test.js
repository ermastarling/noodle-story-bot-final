import test from "node:test";
import assert from "node:assert/strict";

import {
  compareNewsVersions,
  hasUnreadNewsUpdate,
  markNewsAsSeen,
  normalizeNewsVersion
} from "../src/util/news.js";

function buildNewsContent(version, { classification = "player_update" } = {}) {
  return {
    pinned: {
      version: "v0.0.1",
      classification: "player_update"
    },
    sections: [
      {
        title: "Latest",
        entries: [
          {
            version,
            classification,
            date: "2026-05-01T00:00:00.000Z"
          }
        ]
      }
    ]
  };
}

test("News versions: normalize handles leading uppercase V", () => {
  assert.equal(normalizeNewsVersion("V1.2.3"), "v1.2.3");
  assert.equal(normalizeNewsVersion("v1.2.3"), "v1.2.3");
  assert.equal(normalizeNewsVersion("1.2.3"), "v1.2.3");
});

test("News versions: semver ordering with prerelease is respected", () => {
  assert.equal(compareNewsVersions("v1.2.3", "v1.2.2"), 1);
  assert.equal(compareNewsVersions("v1.2.3", "v1.2.3"), 0);
  assert.equal(compareNewsVersions("v1.2.3-alpha", "v1.2.3"), -1);
  assert.equal(compareNewsVersions("v1.2.3", "v1.2.3-beta"), 1);
  assert.equal(compareNewsVersions("v1.2.3-alpha.2", "v1.2.3-alpha.10"), -1);
});

test("News versions: non-semver values are non-comparable", () => {
  assert.equal(compareNewsVersions("release-2026-05", "v1.2.3"), null);
  assert.equal(compareNewsVersions("release-a", "release-b"), null);
});

test("Unread news: missing seen version is unread", () => {
  const content = buildNewsContent("v1.2.3");
  const player = { notifications: {} };
  assert.equal(hasUnreadNewsUpdate(player, content), true);
});

test("Unread news: false when seen version is same or newer", () => {
  const content = buildNewsContent("v1.2.3");
  const same = { notifications: { news_last_seen_version: "v1.2.3" } };
  const newer = { notifications: { news_last_seen_version: "v2.0.0" } };

  assert.equal(hasUnreadNewsUpdate(same, content), false);
  assert.equal(hasUnreadNewsUpdate(newer, content), false);
});

test("Unread news: non-semver fallback uses inequality", () => {
  const content = buildNewsContent("release-2026-05");
  const same = { notifications: { news_last_seen_version: "release-2026-05" } };
  const different = { notifications: { news_last_seen_version: "release-2026-04" } };

  assert.equal(hasUnreadNewsUpdate(same, content), false);
  assert.equal(hasUnreadNewsUpdate(different, content), true);
});

test("markNewsAsSeen: sets latest version when unseen", () => {
  const content = buildNewsContent("v1.2.3");
  const player = { notifications: {} };

  const changed = markNewsAsSeen(player, content);

  assert.equal(changed, true);
  assert.equal(player.notifications.news_last_seen_version, "v1.2.3");
});

test("markNewsAsSeen: does not downgrade when seen is newer", () => {
  const content = buildNewsContent("v1.2.3");
  const player = { notifications: { news_last_seen_version: "v2.0.0" } };

  const changed = markNewsAsSeen(player, content);

  assert.equal(changed, false);
  assert.equal(player.notifications.news_last_seen_version, "v2.0.0");
});

test("markNewsAsSeen: non-semver update changes when value differs", () => {
  const content = buildNewsContent("release-2026-05");
  const player = { notifications: { news_last_seen_version: "release-2026-04" } };

  const changed = markNewsAsSeen(player, content);

  assert.equal(changed, true);
  assert.equal(player.notifications.news_last_seen_version, "vrelease-2026-05");
});

test("markNewsAsSeen: false when there is no player-facing latest version", () => {
  const content = {
    pinned: {
      version: "v1.0.0",
      classification: "internal_update"
    },
    sections: [
      {
        title: "Internal",
        entries: [
          {
            version: "v1.1.0",
            classification: "internal_update",
            date: "2026-05-02T00:00:00.000Z"
          }
        ]
      }
    ]
  };
  const player = { notifications: {} };

  const changed = markNewsAsSeen(player, content);

  assert.equal(changed, false);
  assert.equal(player.notifications.news_last_seen_version, undefined);
});
