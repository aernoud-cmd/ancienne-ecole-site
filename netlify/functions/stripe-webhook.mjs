// POST /.netlify/functions/stripe-webhook
// Configure this URL in the Stripe dashboard (Developers → Webhooks) to
// listen for "checkout.session.completed" and "checkout.session.expired".
// Marks the matching booking PAID (a distinct state from "approved" — see
// README "Booking states") and lets the owner and guest know. Never trusts
// the request without verifying Stripe's signature first. Idempotent: a
// duplicate delivery of the same event is a no-op because it checks
// `booking.paid` before doing anything.
import { getBooking, saveBooking, pushHistory } from "./_lib/store.mjs";
import { verifyWebhookSignature } from "./_lib/stripe.mjs";
import { sendGuestEmail } from "./_lib/notify.mjs";
import { Resend } from "resend";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text();

  let event;
  try {
    event = verifyWebhookSignature(rawBody, signature);
  } catch (e) {
    console.error("stripe-webhook: signature verification failed:", e.message);
    return new Response(`Webhook signature verification failed: ${e.message}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const bookingId = session.metadata?.booking_id;
    if (bookingId && session.payment_status === "paid") {
      // A redirect back to the confirmation page is NOT proof of payment on
      // its own — this webhook event, with a verified signature and
      // payment_status "paid", is the only thing that marks a booking paid.
      const booking = await getBooking(bookingId, { strong: true });
      if (booking && !booking.paid) {
        if (booking.status !== "confirmed") {
          // The booking was cancelled or declined AFTER this Payment Link
          // was created (admin-booking-action.mjs tries to deactivate the
          // link on cancel, but that's best-effort — Stripe API calls can
          // fail, or a guest can complete a checkout session that was
          // already open in their browser in the brief window before
          // deactivation lands). Stripe has already captured real money at
          // this point; we cannot undo that from here, and we must NOT
          // silently flip this booking back to paid/confirmed as if
          // nothing happened. Record it loudly instead so the owner sees
          // it on /admin and refunds it by hand via the Stripe dashboard.
          booking.staleLinkPayment = {
            detectedAt: new Date().toISOString(),
            stripeCheckoutSessionId: session.id,
            amountTotalCents: session.amount_total ?? null,
            currency: session.currency ?? null,
            bookingStatusAtPayment: booking.status,
          };
          pushHistory(booking, "stale_link_payment_alert", { stripeCheckoutSessionId: session.id });
          await saveBooking(bookingId, booking);
          await notifyOwnerStaleLinkPayment(booking, session);
        } else {
          booking.paid = true;
          booking.paidAt = new Date().toISOString();
          booking.stripeCheckoutSessionId = session.id;
          pushHistory(booking, "paid", { stripeCheckoutSessionId: session.id });
          await saveBooking(bookingId, booking);
          await notifyOwnerPaymentReceived(booking);
          await sendGuestEmail(booking, "paid");
        }
      }
    } else {
      console.warn("stripe-webhook: checkout.session.completed without a matching booking_id/paid status");
    }
  } else if (event.type === "checkout.session.expired") {
    const session = event.data.object;
    const bookingId = session.metadata?.booking_id;
    if (bookingId) {
      const booking = await getBooking(bookingId, { strong: true });
      if (booking && booking.status === "confirmed" && !booking.paid) {
        await notifyOwnerLinkExpired(booking);
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "content-type": "application/json" },
  });
};

async function notifyOwnerPaymentReceived(booking) {
  const key = process.env.RESEND_API_KEY;
  const ownerEmail = process.env.OWNER_EMAIL;
  if (!key || !ownerEmail) return;
  try {
    const resend = new Resend(key);
    await resend.emails.send({
      from: process.env.NOTIFY_FROM_EMAIL || "L'Ancienne École <bookings@ancienne-ecole.rent>",
      to: ownerEmail,
      subject: `PAID — ${booking.name}, ${booking.checkin} to ${booking.checkout}`,
      html: `<div style="font-family: sans-serif;"><p><b>${booking.name}</b> just paid for their stay from <b>${booking.checkin}</b> to <b>${booking.checkout}</b>.</p></div>`,
    });
  } catch (e) {
    console.error("stripe-webhook: failed to notify owner of payment:", e.message);
  }
}

async function notifyOwnerStaleLinkPayment(booking, session) {
  const key = process.env.RESEND_API_KEY;
  const ownerEmail = process.env.OWNER_EMAIL;
  const amount = session.amount_total != null ? (session.amount_total / 100).toFixed(2) : "?";
  const currency = (session.currency || "eur").toUpperCase();
  if (!key || !ownerEmail) {
    console.error(
      `stripe-webhook: ACTION REQUIRED — received ${amount} ${currency} for booking ${booking.id} (${booking.name}, ${booking.checkin} to ${booking.checkout}) which is no longer confirmed (status: ${booking.status}). This was NOT applied to the booking and needs a manual refund via the Stripe dashboard. (No RESEND_API_KEY/OWNER_EMAIL set — this alert could only be logged, not emailed.)`
    );
    return;
  }
  try {
    const resend = new Resend(key);
    await resend.emails.send({
      from: process.env.NOTIFY_FROM_EMAIL || "L'Ancienne École <bookings@ancienne-ecole.rent>",
      to: ownerEmail,
      subject: `ACTION REQUIRED — payment received for a cancelled/declined booking (${booking.name})`,
      html: `<div style="font-family: sans-serif;">
        <p><b>${amount} ${currency}</b> was just paid via a Stripe Payment Link for <b>${booking.name}</b>'s stay
        (${booking.checkin} to ${booking.checkout}), but that booking's status is currently
        <b>${booking.status}</b> — not "confirmed". This payment was <b>NOT</b> applied to the booking.</p>
        <p>This can happen if the guest completed checkout in the moment between you cancelling/declining and the
        payment link being deactivated. The money has genuinely been charged in Stripe — please go to your Stripe
        dashboard, find checkout session <code>${session.id}</code>, and issue a refund by hand.</p>
      </div>`,
    });
  } catch (e) {
    console.error("stripe-webhook: failed to send stale-link-payment alert:", e.message);
  }
}

async function notifyOwnerLinkExpired(booking) {
  const key = process.env.RESEND_API_KEY;
  const ownerEmail = process.env.OWNER_EMAIL;
  if (!key || !ownerEmail) return;
  try {
    const resend = new Resend(key);
    await resend.emails.send({
      from: process.env.NOTIFY_FROM_EMAIL || "L'Ancienne École <bookings@ancienne-ecole.rent>",
      to: ownerEmail,
      subject: `Payment link expired, unpaid — ${booking.name}, ${booking.checkin} to ${booking.checkout}`,
      html: `<div style="font-family: sans-serif;"><p>The payment link for <b>${booking.name}</b>'s approved stay (<b>${booking.checkin}</b> to <b>${booking.checkout}</b>) expired without payment. The dates are still held for now (see your unpaid-approval expiry setting on /admin) — follow up with the guest, or send a fresh payment link, or decline the request from your bookings if you'd rather release the dates.</p></div>`,
    });
  } catch (e) {
    console.error("stripe-webhook: failed to notify owner of expired link:", e.message);
  }
}

export const config = {
  path: "/.netlify/functions/stripe-webhook",
};
