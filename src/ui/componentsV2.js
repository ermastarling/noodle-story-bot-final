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

function hasHeadingPrefix(content) {
  return /^#{1,6}\s/.test(String(content ?? "").trim());
}

function normalizeContainerHeading(components = []) {
  if (!Array.isArray(components) || components.length === 0) return components;
  const [first, ...rest] = components;
  if (Number(first?.type) !== 10) return components;

  const raw = String(first?.content ?? "").trim();
  if (!raw || hasHeadingPrefix(raw)) return components;

  return [{ ...first, content: `## ${raw}` }, ...rest];
}

function extractOwnerIdFromCustomId(customId = "") {
  const raw = String(customId ?? "");
  if (!raw) return null;
  const matches = raw.match(/(?:^|:)(\d{17,20})(?::|$)/g) ?? [];
  if (!matches.length) return null;
  const normalized = matches
    .map((token) => String(token).replace(/:/g, "").trim())
    .filter(Boolean);
  return normalized[0] ?? null;
}

function detectOwnerIdInComponents(components = []) {
  const stack = Array.isArray(components) ? [...components] : [];
  const counts = new Map();

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;

    const ownerId = extractOwnerIdFromCustomId(node.custom_id);
    if (ownerId) {
      counts.set(ownerId, (counts.get(ownerId) ?? 0) + 1);
    }

    if (Array.isArray(node.components) && node.components.length > 0) {
      stack.push(...node.components);
    }
  }

  let bestId = null;
  let bestCount = 0;
  for (const [ownerId, count] of counts.entries()) {
    if (count > bestCount) {
      bestId = ownerId;
      bestCount = count;
    }
  }

  return bestId;
}

function hasOwnerFooter(components = []) {
  return (components || []).some(
    (component) => Number(component?.type) === 10 && /menu owner:/i.test(String(component?.content ?? ""))
  );
}

function stripLegacyOwnerFromFooterLines(components = []) {
  const out = Array.isArray(components) ? [...components] : [];
  for (let idx = 0; idx < out.length; idx += 1) {
    const component = out[idx];
    if (Number(component?.type) !== 10) continue;

    const content = String(component?.content ?? "");
    if (!content.includes("Owner:")) continue;

    const nextContent = content
      .split("\n")
      .map((line) => {
        const trimmed = String(line ?? "").trim();
        if (!trimmed.startsWith("-# ")) return line;
        const segments = trimmed
          .slice(3)
          .split("•")
          .map((segment) => String(segment ?? "").trim())
          .filter((segment) => segment && !/^owner\s*:/i.test(segment));
        return segments.length ? `-# ${segments.join(" • ")}` : "";
      })
      .filter(Boolean)
      .join("\n");

    out[idx] = { ...component, content: nextContent };
  }
  return out;
}

function hasFooterSegment(components = [], pattern) {
  const matcher = pattern instanceof RegExp ? pattern : new RegExp(String(pattern || ""), "i");
  return (components || []).some((component) => {
    if (Number(component?.type) !== 10) return false;
    const lines = String(component?.content ?? "").split("\n");
    return lines.some((line) => String(line ?? "").trim().startsWith("-# ") && matcher.test(line));
  });
}

function appendFooterSegment(components = [], segment = "") {
  const safeSegment = String(segment ?? "").trim();
  if (!safeSegment) return components;

  const out = Array.isArray(components) ? [...components] : [];
  for (let idx = out.length - 1; idx >= 0; idx -= 1) {
    const component = out[idx];
    if (Number(component?.type) !== 10) continue;
    const content = String(component?.content ?? "").trim();
    if (content) {
      const lines = content.split("\n");
      for (let lineIdx = lines.length - 1; lineIdx >= 0; lineIdx -= 1) {
        const line = String(lines[lineIdx] ?? "").trim();
        if (!line.startsWith("-# ")) continue;
        lines[lineIdx] = `${line} • ${safeSegment}`;
        out[idx] = { ...component, content: lines.join("\n") };
        return out;
      }
    }

    const footerLine = `-# ${safeSegment}`;
    out[idx] = { ...component, content: content ? `${content}\n\n${footerLine}` : footerLine };
    return out;
  }

  out.push({ type: 10, content: `-# ${safeSegment}` });
  return out;
}

