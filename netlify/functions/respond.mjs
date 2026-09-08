// GET /.netlify/functions/respond?id=...&action=approve|decline&sig=...
// The link the owner clicks from the email/WhatsApp notification. Verifies
// the signature, updates the booking, emails the guest, and shows a small
// branded confirmation page — no login, no dashboard needed for v1.
import { getBooking, saveBooking } from "./_lib/store.mjs";
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

  const booking = await getBooking(id);
  if (!booking) {
    return page("Booking not found", "This booking request no longer exists — it may have already been handled.", true);
  }

  if (booking.status !== "pending") {
    return page(
      `Already ${booking.status}`,
      `This request for ${booking.checkin} → ${booking.checkout} (${booking.name}) was already marked as "${booking.status}".`,
      false
    );
  }

  booking.status = action === "approve" ? "confirmed" : "declined";
  booking.respondedAt = new Date().toISOString();

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

  const title = booking.status === "confirmed" ? "Booking confirmed" : "Booking declined";
  const detail =
    booking.status === "confirmed"
      ? `${booking.name}'s stay from ${booking.checkin} to ${booking.checkout} is now confirmed and blocked on the calendar. They've been emailed the good news${booking.stripePaymentLinkUrl ? " along with their payment link" : ""}.${paymentLinkNote}`
      : `${booking.name}'s request for ${booking.checkin} to ${booking.checkout} has been declined and the dates are released. They've been emailed.`;

  return page(title, detail, false);
};

function page(title, detail, isError) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — L'Ancienne École</title>
<style>
  body { margin:0; background:#0b0b09; color:#ece6d8; font-family: 'Work Sans', Arial, sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; }
  .card { max-width: 480px; padding: 48px 40px; border:1px solid rgba(201,167,105,0.3); border-radius:4px; text-align:center; }
  h1 { font-family: Georgia, serif; font-weight:500; font-size:28px; color: ${isError ? "#d98c8c" : "#c9a769"}; margin: 0 0 16px; }
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
