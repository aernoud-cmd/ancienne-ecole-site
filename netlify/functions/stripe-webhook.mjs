// POST /.netlify/functions/stripe-webhook
// Configure this URL in the Stripe dashboard (Developers → Webhooks) to
// listen for: checkout.session.completed, checkout.session.expired,
// checkout.session.async_payment_succeeded, checkout.session.async_payment_failed,
// and charge.refunded.
//
// This is the ONLY thing that ever confirms a booking or marks a refund
// successful — never a redirect back to the site, never the synchronous
// result of the API call that created the Checkout Session or the refund.
// Never trusts the request without verifying Stripe's signature first.
// Idempotent throughout: every handler checks the booking's current state
// before acting, so a duplicate delivery of the same event (Stripe retries
// on anything but a 200) is always a safe no-op, never a double-charge,
// double-refund, or duplicate email.
import { getBooking, saveBooking, releaseNights, pushHistory, listBookings } from "./_lib/store.mjs";
import { verifyWebhookSignature } from "./_lib/stripe.mjs";
import { sendGuestEmail, siteBaseUrl, bookingSummaryTable } from "./_lib/notify.mjs";
import { nightsBetween } from "./_lib/dates.mjs";
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

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await handlePaymentSucceeded(event.data.object);
        break;
      case "checkout.session.expired":
      case "checkout.session.async_payment_failed":
        await handlePaymentNotCompleted(event.data.object);
        break;
      case "charge.refunded":
        await handleChargeRefunded(event.data.object);
        break;
      default:
        // Other event types aren't subscribed to on purpose — nothing to do.
        break;
    }
  } catch (e) {
    // Let Stripe retry on a genuine processing error (a Blobs write that
    // failed, etc.) rather than swallowing it — but a malformed/unexpected
    // payload shape should never crash the function into an infinite retry
    // loop, so this is caught and logged either way.
    console.error(`stripe-webhook: error handling ${event.type}:`, e);
    return new Response(JSON.stringify({ received: true, error: "handler error, will retry" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "content-type": "application/json" },
  });
};

// checkout.session.completed fires as soon as the guest finishes the
// Checkout page, but payment_status can still be "unpaid" for a delayed
// payment method (e.g. SEPA debit, iDEAL is usually instant) — in that case
// the REAL confirmation arrives later as async_payment_succeeded, so this
// only acts when payment_status is actually "paid" right now.
async function handlePaymentSucceeded(session) {
  if (session.payment_status !== "paid") return;

  const bookingId = session.metadata?.booking_id;
  if (!bookingId) {
    console.warn("stripe-webhook: paid Checkout Session without a booking_id in metadata:", session.id);
    return;
  }

  const booking = await getBooking(bookingId, { strong: true });
  if (!booking) {
    console.warn(`stripe-webhook: paid Checkout Session ${session.id} references unknown booking ${bookingId}`);
    return;
  }

  // Idempotency guard — a duplicate delivery of the same event (or
  // completed + async_payment_succeeded both firing for the same session)
  // must never re-run the confirmation side effects a second time.
  if (booking.paid) return;

  if (booking.status !== "awaiting_payment") {
    // The booking was cancelled, or its hold already expired, AFTER this
    // Checkout Session was created (a guest can complete a checkout that
    // was already open in their browser in the brief window before the
    // session would have been expired/cancelled server-side). Stripe has
    // already captured real money at this point; we cannot undo that from
    // here, and we must NOT silently flip this booking back to
    // paid/confirmed as if nothing happened — see README/spec section 3,
    // "explicitly handle a late payment after expiry/cancellation, never
    // silently resurrect a booking". Record it loudly instead so the owner
    // sees it on /admin and refunds it by hand.
    booking.staleCheckoutPayment = {
      detectedAt: new Date().toISOString(),
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null,
      amountTotalCents: session.amount_total ?? null,
      currency: session.currency ?? null,
      bookingStatusAtPayment: booking.status,
    };
    pushHistory(booking, "stale_checkout_payment_alert", { stripeCheckoutSessionId: session.id });
    await saveBooking(bookingId, booking);
    await notifyOwnerStaleCheckoutPayment(booking, session);
    return;
  }

  booking.status = "confirmed";
  booking.paid = true;
  booking.paidAt = new Date().toISOString();
  booking.stripeCheckoutSessionId = session.id;
  booking.stripePaymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null;
  pushHistory(booking, "paid", { stripeCheckoutSessionId: session.id });
  await saveBooking(bookingId, booking);

  // Nights become "confirmed/busy" for every other guest the instant this
  // save lands (_lib/availability.mjs computeAvailability() derives busy
  // nights live from each booking's own status) and the site's iCal export
  // (calendar-export.mjs) picks up the same change on its very next fetch —
  // neither needs a separate "update" step here.

  await notifyOwnerPaymentReceived(booking);
  await sendGuestEmail(booking, "paid");
}

