// POST /.netlify/functions/book
// Receives a booking submission from the reserve-page form and immediately
// creates a Stripe Checkout Session for the exact quoted total — there is no
// separate owner-approval step before payment any more (see README/spec
// section 3, "direct Stripe Checkout"). The booking is stored right away as
// "awaiting_payment" — a temporary hold on the nights, not a confirmation —
// and only ever becomes "confirmed" once stripe-webhook.mjs sees a verified
// `checkout.session.completed` event for it. If the guest never finishes
// paying, the hold expires on its own (see _lib/availability.mjs
// effectiveStatus() and settings.checkoutHoldMinutes) and the nights become
// bookable again.
import { randomUUID } from "node:crypto";
import {
  getPricingSettings,
  getAllRates,
  listBookings,
  saveBooking,
  claimNights,
  releaseNights,
  pushHistory,
} from "./_lib/store.mjs";
import { computeAvailability } from "./_lib/availability.mjs";
import { isValidISODate, nightsBetween } from "./_lib/dates.mjs";
import { createCheckoutSession } from "./_lib/stripe.mjs";
import { nextReference } from "./_lib/bookingReference.mjs";
import { calculateQuote, derivePartySize, QuoteError } from "./_lib/pricing.mjs";
import { CURRENT_TERMS_VERSION } from "./_lib/terms.mjs";
import { validateAddress } from "./_lib/countries.mjs";

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

  // "Aantal personen" (total) + "waarvan kinderen onder 18 jaar" — the guest
  // form's own input model (see assets/booking.js). Adults is derived and
  // re-validated below server-side, never trusted from the client — see
  // _lib/pricing.mjs derivePartySize(). `totalGuests` is the only name this
  // endpoint accepts now; there is no separate "adults" field in the request.
  const {
    checkin, checkout, totalGuests, children, name, email, phone, message, lang, termsAccepted,
    // Main renter's address — direct-rental self-check-in needs this on file
    // before payment, not collected any other way. addressLine1 is the
    // street + house number combined (deliberately one free-text field, not
    // split, so any country's format fits); addressLine2 is optional
    // (apartment/suite/etc.); country is the ISO 3166-1 alpha-2 code the
    // guest chose from the dropdown, never a free-typed name. See
    // _lib/countries.mjs for the full validation rules.
    addressLine1, addressLine2, postalCode, city, country,
  } = body || {};

  if (!isValidISODate(checkin) || !isValidISODate(checkout)) {
    return json({ ok: false, error: "Invalid dates" }, 400);
  }
  if (checkin >= checkout) {
    return json({ ok: false, error: "Check-out must be after check-in" }, 400);
  }
  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "Please provide a valid name and email" }, 400);
  }
  // The guest must have explicitly seen and accepted the terms/cancellation/
  // deposit copy before a Checkout Session is ever created — enforced here
  // server-side, not only as a disabled-button state in the browser, since
  // this is what later lets us honestly say a specific guest agreed to a
  // specific version of those terms (see README/spec section 10).
  if (termsAccepted !== true) {
    return json({ ok: false, code: "TERMS_NOT_ACCEPTED", error: "Please accept the terms to continue." }, 400);
  }
  // Full address required before any Checkout Session is ever created — see
  // _lib/countries.mjs validateAddress() for the exact rules (international,
  // not just Dutch postcodes; postal code only required where the country
  // actually uses one). Rejected here, cheaply, before any availability
  // lookup or night claim — an incomplete address never gets that far.
  const addressError = validateAddress({ line1: addressLine1, city, postalCode, country });
  if (addressError) {
    return json({ ok: false, code: addressError, error: "Please provide a complete address." }, 400);
  }

  const [settings, rates] = await Promise.all([
    getPricingSettings({ strong: true }),
    getAllRates({ strong: true }),
  ]);

  // Re-check availability server-side, with a strongly-consistent read —
  // never trust the client's calendar state. This also checks against every
  // OTHER booking currently "awaiting_payment" (someone else mid-Checkout
  // right now), which is exactly what stops two guests from both paying for
  // the same nights. Fetched BEFORE calculateQuote (not just re-used after)
  // so the exactly-4-free-nights-between-two-bookings exception (see
  // _lib/pricing.mjs) can be evaluated with real, current busy-night data —
  // then reused as-is for the full-range check right below, rather than
  // reading availability twice.
  const { busyNights } = await computeAvailability(settings, { strong: true });
  const nights = nightsBetween(checkin, checkout);

  // Price + business-rule validation (capacity, minimum stay, allowed
  // arrival day, Saturday-turnover weeks, missing rates) — all in one
  // place, see _lib/pricing.mjs.
  let quote, nAdults, nChildren;
  try {
    ({ adults: nAdults, children: nChildren } = derivePartySize({ totalGuests, children }));
    quote = calculateQuote({ checkin, checkout, adults: nAdults, children: nChildren }, settings, rates, { busyNights });
  } catch (e) {
    if (e instanceof QuoteError) return json({ ok: false, code: e.code, details: e.details }, 409);
    console.error("book.mjs: quote calculation failed:", e);
    return json({ ok: false, error: "Could not calculate a price for those dates" }, 500);
  }

  if (nights.some((n) => busyNights.has(n))) {
    return json({ ok: false, code: "DATES_UNAVAILABLE" }, 409);
  }

  const id = randomUUID();
  const reference = nextReference({ checkin, nights: quote.nights }, await listBookings({ strong: true }));

  // Best-effort claim on every night in the stay, to narrow (not, honestly,
  // eliminate) the window where two simultaneous submissions could both
  // think the same nights are free. This is a temporary hold: it lasts only
  // as long as settings.checkoutHoldMinutes (see effectiveStatus()), after
  // which the booking's own "awaiting_payment" -> "payment_expired"
  // transition is what actually matters for availability — this
  // night-locks claim is just the same short-window race mitigation
  // book.mjs has always used, unrelated to the payment itself.
  const claim = await claimNights(nights, id);
  if (!claim.ok) {
    return json({ ok: false, code: "DATES_UNAVAILABLE" }, 409);
  }

  const bookingLang = ["en", "fr", "nl"].includes(lang) ? lang : "en";

  const booking = {
    id,
    reference,
    checkin,
    checkout,
    nights: quote.nights,
    adults: nAdults,
    children: nChildren,
    name: String(name).slice(0, 200),
    email: String(email).slice(0, 200),
    phone: phone ? String(phone).slice(0, 60) : "",
    message: message ? String(message).slice(0, 1000) : "",
    // Main renter's address, collected for the rental agreement (direct
    // rental with self-check-in) — never shown in a public URL or logged;
    // only stored on the booking record itself, the same way name/email/
    // phone already are. Older bookings created before this field existed
    // simply have no `address` — every place that reads it must handle
    // that (see notify.mjs bookingSummaryTable(), admin-bookings.mjs).
    address: {
      line1: String(addressLine1).slice(0, 200),
      line2: addressLine2 ? String(addressLine2).slice(0, 200) : "",
      postalCode: postalCode ? String(postalCode).trim().slice(0, 20) : "",
      city: String(city).slice(0, 120),
      country, // ISO 3166-1 alpha-2 — see _lib/countries.mjs for the display name lookup
    },
    lang: bookingLang,
    // "awaiting_payment" = Checkout Session created, temporary hold on the
    //   nights, NOT yet a confirmed booking. Expires on its own if unpaid —
    //   see _lib/availability.mjs effectiveStatus().
    // "confirmed" = Stripe has confirmed payment (stripe-webhook.mjs) — the
    //   only way a booking ever reaches this status now. Always paid: true.
    // "payment_expired" = the Checkout Session (or the hold itself) expired
    //   before payment; dates released.
    // "cancelled" = owner cancelled, from /admin — before or after payment;
    //   see admin-booking-action.mjs for the paid-vs-unpaid distinction and
    //   the refund flow.
    // Older bookings created before this change may still carry "pending" /
    // "declined" / "expired_unanswered" / "expired_unpaid" from the previous
    // manual-approval flow (see respond.mjs) — those are read-only history
    // now, this endpoint never creates them.
    status: "awaiting_payment",
    createdAt: new Date().toISOString(),
    // The full price breakdown AND the settings that produced it, frozen at
    // request time. Never recomputed later — a subsequent price change on
    // /admin must not silently change what this guest is actually charged.
    quote,
    paid: false,
    termsAccepted: true,
    termsVersion: CURRENT_TERMS_VERSION,
    termsAcceptedAt: new Date().toISOString(),
    history: [],
  };
  pushHistory(booking, "awaiting_payment");

  try {
    await saveBooking(id, booking);
  } catch (e) {
    await releaseNights(nights, id);
    throw e;
  }

  const base = "https://ancienne-ecole.rent";
  const returnPath = { en: "/en/prices-planning/", fr: "/fr/reserver/", nl: "/prijzen-planning/" }[bookingLang];
  let checkoutUrl;
  try {
    const session = await createCheckoutSession(booking, {
      // "pmt" (not "checkout") on purpose — this page already uses a
      // `checkout` query param for the guest's chosen departure DATE (see
      // assets/booking.js restoreStateFromURL()); reusing that name here
      // for "return"/"cancelled" would silently collide with it.
      successUrl: `${base}${returnPath}?booking=${id}&pmt=return`,
      cancelUrl: `${base}${returnPath}?booking=${id}&pmt=cancelled`,
      holdMinutes: settings.checkoutHoldMinutes ?? 45,
    });
    booking.stripeCheckoutSessionId = session.id;
    booking.stripeCheckoutSessionExpiresAt = session.expiresAt;
    pushHistory(booking, "checkout_session_created", { stripeCheckoutSessionId: session.id });
    await saveBooking(id, booking);
    checkoutUrl = session.url;
  } catch (e) {
    // Could not even create the Checkout Session — release the hold
    // immediately rather than leaving a dead "awaiting_payment" booking
    // sitting on nights nobody can actually pay for.
    booking.status = "payment_expired";
    booking.checkoutSessionError = e.message;
    pushHistory(booking, "checkout_session_error", { error: e.message });
    await saveBooking(id, booking);
    await releaseNights(nights, id);
    console.error("book.mjs: could not create Stripe Checkout Session:", e.message);
    return json({ ok: false, error: "Could not start payment right now. Please try again shortly." }, 502);
  }

  return json({ ok: true, id, checkoutUrl });
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
