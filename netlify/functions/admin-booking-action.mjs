// POST /.netlify/functions/admin-booking-action — { id, action: "decline" | "cancel", reason? }
// The /admin "Aanvragen" tab's row-detail actions. Distinct from respond.mjs
// (the signed email link an owner clicks without logging in): this endpoint
// requires an actual admin session, and additionally supports "cancel" —
// annulling a request that was already approved (and possibly already
// paid), which respond.mjs was never built to do since it only ever acted
// on a still-"pending" request.
//
// Nothing is ever hard-deleted here. A declined or cancelled booking keeps
// its full record (including its history — see store.pushHistory) so it
// stays visible in the Aanvragen list and countable in whatever reporting
// the owner does later; only its nights are released back to availability.
import {
  getBooking,
  saveBooking,
  getPricingSettings,
  releaseNights,
  pushHistory,
} from "./_lib/store.mjs";
import { effectiveStatus } from "./_lib/availability.mjs";
import { nightsBetween } from "./_lib/dates.mjs";
import { hasValidAdminSession, adminUnauthorizedResponse } from "./_lib/adminAuth.mjs";
import { sendGuestEmail } from "./_lib/notify.mjs";
import { deactivatePaymentLink } from "./_lib/stripe.mjs";

export default async (req) => {
  if (!hasValidAdminSession(req)) return adminUnauthorizedResponse();
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const { id, action, reason } = body || {};
  if (!id || !["decline", "cancel"].includes(action)) {
    return json({ ok: false, error: "action must be 'decline' or 'cancel'" }, 400);
  }

  const booking = await getBooking(id, { strong: true });
  if (!booking) return json({ ok: false, error: "Booking not found" }, 404);

  const settings = await getPricingSettings({ strong: true });
  const current = effectiveStatus(booking, settings);
  const nights = nightsBetween(booking.checkin, booking.checkout);

  if (action === "decline") {
    // Mirrors respond.mjs's decline branch, just from a logged-in admin
    // instead of the signed email link — for a request that's still
    // pending (or has quietly expired-but-not-yet-swept). A request that
    // was already approved must go through "cancel" instead, since that
    // path also has to think about payment and the Stripe link.
    if (!["pending", "expired_unanswered"].includes(current)) {
      return json(
        { ok: false, error: `Kan alleen een openstaande aanvraag afwijzen (huidige status: ${current}).` },
        409
      );
    }
    booking.status = "declined";
    booking.respondedAt = new Date().toISOString();
    pushHistory(booking, "declined", { by: "admin", reason: reason || null });
    await releaseNights(nights, id);
    await saveBooking(id, booking);
    const guestEmailResult = await sendGuestEmail(booking, "declined");
    return json({ ok: true, status: booking.status, guestEmailResult });
  }

  // action === "cancel" — only ever for a request that was actually
  // approved. A never-approved request is "declined", not "cancelled" —
  // keeping the two distinct in the data makes the booking's own history
  // an honest record of what actually happened.
  if (current !== "confirmed") {
    return json(
      { ok: false, error: `Kan alleen een goedgekeurde boeking annuleren (huidige status: ${current}).` },
      409
    );
  }

  const wasPaid = !!booking.paid;
  let linkDeactivated = null;
  if (booking.stripePaymentLinkId) {
    try {
      await deactivatePaymentLink(booking.stripePaymentLinkId);
      linkDeactivated = true;
    } catch (e) {
      linkDeactivated = false;
      booking.stripePaymentLinkDeactivateError = e.message;
    }
  }

  booking.status = "cancelled";
  booking.cancelledAt = new Date().toISOString();
  booking.cancelledBy = "admin";
  booking.cancelReason = reason || null;
  pushHistory(booking, "cancelled", { by: "admin", reason: reason || null, wasPaid, linkDeactivated });

  await releaseNights(nights, id);
  await saveBooking(id, booking);
  const guestEmailResult = await sendGuestEmail(booking, "cancelled");

  return json({
    ok: true,
    status: booking.status,
    linkDeactivated,
    guestEmailResult,
    // Surfaced verbatim in the admin UI right after cancelling — the point
    // is that "cancelled" must never read as "and the money's back", when
    // this system has no way to actually move money on its own.
    refundNote: wasPaid
      ? "Deze boeking was al betaald. Annuleren keert dit bedrag NIET automatisch terug — regel een terugbetaling zelf via het Stripe-dashboard."
      : null,
  });
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

export const config = {
  path: "/.netlify/functions/admin-booking-action",
};
