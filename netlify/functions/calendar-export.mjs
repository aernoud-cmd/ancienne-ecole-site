// GET /.netlify/functions/calendar-export  (also aliased to /ical/confirmed.ics)
// Publishes confirmed direct bookings as a standard iCal feed. Add this URL in
// Airbnb as an imported calendar (Hosting → your listing → Availability →
// "Connect calendar" → "Import calendar") to complete the two-way sync:
// Airbnb's own bookings block this site (via sync-airbnb.mjs), and this
// site's confirmed bookings block Airbnb (via this feed). Airbnb refreshes
// imported calendars a few times a day — not instant, but automatic.
import { createEvents } from "ics";
import { listBookings } from "./_lib/store.mjs";
import { parseISODate } from "./_lib/dates.mjs";

function dateParts(iso) {
  const d = parseISODate(iso);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

export default async () => {
  const bookings = await listBookings();
  const confirmed = bookings.filter((b) => b.status === "confirmed");

  const events = confirmed.map((b) => ({
    title: "Booked — L'Ancienne École (direct)",
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
