/** 83.4 → "1:23" */
export function timecode(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** "1:23" | "83" | "1m23s" → 83, or null */
export function parseTime(raw: string | null): number | null {
  if (!raw) return null;
  const v = raw.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v);
  const mmss = v.match(/^(\d+):(\d{1,2})$/);
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
  const hms = v.match(/^(?:(\d+)m)?(?:(\d+)s)?$/);
  if (hms && (hms[1] || hms[2])) return Number(hms[1] ?? 0) * 60 + Number(hms[2] ?? 0);
  return null;
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Case- and ё-insensitive search key. */
export function searchKey(s: string) {
  return s.toLowerCase().replaceAll("ё", "е").replace(/[«»"'.,!?—–-]/g, " ").replace(/\s+/g, " ").trim();
}

const compact = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });

/** "1 просмотр", "12 просмотров", "1,2 тыс. просмотров" */
export function viewsLabel(n: number) {
  const word = plural(n, "просмотр", "просмотра", "просмотров");
  return `${n < 10000 ? n.toLocaleString("ru-RU") : compact.format(n)} ${n >= 10000 ? "просмотров" : word}`;
}

const rtf = new Intl.RelativeTimeFormat("ru", { numeric: "auto" });

/** "сегодня", "вчера", "6 дней назад", "3 недели назад", "2 месяца назад" */
export function ago(iso?: string) {
  if (!iso) return "";
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 7) return rtf.format(-days, "day");
  if (days < 30) return rtf.format(-Math.floor(days / 7), "week");
  if (days < 365) return rtf.format(-Math.floor(days / 30), "month");
  return rtf.format(-Math.floor(days / 365), "year");
}

/** "только что", "5 минут назад", "3 часа назад", then like ago(). */
export function since(ms: number) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "только что";
  if (s < 3600) return rtf.format(-Math.floor(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.floor(s / 3600), "hour");
  return ago(new Date(ms).toISOString());
}

export function fullDate(iso?: string) {
  return iso ? new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }) : "";
}
