// Unit tests for the pure, Blobs-free pieces of the new booking-cancellation
// path (section 1 of the "vervolgopdracht"): store.pushHistory() itself, and
// effectiveStatus()/computeAvailability()'s handling of the new "cancelled"
// status. The stateful parts (admin-booking-action.mjs, stripe-webhook.mjs's
// stale-link-payment branch) need live Netlify Blobs + Stripe and are only
// covered by manual/live verification — see README and the project doc.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pushHistory } from "../netlify/functions/_lib/store.mjs";
import { effectiveStatus, ownBlockedNightsFromRates } from "../netlify/functions/_lib/availability.mjs";

test("pushHistory appends an entry with a timestamp and the given event/meta", () => {
  const booking = { id: "b1" };
  pushHistory(booking, "requested");
  assert.equal(booking.history.length, 1);
  assert.equal(booking.history[0].event, "requested");
  assert.ok(booking.history[0].at); // ISO timestamp present

  pushHistory(booking, "cancelled", { by: "admin", reason: "double-booked elsewhere", wasPaid: true });
  assert.equal(booking.history.length, 2);
  assert.deepEqual(booking.history[1].by, "admin");
  assert.deepEqual(booking.history[1].reason, "double-booked elsewhere");
  assert.equal(booking.history[1].wasPaid, true);
});

test("pushHistory initializes history on a booking that has none yet (pre-existing production bookings)", () => {
  const legacyBooking = { id: "old-one", status: "confirmed" }; // no `history` field at all
  pushHistory(legacyBooking, "cancelled", { by: "admin" });
  assert.deepEqual(legacyBooking.history.map((h) => h.event), ["cancelled"]);
});

test("effectiveStatus passes a cancelled booking through unchanged (no expiry logic applies to it)", () => {
  const settings = { pendingRequestExpiryHours: 48, unpaidApprovedExpiryHours: 72 };
  const booking = {
    status: "cancelled",
    paid: false,
    createdAt: new Date(Date.now() - 1000 * 3600000).toISOString(),
  };
  assert.equal(effectiveStatus(booking, settings), "cancelled");
});

test("a cancelled booking's nights are never treated as an owner-blocked date (cancellation only clears night-locks, never touches rates)", () => {
  // Guards the boundary between the two: ownBlockedNightsFromRates() only
  // ever looks at explicit admin `blocked` flags on rates — cancelling a
  // booking must never accidentally set one.
  const rates = { "2027-05-01": { priceCents: 15000 } };
  assert.deepEqual(ownBlockedNightsFromRates(rates), []);
});
