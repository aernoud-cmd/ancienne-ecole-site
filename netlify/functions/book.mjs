// POST /.netlify/functions/book
// Receives a booking request from the reserve-page form. Never auto-confirms:
// it stores the request as "pending" and notifies the owner (email + WhatsApp),
// who approves or declines via the signed links in that notification.
import { randomUUID } from "node:crypto";
import { getAirbnbBusyNights, listBookings, saveBooking } from "./_lib/store.mjs";
import { isValidISODate, nightsBetween, rangeOverlapsBusy } from "./_lib/dates.mjs";
import { signAction } from "./_lib/token.mjs";
import { sendOwnerBookingAlert, sendGuestEmail } from "./_lib/notify.mjs";

const MAX_ADULTS = 8;
const MAX_CHILDREN = 2;

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
  if (!Number.isInteger(nAdults) || nAdults < 1 || nAdults > MAX_ADULTS || nChildren > MAX_CHILDREN) {
    return json({ ok: false, error: "Invalid party size" }, 400);
  }
  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "Please provide a valid name and email" }, 400);
  }

  // Re-check availability server-side — never trust the client's calendar state.
  const airbnbNights = await getAirbnbBusyNights();
  const existing = await listBookings();
  const busy = new Set(airbnbNights);
  for (const b of existing) {
    if (b.status === "confirmed" || b.status === "pending") {
      for (const n of nightsBetween(b.checkin, b.checkout)) busy.add(n);
    }
  }
  if (rangeOverlapsBusy(checkin, checkout, busy)) {
    return json({ ok: false, error: "Those dates are no longer available. Please pick different dates." }, 409);
  }

  const id = randomUUID();
  const nights = nightsBetween(checkin, checkout).length;
  const booking = {
    id,
    checkin,
    checkout,
    nights,
    adults: nAdults,
    children: nChildren,
    name: String(name).slice(0, 200),
    email: String(email).slice(0, 200),
    phone: phone ? String(phone).slice(0, 60) : "",
    message: message ? String(message).slice(0, 1000) : "",
    lang: ["en", "fr", "nl"].includes(lang) ? lang : "en",
    status: "pending",
    createdAt: new Date().toISOString(),
    approveSig: signAction(id, "approve"),
    declineSig: signAction(id, "decline"),
  };

  await saveBooking(id, booking);

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
