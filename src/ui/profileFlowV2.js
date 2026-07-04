import { buildComponentsV2MenuPayload } from "./componentsV2.js";
import { normalizeComponentEmoji } from "./icons.js";

const BUTTON_STYLE_PRIMARY = 1;
const BUTTON_STYLE_SECONDARY = 2;
const BUTTON_STYLE_SUCCESS = 3;

function asText(content) {
  return { type: 10, content: String(content ?? "").trim() || "-" };
}

function padRight(text, width) {
  const value = String(text ?? "");
  if (value.length >= width) return value;
  return `${value}${" ".repeat(width - value.length)}`;
}

function formatProfileStatsGrid(rows = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const leftColWidth = Math.max(14, ...safeRows.map((row) => {
    const labelLen = String(row?.leftLabel ?? "").length;
    const valueLen = String(row?.leftValue ?? "").length;
    return Math.max(labelLen, valueLen);
  }));
  const rightColWidth = Math.max(10, ...safeRows.map((row) => {
    const labelLen = String(row?.rightLabel ?? "").length;
    const valueLen = String(row?.rightValue ?? "").length;
    return Math.max(labelLen, valueLen);
  }));
  const divider = "  |  ";
  const separator = `${"-".repeat(leftColWidth)}${divider}${"-".repeat(rightColWidth)}`;

  const lines = [];
  for (let idx = 0; idx < safeRows.length; idx += 1) {
    const row = safeRows[idx];
    const leftLabel = padRight(row?.leftLabel ?? "-", leftColWidth);
    const rightLabel = padRight(row?.rightLabel ?? "-", rightColWidth);
    const leftValue = padRight(row?.leftValue ?? "-", leftColWidth);
    const rightValue = padRight(row?.rightValue ?? "-", rightColWidth);
    lines.push(`${leftLabel}${divider}${rightLabel}`);
    lines.push(`${leftValue}${divider}${rightValue}`);
    if (idx < safeRows.length - 1) lines.push(separator);
  }

  return ["```", ...lines, "```"].join("\n");
}

