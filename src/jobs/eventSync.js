import cron from "node-cron";
import { openDb, getServer, upsertServer } from "../db/index.js";
import { newServerState } from "../game/server.js";
import { loadEventsContent, loadSettingsCatalog } from "../content/index.js";
import { buildSettingsMap } from "../settings/resolve.js";
import { computeActiveSeason } from "../game/seasons.js";
import { resolveActiveEventId } from "../game/events.js";
import { nowTs } from "../util/time.js";
import { runWithTelemetry } from "../infra/telemetry.js";

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

async function syncEventsOnce(getKnownServerIds) {
  const serverIds = await getKnownServerIds();
  let failed = false;
  for (const serverId of serverIds) {
    try {
      const s = ensureServer(serverId);
      const settings = buildSettingsMap(settingsCatalog, s.settings);
      const activeSeason = computeActiveSeason(settings);
      const activeEventId = resolveActiveEventId(eventsContent, Date.now(), activeSeason);
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
      failed = true;
      console.error("event_sync failed", serverId, e);
    }
  }
  return !failed;
}

export function startEventSyncScheduler(getKnownServerIds) {
  if (!db) return;
  runWithTelemetry("event_sync", "startup", () => syncEventsOnce(getKnownServerIds)).catch((e) => {
    console.error("event_sync failed", e);
  });
  cron.schedule("5 0 * * *", () => {
    return runWithTelemetry("event_sync", "scheduled", () => syncEventsOnce(getKnownServerIds)).catch((e) => {
      console.error("event_sync failed", e);
    });
  }, { timezone: "UTC" });
}
