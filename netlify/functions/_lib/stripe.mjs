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
