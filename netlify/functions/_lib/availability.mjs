// Shared "what's actually busy right now" logic — used by the public
// availability endpoint, the admin calendar, book.mjs (validating a new
// request) and respond.mjs (validating an approval). Keeping this in one
// place is what makes the expiry rule below apply consistently everywhere,
// instead of five different endpoints each computing "busy" slightly
// differently.
import { getAirbnbBusyNights, listBookings } from "./store.mjs";
import { nightsBetween, hoursSince } from "./dates.mjs";

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
  const [airbnbNights, bookings] = await Promise.all([
    getAirbnbBusyNights({ strong }),
    listBookings({ strong }),
  ]);
  const now = Date.now();
  const withStatus = bookings.map((b) => ({ ...b, effectiveStatus: effectiveStatus(b, settings, now) }));

  const confirmedNights = new Set();
  const pendingNights = new Set();
  for (const b of withStatus) {
    if (excludeBookingId && b.id === excludeBookingId) continue;
    if (b.effectiveStatus === "confirmed") {
      for (const n of nightsBetween(b.checkin, b.checkout)) confirmedNights.add(n);
    } else if (b.effectiveStatus === "pending") {
      for (const n of nightsBetween(b.checkin, b.checkout)) pendingNights.add(n);
    }
  }

  const busyNights = new Set([...airbnbNights, ...confirmedNights, ...pendingNights]);

  return {
    airbnbNights: new Set(airbnbNights),
    confirmedNights,
    pendingNights,
    busyNights,
    bookings: withStatus,
  };
}