function hasGreenButtonInComponents(components = []) {
  const stack = Array.isArray(components) ? [...components] : [];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;

    if (Number(node.type) === 2) {
      const style = node.style;
      if (style === 3 || String(style || "").toLowerCase() === "success") {
        return true;
      }
    }

    if (Array.isArray(node.components) && node.components.length > 0) {
      stack.push(...node.components);
    }
  }
  return false;
}

function withOwnerFooter(components = [], ownerId = "") {
  const safeOwnerId = String(ownerId ?? "").trim();
  if (!safeOwnerId || hasOwnerFooter(components)) return components;

  return appendFooterSegment(components, `Menu owner: <@${safeOwnerId}>`);
}

function withGreenButtonFooterTip(components = []) {
  const tipPattern = /tip:\s*tap the green button\(s\) to continue\.?/i;
  if (hasFooterSegment(components, tipPattern)) return components;
  return appendFooterSegment(components, "Tip: Tap the green button(s) to continue.");
}

export function buildComponentsV2MenuPayload({
  components = [],
  ephemeral = false,
  ownerId,
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

  const normalizedComponents = normalizeContainerHeading(components);
  const ownerSanitizedComponents = stripLegacyOwnerFromFooterLines(normalizedComponents);
  const resolvedOwnerId = String(ownerId ?? "").trim() || detectOwnerIdInComponents(ownerSanitizedComponents);
  let footerComponents = withOwnerFooter(ownerSanitizedComponents, resolvedOwnerId);
  if (hasGreenButtonInComponents(footerComponents)) {
    footerComponents = withGreenButtonFooterTip(footerComponents);
  }

  const container = {
    type: 17,
    components: applyMenuGuideToComponents(footerComponents, menuGuide)
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

function resolveNoticeAccentColor(tone = "info") {
  const normalized = String(tone || "info").trim().toLowerCase();
  if (normalized === "success") return Number(theme?.colors?.success ?? DEFAULT_MENU_ACCENT_COLOR);
  if (normalized === "warning") return Number(theme?.colors?.warning ?? DEFAULT_MENU_ACCENT_COLOR);
  if (normalized === "error") return Number(theme?.colors?.danger ?? DEFAULT_MENU_ACCENT_COLOR);
  return Number(theme?.colors?.primary ?? DEFAULT_MENU_ACCENT_COLOR);
}

export function buildComponentsV2NoticeCardPayload({
  title = "Notice",
  details = [],
  tone = "info",
  ownerId,
  ephemeral = false,
  env = process.env
} = {}) {
  const heading = String(title || "").trim() || "Notice";
  const detailLines = Array.isArray(details)
    ? details.map((line) => String(line ?? "").trim()).filter(Boolean)
    : [];

  const components = [{ type: 10, content: `### ${heading}` }];
  if (detailLines.length > 0) {
    components.push({ type: 10, content: detailLines.join("\n\n") });
  }

  return buildComponentsV2MenuPayload({
    components,
    ownerId,
    ephemeral,
    accentColor: resolveNoticeAccentColor(tone),
    addDivider: false,
    env
  });
}

export function buildComponentsV2PayloadWithNoticeCards({
  mainComponents = [],
  notices = [],
  ownerId,
  ephemeral = false,
  accentColor,
  dividerText,
  imageUrl,
  addDivider,
  env = process.env
} = {}) {
  const mainPayload = buildComponentsV2MenuPayload({
    components: mainComponents,
    ownerId,
    ephemeral,
    accentColor,
    dividerText,
    imageUrl,
    addDivider,
    env
  });

  const stackedContainers = [...(mainPayload.components ?? [])];
  for (const notice of notices || []) {
    if (!notice || typeof notice !== "object") continue;
    const noticePayload = buildComponentsV2NoticeCardPayload({
      title: notice.title,
      details: notice.details,
      tone: notice.tone,
      ownerId,
      ephemeral,
      env
    });
    const container = noticePayload.components?.[0];
    if (container) stackedContainers.push(container);
  }

  return {
    flags: Number(mainPayload.flags || 0),
    components: stackedContainers
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
