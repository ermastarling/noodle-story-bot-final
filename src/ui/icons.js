import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedIcons = null;
const FORCE_UNICODE_EMOJI = String(process.env.NOODLE_FORCE_UNICODE_EMOJI || "0") === "1";

const UNICODE_EMOJI_FALLBACKS = {
  orders: "📋",
  cart: "🛒",
  pantry: "🧺",
  profile: "👤",
  forage: "🌿",
  garden: "🌱",
  fishing: "🎣",
  kitchen: "🍲",
  refresh: "🔄",
  compost_bag: "🧪",
  harvest: "🪴",
  cook: "🍜",
  serve: "🍽️",
  status_complete: "✅",
  status_pending: "🕒",
  cancel: "❌",
  back: "◀️",
  next: "▶️",
  new: "🆕",
  recipes: "📖",
  regulars: "🤝",
  quests: "🧭",
  note: "📝",
  tag: "🏷️",
  sparkle: "✨",
  daily_reward: "🎁",
  season: "🍂",
  event: "🎉",
  vote: "🗳️",
  coins: "🪙",
  basket: "🧺",
  mail: "✉️",
  help: "❓",
  warning: "⚠️",
  confetti: "🎊",
  lock: "🔒",
  time: "⏰"
};

function getUnicodeEmojiFallback(id) {
  return UNICODE_EMOJI_FALLBACKS?.[id] ?? null;
}

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
  if (!value) return getUnicodeEmojiFallback(id) ?? fallback;
  if (typeof value === "string" && value.startsWith("http")) return fallback;
  if (FORCE_UNICODE_EMOJI) return getUnicodeEmojiFallback(id) ?? fallback;
  return value;
}

const CUSTOM_EMOJI_RE = /^<a?:([^:]+):(\d+)>$/;

export function normalizeComponentEmoji(emoji) {
  if (!emoji) return null;

  if (typeof emoji === "string") {
    const raw = emoji.trim();
    if (!raw) return null;
    const customMatch = raw.match(CUSTOM_EMOJI_RE);
    if (customMatch) {
      return {
        name: customMatch[1],
        id: customMatch[2],
        animated: raw.startsWith("<a:")
      };
    }
    return { name: raw };
  }

  if (emoji && typeof emoji === "object") {
    const name = String(emoji.name ?? "").trim();
    const id = emoji.id == null ? undefined : String(emoji.id).trim();
    const animated = Boolean(emoji.animated);
    if (!name && !id) return null;

    const out = {};
    if (name) out.name = name;
    if (id) out.id = id;
    if (animated) out.animated = true;
    return out;
  }

  return null;
}

export function getButtonEmoji(id) {
  const icons = loadIcons();
  const value = icons?.[id];
  if (FORCE_UNICODE_EMOJI) return getUnicodeEmojiFallback(id);
  if (!value || typeof value !== "string") return getUnicodeEmojiFallback(id);
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

function normalizeSceneBannerKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function getSceneBannerUrl(sceneKey, fallback = null) {
  const normalized = normalizeSceneBannerKey(sceneKey);
  if (!normalized) return fallback;

  const icons = loadIcons();
  const candidates = [
    normalized,
    `scene_banner_${normalized}`,
    `scene_${normalized}_banner`,
    `scenebanner_${normalized}`
  ];

  for (const candidate of candidates) {
    const value = icons?.[candidate];
    if (typeof value === "string" && value.startsWith("http")) {
      return value;
    }
  }

  return fallback;
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
