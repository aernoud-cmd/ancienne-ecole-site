// Creates the one-off Stripe Payment Link a guest pays after their booking
// is approved. STRIPE_SECRET_KEY is read from the environment — set by the
// owner directly in Netlify, never seen by anyone else. Amounts here come
// straight from the booking's frozen quote, already in integer cents —
// never recomputed, never converted from a float.
import Stripe from "stripe";

function client() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

const LINE_LABELS = {
  en: {
    stay: (b) => `Stay: ${b.checkin} → ${b.checkout} (${b.quote.nights} nights)`,
    tax: "Tourist tax",
    deposit: "Security deposit (refundable)",
  },
  fr: {
    stay: (b) => `Séjour : ${b.checkin} → ${b.checkout} (${b.quote.nights} nuits)`,
    tax: "Taxe de séjour",
    deposit: "Caution (remboursable)",
  },
  nl: {
    stay: (b) => `Verblijf: ${b.checkin} → ${b.checkout} (${b.quote.nights} nachten)`,
    tax: "Toeristenbelasting",
    deposit: "Waarborgsom (terugbetaalbaar)",
  },
};

/**
 * Creates a single-use Stripe Payment Link for the given confirmed booking.
 * Returns { url, id } on success, or throws if STRIPE_SECRET_KEY isn't set
 * or the Stripe API call fails — callers should treat that as "payment link
 * not available yet", not fail the approval itself.
 */
export async function createBookingPaymentLink(booking) {
  const stripe = client();
  if (!stripe) throw new Error("STRIPE_SECRET_KEY is not set");

  const t = LINE_LABELS[booking.lang] || LINE_LABELS.en;
  const q = booking.quote;
  const currency = (q.currency || "EUR").toLowerCase();

  // One line item for the stay itself (rent after any long-stay discount,
  // plus linen and cleaning — the guest sees these itemized already in the
  // quote/confirmation email; the Stripe page shows the total per line, not
  // a full re-breakdown, to keep it simple).
  const stayAmountCents = q.rentalAfterDiscountCents + q.linenFeeCents + q.cleaningFeeCents;

  const lineItems = [
    {
      quantity: 1,
      price_data: {
        currency,
        unit_amount: stayAmountCents,
        product_data: { name: t.stay(booking) },
      },
    },
  ];

  if (q.touristTaxCents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency,
        unit_amount: q.touristTaxCents,
        product_data: { name: t.tax },
      },
    });
  }

  if (q.depositCents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency,
        unit_amount: q.depositCents,
        product_data: {
          name: t.deposit,
          description:
            "Charged now, refunded after check-out if there's no damage — not part of the rental price.",
        },
      },
    });
  }

  const link = await stripe.paymentLinks.create({
    line_items: lineItems,
    metadata: { booking_id: booking.id },
    submit_type: "book",
    after_completion: {
      type: "hosted_confirmation",
      hosted_confirmation: {
        custom_message:
          "Merci ! / Thank you! / Dank je! — L'Ancienne École has received your payment.",
      },
    },
    // Single-use: once paid, the link stops accepting new payments.
    restrictions: { completed_sessions: { limit: 1 } },
  });

  return { url: link.url, id: link.id };
}

/**
 * Deactivates a previously-created Payment Link so it stops accepting new
 * payments — called when the owner cancels an approved booking from
 * /admin. `restrictions.completed_sessions.limit: 1` already stops a
 * SECOND payment on a link once it's been paid once, but does nothing to
 * stop a first-ever payment on a still-active link after the underlying
 * booking has been cancelled — this is what closes that gap. Throws if
 * STRIPE_SECRET_KEY isn't set or the Stripe API call fails; callers should
 * treat that as "could not deactivate, tell the owner", not fail the
 * cancellation itself — the booking record is what actually governs
 * availability and the stripe-webhook.mjs status check is the second,
 * load-bearing layer of this same protection.
 */
export async function deactivatePaymentLink(paymentLinkId) {
  const stripe = client();
  if (!stripe) throw new Error("STRIPE_SECRET_KEY is not set");
  await stripe.paymentLinks.update(paymentLinkId, { active: false });
}

export function verifyWebhookSignature(rawBody, signatureHeader) {
  const stripe = client();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) throw new Error("Stripe webhook is not configured");
  return stripe.webhooks.constructEvent(rawBody, signatureHeader, secret);
}

// ---- Direct Stripe Checkout (replaces the manual-approval + Payment Link
// flow above for NEW bookings — createBookingPaymentLink/deactivatePaymentLink
// are kept only so any booking already sitting in the old "confirmed,
// unpaid, has a Payment Link" state from before this change can still be
// managed from /admin without special-casing it) ---------------------------

const CHECKOUT_MIN_MINUTES = 30; // Stripe's own hard floor for expires_at
const CHECKOUT_MAX_MINUTES = 24 * 60; // Stripe's own hard ceiling

