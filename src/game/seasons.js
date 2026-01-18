import { parseYYYYMMDD } from "../util/time.js";

export function computeActiveSeason(settings, nowUtcMs = Date.now()) {
  const mode = settings.SEASON_MODE ?? "rolling_days";
  if (mode === "fixed_dates") {
    const m = new Date(nowUtcMs).getUTCMonth() + 1;
    if (m>=3 && m<=5) return "spring";
    if (m>=6 && m<=8) return "summer";
    if (m>=9 && m<=11) return "autumn";
    return "winter";
  }
  const duration = Number(settings.SEASON_DURATION_DAYS ?? 28);
  const anchor = String(settings.SEASON_START_ANCHOR ?? "2026-01-01");
  const anchorMs = parseYYYYMMDD(anchor);
  const daysElapsed = Math.floor((nowUtcMs - anchorMs) / (24*3600*1000));
  const idx = ((Math.floor(daysElapsed / duration) % 4) + 4) % 4;
  return ["spring","summer","autumn","winter"][idx];
}
