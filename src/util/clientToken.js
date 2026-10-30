// discord.js v13 can lose client.token at runtime; REST calls then fail with "token was unavailable to the client".
export function ensureClientToken(client, env = process.env) {
  if (!client || String(client.token || "").trim()) return true;
  const fallback = String(env?.DISCORD_TOKEN || "").trim();
  if (!fallback) return false;
  client.token = fallback;
  return true;
}
