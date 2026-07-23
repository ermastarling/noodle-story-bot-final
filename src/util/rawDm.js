import { normalizeRawContainerPayload } from "./rawPayload.js";

export async function sendRawDm(client, userId, payload = {}) {
  const normalizedUserId = String(userId || "").trim();
  if (!client?.api) throw new Error("Raw DM unavailable: missing client api");
  if (!normalizedUserId) throw new Error("Raw DM unavailable: missing userId");

  const dmChannel = await client.api.users("@me").channels.post({
    data: { recipient_id: normalizedUserId }
  });
  const channelId = String(dmChannel?.id || "").trim();
  if (!channelId) throw new Error("Raw DM unavailable: failed to resolve DM channel id");

  return client.api.channels(channelId).messages.post({
    data: normalizeRawContainerPayload(payload)
  });
}
