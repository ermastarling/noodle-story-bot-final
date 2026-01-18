export function nowTs() { return Date.now(); }

export function dayKeyUTC(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,"0");
  const day = String(d.getUTCDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

export function parseYYYYMMDD(s) {
  const [y,m,d] = s.split("-").map(Number);
  return Date.UTC(y, m-1, d, 0,0,0,0);
}
