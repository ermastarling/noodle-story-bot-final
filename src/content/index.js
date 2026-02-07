import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function loadContentBundle(version = 1) {
  const p = path.join(__dirname, "..", "..", "content", `bundle.v${version}.json`);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export function loadSettingsCatalog() {
  const p = path.join(__dirname, "..", "..", "content", "settings.catalog.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export function loadStaffContent() {
  const p = path.join(__dirname, "..", "..", "content", "staff.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export function loadUpgradesContent() {
  const p = path.join(__dirname, "..", "..", "content", "upgrades.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export function loadQuestsContent() {
  const p = path.join(__dirname, "..", "..", "content", "quests.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export function loadDailyRewards() {
  const p = path.join(__dirname, "..", "..", "content", "daily.rewards.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export function loadBadgesContent() {
  const p = path.join(__dirname, "..", "..", "content", "badges.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export function loadCollectionsContent() {
  const p = path.join(__dirname, "..", "..", "content", "collections.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export function loadSpecializationsContent() {
  const p = path.join(__dirname, "..", "..", "content", "specializations.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export function loadDecorContent() {
  const p = path.join(__dirname, "..", "..", "content", "decor.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export function loadDecorSetsContent() {
  const p = path.join(__dirname, "..", "..", "content", "decor.sets.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export function loadEventsContent() {
  const p = path.join(__dirname, "..", "..", "content", "events.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}
