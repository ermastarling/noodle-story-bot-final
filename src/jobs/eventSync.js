import cron from "node-cron";
import { openDb, getServer, upsertServer } from "../db/index.js";
import { newServerState } from "../game/server.js";
import { loadEventsContent, loadSettingsCatalog } from "../content/index.js";
import { buildSettingsMap } from "../settings/resolve.js";
import { computeActiveSeason } from "../game/seasons.js";
import { getEventWindow } from "../game/events.js";
import { nowTs } from "../util/time.js";

const db = openDb();
const eventsContent = loadEventsContent();
const settingsCatalog = loadSettingsCatalog();

function ensureServer(serverId) {
  let s = getServer(db, serverId);
  if (!s) {
    s = newServerState(serverId);
    upsertServer(db, serverId, s, null);
    s = getServer(db, serverId);
  }
  return s;
}

function resolveActiveEventId(nowMs = Date.now(), activeSeason = null) {
  const events = eventsContent?.events ?? [];
  const active = [];

  for (const event of events) {
    if (!event?.event_id) continue;
    if (activeSeason && event?.season && event.season !== activeSeason) continue;
    const window = getEventWindow(event, nowMs);
    if (!window.start || !window.end) continue;
    if (nowMs < window.start || nowMs > window.end) continue;
    active.push({ event, window });
  }

  if (!active.length) return null;
  active.sort((a, b) => a.window.start - b.window.start);
  return active[0].event.event_id;
}

async function syncEventsOnce(getKnownServerIds) {
  const serverIds = await getKnownServerIds();
  for (const serverId of serverIds) {
    try {
      const s = ensureServer(serverId);
      const settings = buildSettingsMap(settingsCatalog, s.settings);
      const activeSeason = computeActiveSeason(settings);
      const activeEventId = resolveActiveEventId(Date.now(), activeSeason);
      if (s.active_event_id === activeEventId) continue;

      const previous = s.active_event_id ?? null;
      s.active_event_id = activeEventId;
      s.audit_log.push({
        ts: nowTs(),
        actor_id: "system",
        action: "event_sync",
        details: { previous, next: activeEventId }
      });
      upsertServer(db, serverId, s, null);
    } catch (e) {
      console.error("event_sync failed", serverId, e);
    }
  }
}

export function startEventSyncScheduler(getKnownServerIds) {
  if (!db) return;
  syncEventsOnce(getKnownServerIds).catch((e) => {
    console.error("event_sync failed", e);
  });
  cron.schedule("5 0 * * *", async () => {
    await syncEventsOnce(getKnownServerIds);
  }, { timezone: "UTC" });
}
