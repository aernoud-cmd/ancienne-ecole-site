// GET /.netlify/functions/booking-status?id=...
// Tiny, deliberately minimal PUBLIC endpoint — no admin session, no
// signature — so the reserve page can show the guest something useful the
// moment Stripe redirects them back, before their confirmation email has
// necessarily arrived. Returns ONLY what's needed to render that message:
// no name, email, phone, message, or price breakdown. A booking id is a
// random UUID (see book.mjs), not guessable/enumerable, so this is safe to
// expose without auth the same way a random unlisted link would be.
import { getBooking } from "./_lib/store.mjs";
import { getPricingSettings } from "./_lib/store.mjs";
import { effectiveStatus } from "./_lib/availability.mjs";

export default async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return json({ ok: false, error: "Missing id" }, 400);

  const [booking, settings] = await Promise.all([
    getBooking(id, { strong: true }),
    getPricingSettings({ strong: true }),
  ]);
  if (!booking) return json({ ok: false, error: "Not found" }, 404);

  return json({
    ok: true,
    status: effectiveStatus(booking, settings),
    checkin: booking.checkin,
    checkout: booking.checkout,
    paid: !!booking.paid,
  });
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const config = {
  path: "/.netlify/functions/booking-status",
};
