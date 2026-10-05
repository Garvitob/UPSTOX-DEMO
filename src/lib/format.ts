// Formatting for every rendered number and date (docs/SPEC.md → Rounding).
// ₹ uses Indian digit grouping (en-IN), $ uses US grouping. Dates are IST (no DST, fixed +05:30) and use
// fixed English month names so the server, the browser and the tests always produce identical strings.

const cache = new Map<string, Intl.NumberFormat>();
function nf(locale: string, min: number, max: number, grouping = true): Intl.NumberFormat {
  const k = `${locale}|${min}|${max}|${grouping}`;
  let f = cache.get(k);
  if (!f) {
    f = new Intl.NumberFormat(locale, { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: grouping });
    cache.set(k, f);
  }
  return f;
}

/** Values that print as zero at `d` decimals are zero (never "-0.00"). */
const tidy = (n: number, d: number): number => (Math.abs(n) < 0.5 * 10 ** -d ? 0 : n);

/** Plain number with Indian grouping, e.g. num(20359.5) → "20,359.50". Negative keeps an ASCII "-" (as Upstox tables). */
export const num = (n: number, d = 2): string => nf('en-IN', d, d).format(tidy(n, d));

/** Rupees, e.g. inr(1985.333) → "₹1,985.33"; inr(4968, 0) → "₹4,968". Pass magnitudes; copy adds direction words. */
export const inr = (n: number, d = 2): string => '₹' + num(n, d);

/** Dollars with US grouping, e.g. usd(180.306) → "$180.31". */
export const usd = (n: number, d = 2): string => '$' + nf('en-US', d, d).format(tidy(n, d));

/** Table style signed number: "+1,367.55" / "-2,964.00" (reference `sgn`); zero prints "0.00" without a sign. */
export const sgnNum = (n: number, d = 2): string => {
  const v = tidy(n, d);
  return v === 0 ? num(0, d) : (v < 0 ? '' : '+') + num(v, d);
};

/** India share counts print ungrouped, as the reference does ("6 → 9", "You sold 1500 shares"). */
export const shareCount = (n: number): string => (Number.isInteger(n) ? String(n) : qty(n));

/** Magnitude of a ratio as a percentage with 1 decimal: pct(-0.2983) → "29.8%". */
export const pct = (ratio: number): string => {
  const v = Math.abs(ratio * 100);
  return (v < 0.05 ? 0 : v).toFixed(1) + '%';
};

/** Signed percentage with a true minus sign, as SPEC writes it: "−3.3%", "+2.5%"; zero stays "0.0%". */
export const signedPct = (ratio: number): string => {
  const s = pct(ratio);
  if (s === '0.0%') return s;
  return (ratio < 0 ? '−' : '+') + s;
};

/** Ordinal: 1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 23rd 101st 111th. */
export const nth = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** Share quantity: integers as-is, fractional (US) up to 4 decimals with trailing zeros trimmed: 2.4 → "2.4". */
export const qty = (n: number): string => nf('en-US', 0, 4).format(n);

/** "share" / "shares". */
export const shares = (n: number): string => (n === 1 ? 'share' : 'shares');

// ---------- dates (IST) ----------
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const IST_OFFSET_MS = 5.5 * 3600 * 1000;

interface Parts { y: number; m: number; d: number; dow: number; hh: number; mm: number }
/** Calendar parts of an instant in IST. */
export function istParts(epochMs: number): Parts {
  const t = new Date(epochMs + IST_OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), dow: t.getUTCDay(), hh: t.getUTCHours(), mm: t.getUTCMinutes() };
}
const pad2 = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" (a calendar date, no time zone) → "12 Jan 2026". */
export function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return `${d} ${MON[m - 1]} ${y}`;
}

/** "YYYY-MM-DD" → "2 Oct" (e.g. which day's USD/INR close a lot used). */
export function fmtDayMonth(ymd: string): string {
  const [, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return `${d} ${MON[m - 1]}`;
}

/** "YYYY-MM-DD" → "Apr 2024" (used for "since <first month of the window>"). */
export function fmtMonthYear(ymd: string): string {
  const [y, m] = ymd.slice(0, 10).split('-').map(Number);
  return `${MON[m - 1]} ${y}`;
}

/** ISO instant → "12:42, 4 Oct" in IST (source chip "fetched <HH:MM, D Mon>"). */
export function fmtFetched(iso: string): string {
  const p = istParts(Date.parse(iso));
  return `${pad2(p.hh)}:${pad2(p.mm)}, ${p.d} ${MON[p.m]}`;
}

/** Epoch ms → "Thu 15:59" in IST ("Last traded <day> <HH:MM>"). */
export function fmtLastTraded(epochMs: number): string {
  const p = istParts(epochMs);
  return `${DOW[p.dow]} ${pad2(p.hh)}:${pad2(p.mm)}`;
}

/** Epoch ms → "Fri 2 Oct 22:30 IST" (tooltips: the full IST instant of a feed tick or candle). */
export function fmtIstStamp(epochMs: number): string {
  const p = istParts(epochMs);
  return `${DOW[p.dow]} ${p.d} ${MON[p.m]} ${pad2(p.hh)}:${pad2(p.mm)} IST`;
}

/** Epoch ms → "06 Oct" in IST (index expiry in the ticker). */
export function fmtExpiry(epochMs: number): string {
  const p = istParts(epochMs);
  return `${pad2(p.d)} ${MON[p.m]}`;
}

/** Instant → its IST calendar date "YYYY-MM-DD" (e.g. the date of an Alpaca fill for FX lookup). */
export function istDate(epochMs: number): string {
  const p = istParts(epochMs);
  return `${p.y}-${pad2(p.m + 1)}-${pad2(p.d)}`;
}

/** Epoch ms → "Mon 7:00 PM IST" style (US market opening note). */
export function fmtIstClock(epochMs: number): string {
  const p = istParts(epochMs);
  const h12 = p.hh % 12 === 0 ? 12 : p.hh % 12;
  return `${DOW[p.dow]} ${h12}:${pad2(p.mm)} ${p.hh < 12 ? 'AM' : 'PM'} IST`;
}

/** Initials for the avatar tile from the profile's user_name, e.g. "ASHA RAO" → "AR" (the name itself never leaves the server). */
export function initialsOf(name: string): string {
  return name
    .split(/[\s()]+/)
    .filter(w => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');
}
