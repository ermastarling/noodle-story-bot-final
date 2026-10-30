const DISCORD_SNOWFLAKE = /^\d{17,20}$/;
const DELIVERY_STALE_AFTER_MS = 10 * 60 * 1000;

export function claimScheduledMessageDelivery(db, jobId, now = Date.now(), channelId = null) {
  const attemptChannelId = DISCORD_SNOWFLAKE.test(String(channelId ?? "")) ? String(channelId) : null;
  const result = db.prepare(`
    INSERT INTO scheduled_message_delivery (job_id, status, attempt_started_at, attempt_channel_id, updated_at)
    VALUES (?, 'sending', ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET
      status = 'sending',
      attempt_started_at = excluded.attempt_started_at,
      attempt_channel_id = excluded.attempt_channel_id,
      updated_at = excluded.updated_at
    WHERE scheduled_message_delivery.status = 'sent'
  `).run(String(jobId), now, attemptChannelId, now);
  return result.changes === 1;
}

export function completeScheduledMessageDelivery(db, jobId, now = Date.now()) {
  return db.prepare(`
    UPDATE scheduled_message_delivery SET status = 'sent', updated_at = ?
    WHERE job_id = ? AND status = 'sending'
  `).run(now, String(jobId)).changes === 1;
}

export function markScheduledMessageDeliveryUnknown(db, jobId, now = Date.now()) {
  return db.prepare(`
    UPDATE scheduled_message_delivery SET status = 'delivery_unknown', updated_at = ?
    WHERE job_id = ? AND status = 'sending'
  `).run(now, String(jobId)).changes === 1;
}

export function markStaleScheduledDeliveriesUnknown(db, now = Date.now()) {
  if (!db) throw new Error("Database is required");
  const cutoff = now - DELIVERY_STALE_AFTER_MS;
  return db.transaction(() => {
    const results = [
      db.prepare(`
        UPDATE scheduled_message_delivery SET status = 'delivery_unknown', updated_at = ?
        WHERE status = 'sending' AND attempt_started_at <= ?
      `).run(now, cutoff),
      db.prepare(`
        UPDATE scheduled_game_updates SET status = 'delivery_unknown', updated_at = ?
        WHERE status = 'sending' AND updated_at <= ?
      `).run(now, cutoff),
      db.prepare(`
        UPDATE game_update_season_state SET status = 'delivery_unknown', updated_at = ?
        WHERE status = 'sending' AND updated_at <= ?
      `).run(now, cutoff),
      db.prepare(`
        UPDATE weekly_giveaways SET status = 'delivery_unknown'
        WHERE status = 'posting' AND posting_started_at <= ?
      `).run(cutoff),
      db.prepare(`
        UPDATE weekly_giveaways SET confirmation_status = 'delivery_unknown'
        WHERE confirmation_status = 'sending' AND confirmation_started_at <= ?
      `).run(cutoff),
      db.prepare(`
        UPDATE weekly_giveaways SET valor_confirmation_status = 'delivery_unknown'
        WHERE valor_confirmation_status = 'sending' AND valor_confirmation_started_at <= ?
      `).run(cutoff)
    ];
    return results.reduce((sum, result) => sum + result.changes, 0);
  })();
}