function stayLineItems(booking) {
  const t = LINE_LABELS[booking.lang] || LINE_LABELS.en;
  const q = booking.quote;
  const currency = (q.currency || "EUR").toLowerCase();
  const stayAmountCents = q.rentalAfterDiscountCents + q.linenFeeCents + q.cleaningFeeCents;

  const lineItems = [
    {
      quantity: 1,
      price_data: { currency, unit_amount: stayAmountCents, product_data: { name: t.stay(booking) } },
    },
  ];
  if (q.touristTaxCents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: { currency, unit_amount: q.touristTaxCents, product_data: { name: t.tax } },
    });
  }
  if (q.depositCents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency,
        unit_amount: q.depositCents,
        product_data: {
          name: t.deposit,
          description:
            "Charged now, refunded after check-out if there's no damage — not part of the rental price.",
        },
      },
    });
  }
  return lineItems;
}

/**
 * Creates a Stripe Checkout Session for one specific booking's exact frozen
 * quote (never recomputed — the amounts here come straight from
 * booking.quote, already in integer cents). This is what actually confirms
 * a booking now: there is no separate owner-approval step first — the
 * booking is only ever "awaiting_payment" until this session is paid (see
 * book.mjs) and only ever becomes "confirmed" once stripe-webhook.mjs sees a
 * verified `checkout.session.completed` event for it.
 *
 * @param {object} booking
 * @param {object} opts
 * @param {string} opts.successUrl
 * @param {string} opts.cancelUrl
 * @param {number} opts.holdMinutes  desired hold window — clamped to
 *   Stripe's own allowed range (30 minutes .. 24 hours) since a value
 *   outside that range is rejected by the API outright.
 */
export async function createCheckoutSession(booking, { successUrl, cancelUrl, holdMinutes }) {
  const stripe = client();
  if (!stripe) throw new Error("STRIPE_SECRET_KEY is not set");

  const clampedMinutes = Math.min(CHECKOUT_MAX_MINUTES, Math.max(CHECKOUT_MIN_MINUTES, Math.round(holdMinutes)));
  const expiresAt = Math.floor(Date.now() / 1000) + clampedMinutes * 60;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: stayLineItems(booking),
    metadata: { booking_id: booking.id },
    success_url: successUrl,
    cancel_url: cancelUrl,
    expires_at: expiresAt,
    customer_email: booking.email,
    locale: ["nl", "fr"].includes(booking.lang) ? booking.lang : "en",
  });

  return { id: session.id, url: session.url, expiresAt: new Date(session.expires_at * 1000).toISOString() };
}

/**
 * Manually expires a still-open Checkout Session — used when the owner
 * cancels an "awaiting_payment" hold from /admin before the guest has
 * either paid or let it time out on its own. This itself triggers Stripe's
 * own `checkout.session.expired` webhook event, so the booking's actual
 * state transition still happens in one place (stripe-webhook.mjs), not
 * duplicated here. Throws if the session is already paid/expired/closed —
 * callers should treat that as "already resolved, nothing to do", not an
 * error worth failing the admin action over.
 */
export async function expireCheckoutSession(sessionId) {
  const stripe = client();
  if (!stripe) throw new Error("STRIPE_SECRET_KEY is not set");
  return stripe.checkout.sessions.expire(sessionId);
}

/**
 * Issues a real Stripe refund for a paid booking. `amountCents` is
 * required and explicit (never "refund everything" implicitly) so a
 * partial refund is always a deliberate choice, not a default. Returns the
 * Stripe Refund object as created — its `status` can be "succeeded",
 * "pending", or "failed" (some payment methods settle asynchronously); the
 * caller (admin-booking-action.mjs) must not treat "the API call didn't
 * throw" as "the refund is done" — only a `status: "succeeded"` here, or a
 * later confirmed `charge.refunded` webhook event, means the money has
 * actually moved. Idempotent: pass the same `idempotencyKey` on a retry
 * (e.g. the booking id + a fixed suffix) and Stripe guarantees it won't
 * double-refund even if the admin double-clicks or a network error made the
 * first attempt's result unclear.
 */
export async function refundPayment(paymentIntentId, amountCents, { idempotencyKey } = {}) {
  const stripe = client();
  if (!stripe) throw new Error("STRIPE_SECRET_KEY is not set");
  return stripe.refunds.create(
    { payment_intent: paymentIntentId, amount: amountCents },
    idempotencyKey ? { idempotencyKey } : undefined
  );
}

/**
 * Retrieves a Checkout Session with its PaymentIntent expanded — used once,
 * right after a `checkout.session.completed` webhook, to learn the
 * PaymentIntent id a later refund needs (the webhook's own session object
 * already includes `payment_intent` as a plain id string, so this is only
 * needed if a caller has a session id but not the full event payload).
 */
export async function retrieveCheckoutSession(sessionId) {
  const stripe = client();
  if (!stripe) throw new Error("STRIPE_SECRET_KEY is not set");
  return stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
}
