// lib/dates.mjs — pure date math. No I/O.
//
// All arithmetic runs on 'YYYY-MM-DD' strings via a Date pinned to 12:00
// UTC. Noon-UTC never crosses a date boundary when whole days are added,
// so daylight-saving transitions cannot corrupt the math. Timezone only
// enters once — when deciding what calendar day a build instant falls on.

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

// A noon-UTC Date for the given parts, or null if it is not a real day
// (e.g. 2026-02-30 silently rolls over — we reject that).
function toNoonUTC(year, month, day) {
  const dt = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return dt;
}

function fromDate(dt) {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Normalise an Airtable date value to a validated 'YYYY-MM-DD' string.
 * Accepts a date string (with or without a time part) or a Date object.
 * Returns null for anything missing, unparseable, or not a real day.
 */
export function parseDate(value) {
  if (value == null) return null;
  let s;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    s = value.toISOString();
  } else if (typeof value === 'string') {
    s = value;
  } else {
    return null;
  }
  const m = s.match(DATE_RE);
  if (!m) return null;
  return toNoonUTC(+m[1], +m[2], +m[3]) ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Add n days (negative allowed) to a 'YYYY-MM-DD' string. */
export function addDays(dateStr, n) {
  const m = dateStr.match(DATE_RE);
  const dt = toNoonUTC(+m[1], +m[2], +m[3]);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromDate(dt);
}

/** Day of week for a 'YYYY-MM-DD' string. 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(dateStr) {
  const m = dateStr.match(DATE_RE);
  return toNoonUTC(+m[1], +m[2], +m[3]).getUTCDay();
}

/** Human label for a date string, e.g. 'Sat 23 May'. */
export function formatLabel(dateStr) {
  const m = dateStr.match(DATE_RE);
  const dt = toNoonUTC(+m[1], +m[2], +m[3]);
  return `${DOW[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}

/** The calendar date at `instant` in IANA zone `tz`, as 'YYYY-MM-DD'. */
export function localToday(instant, tz) {
  const d = instant instanceof Date ? instant : new Date(instant);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The wall-clock time at `instant` in IANA zone `tz`, as 'HH:MM' (24h). */
export function localTime(instant, tz) {
  const d = instant instanceof Date ? instant : new Date(instant);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  let hour = get('hour');
  if (hour === '24') hour = '00'; // some ICU builds emit 24 at midnight
  return `${hour}:${get('minute')}`;
}

/**
 * The display window: the next `count` Saturday–Sunday weekends from the
 * build instant, evaluated in IANA zone `tz`.
 *
 * - Build runs Mon–Fri  → first weekend is the upcoming Saturday.
 * - Build runs Saturday → that day's weekend is first.
 * - Build runs Sunday   → the weekend in progress is still first (its
 *   Saturday was yesterday) — a renter looking on Sunday must see today.
 *
 * Returns: [{ index, days: [{date,label}, {date,label}] }, ...]
 */
export function weekendWindow(instant, tz, count) {
  const today = localToday(instant, tz);
  const dow = dayOfWeek(today);
  let offsetToSaturday;
  if (dow === 6) offsetToSaturday = 0; // Saturday
  else if (dow === 0) offsetToSaturday = -1; // Sunday — Saturday was yesterday
  else offsetToSaturday = 6 - dow; // Mon–Fri — upcoming Saturday
  const firstSaturday = addDays(today, offsetToSaturday);

  const weekends = [];
  for (let i = 0; i < count; i++) {
    const sat = addDays(firstSaturday, i * 7);
    const sun = addDays(sat, 1);
    weekends.push({
      index: i,
      days: [
        { date: sat, label: formatLabel(sat) },
        { date: sun, label: formatLabel(sun) },
      ],
    });
  }
  return weekends;
}