export function reconcileScheduledDelivery(db, {
  type,
  recordId,
  resolution,
  messageId,
  verifiedAbsent = false,
  now = Date.now()
} = {}) {
  if (!db) throw new Error("Database is required");
  const id = String(recordId ?? "").trim();
  if (!id) return { ok: false, reason: "missing_record_id" };
  if (!["delivered", "not_delivered"].includes(resolution)) {
    return { ok: false, reason: "invalid_resolution" };
  }
  if (resolution === "not_delivered" && verifiedAbsent !== true) {
    return { ok: false, reason: "absence_not_verified" };
  }
  const resolvedMessageId = String(messageId ?? "").trim();
  if (resolution === "delivered" && !DISCORD_SNOWFLAKE.test(resolvedMessageId)) {
    return { ok: false, reason: "invalid_message_id" };
  }

  return db.transaction(() => {
    if (type === "scheduled_message") {
      const row = db.prepare(
        "SELECT status, attempt_channel_id FROM scheduled_message_delivery WHERE job_id = ?"
      ).get(id);
      if (row?.status !== "delivery_unknown") return { ok: false, reason: "not_unknown" };
      if (resolution === "delivered") {
        const attemptChannelId = String(row.attempt_channel_id ?? "");
        if (!DISCORD_SNOWFLAKE.test(attemptChannelId)) {
          return { ok: false, reason: "missing_attempt_provenance" };
        }
        const updated = db.prepare(`
          UPDATE scheduled_message_delivery SET status = 'sent', updated_at = ?
          WHERE job_id = ? AND status = 'delivery_unknown' AND attempt_channel_id = ?
        `).run(now, id, attemptChannelId);
        if (updated.changes !== 1) return { ok: false, reason: "not_unknown" };
        db.prepare(`
          INSERT INTO scheduled_message_state (job_id, channel_id, message_id, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(job_id) DO UPDATE SET
            channel_id = excluded.channel_id,
            message_id = excluded.message_id,
            updated_at = excluded.updated_at
        `).run(id, attemptChannelId, resolvedMessageId, now);
      } else {
        const deleted = db.prepare("DELETE FROM scheduled_message_delivery WHERE job_id = ? AND status = 'delivery_unknown'").run(id);
        if (deleted.changes !== 1) return { ok: false, reason: "not_unknown" };
      }
      return { ok: true, status: resolution === "delivered" ? "sent" : "cleared" };
    }

    if (type === "game_update") {
      const row = db.prepare(
        "SELECT guild_id, rollout_summary, attempt_channel_id, attempt_canary FROM scheduled_game_updates WHERE schedule_id = ? AND status = 'delivery_unknown'"
      ).get(id);
      if (!row) return { ok: false, reason: "not_unknown" };
      if (resolution === "not_delivered") {
        const result = db.prepare(`
          UPDATE scheduled_game_updates
          SET status = 'pending', attempt_channel_id = NULL, attempt_canary = NULL, updated_at = ?
          WHERE schedule_id = ? AND status = 'delivery_unknown'
        `).run(now, id);
        if (result.changes !== 1) return { ok: false, reason: "not_unknown" };
        return { ok: true, status: "pending" };
      }
      if (
        !DISCORD_SNOWFLAKE.test(String(row.attempt_channel_id ?? ""))
        || ![0, 1].includes(row.attempt_canary)
      ) {
        return { ok: false, reason: "missing_attempt_provenance" };
      }
      const publicRelease = row.attempt_canary === 0;
      const nextStatus = publicRelease ? "sent" : (row.rollout_summary ? "canary_previewed" : "sent");
      const result = db.prepare(`
        UPDATE scheduled_game_updates SET status = ?, message_id = ?, updated_at = ?
        WHERE schedule_id = ? AND status = 'delivery_unknown'
          AND attempt_channel_id = ? AND attempt_canary = ?
      `).run(
        nextStatus,
        resolvedMessageId,
        now,
        id,
        row.attempt_channel_id,
        row.attempt_canary
      );
      if (result.changes !== 1) return { ok: false, reason: "not_unknown" };
      if (publicRelease && row.rollout_summary) {
        db.prepare(`
          INSERT INTO game_update_release_state (guild_id, first_update_sent_at, first_update_id)
          VALUES (?, ?, ?)
          ON CONFLICT(guild_id) DO NOTHING
        `).run(row.guild_id, now, id);
      }
      return { ok: true, status: nextStatus };
    }

    if (type === "season_update") {
      const row = db.prepare(
        "SELECT status, attempt_channel_id, attempt_canary FROM game_update_season_state WHERE guild_id = ?"
      ).get(id);
      if (row?.status !== "delivery_unknown") return { ok: false, reason: "not_unknown" };
      if (resolution === "not_delivered") {
        const result = db.prepare(`
          UPDATE game_update_season_state
          SET status = 'pending', message_id = NULL, attempt_channel_id = NULL, attempt_canary = NULL, updated_at = ?
          WHERE guild_id = ? AND status = 'delivery_unknown'
        `).run(now, id);
        if (result.changes !== 1) return { ok: false, reason: "not_unknown" };
        return { ok: true, status: "pending" };
      }
      if (
        !DISCORD_SNOWFLAKE.test(String(row.attempt_channel_id ?? ""))
        || ![0, 1].includes(row.attempt_canary)
      ) {
        return { ok: false, reason: "missing_attempt_provenance" };
      }
      const status = row.attempt_canary === 1 ? "canary_previewed" : "sent";
      const result = db.prepare(`
        UPDATE game_update_season_state SET status = ?, message_id = ?, updated_at = ?
        WHERE guild_id = ? AND status = 'delivery_unknown'
          AND attempt_channel_id = ? AND attempt_canary = ?
      `).run(status, resolvedMessageId, now, id, row.attempt_channel_id, row.attempt_canary);
      if (result.changes !== 1) return { ok: false, reason: "not_unknown" };
      return { ok: true, status };
    }

    const giveawayFields = {
      giveaway_post: ["status", "message_id", "posting_started_at"],
      giveaway_winner: ["confirmation_status", "confirmation_message_id", "confirmation_started_at"],
      valor_confirmation: ["valor_confirmation_status", "valor_confirmation_message_id", "valor_confirmation_started_at"]
    };
    const fields = giveawayFields[type];
    if (!fields) return { ok: false, reason: "invalid_type" };
    const [statusField, messageField, startedField] = fields;
    const row = db.prepare(`
      SELECT ${statusField} AS status, award_status, closes_at
      FROM weekly_giveaways WHERE giveaway_id = ?
    `).get(id);
    if (row?.status !== "delivery_unknown") return { ok: false, reason: "not_unknown" };
    if (type === "valor_confirmation" && row.award_status !== "awaiting_manual") {
      return { ok: false, reason: "not_awaiting_fulfillment" };
    }
    if (type === "giveaway_post" && resolution === "not_delivered" && Number(row.closes_at) <= now) {
      db.prepare(`
        UPDATE weekly_giveaways SET status = 'closed', award_status = 'no_winner',
          message_id = NULL, posting_started_at = NULL
        WHERE giveaway_id = ? AND status = 'delivery_unknown'
      `).run(id);
      return { ok: true, status: "closed_no_winner" };
    }

    const status = type === "giveaway_post"
      ? "open"
      : resolution === "delivered"
        ? (type === "giveaway_winner" ? "sent" : "confirmed")
        : "pending";
    const updateGiveaway = db.prepare(`
      UPDATE weekly_giveaways SET ${statusField} = ?, ${messageField} = ?, ${startedField} = NULL
      ${type === "giveaway_winner" && resolution === "delivered" ? ", status = 'closed'" : ""}
      WHERE giveaway_id = ? AND ${statusField} = 'delivery_unknown'
    `);
    const result = updateGiveaway.run(status, resolution === "delivered" ? resolvedMessageId : null, id);
    if (result.changes !== 1) return { ok: false, reason: "not_unknown" };
    return { ok: true, status };
  })();
}
