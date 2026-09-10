// GET /.netlify/functions/quote?checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&totalGuests=N&children=N
// Public endpoint the reserve-page calendar calls to show a live, itemized
// price breakdown as the guest picks dates — using the exact same
// calculateQuote() that book.mjs and respond.mjs use, against the exact
// same live settings/rates an approval would charge, so the number shown
// here always matches what's actually charged later (unless the owner
// changes a price in between — see README "One central price calculation").
import { calculateQuote, derivePartySize, QuoteError } from "./_lib/pricing.mjs";
import { getPricingSettings, getAllRates } from "./_lib/store.mjs";
import { computeAvailability } from "./_lib/availability.mjs";
import { isValidISODate } from "./_lib/dates.mjs";

export default async (req) => {
  const url = new URL(req.url);
  const checkin = url.searchParams.get("checkin");
  const checkout = url.searchParams.get("checkout");
  // "Aantal personen" (total) + "waarvan kinderen onder 18 jaar" — the guest
  // form's own input model (see assets/booking.js). Adults is derived and
  // re-validated below, never trusted from the client — see
  // _lib/pricing.mjs derivePartySize().
  const totalGuests = Number(url.searchParams.get("totalGuests") || 1);
  const children = Number(url.searchParams.get("children") || 0);

  if (!isValidISODate(checkin) || !isValidISODate(checkout) || checkin >= checkout) {
    return json({ ok: false, error: "Invalid dates" }, 400);
  }

  const [settings, rates] = await Promise.all([getPricingSettings(), getAllRates()]);

  try {
    const { adults } = derivePartySize({ totalGuests, children });
    // Not strongly consistent — this is only a live preview while the guest
    // is still picking dates, not the authoritative check (book.mjs re-does
    // that with a strong read right before creating a Checkout Session). It
    // exists purely so the exactly-4-free-nights exception (see
    // _lib/pricing.mjs) previews correctly instead of showing a spurious
    // MIN_NIGHTS_NOT_MET error for a stay that book.mjs would actually accept.
    const { busyNights } = await computeAvailability(settings);
    const quote = calculateQuote({ checkin, checkout, adults, children }, settings, rates, { busyNights });
    return json({ ok: true, quote });
  } catch (e) {
    if (e instanceof QuoteError) {
      return json({ ok: false, code: e.code, details: e.details }, 409);
    }
    console.error("quote.mjs:", e);
    return json({ ok: false, error: "Could not calculate a price" }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json",
      // Short cache only — a price must reflect an admin change quickly.
      "cache-control": "public, max-age=20",
    },
  });
}

export const config = {
  path: "/.netlify/functions/quote",
};
