// GET /.netlify/functions/respond?id=...&action=approve|decline&sig=...
// The link the owner clicks from the email/WhatsApp notification. Verifies
// the signature, re-checks availability, updates the booking, emails the
// guest, and shows a small branded confirmation page — no login needed for
// this one link (the signature itself is the credential), unlike /admin.
import { getBooking, saveBooking, getPricingSettings, releaseNights } from "./_lib/store.mjs";
import { computeAvailability, effectiveStatus } from "./_lib/availability.mjs";
import { nightsBetween } from "./_lib/dates.mjs";
import { verifyAction } from "./_lib/token.mjs";
import { sendGuestEmail } from "./_lib/notify.mjs";
import { createBookingPaymentLink } from "./_lib/stripe.mjs";

export default async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const action = url.searchParams.get("action");
  const sig = url.searchParams.get("sig");

  if (!id || !["approve", "decline"].includes(action) || !verifyAction(id, action, sig)) {
    return page("Invalid or expired link", "This confirmation link isn't valid. If you're trying to respond to a booking request, please use the link from the original notification email.", true);
  }

  const booking = await getBooking(id, { strong: true });
  if (!booking) {
    return page("Booking not found", "This booking request no longer exists — it may have already been handled.", true);
  }

  if (booking.status !== "pending") {
    return page(
      `Already ${statusLabel(booking.status)}`,
      `This request for ${booking.checkin} → ${booking.checkout} (${booking.name}) was already marked "${statusLabel(booking.status)}".`,
      false
    );
  }

  const settings = await getPricingSettings({ strong: true });

  // A "pending" request whose expiry window has already passed (see
  // effectiveStatus() — this is the same live-expiry check availability.mjs
  // uses everywhere else) must not be approvable as if nothing happened,
  // even though the stored `status` field itself hasn't been flipped by the
  // hourly sweep yet. Declining an already-expired request is still fine —
  // it only releases dates that should already be free either way.
  if (action === "approve" && effectiveStatus(booking, settings) === "expired_unanswered") {
    return page(
      "This request has expired",
      `${booking.name}'s request for ${booking.checkin} → ${booking.checkout} was not answered within ${settings.pendingRequestExpiryHours} hours and has expired — it can no longer be approved directly. If the dates are still free and you want to honor it, contact ${booking.name} at ${booking.email} and ask them to submit a new request.`,
      true
    );
  }

  const nights = nightsBetween(booking.checkin, booking.checkout);

  if (action === "approve") {
    // The one guarantee this whole system actually makes: two overlapping
    // bookings can never both reach "confirmed". Re-check, right now, with
    // a strongly-consistent read, against every OTHER confirmed booking and
    // against Airbnb — excluding this booking's own (still "pending") nights
    // from the busy set, since those are what we're about to confirm.
    const { busyNights } = await computeAvailability(settings, { strong: true, excludeBookingId: id });
    const conflict = nights.some((n) => busyNights.has(n));
    if (conflict) {
      return page(
        "Can't confirm — now conflicts with another booking",
        `${booking.name}'s request for ${booking.checkin} → ${booking.checkout} now overlaps a booking that was confirmed (or synced from Airbnb) since this request came in. It has NOT been confirmed. Please contact ${booking.name} at ${booking.email} and either offer different dates or decline this request.`,
        true
      );
    }
  }

  booking.status = action === "approve" ? "confirmed" : "declined";
  booking.respondedAt = new Date().toISOString();

  if (booking.status === "declined") {
    // Free the night-locks so those dates can be claimed by a future
    // request instead of staying stuck against this declined booking's id.
    await releaseNights(nights, id);
  }

  let paymentLinkNote = "";
  if (booking.status === "confirmed") {
    try {
      const link = await createBookingPaymentLink(booking);
      booking.stripePaymentLinkUrl = link.url;
      booking.stripePaymentLinkId = link.id;
    } catch (e) {
      // Don't block the confirmation on this — the owner can still send a
      // payment link manually later. Surfaced on the confirmation page below.
      booking.stripePaymentLinkError = e.message;
      paymentLinkNote = ` (Payment link could not be created: ${e.message} — check STRIPE_SECRET_KEY in Netlify, then send the guest a link manually.)`;
    }
  }

  await saveBooking(id, booking);

  await sendGuestEmail(booking, booking.status === "confirmed" ? "confirmed" : "declined");

  const title = booking.status === "confirmed" ? "Booking approved" : "Booking declined";
  const detail =
    booking.status === "confirmed"
      ? `${booking.name}'s stay from ${booking.checkin} to ${booking.checkout} is now APPROVED and blocked on the calendar. They've been emailed the good news${booking.stripePaymentLinkUrl ? " along with their payment link" : ""} — the booking becomes PAID only once Stripe confirms they've actually paid it.${paymentLinkNote}`
      : `${booking.name}'s request for ${booking.checkin} to ${booking.checkout} has been declined and the dates are released. They've been emailed.`;

  return page(title, detail, false);
};

function statusLabel(status) {
  return (
    {
      pending: "requested",
      confirmed: "approved",
      declined: "declined",
      expired_unanswered: "expired (unanswered)",
      expired_unpaid: "expired (unpaid)",
    }[status] || status
  );
}

function page(title, detail, isError) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} — L'Ancienne École</title>
<style>
  body { margin:0; background:#0b0b09; color:#ece6d8; font-family: 'Work Sans', Arial, sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; }
  .card { max-width: 520px; padding: 48px 40px; border:1px solid rgba(201,167,105,0.3); border-radius:4px; text-align:center; }
  h1 { font-family: Georgia, serif; font-weight:500; font-size:26px; color: ${isError ? "#d98c8c" : "#c9a769"}; margin: 0 0 16px; }
  p { font-size: 15px; line-height:1.7; color:#a89d89; }
</style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${detail}</p>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

export const config = {
  path: "/.netlify/functions/respond",
};