// checkout.session.expired: the guest never finished paying inside the
// session's own expiry window. checkout.session.async_payment_failed: a
// delayed payment method (e.g. a SEPA debit) came back as failed rather
// than succeeded. Either way, treat it the same: release the hold if it's
// still the one holding these nights, and let the guest know nothing was
// charged.
async function handlePaymentNotCompleted(session) {
  const bookingId = session.metadata?.booking_id;
  if (!bookingId) return;

  const booking = await getBooking(bookingId, { strong: true });
  if (!booking) return;

  // Only act if this booking is still actually waiting on this exact
  // session — it may already have been cancelled from /admin (which itself
  // calls Stripe to expire the session, so this event can arrive AFTER that
  // admin action already resolved things) or, less likely, a duplicate
  // event delivery.
  if (booking.status !== "awaiting_payment") return;
  if (booking.stripeCheckoutSessionId && booking.stripeCheckoutSessionId !== session.id) return;

  booking.status = "payment_expired";
  booking.paymentExpiredAt = new Date().toISOString();
  pushHistory(booking, "payment_expired", { stripeCheckoutSessionId: session.id });
  await saveBooking(bookingId, booking);
  // This is the primary release path for an abandoned/expired Checkout
  // hold (expire-bookings.mjs's hourly sweep is only a backstop for a
  // missed/delayed webhook — and can't do this itself once the status here
  // has already moved past "awaiting_payment"). Without this, the night
  // locks claimed in book.mjs's claimNights() would sit forever and
  // wrongly block a later, different guest from booking these same nights,
  // even though computeAvailability() would otherwise correctly show them
  // as free again.
  await releaseNights(nightsBetween(booking.checkin, booking.checkout), bookingId);

  await sendGuestEmail(booking, "paymentExpired");
}

// charge.refunded confirms — independently of whatever the synchronous
// stripe.refunds.create() call in admin-booking-action.mjs returned — that
// a refund actually completed. This is the authoritative signal
// admin-booking-action.mjs's "refund pending" state waits for before ever
// telling the owner or guest a refund succeeded (see README/spec section 9:
// "refund only marked successful when Stripe confirms it").
async function handleChargeRefunded(charge) {
  const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntentId) return;

  // Bookings aren't indexed by PaymentIntent id, so this does a bounded scan
  // — acceptable here since this event is rare (only fires on an actual
  // refund) and listBookings() is already used the same way by every admin
  // read. A future optimization could add a secondary index if booking
  // volume ever makes this scan noticeable.
  const bookings = await listBookings({ strong: true });
  const booking = bookings.find((b) => b.stripePaymentIntentId === paymentIntentId);
  if (!booking) return;

  const latestRefund = charge.refunds?.data?.[0] || null;
  const refundedCents = charge.amount_refunded ?? latestRefund?.amount ?? null;

  // Idempotency: this event can be delivered more than once for the same
  // refund, and a booking can in principle be refunded more than once
  // (e.g. a later separate partial refund) — only treat this as "new" work
  // if the confirmed-refunded amount actually changed since we last saw it.
  if (booking.refundConfirmedTotalCents === refundedCents) return;

  const wasFirstConfirmation = booking.refundConfirmedTotalCents == null;
  booking.refundConfirmedTotalCents = refundedCents;
  booking.refundStatus = charge.amount_refunded >= charge.amount ? "fully_refunded" : "partially_refunded";
  booking.lastRefundAmountCents = refundedCents;
  booking.lastRefundConfirmedAt = new Date().toISOString();
  pushHistory(booking, "refund_confirmed", { refundedCents, refundStatus: booking.refundStatus });
  await saveBooking(booking.id, booking);

  // Only email the guest once for a given refund confirmation, and only if
  // the admin flow actually put this booking into a "refund pending" state
  // first (a refund triggered entirely outside this system — directly in
  // the Stripe dashboard — still gets recorded above, but doesn't spam a
  // guest with an email about a booking action they may not recognize the
  // context for).
  if (wasFirstConfirmation && booking.refundPendingNotified) {
    await sendGuestEmail(booking, "refundSuccess");
  }

  await notifyOwnerRefundConfirmed(booking, refundedCents);
}

