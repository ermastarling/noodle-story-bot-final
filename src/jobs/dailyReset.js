import cron from "node-cron";
import { openDb, getServer, upsertServer } from "../db/index.js";
import { newServerState } from "../game/server.js";
import { loadContentBundle, loadSettingsCatalog, loadStaffContent } from "../content/index.js";
import { buildSettingsMap } from "../settings/resolve.js";
import { computeActiveSeason } from "../game/seasons.js";
import { rollMarket } from "../game/market.js";
import { ensureDailyOrders } from "../game/orders.js";
import { rollDailyStaffPool } from "../game/staff.js";
import { dayKeyUTC, nowTs } from "../util/time.js";

const db = openDb();
const content = loadContentBundle(1);
const catalog = loadSettingsCatalog();
const staffContent = loadStaffContent();

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
        rollMarket({ serverId, content, serverState: s });
        ensureDailyOrders(s, settings, content, new Set(["classic_soy_ramen"]), serverId);
        
        // Roll daily staff pool
        const staffPool = rollDailyStaffPool({ serverId, staffContent });
        s.staff_pool = staffPool;
        s.staff_day = today;

        s.audit_log.push({ ts: nowTs(), actor_id: "system", action: "daily_reset", details: { day: today }});
        upsertServer(db, serverId, s, null);
      } catch (e) {
        console.error("daily_reset failed", serverId, e);
      }
    }
  }, { timezone: "UTC" });
}
