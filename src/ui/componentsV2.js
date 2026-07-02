const MESSAGE_FLAG_EPHEMERAL = 1 << 6;
export const MESSAGE_FLAG_IS_COMPONENTS_V2 = 1 << 15;

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

  const container = {
    type: 17,
    components: [
      {
        type: 10,
        content: textContent || "Status unavailable."
      }
    ]
  };

  if (Number.isInteger(accentColor) && accentColor >= 0) {
    container.accent_color = accentColor;
  }

  const flags = ephemeral
    ? (MESSAGE_FLAG_IS_COMPONENTS_V2 | MESSAGE_FLAG_EPHEMERAL)
    : MESSAGE_FLAG_IS_COMPONENTS_V2;

  return {
    flags,
    components: [container]
  };
}

export async function replyOrEditInteraction(interaction, payload) {
  if (!interaction) throw new Error("interaction is required");
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }
  return interaction.reply(payload);
}
