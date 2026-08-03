import discordPkg from "discord.js";

const GUILD_VOICE_CHANNEL_TYPE_SOURCE = discordPkg?.ChannelTypes?.GUILD_VOICE
  ?? discordPkg?.Constants?.ChannelTypes?.GUILD_VOICE;
const GUILD_VOICE_CHANNEL_TYPE = typeof GUILD_VOICE_CHANNEL_TYPE_SOURCE === "number"
  ? GUILD_VOICE_CHANNEL_TYPE_SOURCE
  : 2;
const GUILD_VOICE_CHANNEL_TYPE_NAME = String(
  GUILD_VOICE_CHANNEL_TYPE_SOURCE
  ?? "GUILD_VOICE"
).trim().toUpperCase();

export function isGuildVoiceCounterChannelType(type) {
  if (Number(type) === GUILD_VOICE_CHANNEL_TYPE) return true;
  const normalizedType = String(type ?? "").trim().toUpperCase();
  if (!normalizedType) return false;
  return normalizedType === "GUILD_VOICE"
    || normalizedType === String(GUILD_VOICE_CHANNEL_TYPE)
    || normalizedType === GUILD_VOICE_CHANNEL_TYPE_NAME;
}

export async function resolveOfficialStatsChannelTarget(officialGuild, channelId, { label, preferredCategoryId } = {}) {
  const existingId = String(channelId || "").trim();
  const normalizedLabel = String(label || "").trim().toLowerCase();
  const preferredCategoryKey = String(preferredCategoryId || "").trim();

  const isVoiceCounterChannel = (candidate) => Boolean(
    candidate
    && isGuildVoiceCounterChannelType(candidate.type)
    && typeof candidate?.name === "string"
  );

  const getCategoryMatchCandidates = () => {
    if (!officialGuild?.channels?.cache) return [];
    return Array.from(officialGuild.channels.cache.values()).filter((candidate) => {
      if (!isVoiceCounterChannel(candidate)) return false;
      if (!preferredCategoryKey) return false;
      const parentId = String(candidate.parentId || candidate.parent?.id || "").trim();
      return parentId === preferredCategoryKey;
    });
  };

  const findByLabel = (scopeCandidates) => {
    if (!normalizedLabel || !Array.isArray(scopeCandidates)) return null;
    const candidates = scopeCandidates.filter((candidate) => {
      const name = String(candidate?.name || "").trim().toLowerCase();
      return name.includes(normalizedLabel);
    });

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      const aExact = String(a.name || "").trim().toLowerCase() === normalizedLabel;
      const bExact = String(b.name || "").trim().toLowerCase() === normalizedLabel;
      if (aExact !== bExact) return aExact ? -1 : 1;
      return (Number(a.position ?? 0) - Number(b.position ?? 0));
    });
    return candidates[0] || null;
  };

  if (existingId) {
    const configuredChannel = officialGuild?.channels?.cache?.get(existingId)
      || await officialGuild?.channels?.fetch?.(existingId).catch(() => null);
    if (configuredChannel && isVoiceCounterChannel(configuredChannel)) {
      return { channel: configuredChannel, source: "configured" };
    }
  }

  const categoryMatches = getCategoryMatchCandidates();
  const categoryMatch = findByLabel(categoryMatches);
  if (categoryMatch) {
    return { channel: categoryMatch, source: "label-category" };
  }

  if (!officialGuild?.channels?.cache) return null;
  const guildMatches = Array.from(officialGuild.channels.cache.values()).filter(isVoiceCounterChannel);
  const guildMatch = findByLabel(guildMatches);
  if (guildMatch) {
    return { channel: guildMatch, source: "label-guild" };
  }

  return null;
}
