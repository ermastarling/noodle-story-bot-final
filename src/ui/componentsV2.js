import { theme } from "./theme.js";
import { getSceneBannerUrl } from "./icons.js";

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

function normalizeHeadingSceneKey(value = "") {
  const withoutCustomEmoji = String(value ?? "").replace(/<a?:[^:>]+:\d+>/g, " ");
  return withoutCustomEmoji
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function resolveSceneBannerFromHeading(heading = "") {
  const normalized = normalizeHeadingSceneKey(heading);
  if (!normalized) return "";

  const aliases = {
    noodle_story_store: ["store"],
    customize_profile: ["customize"],
    orders_served: ["serve"],
    serve_orders: ["serve"],
    accept_orders: ["orders"],
    order_ingredients: ["pantry"],
    bot_list_vote_rewards: ["vote_rewards"],
    send_a_tip: ["tip"],
    shop_visit: ["blessing"],
    take_out_counter: ["takeout_counter"],
    shared_order: ["party"],
    create_shared_order: ["party"],
    shared_order_status: ["party"],
    shared_order_contributions: ["party"]
  };

  const keywordAliases = {
    about: ["about"],
    blessing: ["blessing"],
    bless: ["blessing"],
    collections: ["collections"],
    cook: ["cook"],
    customize: ["customize"],
    event: ["event"],
    fishing: ["fishing"],
    forage: ["forage"],
    garden: ["garden"],
    kitchen: ["kitchen"],
    market: ["market"],
    buy: ["market"],
    multi_buy: ["market"],
    multibuy: ["market"],
    news: ["news"],
    orders: ["orders"],
    pantry: ["pantry"],
    party: ["party"],
    profile: ["profile"],
    quests: ["quests"],
    recipes: ["recipes"],
    regulars: ["regulars"],
    season: ["season"],
    sell: ["sell"],
    serve: ["serve"],
    specializations: ["specializations"],
    staff: ["staff"],
    status: ["status"],
    store: ["store"],
    take_out: ["takeout_counter"],
    takeout: ["takeout_counter"],
    takeout_counter: ["takeout_counter"],
    tip: ["tip"],
    visit: ["blessing"],
    shared: ["party"],
    shared_order: ["party"],
    upgrades: ["upgrades"],
    vote_rewards: ["vote_rewards"],
    bot_list_vote_rewards: ["vote_rewards"]
  };

  const candidates = [normalized, ...(aliases[normalized] ?? [])];
  for (const [token, mapped] of Object.entries(keywordAliases)) {
    if (normalized.includes(token)) {
      candidates.push(...mapped);
    }
  }

  const uniqueCandidates = [...new Set(candidates.filter(Boolean))];
  for (const key of uniqueCandidates) {
    const bannerUrl = String(getSceneBannerUrl(key, "") ?? "").trim();
    if (bannerUrl) return bannerUrl;
  }

  return "";
}

function replaceHeadingWithSceneBanner(components = []) {
  if (!Array.isArray(components) || components.length === 0) return components;

  let firstTextLocation = null;
  for (let idx = 0; idx < components.length; idx += 1) {
    const component = components[idx];
    if (Number(component?.type) === 10) {
      firstTextLocation = { kind: "top", componentIndex: idx, textIndex: null, textComponent: component };
      break;
    }

    if (Number(component?.type) === 9 && Array.isArray(component?.components)) {
      const childIndex = component.components.findIndex((child) => Number(child?.type) === 10);
      if (childIndex >= 0) {
        firstTextLocation = {
          kind: "section",
          componentIndex: idx,
          textIndex: childIndex,
          textComponent: component.components[childIndex]
        };
        break;
      }
    }
  }

  if (!firstTextLocation?.textComponent) return components;

  const lines = String(firstTextLocation.textComponent?.content ?? "").split("\n");
  let headingLineIndex = -1;
  let headingText = "";

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = String(lines[idx] ?? "").trim();
    if (!line) continue;
    const match = line.match(/^#{1,6}\s+(.+)$/);
    if (!match?.[1]) return components;
    headingLineIndex = idx;
    headingText = String(match[1]).trim();
    break;
  }

  if (headingLineIndex < 0 || !headingText) return components;

  const bannerUrl = resolveSceneBannerFromHeading(headingText);
  if (!bannerUrl) return components;

  const out = [...components];
  const remainingLines = [...lines];
  remainingLines.splice(headingLineIndex, 1);

  // Trim a single blank line after removed heading so spacing stays clean.
  while (remainingLines.length > 0 && !String(remainingLines[0] ?? "").trim()) {
    remainingLines.shift();
  }

  const nextContent = remainingLines.join("\n").trim();
  if (firstTextLocation.kind === "top") {
    const textComponent = out[firstTextLocation.componentIndex];
    if (nextContent) {
      out[firstTextLocation.componentIndex] = { ...textComponent, content: nextContent };
    } else {
      out.splice(firstTextLocation.componentIndex, 1);
    }
  } else {
    const parent = out[firstTextLocation.componentIndex];
    const childComponents = Array.isArray(parent?.components) ? [...parent.components] : [];
    if (nextContent) {
      childComponents[firstTextLocation.textIndex] = {
        ...childComponents[firstTextLocation.textIndex],
        content: nextContent
      };
      out[firstTextLocation.componentIndex] = { ...parent, components: childComponents };
    } else {
      childComponents.splice(firstTextLocation.textIndex, 1);
      if (childComponents.length > 0) {
        out[firstTextLocation.componentIndex] = { ...parent, components: childComponents };
      } else {
        out.splice(firstTextLocation.componentIndex, 1);
      }
    }
  }

  const hasBannerMedia = out.some((component) => {
    if (Number(component?.type) !== 12) return false;
    const firstItemUrl = String(component?.items?.[0]?.media?.url ?? "").trim();
    return firstItemUrl === bannerUrl;
  });
  if (!hasBannerMedia) {
    out.unshift({
      type: 12,
      items: [{ media: { url: bannerUrl } }]
    });
  }

  return out;
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
  const firstActionRowIndex = out.findIndex((component) => Number(component?.type) === 1);
  const insertIndex = firstActionRowIndex >= 0 ? firstActionRowIndex : out.length;

  for (let idx = insertIndex - 1; idx >= 0; idx -= 1) {
    const component = out[idx];
    if (Number(component?.type) !== 10) continue;
    const content = String(component?.content ?? "").trim();
    if (!content) continue;
    const lines = content.split("\n");
    for (let lineIdx = lines.length - 1; lineIdx >= 0; lineIdx -= 1) {
      const line = String(lines[lineIdx] ?? "").trim();
      if (!line.startsWith("-# ")) continue;
      lines[lineIdx] = `${line} • ${safeSegment}`;
      out[idx] = { ...component, content: lines.join("\n") };
      return out;
    }
  }

  out.splice(insertIndex, 0, { type: 10, content: `-# ${safeSegment}` });
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
  includeGreenButtonTip = true,
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
  const sceneBannerComponents = replaceHeadingWithSceneBanner(normalizedComponents);
  const ownerSanitizedComponents = stripLegacyOwnerFromFooterLines(sceneBannerComponents);
  const resolvedOwnerId = String(ownerId ?? "").trim() || detectOwnerIdInComponents(ownerSanitizedComponents);
  let footerComponents = withOwnerFooter(ownerSanitizedComponents, resolvedOwnerId);
  if (includeGreenButtonTip && hasGreenButtonInComponents(footerComponents)) {
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
  includeGreenButtonTip = true,
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
    includeGreenButtonTip,
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
  includeGreenButtonTip = true,
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
    includeGreenButtonTip,
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
      includeGreenButtonTip,
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
  const explicitToggle = String(env?.NOODLE_COMPONENTS_V2_TUTORIAL_ENABLED ?? "").trim();
  if (explicitToggle === "1") return true;
  const configured = parseAllowlist(env?.NOODLE_COMPONENTS_V2_TUTORIAL_USER_ALLOWLIST);
  if (configured.size > 0) return configured.has(normalizeSnowflake(userId));
  if (explicitToggle === "0") return false;
  // Default to enabled for tutorial users unless explicitly disabled.
  return true;
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

  const isV2Payload = (() => {
    if (!payload || typeof payload !== "object") return false;
    if ((Number(payload.flags) & MESSAGE_FLAG_IS_COMPONENTS_V2) !== 0) return true;
    const stack = Array.isArray(payload.components) ? [...payload.components] : [];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      const type = Number(node.type);
      if (type === 9 || type === 10 || type === 12 || type === 17) return true;
      if (Array.isArray(node.components)) stack.push(...node.components);
    }
    return false;
  })();

  const isInvalidComponentTypeError = (error) => {
    const message = String(error?.message ?? "");
    return String(error?.code ?? "") === "INVALID_TYPE"
      || message.includes("valid MessageComponentType");
  };

  const toRawWebhookPayload = (input = {}) => {
    const out = { ...input };
    const MESSAGE_FLAG_EPHEMERAL = 1 << 6;
    const hasEphemeralFlag = (Number(out.flags) & MESSAGE_FLAG_EPHEMERAL) !== 0;
    if (out.ephemeral === true && !hasEphemeralFlag) {
      out.flags = Number(out.flags || 0) | MESSAGE_FLAG_EPHEMERAL;
    }
    delete out.ephemeral;
    return out;
  };

  const rawWebhookEditOriginal = async () => {
    const applicationId = interaction?.applicationId || interaction?.client?.user?.id;
    const token = interaction?.token;
    if (!interaction?.client?.api || !applicationId || !token) {
      throw new Error("Raw webhook edit unavailable: missing client api/applicationId/token");
    }
    return interaction.client.api
      .webhooks(applicationId, token)
      .messages("@original")
      .patch({ data: toRawWebhookPayload(payload) });
  };

  if (interaction.deferred || interaction.replied) {
    if (isV2Payload) {
      try {
        return await rawWebhookEditOriginal();
      } catch {
        // Fall through to discord.js editReply fallback.
      }
    }

    try {
      return await interaction.editReply(payload);
    } catch (error) {
      if (isV2Payload && isInvalidComponentTypeError(error)) {
        return rawWebhookEditOriginal();
      }
      throw error;
    }
  }

  return interaction.reply(payload);
}
