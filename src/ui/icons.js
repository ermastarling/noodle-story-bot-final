import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedIcons = null;

function loadIcons() {
  if (cachedIcons) return cachedIcons;
  const p = path.join(__dirname, "..", "..", "content", "icons.json");
  const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
  cachedIcons = raw?.icons ?? {};
  return cachedIcons;
}

export function getIcon(id, fallback = "?") {
  const icons = loadIcons();
  const value = icons?.[id];
  if (!value) return fallback;
  if (typeof value === "string" && value.startsWith("http")) return fallback;
  return value;
}

export function getIconUrl(id) {
  const icons = loadIcons();
  const value = icons?.[id];
  if (typeof value === "string" && value.startsWith("http")) return value;
  return null;
}