function normalizeFieldName(name = "") {
  return String(name ?? "")
    .toLowerCase()
    .replace(/:[a-z0-9_+-]+:/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findFieldValue(fields = [], canonicalName = "") {
  const wanted = normalizeFieldName(canonicalName);
  for (const field of fields) {
    const name = normalizeFieldName(field?.name);
    if (name !== wanted) continue;
    const value = String(field?.value ?? "").trim();
    if (value) return value;
  }
  return "-";
}

function button({
  label,
  customId,
  style = BUTTON_STYLE_SECONDARY,
  emoji,
  disabled = false
} = {}) {
  const out = {
    type: 2,
    style,
    label: String(label ?? "").trim() || "Action",
    custom_id: String(customId ?? "").trim() || "noodle:noop",
    disabled: Boolean(disabled)
  };
  const normalizedEmoji = normalizeComponentEmoji(emoji);
  if (normalizedEmoji) out.emoji = normalizedEmoji;
  return out;
}

function buildProfileActionRows({
  userId,
  showTakeout = false,
  newsAvailable = false,
  questsAvailable = false,
  specializationsAvailable = false,
  buttonEmoji = {}
} = {}) {
  const safeUserId = String(userId ?? "").trim();
  if (!safeUserId) return [];

  const topButtons = [
    button({
      label: "Orders",
      customId: `noodle:nav:orders:${safeUserId}`,
      style: BUTTON_STYLE_PRIMARY,
      emoji: buttonEmoji.orders
    })
  ];

  if (showTakeout) {
    topButtons.push(button({
      label: "Takeout",
      customId: `noodle:nav:takeout:${safeUserId}`,
      style: BUTTON_STYLE_SUCCESS,
      emoji: buttonEmoji.orders
    }));
  }

  topButtons.push(
    button({
      label: "Buy",
      customId: `noodle:nav:buy:${safeUserId}`,
      style: BUTTON_STYLE_SECONDARY,
      emoji: buttonEmoji.cart
    }),
    button({
      label: "Pantry",
      customId: `noodle:nav:pantry:${safeUserId}`,
      style: BUTTON_STYLE_SECONDARY,
      emoji: buttonEmoji.pantry
    }),
    button({
      label: "News",
      customId: `noodle:nav:news:${safeUserId}`,
      style: newsAvailable ? BUTTON_STYLE_SUCCESS : BUTTON_STYLE_SECONDARY,
      emoji: buttonEmoji.new
    })
  );

  const secondButtons = [
    button({
      label: "Party",
      customId: `noodle-social:nav:party:${safeUserId}`,
      style: BUTTON_STYLE_PRIMARY,
      emoji: buttonEmoji.party
    }),
    button({
      label: "Upgrades",
      customId: `noodle-upgrades:category:${safeUserId}:all:profile`,
      style: BUTTON_STYLE_SECONDARY,
      emoji: buttonEmoji.upgrades
    }),
    button({
      label: "Stats",
      customId: `noodle-social:nav:stats:${safeUserId}`,
      style: BUTTON_STYLE_SECONDARY,
      emoji: buttonEmoji.stats
    }),
    button({
      label: "Quests",
      customId: `noodle:nav:quests:${safeUserId}`,
      style: questsAvailable ? BUTTON_STYLE_SUCCESS : BUTTON_STYLE_SECONDARY,
      emoji: buttonEmoji.quests
    }),
    button({
      label: "Customize",
      customId: `noodle:nav:profile_edit:${safeUserId}`,
      style: specializationsAvailable ? BUTTON_STYLE_SUCCESS : BUTTON_STYLE_SECONDARY,
      emoji: buttonEmoji.customize
    })
  ];

  return [
    { type: 1, components: topButtons.slice(0, 5) },
    { type: 1, components: secondButtons.slice(0, 5) }
  ];
}

function buildProfileEditActionRows({ userId, specializationsAvailable = false, buttonEmoji = {} } = {}) {
  const safeUserId = String(userId ?? "").trim();
  if (!safeUserId) return [];

  return [
    {
      type: 1,
      components: [
        button({
          label: "Shop Name",
          customId: `noodle:profile:edit_shop_name:${safeUserId}`,
          style: BUTTON_STYLE_PRIMARY,
          emoji: buttonEmoji.note
        }),
        button({
          label: "Tagline",
          customId: `noodle:profile:edit_tagline:${safeUserId}`,
          style: BUTTON_STYLE_PRIMARY,
          emoji: buttonEmoji.tag
        }),
        button({
          label: "Specializations",
          customId: `noodle:nav:specialize:${safeUserId}`,
          style: specializationsAvailable ? BUTTON_STYLE_SUCCESS : BUTTON_STYLE_SECONDARY,
          emoji: buttonEmoji.sparkle
        }),
        button({
          label: "Store",
          customId: `noodle:action:store:${safeUserId}`,
          style: BUTTON_STYLE_SUCCESS,
          emoji: buttonEmoji.cart
        })
      ]
    },
    {
      type: 1,
      components: [
        button({
          label: "Back",
          customId: `noodle:nav:profile:${safeUserId}`,
          style: BUTTON_STYLE_SECONDARY,
          emoji: buttonEmoji.back
        })
      ]
    }
  ];
}

function asThumbnailAccessory(url = "") {
  const safeUrl = String(url ?? "").trim();
  if (!safeUrl) return null;
  return {
    type: 11,
    media: { url: safeUrl }
  };
}

function asMediaGallery(url = "") {
  const safeUrl = String(url ?? "").trim();
  if (!safeUrl) return null;
  return {
    type: 12,
    items: [{ media: { url: safeUrl } }]
  };
}

export function buildProfileEditV2Message({
  userId,
  specializationsAvailable = false,
  statusLine = "",
  buttonEmoji = {},
  ownerId
} = {}) {
  const components = [
    asText("## Customize Profile"),
    asText([
      "- Change your shop name and tagline.",
      "- Change your shop specialization.",
      "- Check out the Store for premium specializations, coin packs, and subscription perks."
    ].join("\n"))
  ];

  const safeStatusLine = String(statusLine ?? "").trim();
  if (safeStatusLine) components.push(asText(safeStatusLine));

  components.push(...buildProfileEditActionRows({ userId, specializationsAvailable, buttonEmoji }));

  return buildComponentsV2MenuPayload({
    components,
    ownerId: String(ownerId ?? userId ?? "").trim()
  });
}

export function buildSpecializationListV2Message({
  userId,
  entries = [],
  page = 0,
  totalPages = 1,
  specializationsAvailable = false,
  buttonEmoji = {},
  ownerId
} = {}) {
  const components = [asText("## Specializations")];

  const safeEntries = Array.isArray(entries) ? entries : [];
  if (safeEntries.length <= 0) {
    components.push(asText("No specializations available yet."));
  } else {
    for (const entry of safeEntries) {
      const line = [
        `**${String(entry?.name ?? "Unknown specialization")}**`,
        String(entry?.statusLine ?? ""),
        String(entry?.description ?? "")
      ].filter(Boolean).join("\n");

      const accessory = asThumbnailAccessory(entry?.thumbnailUrl);
      if (accessory) {
        components.push({ type: 9, components: [asText(line)], accessory });
      } else {
        components.push(asText(line));
      }
    }
  }

  const safeTotalPages = Math.max(1, Math.floor(Number(totalPages) || 1));
  const safePage = Math.min(Math.max(Math.floor(Number(page) || 0), 0), safeTotalPages - 1);
  components.push(asText(`Page ${safePage + 1}/${safeTotalPages}`));

  if (safeTotalPages > 1) {
    components.push({
      type: 1,
      components: [
        button({
          label: "Prev",
          customId: `noodle:nav:specialize:${userId}:${safePage <= 0 ? safeTotalPages - 1 : safePage - 1}`,
          style: BUTTON_STYLE_SECONDARY,
          emoji: buttonEmoji.back
        }),
        button({
          label: "Next",
          customId: `noodle:nav:specialize:${userId}:${safePage >= safeTotalPages - 1 ? 0 : safePage + 1}`,
          style: BUTTON_STYLE_SECONDARY,
          emoji: buttonEmoji.next
        })
      ]
    });
  }

  components.push({
    type: 1,
    components: [
      button({
        label: "Select Specialization",
        customId: `noodle:profile:specialize_select:${userId}`,
        style: BUTTON_STYLE_PRIMARY,
        emoji: buttonEmoji.sparkle
      })
    ]
  });

  components.push(...buildProfileEditActionRows({ userId, specializationsAvailable, buttonEmoji }));

  return buildComponentsV2MenuPayload({
    components,
    ownerId: String(ownerId ?? userId ?? "").trim()
  });
}

export function buildSpecializationPickerV2Message({
  userId,
  options = [],
  specializationsAvailable = false,
  buttonEmoji = {},
  ownerId
} = {}) {
  const safeOptions = Array.isArray(options) ? options.slice(0, 25) : [];
  const components = [
    asText("## Choose Specialization"),
    asText("Pick a specialization to preview and confirm.")
  ];

  if (safeOptions.length > 0) {
    components.push({
      type: 1,
      components: [
        {
          type: 3,
          custom_id: `noodle:profile:specialize_pick:${userId}`,
          placeholder: "Select a specialization",
          min_values: 1,
          max_values: 1,
          options: safeOptions
        }
      ]
    });
  }

  components.push(...buildProfileEditActionRows({ userId, specializationsAvailable, buttonEmoji }));
  return buildComponentsV2MenuPayload({
    components,
    ownerId: String(ownerId ?? userId ?? "").trim()
  });
}

export function buildSpecializationConfirmV2Message({
  userId,
  specName,
  specDescription = "",
  specThumbnailUrl = "",
  specializationsAvailable = false,
  buttonEmoji = {},
  ownerId,
  lockedReason = "",
  specId = ""
} = {}) {
  const safeName = String(specName ?? "").trim() || "Specialization";
  const safeDescription = String(specDescription ?? "").trim();
  const safeLocked = String(lockedReason ?? "").trim();

  const components = [
    asText(`## ${safeLocked ? "Specialization Locked" : "Confirm Specialization"}`)
  ];

  const summary = safeLocked
    ? [`You can't select **${safeName}** yet.`, safeLocked].filter(Boolean).join("\n")
    : [`You're about to switch to **${safeName}**.`, safeDescription ? `_${safeDescription}_` : "", "Press **Confirm** to apply."].filter(Boolean).join("\n\n");
  components.push(asText(summary));

  const accessory = asThumbnailAccessory(specThumbnailUrl);
  if (accessory) {
    components.push({
      type: 9,
      components: [asText("Preview")],
      accessory
    });
  }

  if (!safeLocked && String(specId ?? "").trim()) {
    components.push({
      type: 1,
      components: [
        button({
          label: "Confirm",
          customId: `noodle:profile:specialize_confirm:${userId}:${specId}`,
          style: BUTTON_STYLE_SUCCESS
        }),
        button({
          label: "Cancel",
          customId: `noodle:profile:specialize_cancel:${userId}`,
          style: BUTTON_STYLE_SECONDARY
        })
      ]
    });
  }

  components.push(...buildProfileEditActionRows({ userId, specializationsAvailable, buttonEmoji }));

  return buildComponentsV2MenuPayload({
    components,
    ownerId: String(ownerId ?? userId ?? "").trim()
  });
}

export function buildSpecializationUpdatedV2Message({
  userId,
  specName,
  specThumbnailUrl = "",
  specializationsAvailable = false,
  buttonEmoji = {},
  ownerId
} = {}) {
  const safeName = String(specName ?? "").trim() || "Specialization";
  const components = [
    asText("## Specialization Updated"),
    asText(`Active specialization: **${safeName}**.`)
  ];

  const gallery = asMediaGallery(specThumbnailUrl);
  if (gallery) components.push(gallery);

  components.push({
    type: 1,
    components: [
      button({
        label: "Select Specialization",
        customId: `noodle:profile:specialize_select:${userId}`,
        style: BUTTON_STYLE_PRIMARY,
        emoji: buttonEmoji.sparkle
      })
    ]
  });

  components.push(...buildProfileEditActionRows({ userId, specializationsAvailable, buttonEmoji }));

  return buildComponentsV2MenuPayload({
    components,
    ownerId: String(ownerId ?? userId ?? "").trim()
  });
}

export function buildDecorSetsV2Message({
  userId,
  entries = [],
  page = 0,
  totalPages = 1,
  buttonEmoji = {},
  ownerId
} = {}) {
  const components = [asText("## Decor - Specialization Sets")];

  const safeEntries = Array.isArray(entries) ? entries : [];
  if (safeEntries.length <= 0) {
    components.push(asText("No decor sets available."));
  } else {
    for (const entry of safeEntries) {
      const line = [
        `**${String(entry?.name ?? "Unknown set")}**`,
        String(entry?.statusLine ?? ""),
        String(entry?.piecesLine ?? ""),
        String(entry?.description ?? "")
      ].filter(Boolean).join("\n");
      const accessory = asThumbnailAccessory(entry?.imageUrl);
      if (accessory) {
        components.push({ type: 9, components: [asText(line)], accessory });
      } else {
        components.push(asText(line));
      }
    }
  }

  const safeTotalPages = Math.max(1, Math.floor(Number(totalPages) || 1));
  const safePage = Math.min(Math.max(Math.floor(Number(page) || 0), 0), safeTotalPages - 1);
  components.push(asText(`Page ${safePage + 1}/${safeTotalPages}`));

  if (safeTotalPages > 1) {
    components.push({
      type: 1,
      components: [
        button({
          label: "Prev",
          customId: `noodle:nav:decor:${userId}:${safePage <= 0 ? safeTotalPages - 1 : safePage - 1}`,
          style: BUTTON_STYLE_SECONDARY,
          emoji: buttonEmoji.back
        }),
        button({
          label: "Next",
          customId: `noodle:nav:decor:${userId}:${safePage >= safeTotalPages - 1 ? 0 : safePage + 1}`,
          style: BUTTON_STYLE_SECONDARY,
          emoji: buttonEmoji.next
        })
      ]
    });
  }

  components.push({
    type: 1,
    components: [
      button({
        label: "Back",
        customId: `noodle:nav:profile_edit:${userId}`,
        style: BUTTON_STYLE_SECONDARY,
        emoji: buttonEmoji.back
      })
    ]
  });

  return buildComponentsV2MenuPayload({
    components,
    ownerId: String(ownerId ?? userId ?? "").trim()
  });
}

export function buildProfileHomeV2Message({
  userId,
  embed,
  viewingSelf = true,
  showTakeout = false,
  newsAvailable = false,
  questsAvailable = false,
  specializationsAvailable = false,
  buttonEmoji = {},
  ownerId
} = {}) {
  const raw = embed?.toJSON?.() ?? embed ?? {};
  const title = String(raw?.title ?? "").trim() || "Profile";
  const description = String(raw?.description ?? "").trim();
  const fields = Array.isArray(raw?.fields) ? raw.fields : [];
  const decorImageUrl = String(raw?.image?.url ?? "").trim();

  const bowlsServed = findFieldValue(fields, "Bowls Served");
  const level = findFieldValue(fields, "Level");
  const rep = findFieldValue(fields, "REP");
  const coins = findFieldValue(fields, "Coins");

  const components = [asText(`## ${title}`)];
  if (description) components.push(asText(description));

  components.push(asText(formatProfileStatsGrid([
    { leftLabel: "Bowls Served", leftValue: bowlsServed, rightLabel: "Level", rightValue: level },
    { leftLabel: "REP", leftValue: rep, rightLabel: "Coins", rightValue: coins }
  ])));

  for (const field of fields) {
    const name = String(field?.name ?? "").trim();
    const value = String(field?.value ?? "").trim();
    if (!name && !value) continue;

    const normalized = normalizeFieldName(name);
    if (normalized === "bowls served" || normalized === "level" || normalized === "rep" || normalized === "coins") {
      continue;
    }

    components.push(asText([name ? `**${name}**` : "", value || "-"].filter(Boolean).join("\n")));
  }

  if (decorImageUrl) {
    components.push({
      type: 12,
      items: [
        {
          media: { url: decorImageUrl }
        }
      ]
    });
  }

  if (viewingSelf) {
    components.push(...buildProfileActionRows({
      userId,
      showTakeout,
      newsAvailable,
      questsAvailable,
      specializationsAvailable,
      buttonEmoji
    }));
  }

  return buildComponentsV2MenuPayload({
    components,
    ownerId: String(ownerId ?? userId ?? "").trim()
  });
}