import cron from "node-cron";
import { openDb, getServer, upsertServer } from "../db/index.js";
import { newServerState } from "../game/server.js";
import { loadContentBundle, loadSettingsCatalog, loadEventsContent } from "../content/index.js";
import { buildSettingsMap } from "../settings/resolve.js";
import { computeActiveSeason } from "../game/seasons.js";
import { rollMarket } from "../game/market.js";
import { getActiveEventEffects, withEventRecipes } from "../game/events.js";
import { ensureDailyOrders } from "../game/orders.js";
import { dayKeyUTC, nowTs } from "../util/time.js";

const db = openDb();
const baseContent = loadContentBundle(1);
const catalog = loadSettingsCatalog();
const eventsContent = loadEventsContent();
const content = withEventRecipes(baseContent, eventsContent);

function ensureServer(serverId) {
  let s = getServer(db, serverId);
  if (!s) {
    s = newServerState(serverId);
    upsertServer(db, serverId, s, null);
    s = getServer(db, serverId);
  }
  return s;
}

export function startDailyResetScheduler(getKnownServerIds) {
  // Default: midnight UTC
  cron.schedule("0 0 * * *", async () => {
    const serverIds = await getKnownServerIds();
    for (const serverId of serverIds) {
      try {
        const s = ensureServer(serverId);
        const settings = buildSettingsMap(catalog, s.settings);
        const today = dayKeyUTC();

        s.season = computeActiveSeason(settings);
        const activeEventEffects = getActiveEventEffects(eventsContent, s);
        const activeEventId = s.active_event_id ?? null;
        rollMarket({ serverId, content, serverState: s, eventEffects: activeEventEffects });
        ensureDailyOrders(s, settings, content, new Set(["classic_soy_ramen"]), serverId, activeEventId);
        
        s.audit_log.push({ ts: nowTs(), actor_id: "system", action: "daily_reset", details: { day: today }});
        upsertServer(db, serverId, s, null);
      } catch (e) {
        console.error("daily_reset failed", serverId, e);
      }
    }
  }, { timezone: "UTC" });
}
