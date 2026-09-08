// GET /.netlify/functions/quote?checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&adults=N&children=N
// Public endpoint the reserve-page calendar calls to show a live, itemized
// price breakdown as the guest picks dates — using the exact same
// calculateQuote() that book.mjs and respond.mjs use, against the exact
// same live settings/rates an approval would charge, so the number shown
// here always matches what's actually charged later (unless the owner
// changes a price in between — see README "One central price calculation").
import { calculateQuote, QuoteError } from "./_lib/pricing.mjs";
import { getPricingSettings, getAllRates } from "./_lib/store.mjs";
import { isValidISODate } from "./_lib/dates.mjs";

export default async (req) => {
  const url = new URL(req.url);
  const checkin = url.searchParams.get("checkin");
  const checkout = url.searchParams.get("checkout");
  const adults = Number(url.searchParams.get("adults") || 1);
  const children = Number(url.searchParams.get("children") || 0);

  if (!isValidISODate(checkin) || !isValidISODate(checkout) || checkin >= checkout) {
    return json({ ok: false, error: "Invalid dates" }, 400);
  }

  const [settings, rates] = await Promise.all([getPricingSettings(), getAllRates()]);

  try {
    const quote = calculateQuote({ checkin, checkout, adults, children }, settings, rates);
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
