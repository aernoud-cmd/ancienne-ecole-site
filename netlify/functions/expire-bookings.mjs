// Scheduled function — runs every hour. Makes expiry durable and visible
// (e.g. in the booking list) by persisting `status: "expired_unanswered"` or
// `status: "expired_unpaid"` once a request has been sitting unanswered or
// unpaid past the thresholds set on /admin, and releases its night-locks.
//
// This is a belt-and-suspenders companion to _lib/availability.mjs's
// effectiveStatus(): that function already makes an expired request stop
// blocking new ones immediately (live, on every read) even before this job
// runs — this job just writes the fact down so it's not only a computed,
// in-memory state.
import { listBookings, saveBooking, getPricingSettings, releaseNights, pushHistory } from "./_lib/store.mjs";
import { effectiveStatus } from "./_lib/availability.mjs";
import { nightsBetween } from "./_lib/dates.mjs";

export default async () => {
  const settings = await getPricingSettings({ strong: true });
  const bookings = await listBookings({ strong: true });
  let expiredCount = 0;

  for (const b of bookings) {
    if (b.status !== "pending" && !(b.status === "confirmed" && !b.paid)) continue;
    const status = effectiveStatus(b, settings);
    if (status === b.status) continue; // not expired

    b.status = status; // "expired_unanswered" | "expired_unpaid"
    b.expiredAt = new Date().toISOString();
    pushHistory(b, status, { by: "scheduled-sweep" });
    await saveBooking(b.id, b);
    await releaseNights(nightsBetween(b.checkin, b.checkout), b.id);
    expiredCount++;
  }

  return new Response(JSON.stringify({ ok: true, expired: expiredCount }), {
    headers: { "content-type": "application/json" },
  });
};

export const config = {
  schedule: "0 * * * *", // every hour
};
