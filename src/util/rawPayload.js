function normalizeRawNode(node) {
  const base = node?.toJSON?.() ?? node;
  if (!base || typeof base !== "object") return base;

  const out = { ...base };
  if (Array.isArray(out.components)) {
    out.components = out.components.map((child) => normalizeRawNode(child)).filter(Boolean);
  }
  if (Array.isArray(out.items)) {
    out.items = out.items.map((item) => normalizeRawNode(item)).filter(Boolean);
  }
  if (out.accessory && typeof out.accessory === "object") {
    out.accessory = normalizeRawNode(out.accessory);
  }
  return out;
}

export function normalizeRawContainerPayload(payload = {}, { ephemeralFlag = 0 } = {}) {
  const out = { ...(payload || {}) };

  if (Array.isArray(out.components)) {
    out.components = out.components.map((entry) => normalizeRawNode(entry)).filter(Boolean);
  }

  const hasEphemeralFlag = (Number(out.flags) & Number(ephemeralFlag || 0)) !== 0;
  if (out.ephemeral === true && Number(ephemeralFlag || 0) > 0 && !hasEphemeralFlag) {
    out.flags = Number(out.flags || 0) | Number(ephemeralFlag || 0);
  }
  delete out.ephemeral;

  if (typeof out.content === "string" && out.content.trim().length === 0) {
    const hasComponents = Array.isArray(out.components) && out.components.length > 0;
    if (hasComponents) delete out.content;
  }

  const hasAnyContent = Boolean(out.content)
    || (Array.isArray(out.components) && out.components.length > 0);
  if (!hasAnyContent) {
    out.content = "\u200b";
  }

  return out;
}
