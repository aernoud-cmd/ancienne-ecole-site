// POST /.netlify/functions/admin-booking-action
//   { id, action: "decline" | "cancel" | "cancel_and_refund", reason?, confirmAmountCents? }
// The /admin "Aanvragen" tab's row-detail actions. Requires an actual admin
// session (unlike the old signed-email-link flow this replaces for new
// bookings — see book.mjs/stripe-webhook.mjs).
//
// Three distinct actions, matching three distinct real-world situations:
//   "decline"          — a LEGACY request-flow booking (status "pending" /
//                         "expired_unanswered") that predates direct
//                         Checkout. New bookings never sit in "pending"
//                         any more, but old ones already in the data still
//                         need this.
//   "cancel"            — an UNPAID booking: either a still-open or already-
//                         expired Checkout hold ("awaiting_payment" /
//                         "payment_expired"), or a legacy "confirmed"
//                         booking that was never paid. One clear action, no
//                         money involved, no refund needed.
//   "cancel_and_refund" — a PAID, "confirmed" booking. Cancels AND starts a
//                         real Stripe refund for whatever hasn't been
//                         refunded yet. The frontend is expected to have
//                         already shown the guest/dates/amount to the admin
//                         as an explicit first confirmation step — this
//                         endpoint enforces a SECOND, server-side check of
//                         its own: `confirmAmountCents` must exactly match
//                         the amount this call is about to refund, so the
//                         action can never fire against a stale number the
//                         admin didn't actually see confirmed.
//
// Nothing is ever hard-deleted here. A declined or cancelled booking keeps
// its full record (including its history — see store.pushHistory) so it
// stays visible in the Aanvragen list; only its nights are released.
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
import { deactivatePaymentLink, expireCheckoutSession, refundPayment } from "./_lib/stripe.mjs";
import { Resend } from "resend";

