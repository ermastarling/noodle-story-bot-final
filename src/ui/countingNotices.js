import { buildComponentsV2PayloadWithNoticeCards } from "./componentsV2.js";

export function buildCountingNoticePayload(message, userIds = []) {
  return {
    ...buildComponentsV2PayloadWithNoticeCards({
      mainComponents: [
        { type: 10, content: "## Counting" },
        { type: 10, content: String(message ?? "") }
      ],
      ephemeral: false,
      includeGreenButtonTip: false
    }),
    allowed_mentions: {
      parse: [],
      users: userIds.map((userId) => String(userId))
    }
  };
}
