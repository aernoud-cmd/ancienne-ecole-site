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
      // pending | confirmed | declined | cancelled | expired_unanswered |
      // expired_unpaid | awaiting_payment | payment_expired
      const status = effectiveStatus(b, settings);
      const paidTotalCents = b.quote?.totalWithDepositCents ?? null;
      const alreadyRefundedCents = b.refundConfirmedTotalCents || 0;
      const amountToRefundCents =
        b.paid && paidTotalCents != null ? Math.max(0, paidTotalCents - alreadyRefundedCents) : null;
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
        totalCents: paidTotalCents,
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
        stripeCheckoutSessionExpiresAt: b.stripeCheckoutSessionExpiresAt || null,
        staleLinkPayment: b.staleLinkPayment || null,
        staleCheckoutPayment: b.staleCheckoutPayment || null,
        // Refund state — see admin-booking-action.mjs's "cancel_and_refund".
        refundStatus: b.refundStatus || null, // null | "pending" | "failed" | "fully_refunded" | "partially_refunded"
        refundError: b.refundError || null,
        refundPendingAmountCents: b.refundPendingAmountCents ?? null,
        refundConfirmedTotalCents: b.refundConfirmedTotalCents ?? null,
        amountToRefundCents,
        termsVersion: b.termsVersion || null,
        history: Array.isArray(b.history) ? b.history : [],
        // What the admin row's action buttons should offer right now — kept
        // in sync with admin-booking-action.mjs's own rules, so the UI never
        // offers a button the backend would then reject.
        canDecline: ["pending", "expired_unanswered"].includes(status),
        canCancel:
          ["awaiting_payment", "payment_expired"].includes(status) || (status === "confirmed" && !b.paid),
        canCancelAndRefund: status === "confirmed" && b.paid,
        // A cancelled, paid booking whose refund attempt failed can be
        // retried — same action, same amount, without re-cancelling.
        canRetryRefund: status === "cancelled" && b.paid && amountToRefundCents > 0,
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
