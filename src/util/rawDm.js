import { normalizeRawContainerPayload } from "./rawPayload.js";
import { REST } from "@discordjs/rest";

function isClientTokenUnavailableError(error) {
  const message = String(error?.message ?? "").toLowerCase();
  return String(error?.code ?? "") === "TOKEN_MISSING"
    || message.includes("token was unavailable to the client");
}

function resolveBotToken(client) {
  const fromClient = String(client?.token || "").trim();
  if (fromClient) return fromClient;
  return String(process.env.DISCORD_TOKEN || "").trim();
}

export async function sendRawDm(client, userId, payload = {}) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) throw new Error("Raw DM unavailable: missing userId");
  const normalizedPayload = normalizeRawContainerPayload(payload);

  if (client?.api) {
    try {
      const dmChannel = await client.api.users("@me").channels.post({
        data: { recipient_id: normalizedUserId }
      });
      const channelId = String(dmChannel?.id || "").trim();
      if (!channelId) throw new Error("Raw DM unavailable: failed to resolve DM channel id");

      return await client.api.channels(channelId).messages.post({
        data: normalizedPayload
      });
    } catch (error) {
      if (!isClientTokenUnavailableError(error)) throw error;
      const token = resolveBotToken(client);
      if (!token) throw error;
      client.token = token;
    }
  }

  const token = resolveBotToken(client);
  if (!token) {
    throw new Error("Raw DM unavailable: missing bot token");
  }

  const rest = new REST({ version: "10" }).setToken(token);
  const dmChannel = await rest.post("/users/@me/channels", {
    body: { recipient_id: normalizedUserId }
  });
  const channelId = String(dmChannel?.id || "").trim();
  if (!channelId) throw new Error("Raw DM unavailable: failed to resolve DM channel id");

  return rest.post(`/channels/${channelId}/messages`, {
    body: normalizedPayload
  });
}
