export function buildSettingsMap(catalog, overrides) {
  const out = {};
  for (const s of catalog) out[s.key] = structuredClone(s.default);
  for (const [k,v] of Object.entries(overrides ?? {})) out[k] = v;
  return out;
}
