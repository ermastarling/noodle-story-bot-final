const MAX_CUSTOM_ID_LENGTH = 100;

// Discord rejects a message when two components share a custom_id (e.g. wrap-around Previous/Next on a 2-page menu).
// Handlers read fixed leading segments, so a trailing suffix keeps the original route intact. The original id is never
// truncated: if no suffix fits in 100 chars, the exact-route twin is dropped instead (a Section falls back to its text).
export function dedupeComponentCustomIds(nodes) {
  if (!Array.isArray(nodes)) return nodes;
  const seen = new Set();

  const uniqueId = (id) => {
    if (!seen.has(id)) return id;
    for (const make of [(n) => `:dup${n}`, (n) => `:${n}`]) {
      for (let n = 2; n < 100; n += 1) {
        const candidate = `${id}${make(n)}`;
        if (candidate.length > MAX_CUSTOM_ID_LENGTH) break;
        if (!seen.has(candidate)) return candidate;
      }
    }
    return null;
  };

  // Returns the node, an array of replacement nodes, or null to drop it.
  const visit = (node) => {
    if (!node || typeof node !== "object") return node;
    const out = { ...node };
    if (typeof out.custom_id === "string" && out.custom_id) {
      const id = uniqueId(out.custom_id);
      if (id === null) return null;
      out.custom_id = id;
      seen.add(id);
    }
    if (Array.isArray(out.components)) out.components = out.components.flatMap((child) => visit(child) ?? []);
    if (out.accessory && typeof out.accessory === "object") {
      const accessory = visit(out.accessory);
      if (!accessory) return out.components ?? null;
      out.accessory = accessory;
    }
    return out;
  };

  return nodes.flatMap((node) => visit(node) ?? []);
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
