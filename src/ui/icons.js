import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedIcons = null;

function flattenIcons(rawIcons) {
  const out = {};
  if (!rawIcons || typeof rawIcons !== "object") return out;

  for (const [key, value] of Object.entries(rawIcons)) {
    if (typeof value === "string") {
      out[key] = value;
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [childKey, childValue] of Object.entries(value)) {
        if (typeof childValue === "string") {
          out[childKey] = childValue;
        }
      }
    }
  }

  return out;
}

function loadIcons() {
  if (cachedIcons) return cachedIcons;
  const p = path.join(__dirname, "..", "..", "content", "icons.json");
  const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
  cachedIcons = flattenIcons(raw?.icons ?? {});
  return cachedIcons;
}

export function getIcon(id, fallback = "?") {
  const icons = loadIcons();
  const value = icons?.[id];
  if (!value) return fallback;
  if (typeof value === "string" && value.startsWith("http")) return fallback;
  return value;
}

const CUSTOM_EMOJI_RE = /^<a?:([^:]+):(\d+)>$/;

export function getButtonEmoji(id) {
  const icons = loadIcons();
  const value = icons?.[id];
  if (!value || typeof value !== "string") return null;
  if (value.startsWith("http")) return null;
  const match = value.match(CUSTOM_EMOJI_RE);
  if (match) {
    return { name: match[1], id: match[2], animated: value.startsWith("<a:") };
  }
  return value;
}

export function applyButtonEmoji(button, iconId) {
  const emoji = getButtonEmoji(iconId);
  if (emoji) button.setEmoji(emoji);
  return button;
}

export function getIconUrl(id) {
  const icons = loadIcons();
  const value = icons?.[id];
  if (typeof value === "string" && value.startsWith("http")) return value;
  return null;
}

export function resolveIcon(value, fallback = "?") {
  if (!value) return fallback;
  if (typeof value !== "string") return fallback;
  const icons = loadIcons();
  if (icons?.[value]) return getIcon(value, fallback);
  return value;
}

export function getCustomEmojiEntries() {
  const icons = loadIcons();
  const entries = [];

  for (const [key, value] of Object.entries(icons ?? {})) {
    if (typeof value !== "string") continue;
    const match = value.match(CUSTOM_EMOJI_RE);
    if (!match) continue;
    entries.push({ key, name: match[1], id: match[2], animated: value.startsWith("<a:") });
  }

  return entries;
}
