// Small date helpers shared by the booking functions.
// Dates are handled as plain "YYYY-MM-DD" strings (no timezone math needed —
// stays are always booked in whole nights, in the property's local calendar).

export function toISODate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISODate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// Returns every night (as YYYY-MM-DD) between checkin (inclusive) and
// checkout (exclusive) — the standard hospitality convention: the checkout
// date itself is not a booked night, it's the day the next guest can arrive.
export function nightsBetween(checkinISO, checkoutISO) {
  const nights = [];
  let cur = parseISODate(checkinISO);
  const end = parseISODate(checkoutISO);
  while (cur < end) {
    nights.push(toISODate(cur));
    cur = new Date(cur.getTime() + 86400000);
  }
  return nights;
}

// True if [checkinISO, checkoutISO) overlaps any night in busySet (a Set of "YYYY-MM-DD").
export function rangeOverlapsBusy(checkinISO, checkoutISO, busySet) {
  const nights = nightsBetween(checkinISO, checkoutISO);
  return nights.some((n) => busySet.has(n));
}

export function isValidISODate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseISODate(s);
  if (isNaN(d.getTime())) return false;
  // Reject values JS silently rolled over (e.g. 2026-13-40 -> some date in 2027).
  return toISODate(d) === s;
}
