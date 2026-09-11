// Shared "what's actually busy right now" logic — used by the public
// availability endpoint, the admin calendar, book.mjs (validating a new
// request) and respond.mjs (validating an approval). Keeping this in one
// place is what makes the expiry rule below apply consistently everywhere,
// instead of five different endpoints each computing "busy" slightly
// differently.
import { getAirbnbBusyNights, listBookings, getAllRates } from "./store.mjs";
import { nightsBetween } from "./dates.mjs";
import { roundNightlyPriceCents } from "./money.mjs";

// Pure and unit-testable on its own: which dates the owner has explicitly
// blocked from /admin (personal use, maintenance, etc.), independent of
// whether a price happens to still be set on them. Kept separate from
// "no price set" — those are two distinct reasons a date isn't bookable,
// and /admin shows them as two distinct statuses.
export function ownBlockedNightsFromRates(rates) {
  return Object.keys(rates || {}).filter((d) => rates[d]?.blocked);
}

// Pure and unit-testable on its own: a sparse {date: roundedPriceCents} map
// for every date in `dates` that has a price set on `rates` — used by the
// public availability endpoint to show a nightly price on the guest
// calendar tile. Rounds with the exact same roundNightlyPriceCents() rule
// applied inside calculateQuote() (see _lib/pricing.mjs and _lib/money.mjs),
// on the same raw admin-entered rate, so the number shown on a tile can
// never differ from what a booking for that night would actually charge.
// Dates with no price at all are simply omitted (mirrors the noPriceNights
// list the same caller builds alongside this).
export function buildPricesByDate(rates, dates) {
  const out = {};
  const safeRates = rates || {};
  for (const d of dates) {
    const raw = safeRates[d] && safeRates[d].priceCents;
    if (raw != null) out[d] = roundNightlyPriceCents(raw);
  }
  return out;
}

// A request's *effective* status accounts for expiry even before the
// scheduled sweep (expire-bookings.mjs) has had a chance to persist it —
// so there's never a window where an actually-expired request still blocks
// new ones just because the hourly job hasn't run yet. The sweep is what
// makes the expiry visible/durable (e.g. in the admin view); this function
// is what makes it effective immediately.
export function effectiveStatus(booking, settings, now = Date.now()) {
  if (booking.status === "pending") {
    const hours = (now - new Date(booking.createdAt).getTime()) / 3600000;
    if (hours > (settings.pendingRequestExpiryHours ?? 48)) return "expired_unanswered";
  }
  if (booking.status === "confirmed" && !booking.paid) {
    const since = booking.respondedAt || booking.createdAt;
    const hours = (now - new Date(since).getTime()) / 3600000;
    if (hours > (settings.unpaidApprovedExpiryHours ?? 72)) return "expired_unpaid";
  }
  // Direct-Checkout flow (book.mjs): a booking sits in "awaiting_payment"
  // from the moment its Stripe Checkout Session is created until the
  // webhook confirms payment. If the guest never finishes paying, this is
  // what stops the temporary hold from blocking the nights forever — the
  // scheduled sweep (expire-bookings.mjs) and the Stripe-side session
  // expiry (created with a matching `expires_at`, see _lib/stripe.mjs) both
  // aim for the same window, but this live check is what guarantees no gap
  // even if a webhook delivery is delayed or lost.
  if (booking.status === "awaiting_payment") {
    const minutes = (now - new Date(booking.createdAt).getTime()) / 60000;
    if (minutes > (settings.checkoutHoldMinutes ?? 45)) return "payment_expired";
  }
  return booking.status;
}

/**
 * @param {object} settings  current pricing/booking settings (for the
 *   expiry thresholds) — pass one you already fetched to avoid a second read.
 * @param {object} [opts]
 * @param {boolean} [opts.strong] use strong Blobs consistency
 * @param {string}  [opts.excludeBookingId] leave one booking's own nights
 *   out of the busy set (used when re-validating that booking itself)
 */
export async function computeAvailability(settings, { strong = false, excludeBookingId = null } = {}) {
  const [airbnbNights, bookings, rates] = await Promise.all([
    getAirbnbBusyNights({ strong }),
    listBookings({ strong }),
    getAllRates({ strong }),
  ]);
  const now = Date.now();
  const withStatus = bookings.map((b) => ({ ...b, effectiveStatus: effectiveStatus(b, settings, now) }));

  const confirmedNights = new Set();
  const pendingNights = new Set();
  for (const b of withStatus) {
    if (excludeBookingId && b.id === excludeBookingId) continue;
    if (b.effectiveStatus === "confirmed") {
      for (const n of nightsBetween(b.checkin, b.checkout)) confirmedNights.add(n);
    } else if (b.effectiveStatus === "pending" || b.effectiveStatus === "awaiting_payment") {
      // "awaiting_payment" (a guest is mid-Stripe-Checkout right now) blocks
      // nights the same way "pending" (an old request-flow booking awaiting
      // owner review) does — either way, another guest must not be able to
      // book or pay for the same nights in the meantime. Guest-facing UI
      // shows both as "requested, awaiting confirmation".
      for (const n of nightsBetween(b.checkin, b.checkout)) pendingNights.add(n);
    }
  }

  const ownBlockedNights = new Set(ownBlockedNightsFromRates(rates));

  const busyNights = new Set([...airbnbNights, ...confirmedNights, ...pendingNights, ...ownBlockedNights]);

  return {
    airbnbNights: new Set(airbnbNights),
    confirmedNights,
    pendingNights,
    ownBlockedNights,
    busyNights,
    bookings: withStatus,
  };
}
