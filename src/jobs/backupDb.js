import fs from "fs";
import path from "path";
import cron from "node-cron";
import { runWithTelemetry } from "../infra/telemetry.js";

const DEFAULT_CRON = "0 3 * * *"; // 03:00 UTC daily
const DEFAULT_RETAIN = 14;

function resolveBackupDir() {
  const base = process.env.NOODLE_BACKUP_DIR || path.join(process.cwd(), "data", "backups");
  fs.mkdirSync(base, { recursive: true });
  return base;
}

function formatStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function listBackups(dir) {
  return fs.readdirSync(dir)
    .filter((name) => name.startsWith("noodlestory-") && name.endsWith(".sqlite"))
    .map((name) => ({
      name,
      fullPath: path.join(dir, name),
      stat: fs.statSync(path.join(dir, name))
    }))
    .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);
}

function cleanupOldBackups(dir, retainCount) {
  const backups = listBackups(dir);
  const excess = backups.length - retainCount;
  if (excess <= 0) return;
  const toDelete = backups.slice(0, excess);
  for (const file of toDelete) {
    try {
      fs.unlinkSync(file.fullPath);
      console.log(`🧹 Deleted old backup: ${file.name}`);
    } catch (e) {
      console.error(`⚠️ Failed to delete backup ${file.name}:`, e?.message ?? e);
    }
  }
}

let isRunning = false;

export async function runDbBackup(db, reason = "scheduled") {
  if (!db) return false;
  if (isRunning) {
    console.log("⏭️  Backup already running, skipping");
    return "skipped";
  }
  isRunning = true;

  try {
    const dir = resolveBackupDir();
    const stamp = formatStamp();
    const dest = path.join(dir, `noodlestory-${stamp}.sqlite`);
    const latest = path.join(dir, "latest.sqlite");
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
    } catch (e) {
      console.warn("⚠️ WAL checkpoint failed:", e?.message ?? e);
    }

    await db.backup(dest);
    try {
      fs.copyFileSync(dest, latest);
      console.log(`✅ DB backup (${reason}) saved: ${dest} (latest.sqlite updated)`);
    } catch (e) {
      console.error("⚠️ Failed to update latest.sqlite:", e?.message ?? e);
    }

    const retain = Number.parseInt(process.env.NOODLE_BACKUP_RETAIN || "", 10);
    const retainCount = Number.isFinite(retain) && retain > 0 ? retain : DEFAULT_RETAIN;
    cleanupOldBackups(dir, retainCount);
    return true;
  } catch (e) {
    console.error("❌ DB backup failed:", e?.stack ?? e);
    return false;
  } finally {
    isRunning = false;
  }
}

export function startDbBackupScheduler(db) {
  if (!db) return;
  const cronExpr = process.env.NOODLE_BACKUP_CRON || DEFAULT_CRON;
  cron.schedule(cronExpr, () => {
    return runWithTelemetry("database_backup", "scheduled", () => runDbBackup(db, "scheduled"));
  }, { timezone: "UTC" });
}
