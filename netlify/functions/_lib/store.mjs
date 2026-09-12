// Thin wrapper around Netlify Blobs — the small built-in key/value store we
// use instead of a separate database. Logical stores:
//   "bookings"    — one JSON object per booking request, keyed by its id
//   "calendar"    — cached busy-date data: the Airbnb feed (from the
//                   scheduled sync)
//   "pricing"     — the admin-editable nightly rates + pricing/booking
//                   settings (see pricingDefaults.mjs for the shape)
//   "night-locks" — one tiny record per calendar night, used only to narrow
//                   the window in which two simultaneous requests could
//                   both think the same night is free (see claimNights()).
import { withReferences } from "./bookingReference.mjs";
import { getStore } from "@netlify/blobs";
import { mergeWithDefaults } from "./pricingDefaults.mjs";

export function bookingsStore() {
  return getStore("bookings");
}

export function calendarStore() {
  return getStore("calendar");
}

export function pricingStore() {
  return getStore("pricing");
}

export function nightLocksStore() {
  return getStore("night-locks");
}

// Reads that decide whether dates are available, or whether an approval
// would create a double-booking, use "strong" consistency — a touch slower,
// but immune to the brief replication lag Netlify Blobs' default "eventual"
// consistency can have across regions. Every other read (display-only) uses
// the fast default.
const STRONG = { consistency: "strong" };

export async function getBooking(id, { strong = false } = {}) {
  const store = bookingsStore();
  const booking = await store.get(id, { type: "json", ...(strong ? STRONG : {}) });
  if (booking && !booking.reference) return (await listBookings({ strong })).find(b => b.id === id) || booking;
  return booking;
}

export async function saveBooking(id, data) {
  const store = bookingsStore();
  await store.setJSON(id, data);
}

// Appends one entry to a booking's audit trail in place and returns the
// booking, so call sites can do `pushHistory(booking, "approved", {...})`
// right before `saveBooking(id, booking)`. This is the one place every
// status-changing code path (book.mjs, respond.mjs, stripe-webhook.mjs,
// expire-bookings.mjs, admin-booking-action.mjs) records what happened, so
// /admin's booking detail view has a real timeline instead of just the
// handful of top-level *At fields. Bookings created before this existed
// simply have no/partial history — the admin UI shows what's there rather
// than pretending otherwise.
export function pushHistory(booking, event, meta = {}) {
  if (!Array.isArray(booking.history)) booking.history = [];
  booking.history.push({ at: new Date().toISOString(), event, ...meta });
  return booking;
}

export async function listBookings({ strong = false } = {}) {
  const store = bookingsStore();
  const { blobs } = await store.list();
  const all = await Promise.all(
    blobs.map((b) => store.get(b.key, { type: "json", ...(strong ? STRONG : {}) }))
  );
  return withReferences(all.filter(Boolean));
}

export async function getAirbnbBusyNights({ strong = false } = {}) {
  const store = calendarStore();
  const data = await store.get("airbnb-busy-nights", { type: "json", ...(strong ? STRONG : {}) });
  return data?.nights ?? [];
}

export async function getAirbnbSyncMeta() {
  const store = calendarStore();
  return store.get("airbnb-busy-nights", { type: "json" });
}

export async function setAirbnbBusyNights(nights, sourceMeta) {
  const store = calendarStore();
  const now = new Date().toISOString();
  await store.setJSON("airbnb-busy-nights", {
    nights,
    syncedAt: now, // last SUCCESSFUL sync
    lastAttemptAt: now, // last attempt of any kind (success counts too)
    lastError: null, // a fresh successful sync clears any previous error
    ...sourceMeta,
  });
}

// Records a failed sync WITHOUT touching the last-known-good `nights` list
// (setAirbnbBusyNights isn't called on failure) — surfaced on /admin so a
// broken AIRBNB_ICAL_URL or an Airbnb-side outage doesn't go unnoticed.
// lastAttemptAt is updated even on failure so /admin can show "last attempt"
// separately from "last successful sync" — e.g. several failed retries in a
// row after one old success should read as stale-and-struggling, not silently
// look identical to a single failure right after a fresh success.
export async function setAirbnbSyncError(message) {
  const store = calendarStore();
  const current = (await store.get("airbnb-busy-nights", { type: "json" })) || {};
  await store.setJSON("airbnb-busy-nights", {
    ...current,
    lastError: message,
    lastErrorAt: new Date().toISOString(),
    lastAttemptAt: new Date().toISOString(),
  });
}

