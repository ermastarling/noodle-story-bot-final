export function ensureRuntimeSchemaColumns(db) {
  const additions = [
    ["weekly_giveaways", "confirmation_status", "TEXT NOT NULL DEFAULT 'pending'"],
    ["weekly_giveaways", "confirmation_started_at", "INTEGER"],
    ["weekly_giveaways", "valor_confirmation_status", "TEXT NOT NULL DEFAULT 'pending'"],
    ["weekly_giveaways", "valor_confirmation_started_at", "INTEGER"],
    ["weekly_giveaways", "valor_confirmation_message_id", "TEXT"],
    ["weekly_giveaways", "posting_started_at", "INTEGER"],
    ["scheduled_game_updates", "attempt_channel_id", "TEXT"],
    ["scheduled_game_updates", "attempt_canary", "INTEGER"]
  ];
  const migrate = db.transaction(() => {
    for (const [table, column, definition] of additions) {
      const existing = db.prepare(`PRAGMA table_info(${table})`).all();
      if (!existing.some((entry) => entry.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    }
  });
  migrate();
}
