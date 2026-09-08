// POST /.netlify/functions/book
// Receives a booking request from the reserve-page form. Never auto-confirms:
// it stores the request as "pending" (requested — awaiting the owner's
// personal approval) and notifies the owner (email + WhatsApp), who
// approves or declines via the signed links in that notification.
import { randomUUID } from "node:crypto";
import {
  getPricingSettings,
  getAllRates,
  saveBooking,
  claimNights,
  releaseNights,
} from "./_lib/store.mjs";
import { computeAvailability } from "./_lib/availability.mjs";
import { isValidISODate, nightsBetween } from "./_lib/dates.mjs";
import { signAction } from "./_lib/token.mjs";
import { sendOwnerBookingAlert, sendGuestEmail } from "./_lib/notify.mjs";
import { calculateQuote, QuoteError } from "./_lib/pricing.mjs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const { checkin, checkout, adults, children, name, email, phone, message, lang } = body || {};

  if (!isValidISODate(checkin) || !isValidISODate(checkout)) {
    return json({ ok: false, error: "Invalid dates" }, 400);
  }
  if (checkin >= checkout) {
    return json({ ok: false, error: "Check-out must be after check-in" }, 400);
  }
  const nAdults = Number(adults);
  const nChildren = Number(children) || 0;
  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "Please provide a valid name and email" }, 400);
  }

  const [settings, rates] = await Promise.all([
    getPricingSettings({ strong: true }),
    getAllRates({ strong: true }),
  ]);

  // Price + business-rule validation (capacity, minimum stay, allowed
  // arrival day, missing rates) — all in one place, see _lib/pricing.mjs.
  let quote;
  try {
    quote = calculateQuote({ checkin, checkout, adults: nAdults, children: nChildren }, settings, rates);
  } catch (e) {
    if (e instanceof QuoteError) return json({ ok: false, code: e.code, details: e.details }, 409);
    console.error("book.mjs: quote calculation failed:", e);
    return json({ ok: false, error: "Could not calculate a price for those dates" }, 500);
  }

  // Re-check availability server-side, with a strongly-consistent read —
  // never trust the client's calendar state.
  const { busyNights } = await computeAvailability(settings, { strong: true });
  const nights = nightsBetween(checkin, checkout);
  if (nights.some((n) => busyNights.has(n))) {
    return json({ ok: false, code: "DATES_UNAVAILABLE" }, 409);
  }

  const id = randomUUID();

  // Best-effort claim on every night in the stay, to narrow (not, honestly,
  // eliminate) the window where two simultaneous requests could both think
  // the same nights are free — see store.claimNights() for exactly what
  // this does and doesn't guarantee, and README "Availability & double
  // bookings" for the real guarantee (enforced in respond.mjs at approval).
  const claim = await claimNights(nights, id);
  if (!claim.ok) {
    return json({ ok: false, code: "DATES_UNAVAILABLE" }, 409);
  }

  const booking = {
    id,
    checkin,
    checkout,
    nights: quote.nights,
    adults: nAdults,
    children: nChildren,
    name: String(name).slice(0, 200),
    email: String(email).slice(0, 200),
    phone: phone ? String(phone).slice(0, 60) : "",
    message: message ? String(message).slice(0, 1000) : "",
    lang: ["en", "fr", "nl"].includes(lang) ? lang : "en",
    // "pending" = requested, awaiting the owner's personal approval.
    // "confirmed" = approved by the owner (a payment link has been sent).
    // "paid" is a separate boolean on top of "confirmed" — see stripe-webhook.mjs.
    // "declined" / "expired_unanswered" / "expired_unpaid" release the dates.
    status: "pending",
    createdAt: new Date().toISOString(),
    approveSig: signAction(id, "approve"),
    declineSig: signAction(id, "decline"),
    // The full price breakdown AND the settings that produced it, frozen at
    // request time. Never recomputed later — a subsequent price change on
    // /admin must not silently change what this guest was already shown.
    quote,
    paid: false,
  };

  try {
    await saveBooking(id, booking);
  } catch (e) {
    await releaseNights(nights, id);
    throw e;
  }

  const notifyResult = await sendOwnerBookingAlert(booking);
  const guestResult = await sendGuestEmail(booking, "received");

  return json({ ok: true, id, notify: notifyResult, guestEmail: guestResult });
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const config = {
  path: "/.netlify/functions/book",
};