// ---- Pricing settings ------------------------------------------------

export async function getPricingSettings({ strong = false } = {}) {
  const store = pricingStore();
  const saved = await store.get("settings", { type: "json", ...(strong ? STRONG : {}) });
  return mergeWithDefaults(saved);
}

export async function savePricingSettings(settings) {
  const store = pricingStore();
  await store.setJSON("settings", settings);
}

// ---- Nightly rates -----------------------------------------------------
// One JSON object, keyed by "YYYY-MM-DD", value { priceCents, minNights }.
// A date not present in this map has no price set — it is NOT bookable,
// never treated as free/€0.

export async function getAllRates({ strong = false } = {}) {
  const store = pricingStore();
  const data = await store.get("rates", { type: "json", ...(strong ? STRONG : {}) });
  return data || {};
}

// Merges `patch` (a { "YYYY-MM-DD": { priceCents?, minNights? } } object)
// into the stored rates, returning the full updated map and the list of
// dates that actually changed value (for the admin "here's what will
// change" confirmation step).
export async function patchRates(patch) {
  const store = pricingStore();
  const current = (await store.get("rates", { type: "json", ...STRONG })) || {};
  const changed = [];
  const next = { ...current };
  for (const [date, fields] of Object.entries(patch)) {
    const existing = next[date] || {};
    const merged = { ...existing, ...fields };
    if (merged.priceCents == null) delete merged.priceCents;
    if (merged.minNights == null) delete merged.minNights;
    if (!merged.blocked) delete merged.blocked;
    if (!merged.saturdayTurnover) delete merged.saturdayTurnover;
    if (merged.allowedArrivalWeekdays == null) delete merged.allowedArrivalWeekdays;
    if (JSON.stringify(existing) !== JSON.stringify(merged)) {
      changed.push({
        date,
        before: existing.priceCents ?? null,
        after: merged.priceCents ?? null,
        blockedBefore: !!existing.blocked,
        blockedAfter: !!merged.blocked,
      });
    }
    if (Object.keys(merged).length === 0) {
      delete next[date];
    } else {
      next[date] = merged;
    }
  }
  await store.setJSON("rates", next);
  return { rates: next, changed };
}

// ---- Best-effort night claiming (concurrency mitigation) --------------
// Netlify Blobs has no compare-and-swap in the SDK version this site uses,
// so this can't be a true atomic lock. What it does do: write a claim for
// every requested night, then immediately re-read each one back with
// strong consistency to check nothing else won it in the same instant.
// This narrows — but, honestly, does not mathematically eliminate — the
// window where two near-simultaneous requests both see a night as free.
// The guarantee that actually matters is enforced separately and for real,
// in respond.mjs: two overlapping bookings can never BOTH reach "confirmed"
// status, because approval re-checks against every other confirmed booking
// and against Airbnb before confirming. See README "Availability & double
// bookings".
export async function claimNights(nights, bookingId) {
  const store = nightLocksStore();
  const claimedByUs = [];
  try {
    for (const night of nights) {
      const existing = await store.get(night, { type: "json", ...STRONG });
      if (existing && existing.bookingId !== bookingId) {
        await releaseNights(claimedByUs, bookingId);
        return { ok: false, conflictNight: night };
      }
      await store.setJSON(night, { bookingId, at: new Date().toISOString() });
      claimedByUs.push(night);
    }
    // Re-read every night we just wrote to catch a racer that wrote in the
    // same window between our check and our write.
    for (const night of claimedByUs) {
      const confirmed = await store.get(night, { type: "json", ...STRONG });
      if (!confirmed || confirmed.bookingId !== bookingId) {
        await releaseNights(claimedByUs, bookingId);
        return { ok: false, conflictNight: night };
      }
    }
    return { ok: true };
  } catch (e) {
    await releaseNights(claimedByUs, bookingId);
    throw e;
  }
}

export async function releaseNights(nights, bookingId) {
  const store = nightLocksStore();
  await Promise.all(
    nights.map(async (night) => {
      const existing = await store.get(night, { type: "json" }).catch(() => null);
      if (existing && existing.bookingId === bookingId) {
        await store.delete(night).catch(() => {});
      }
    })
  );
}
