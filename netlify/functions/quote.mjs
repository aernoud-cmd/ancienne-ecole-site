// GET /.netlify/functions/quote?checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&adults=N&children=N
// Public endpoint the reserve-page calendar calls to show a live, itemized
// price breakdown as the guest picks dates — using the exact same
// calculateQuote() that book.mjs and respond.mjs use, so the number shown
// here always matches what's actually charged later.
import { calculateQuote } from "./_lib/pricing.mjs";
import { isValidISODate } from "./_lib/dates.mjs";

const MAX_ADULTS = 8;
const MAX_CHILDREN = 2;

export default async (req) => {
  const url = new URL(req.url);
  const checkin = url.searchParams.get("checkin");
  const checkout = url.searchParams.get("checkout");
  const adults = Number(url.searchParams.get("adults") || 1);
  const children = Number(url.searchParams.get("children") || 0);

  if (!isValidISODate(checkin) || !isValidISODate(checkout) || checkin >= checkout) {
    return json({ ok: false, error: "Invalid dates" }, 400);
  }
  if (!Number.isInteger(adults) || adults < 1 || adults > MAX_ADULTS || children < 0 || children > MAX_CHILDREN) {
    return json({ ok: false, error: "Invalid party size" }, 400);
  }

  const quote = calculateQuote(checkin, checkout, adults, children);
  return json({ ok: true, quote });
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=60",
    },
  });
}

export const config = {
  path: "/.netlify/functions/quote",
};
