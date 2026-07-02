import { theme } from "./theme.js";

const MESSAGE_FLAG_EPHEMERAL = 1 << 6;
export const MESSAGE_FLAG_IS_COMPONENTS_V2 = 1 << 15;
const DEFAULT_MENU_ACCENT_COLOR = Number(theme?.colors?.primary ?? 0xE2B86B);
const DEFAULT_MENU_DIVIDER_TEXT = "━━━━━━━━━━━━━━━━━━━━━━━━";

function parseMenuColor(value, fallback = DEFAULT_MENU_ACCENT_COLOR) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;

  const raw = String(value).trim();
  if (!raw) return fallback;
  const normalized = raw.startsWith("#") ? raw.slice(1) : raw;
  if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
    const parsed = Number.parseInt(normalized, 16);
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  }

  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  return fallback;
}

function normalizeUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return "";
}

function shouldShowDivider(value, fallback = true) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

export function resolveComponentsV2MenuGuide(env = process.env, overrides = {}) {
  const accentColor = parseMenuColor(
    overrides.accentColor ?? env?.NOODLE_COMPONENTS_V2_MENU_ACCENT_COLOR,
    DEFAULT_MENU_ACCENT_COLOR
  );
  const dividerText = String(
    overrides.dividerText
    ?? env?.NOODLE_COMPONENTS_V2_MENU_DIVIDER_TEXT
    ?? env?.NOODLE_COMPONENTS_V2_MENU_DIVIDER_LABEL
    ?? DEFAULT_MENU_DIVIDER_TEXT
  ).trim() || DEFAULT_MENU_DIVIDER_TEXT;
  const imageUrl = normalizeUrl(overrides.imageUrl ?? env?.NOODLE_COMPONENTS_V2_MENU_IMAGE_URL ?? "");
  const addDivider = shouldShowDivider(
    overrides.addDivider ?? env?.NOODLE_COMPONENTS_V2_MENU_SHOW_DIVIDER,
    true
  );

  return {
    accentColor,
    dividerText,
    imageUrl,
    addDivider
  };
}

function applyMenuGuideToComponents(components = [], menuGuide = {}) {
  const out = Array.isArray(components) ? [...components] : [];
  if (menuGuide.imageUrl) {
    out.unshift({ type: 10, content: `Menu image: ${menuGuide.imageUrl}` });
  }

  if (menuGuide.addDivider) {
    const firstActionRowIndex = out.findIndex((component) => Number(component?.type) === 1);
    if (firstActionRowIndex >= 0) {
      out.splice(firstActionRowIndex, 0, {
        type: 14,
        divider: true,
        spacing: 1
      });
    }
  }

  return out;
}

export function buildComponentsV2MenuPayload({
  components = [],
  ephemeral = false,
  accentColor,
  dividerText,
  imageUrl,
  addDivider,
  env = process.env
} = {}) {
  const menuGuide = resolveComponentsV2MenuGuide(env, {
    accentColor,
    dividerText,
    imageUrl,
    addDivider
  });

  const container = {
    type: 17,
    components: applyMenuGuideToComponents(components, menuGuide)
  };

  if (Number.isInteger(menuGuide.accentColor) && menuGuide.accentColor >= 0) {
    container.accent_color = menuGuide.accentColor;
  }

  const flags = ephemeral
    ? (MESSAGE_FLAG_IS_COMPONENTS_V2 | MESSAGE_FLAG_EPHEMERAL)
    : MESSAGE_FLAG_IS_COMPONENTS_V2;

  return {
    flags,
    components: [container]
  };
}

function normalizeSnowflake(value) {
  return String(value ?? "").trim();
}

function isEnabled(value) {
  return String(value ?? "0").trim() === "1";
}

function parseAllowlist(value) {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((part) => normalizeSnowflake(part))
      .filter(Boolean)
  );
}

function isTutorialActive(player) {
  return Boolean(player?.tutorial?.active === true);
}

export function resolveComponentsV2TargetGuild(env = process.env) {
  return normalizeSnowflake(env?.NOODLE_DEV_GUILD_ID || env?.DISCORD_GUILD_ID || "");
}

function isGuildAllowed(guildId, env = process.env) {
  const normalizedGuild = normalizeSnowflake(guildId);
  if (!normalizedGuild) return false;

  const configured = parseAllowlist(env?.NOODLE_COMPONENTS_V2_GUILD_ALLOWLIST);
  if (configured.size > 0) return configured.has(normalizedGuild);

  const fallbackGuild = resolveComponentsV2TargetGuild(env);
  if (!fallbackGuild) return false;
  return fallbackGuild === normalizedGuild;
}

function isUserAllowed(userId, env = process.env) {
  const configured = parseAllowlist(env?.NOODLE_COMPONENTS_V2_USER_ALLOWLIST);
  if (configured.size === 0) return true;
  return configured.has(normalizeSnowflake(userId));
}

function isTutorialUserAllowed(userId, env = process.env) {
  if (isEnabled(env?.NOODLE_COMPONENTS_V2_TUTORIAL_ENABLED)) return true;
  const configured = parseAllowlist(env?.NOODLE_COMPONENTS_V2_TUTORIAL_USER_ALLOWLIST);
  if (configured.size === 0) return false;
  return configured.has(normalizeSnowflake(userId));
}

export function isComponentsV2Enabled({ guildId, userId, player, env = process.env } = {}) {
  if (!isEnabled(env?.NOODLE_COMPONENTS_V2_ENABLED)) return false;
  if (!isGuildAllowed(guildId, env)) return false;
  if (!isUserAllowed(userId, env)) return false;

  if (isTutorialActive(player) && !isTutorialUserAllowed(userId, env)) {
    return false;
  }

  return true;
}

export function buildComponentsV2ContainerMessage({ title, lines = [], accentColor, ephemeral = false } = {}) {
  const heading = String(title ?? "").trim();
  const statusLines = Array.isArray(lines)
    ? lines.map((line) => String(line ?? "").trim()).filter(Boolean)
    : [];

  const textContent = [
    heading ? `## ${heading}` : "",
    statusLines.join("\n")
  ].filter(Boolean).join("\n\n");

  return buildComponentsV2MenuPayload({
    components: [{ type: 10, content: textContent || "Status unavailable." }],
    accentColor,
    ephemeral,
    addDivider: false
  });
}

export async function replyOrEditInteraction(interaction, payload) {
  if (!interaction) throw new Error("interaction is required");
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }
  return interaction.reply(payload);
}