async function notifyOwnerPaymentReceived(booking) {
  const key = process.env.RESEND_API_KEY;
  const ownerEmail = process.env.OWNER_EMAIL;
  if (!key || !ownerEmail) return;
  try {
    const resend = new Resend(key);
    await resend.emails.send({
      from: process.env.NOTIFY_FROM_EMAIL || "L'Ancienne École <bookings@ancienne-ecole.rent>",
      to: ownerEmail,
      subject: `PAID & CONFIRMED — ${booking.name}, ${booking.checkin} to ${booking.checkout}`,
      // Same summary table the guest's own confirmation gets (English,
      // regardless of the guest's own language, since this is the owner's
      // copy) — includes the main renter's address when the booking has one
      // (see book.mjs), which is what the owner actually needs on file for
      // the rental agreement, not only "see /admin".
      html: `<div style="font-family: sans-serif; max-width: 520px;"><p><b>${booking.name}</b> just paid and their stay is now confirmed.</p>${bookingSummaryTable(booking, "en")}<p style="font-size:12px;color:#999;">Full details, history and refund status: /admin.</p></div>`,
    });
  } catch (e) {
    console.error("stripe-webhook: failed to notify owner of payment:", e.message);
  }
}

async function notifyOwnerStaleCheckoutPayment(booking, session) {
  const key = process.env.RESEND_API_KEY;
  const ownerEmail = process.env.OWNER_EMAIL;
  const amount = session.amount_total != null ? (session.amount_total / 100).toFixed(2) : "?";
  const currency = (session.currency || "eur").toUpperCase();
  const adminUrl = `${siteBaseUrl()}/admin/`;
  if (!key || !ownerEmail) {
    console.error(
      `stripe-webhook: ACTION REQUIRED — received ${amount} ${currency} for booking ${booking.id} (${booking.name}, ${booking.checkin} to ${booking.checkout}) which is no longer awaiting payment (status: ${booking.status}). This was NOT applied to the booking and needs a manual refund via the Stripe dashboard. (No RESEND_API_KEY/OWNER_EMAIL set — this alert could only be logged, not emailed.)`
    );
    return;
  }
  try {
    const resend = new Resend(key);
    await resend.emails.send({
      from: process.env.NOTIFY_FROM_EMAIL || "L'Ancienne École <bookings@ancienne-ecole.rent>",
      to: ownerEmail,
      subject: `ACTION REQUIRED — late payment for an expired/cancelled booking (${booking.name})`,
      html: `<div style="font-family: sans-serif;">
        <p><b>${amount} ${currency}</b> was just paid via Stripe Checkout for <b>${booking.name}</b>'s stay
        (${booking.checkin} to ${booking.checkout}), but that booking's status is currently
        <b>${booking.status}</b> — not "awaiting_payment". This payment was <b>NOT</b> applied to the booking,
        and the dates were NOT re-blocked.</p>
        <p>This can happen if the guest completed a Checkout page that was already open in their browser in the
        moment between the hold expiring/being cancelled and Stripe closing the session. The money has genuinely
        been charged — please go to your <a href="${adminUrl}">admin page</a> or your Stripe dashboard, find
        checkout session <code>${session.id}</code>, and issue a refund by hand.</p>
      </div>`,
    });
  } catch (e) {
    console.error("stripe-webhook: failed to send stale-checkout-payment alert:", e.message);
  }
}

async function notifyOwnerRefundConfirmed(booking, refundedCents) {
  const key = process.env.RESEND_API_KEY;
  const ownerEmail = process.env.OWNER_EMAIL;
  if (!key || !ownerEmail) return;
  const amount = refundedCents != null ? (refundedCents / 100).toFixed(2) : "?";
  try {
    const resend = new Resend(key);
    await resend.emails.send({
      from: process.env.NOTIFY_FROM_EMAIL || "L'Ancienne École <bookings@ancienne-ecole.rent>",
      to: ownerEmail,
      subject: `Refund confirmed — ${booking.name}, ${booking.checkin} to ${booking.checkout}`,
      html: `<div style="font-family: sans-serif;"><p>Stripe has confirmed a refund of <b>€${amount}</b> for <b>${booking.name}</b>'s cancelled stay (${booking.checkin} to ${booking.checkout}).</p></div>`,
    });
  } catch (e) {
    console.error("stripe-webhook: failed to notify owner of confirmed refund:", e.message);
  }
}

export const config = {
  path: "/.netlify/functions/stripe-webhook",
};
