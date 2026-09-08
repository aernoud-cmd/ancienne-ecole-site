// POST /.netlify/functions/stripe-webhook
// Configure this URL in the Stripe dashboard (Developers → Webhooks) to
// listen for "checkout.session.completed". Marks the matching booking as
// paid and lets the owner know. Never trusts the request without verifying
// Stripe's signature first.
import { getBooking, saveBooking } from "./_lib/store.mjs";
import { verifyWebhookSignature } from "./_lib/stripe.mjs";
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
      const booking = await getBooking(bookingId);
      if (booking && !booking.paid) {
        booking.paid = true;
        booking.paidAt = new Date().toISOString();
        booking.stripeCheckoutSessionId = session.id;
        await saveBooking(bookingId, booking);
        await notifyOwnerPaymentReceived(booking);
      }
    } else {
      console.warn("stripe-webhook: checkout.session.completed without a matching booking_id/paid status");
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
      subject: `Payment received — ${booking.name}, ${booking.checkin} to ${booking.checkout}`,
      html: `<div style="font-family: sans-serif;"><p><b>${booking.name}</b> just paid for their stay from <b>${booking.checkin}</b> to <b>${booking.checkout}</b>.</p></div>`,
    });
  } catch (e) {
    console.error("stripe-webhook: failed to notify owner of payment:", e.message);
  }
}

export const config = {
  path: "/.netlify/functions/stripe-webhook",
};
