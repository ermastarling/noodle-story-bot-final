import { randomInt } from "node:crypto";

const ALLOWED_PACKS = new Set(["coin_pack_099", "coin_pack_199", "coin_pack_499"]);
const ALLOWED_PERKS = new Set(["house_247", "takeout_counter"]);
const DAY_MS = 24 * 60 * 60 * 1000;

export function getGiveawayWeekStart(now = Date.now()) {
  const date = new Date(now);
  const daysSinceWednesday = (date.getUTCDay() - 3 + 7) % 7;
  let start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceWednesday, 21, 0, 0, 0);
  if (start > now) start -= 7 * DAY_MS;
  return start;
}

export function listCurrentWeeklyGiveaways(db, guildId, now = Date.now()) {
  const safeGuildId = String(guildId ?? "").trim();
  if (!db || !safeGuildId) return [];
  const weekKey = String(getGiveawayWeekStart(now));
  return db.prepare(`
    SELECT
      g.giveaway_id,
      g.guild_id,
      g.week_key,
      g.contest_number,
      g.closes_at,
      COUNT(e.user_id) AS entrant_count
    FROM weekly_giveaways g
    LEFT JOIN weekly_giveaway_entries e ON e.giveaway_id = g.giveaway_id
    WHERE g.guild_id = ? AND g.week_key = ? AND g.status = 'open' AND g.closes_at > ?
    GROUP BY g.giveaway_id, g.guild_id, g.week_key, g.contest_number, g.closes_at
    ORDER BY g.contest_number
  `).all(safeGuildId, weekKey, now);
}

export function getCurrentWeeklyGiveawayEntries(db, {
  guildId,
  giveawayId,
  page = 1,
  pageSize = 20,
  now = Date.now()
} = {}) {
  const giveaway = listCurrentWeeklyGiveaways(db, guildId, now)
    .find((entry) => entry.giveaway_id === String(giveawayId ?? "").trim());
  if (!giveaway) return null;

  const safePageSize = Math.max(1, Math.min(50, Math.floor(Number(pageSize) || 20)));
  const totalEntries = Number(giveaway.entrant_count) || 0;
  const totalPages = Math.max(1, Math.ceil(totalEntries / safePageSize));
  const safePage = Math.min(totalPages, Math.max(1, Math.floor(Number(page) || 1)));
  const entries = db.prepare(`
    SELECT user_id, entered_at
    FROM weekly_giveaway_entries
    WHERE giveaway_id = ?
    ORDER BY entered_at, user_id
    LIMIT ? OFFSET ?
  `).all(giveaway.giveaway_id, safePageSize, (safePage - 1) * safePageSize);

  return {
    ...giveaway,
    entrant_count: totalEntries,
    entries,
    page: safePage,
    page_size: safePageSize,
    total_pages: totalPages
  };
}

function validatePrize(prize) {
  if (!prize || typeof prize !== "object") return false;
  if (prize.type === "coins") {
    return Number.isSafeInteger(prize.amount) && prize.amount >= 5000 && prize.amount <= 50000 && prize.amount % 5000 === 0;
  }
  if (prize.type === "coin_pack") return ALLOWED_PACKS.has(prize.pack_id);
  if (prize.type === "perks") {
    return Array.isArray(prize.perks)
      && prize.perks.length >= 1
      && prize.perks.length <= 2
      && new Set(prize.perks).size === prize.perks.length
      && prize.perks.every((perk) => ALLOWED_PERKS.has(perk));
  }
  if (prize.type === "valor") {
    return Number.isSafeInteger(prize.amount)
      && prize.amount >= 100
      && prize.amount <= 500
      && prize.amount % 50 === 0;
  }
  return false;
}

export function validateGiveawayContent(content) {
  const pools = content?.prize_pools_by_contest_count;
  for (const contestCount of [1, 2, 3]) {
    const pool = pools?.[String(contestCount)];
    if (!Array.isArray(pool) || pool.length < contestCount) {
      throw new Error(`Giveaway prize pool for ${contestCount} contest(s) is incomplete`);
    }
    if (pool.some((prize) => !validatePrize(prize))) {
      throw new Error(`Giveaway prize pool for ${contestCount} contest(s) has an invalid reward`);
    }
  }
  return pools;
}

export function chooseWeeklyContestCount(rng = randomInt) {
  return rng(1, 4);
}

export function chooseWeeklyPrizes(contestCount, content, rng = randomInt) {
  const pools = validateGiveawayContent(content);
  if (![1, 2, 3].includes(contestCount)) {
    throw new Error("Weekly giveaway contest count must be between 1 and 3");
  }
  const pool = pools[String(contestCount)];
  const available = [...pool];
  const prizes = [];
  while (prizes.length < contestCount) {
    const index = rng(0, available.length);
    prizes.push(structuredClone(available.splice(index, 1)[0]));
  }
  return prizes;
}

export function recordGiveawayEntry(db, {
  giveawayId,
  guildId,
  channelId,
  messageId,
  userId,
  now = Date.now()
} = {}) {
  if (!db) return { ok: false, reason: "database_unavailable" };
  const enter = db.transaction(() => {
    const giveaway = db.prepare("SELECT * FROM weekly_giveaways WHERE giveaway_id = ?").get(giveawayId);
    if (!giveaway || giveaway.guild_id !== guildId || giveaway.channel_id !== channelId || giveaway.message_id !== messageId) {
      return { ok: false, reason: "giveaway_not_found" };
    }
    if (giveaway.status !== "open" || Number(giveaway.closes_at) <= now) {
      return { ok: false, reason: "giveaway_closed" };
    }
    const priorWin = db.prepare(
      "SELECT 1 FROM weekly_giveaway_wins WHERE guild_id = ? AND week_key = ? AND user_id = ?"
    ).get(guildId, giveaway.week_key, userId);
    if (priorWin) return { ok: false, reason: "already_won_this_week" };

    const result = db.prepare(`
      INSERT OR IGNORE INTO weekly_giveaway_entries (giveaway_id, user_id, entered_at)
      VALUES (?, ?, ?)
    `).run(giveawayId, userId, now);
    return { ok: true, alreadyEntered: Number(result?.changes ?? 0) === 0 };
  });
  return enter();
}
