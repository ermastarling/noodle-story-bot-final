export function resolvePreferredGuildId(env = process.env) {
  return String(
    env?.NOODLE_OFFICIAL_GUILD_ID || env?.NOODLE_DEV_GUILD_ID || env?.DISCORD_GUILD_ID || ""
  ).trim();
}
