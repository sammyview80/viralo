/** datetime-local input ↔ UTC ISO (wall-clock local, not browser-parse quirks). */

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function datetimeLocalToUtcIso(value: string): string {
  const m = LOCAL_RE.exec(value);
  if (!m) throw new Error("invalid datetime-local value");
  const [, ys, ms, ds, hs, mins] = m;
  const d = new Date(Number(ys), Number(ms) - 1, Number(ds), Number(hs), Number(mins), 0, 0);
  return d.toISOString();
}

export function utcIsoToDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function defaultDatetimeLocalPlusMs(ms: number): string {
  return utcIsoToDatetimeLocal(new Date(Date.now() + ms).toISOString());
}
