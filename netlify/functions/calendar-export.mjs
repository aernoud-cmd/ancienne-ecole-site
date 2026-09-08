// GET /.netlify/functions/calendar-export  (also aliased to /ical/confirmed.ics)
// Publishes confirmed-and-not-yet-expired direct bookings as a standard
// iCal feed. Add this URL in Airbnb as an imported calendar (Hosting →
// your listing → Availability → "Connect calendar" → "Import calendar") to
// complete the two-way sync: Airbnb's own bookings block this site (via
// sync-airbnb.mjs), and this site's approved bookings block Airbnb (via
// this feed). Airbnb refreshes imported calendars a few times a day — not
// instant, but automatic. A booking that's since expired unpaid (see
// _lib/availability.mjs) drops out of this feed on its own, the same way
// a declined one does — nothing extra to manage.
import { createEvents } from "ics";
import { listBookings, getPricingSettings } from "./_lib/store.mjs";
import { parseISODate } from "./_lib/dates.mjs";
import { effectiveStatus } from "./_lib/availability.mjs";

function dateParts(iso) {
  const d = parseISODate(iso);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

export default async () => {
  const settings = await getPricingSettings();
  const bookings = await listBookings();
  const confirmed = bookings.filter((b) => effectiveStatus(b, settings) === "confirmed");

  const events = confirmed.map((b) => ({
    title: `Booked — L'Ancienne École (direct, ${b.paid ? "paid" : "approved"})`,
    start: dateParts(b.checkin),
    end: dateParts(b.checkout),
    uid: `${b.id}@ancienne-ecole.rent`,
    productId: "ancienne-ecole-rent/direct-booking",
    status: "CONFIRMED",
  }));

  const { error, value } = createEvents(events);
  if (error) {
    return new Response(`Error generating calendar: ${error}`, { status: 500 });
  }

  return new Response(value, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="ancienne-ecole-confirmed.ics"',
      "cache-control": "public, max-age=1800", // 30 min
    },
  });
};

export const config = {
  path: "/.netlify/functions/calendar-export",
};
