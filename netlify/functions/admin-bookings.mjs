// GET /.netlify/functions/admin-bookings — read-only list of requests for
// the /admin page, so the distinction between requested / approved / paid /
// declined / expired is visible somewhere besides your inbox. Approving and
// declining still happens via the signed links in the notification email —
// this view doesn't duplicate that, it's just visibility.
import { listBookings, getPricingSettings } from "./_lib/store.mjs";
import { effectiveStatus } from "./_lib/availability.mjs";
import { hasValidAdminSession, adminUnauthorizedResponse } from "./_lib/adminAuth.mjs";

export default async (req) => {
  if (!hasValidAdminSession(req)) return adminUnauthorizedResponse();
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const settings = await getPricingSettings({ strong: true });
  const bookings = await listBookings({ strong: true });

  const summary = bookings
    .map((b) => ({
      id: b.id,
      checkin: b.checkin,
      checkout: b.checkout,
      nights: b.nights,
      adults: b.adults,
      children: b.children,
      name: b.name,
      email: b.email,
      status: effectiveStatus(b, settings), // pending | confirmed | declined | expired_unanswered | expired_unpaid
      paid: !!b.paid,
      totalCents: b.quote?.totalWithDepositCents ?? null,
      currency: b.quote?.currency ?? "EUR",
      createdAt: b.createdAt,
      respondedAt: b.respondedAt || null,
      paidAt: b.paidAt || null,
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return new Response(JSON.stringify({ ok: true, bookings: summary }), {
    headers: { "content-type": "application/json" },
  });
};

export const config = {
  path: "/.netlify/functions/admin-bookings",
};
