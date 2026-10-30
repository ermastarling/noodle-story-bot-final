const MAX_CUSTOM_ID_LENGTH = 100;

// Discord rejects a message when two components share a custom_id (e.g. wrap-around Previous/Next on a 2-page menu).
// Handlers read fixed leading segments, so a trailing suffix keeps the original route intact.
export function dedupeComponentCustomIds(nodes) {
  if (!Array.isArray(nodes)) return nodes;
  const seen = new Set();

  const uniqueId = (id) => {
    if (!seen.has(id)) return id;
    for (let n = 2; ; n += 1) {
      const suffix = `:dup${n}`;
      const candidate = `${id.slice(0, MAX_CUSTOM_ID_LENGTH - suffix.length)}${suffix}`;
      if (!seen.has(candidate)) return candidate;
    }
  };

  const visit = (node) => {
    if (!node || typeof node !== "object") return node;
    const out = { ...node };
    if (typeof out.custom_id === "string" && out.custom_id) {
      out.custom_id = uniqueId(out.custom_id);
      seen.add(out.custom_id);
    }
    if (Array.isArray(out.components)) out.components = out.components.map(visit);
    if (out.accessory && typeof out.accessory === "object") out.accessory = visit(out.accessory);
    return out;
  };

  return nodes.map(visit);
}

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
    out.components = dedupeComponentCustomIds(out.components.map((entry) => normalizeRawNode(entry)).filter(Boolean));
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
