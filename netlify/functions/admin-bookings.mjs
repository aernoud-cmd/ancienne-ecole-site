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
    .map((b) => {
      const status = effectiveStatus(b, settings); // pending | confirmed | declined | cancelled | expired_unanswered | expired_unpaid
      return {
        id: b.id,
        checkin: b.checkin,
        checkout: b.checkout,
        nights: b.nights,
        adults: b.adults,
        children: b.children,
        name: b.name,
        email: b.email,
        phone: b.phone || "",
        message: b.message || "",
        status,
        paid: !!b.paid,
        totalCents: b.quote?.totalWithDepositCents ?? null,
        currency: b.quote?.currency ?? "EUR",
        quote: b.quote || null,
        createdAt: b.createdAt,
        respondedAt: b.respondedAt || null,
        paidAt: b.paidAt || null,
        cancelledAt: b.cancelledAt || null,
        cancelledBy: b.cancelledBy || null,
        cancelReason: b.cancelReason || null,
        stripePaymentLinkUrl: b.stripePaymentLinkUrl || null,
        stripePaymentLinkDeactivateError: b.stripePaymentLinkDeactivateError || null,
        staleLinkPayment: b.staleLinkPayment || null,
        history: Array.isArray(b.history) ? b.history : [],
        // What the admin row's action buttons should offer right now — kept
        // in sync with admin-booking-action.mjs's own rules, so the UI never
        // offers a button the backend would then reject.
        canDecline: ["pending", "expired_unanswered"].includes(status),
        canCancel: status === "confirmed",
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return new Response(JSON.stringify({ ok: true, bookings: summary }), {
    headers: { "content-type": "application/json" },
  });
};

export const config = {
  path: "/.netlify/functions/admin-bookings",
};