export default async (req) => {
  if (!hasValidAdminSession(req)) return adminUnauthorizedResponse();
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const { id, action, reason, confirmAmountCents } = body || {};
  if (!id || !["decline", "cancel", "cancel_and_refund"].includes(action)) {
    return json({ ok: false, error: "action must be 'decline', 'cancel' or 'cancel_and_refund'" }, 400);
  }

  const booking = await getBooking(id, { strong: true });
  if (!booking) return json({ ok: false, error: "Booking not found" }, 404);

  const settings = await getPricingSettings({ strong: true });
  const current = effectiveStatus(booking, settings);
  const nights = nightsBetween(booking.checkin, booking.checkout);

  if (action === "decline") {
    // Legacy request-flow only (see file header) — a request that was
    // already approved/paid must go through "cancel"/"cancel_and_refund".
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

  if (action === "cancel") {
    return handleUnpaidCancel(booking, current, nights, reason);
  }

  // action === "cancel_and_refund"
  return handlePaidCancelAndRefund(booking, current, nights, reason, confirmAmountCents);
};

// ---- "cancel": no money involved --------------------------------------
async function handleUnpaidCancel(booking, current, nights, reason) {
  const id = booking.id;

  // A direct-Checkout hold (open or already expired) — the common case now.
  const isCheckoutHold = ["awaiting_payment", "payment_expired"].includes(current);
  // A legacy request-flow booking that was approved but never paid.
  const isLegacyUnpaidConfirmed = current === "confirmed" && !booking.paid;

  if (!isCheckoutHold && !isLegacyUnpaidConfirmed) {
    return json(
      {
        ok: false,
        error:
          current === "confirmed"
            ? `Deze boeking is al betaald — gebruik 'cancel_and_refund' om te annuleren én terug te betalen.`
            : `Kan alleen een onbetaalde boeking annuleren (huidige status: ${current}).`,
      },
      409
    );
  }

  // Best-effort: close the Stripe side too, so a browser tab the guest
  // still has open on an old Checkout page (or an old Payment Link) can't
  // complete a payment after this. Never blocks the cancellation itself —
  // stripe-webhook.mjs's stale-payment handling is the real, load-bearing
  // safety net if this best-effort step is skipped or fails.
  let stripeCloseError = null;
  if (current === "awaiting_payment" && booking.stripeCheckoutSessionId) {
    try {
      await expireCheckoutSession(booking.stripeCheckoutSessionId);
    } catch (e) {
      // "Session is already expired/completed" is an expected race, not a
      // real error — only worth recording if it's something else.
      if (!/already expired|no longer open|already completed/i.test(e.message || "")) {
        stripeCloseError = e.message;
      }
    }
  } else if (isLegacyUnpaidConfirmed && booking.stripePaymentLinkId) {
    try {
      await deactivatePaymentLink(booking.stripePaymentLinkId);
    } catch (e) {
      stripeCloseError = e.message;
    }
  }

  booking.status = "cancelled";
  booking.cancelledAt = new Date().toISOString();
  booking.cancelledBy = "admin";
  booking.cancelReason = reason || null;
  if (stripeCloseError) booking.stripeCloseError = stripeCloseError;
  pushHistory(booking, "cancelled", { by: "admin", reason: reason || null, wasPaid: false, stripeCloseError });

  await releaseNights(nights, id);
  await saveBooking(id, booking);

  // A guest whose Checkout hold is cancelled before they ever paid was
  // never told anything about this booking existing on our side in the
  // first place (the direct-Checkout flow sends no "we've received your
  // request" email — see book.mjs) — so there's nothing to follow up on
  // for them, and emailing them here would be confusing, not helpful. A
  // legacy request-flow booking DID already get a "your request was
  // approved" email, so that guest is told, exactly as before.
  let guestEmailResult = "skipped (guest was never notified of this booking)";
  if (isLegacyUnpaidConfirmed) {
    guestEmailResult = await sendGuestEmail(booking, "cancelled");
  }

  return json({ ok: true, status: booking.status, stripeCloseError, guestEmailResult });
}

// ---- "cancel_and_refund": a real Stripe refund -------------------------
async function handlePaidCancelAndRefund(booking, current, nights, reason, confirmAmountCents) {
  const id = booking.id;
  const alreadyCancelled = booking.status === "cancelled";

  if (!alreadyCancelled && !(current === "confirmed" && booking.paid)) {
    return json(
      { ok: false, error: `Kan alleen een betaalde, bevestigde boeking annuleren-en-terugbetalen (huidige status: ${current}).` },
      409
    );
  }

  const paidTotalCents = booking.quote?.totalWithDepositCents ?? null;
  if (paidTotalCents == null) {
    return json({ ok: false, error: "Geen prijsopbouw bekend voor deze boeking — kan het terug te betalen bedrag niet vaststellen." }, 409);
  }
  const alreadyRefundedCents = booking.refundConfirmedTotalCents || 0;
  const amountToRefundCents = paidTotalCents - alreadyRefundedCents;

  if (amountToRefundCents <= 0) {
    return json({ ok: false, error: "Deze boeking is al volledig terugbetaald.", alreadyRefundedCents }, 409);
  }

  // The second, server-side half of the two-step confirmation: the admin UI
  // must show this exact amount to the owner before this call is allowed to
  // fire. A mismatch (e.g. the page was left open and something changed
  // since) is refused rather than silently refunding a different amount —
  // the response includes the current real amount so the UI can refresh
  // and ask again.
  if (confirmAmountCents !== amountToRefundCents) {
    return json(
      {
        ok: false,
        code: "REFUND_AMOUNT_MISMATCH",
        error: "Het te bevestigen bedrag komt niet meer overeen — ververs en probeer opnieuw.",
        amountToRefundCents,
      },
      409
    );
  }

  if (!booking.stripePaymentIntentId) {
    return json(
      { ok: false, error: "Geen Stripe-betalingsreferentie bekend voor deze boeking — regel de terugbetaling handmatig via het Stripe-dashboard." },
      409
    );
  }

  // Cancel + release the nights FIRST, and persist that immediately —
  // independent of whether the refund call below succeeds. The stay being
  // cancelled and the dates being freed must never be blocked on Stripe
  // being slow or temporarily unreachable, and a refund that fails is
  // something the owner can retry — a cancellation that got stuck because
  // the refund attempt threw would be much worse.
  if (!alreadyCancelled) {
    booking.status = "cancelled";
    booking.cancelledAt = new Date().toISOString();
    booking.cancelledBy = "admin";
    booking.cancelReason = reason || null;
    pushHistory(booking, "cancelled", { by: "admin", reason: reason || null, wasPaid: true });
    await releaseNights(nights, id);
    await saveBooking(id, booking);
  }

  // Idempotency key ties this to the specific (booking, already-refunded-so-
  // far) state, so a genuine double-click or a retried request after a
  // network error that left the first attempt's outcome unclear can never
  // create two refunds for the same money — Stripe itself deduplicates on
  // this key, which is a stronger guarantee than anything a client-side
  // "don't double click" flag alone could give.
  const idempotencyKey = `${id}:refund:${alreadyRefundedCents}:${amountToRefundCents}`;

  let refund;
  try {
    refund = await refundPayment(booking.stripePaymentIntentId, amountToRefundCents, { idempotencyKey });
  } catch (e) {
    booking.refundStatus = "failed";
    booking.refundError = e.message;
    booking.refundLastAttemptAt = new Date().toISOString();
    pushHistory(booking, "refund_failed", { error: e.message, amountToRefundCents });
    await saveBooking(id, booking);
    await notifyOwnerRefundFailed(booking, e.message, amountToRefundCents);
    // The cancellation itself already succeeded and was saved above — this
    // is reported honestly as a refund failure, never folded into a
    // generic "cancelled" success message (see README/spec section 9).
    return json({
      ok: true,
      status: "cancelled",
      refund: { status: "failed", error: e.message, amountToRefundCents },
    });
  }

  // Stripe's synchronous response can already say "succeeded" for a card
  // payment, but this system only ever treats a refund as DONE once the
  // `charge.refunded` webhook confirms it (stripe-webhook.mjs) — this just
  // records that a refund was legitimately started and is pending that
  // confirmation, and remembers to email the guest once it lands.
  booking.refundStatus = refund.status === "failed" ? "failed" : "pending";
  booking.refundPendingAmountCents = amountToRefundCents;
  booking.refundStripeRefundId = refund.id;
  booking.refundPendingNotified = true;
  booking.refundInitiatedAt = new Date().toISOString();
  pushHistory(booking, "refund_initiated", { stripeRefundId: refund.id, amountToRefundCents, stripeStatus: refund.status });
  await saveBooking(id, booking);

  const guestEmailResult = await sendGuestEmail(
    { ...booking, pendingRefundAmountCents: amountToRefundCents },
    "refundPending"
  );

  return json({
    ok: true,
    status: "cancelled",
    refund: { status: "pending", stripeRefundId: refund.id, amountToRefundCents },
    guestEmailResult,
  });
}

async function notifyOwnerRefundFailed(booking, errorMessage, amountToRefundCents) {
  const key = process.env.RESEND_API_KEY;
  const ownerEmail = process.env.OWNER_EMAIL;
  if (!key || !ownerEmail) {
    console.error(
      `admin-booking-action: ACTION REQUIRED — refund of ${(amountToRefundCents / 100).toFixed(2)} for booking ${booking.id} (${booking.name}) failed: ${errorMessage}. Retry from /admin or refund manually in Stripe.`
    );
    return;
  }
  try {
    const resend = new Resend(key);
    await resend.emails.send({
      from: process.env.NOTIFY_FROM_EMAIL || "L'Ancienne École <bookings@ancienne-ecole.rent>",
      to: ownerEmail,
      subject: `ACTION REQUIRED — refund failed for ${booking.name} (${booking.checkin} to ${booking.checkout})`,
      html: `<div style="font-family: sans-serif;"><p>The booking has been cancelled, but the Stripe refund of <b>€${(amountToRefundCents / 100).toFixed(2)}</b> failed: <code>${errorMessage}</code>.</p><p>Retry from /admin, or issue the refund manually in your Stripe dashboard.</p></div>`,
    });
  } catch (e) {
    console.error("admin-booking-action: failed to send refund-failed alert:", e.message);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

export const config = {
  path: "/.netlify/functions/admin-booking-action",
};
