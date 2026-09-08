// GET /.netlify/functions/availability
// Public endpoint the reserve-page calendar calls to know which nights are
// already taken — merges the synced Airbnb calendar with confirmed direct
// bookings from our own store, so double-booking is never possible either way.
import { getAirbnbBusyNights, listBookings } from "./_lib/store.mjs";
import { nightsBetween } from "./_lib/dates.mjs";

export default async () => {
  const airbnbNights = await getAirbnbBusyNights();
  const bookings = await listBookings();

  const directNights = new Set();
  for (const b of bookings) {
    if (b.status === "confirmed" || b.status === "pending") {
      for (const n of nightsBetween(b.checkin, b.checkout)) directNights.add(n);
    }
  }

  const busy = new Set([...airbnbNights, ...directNights]);

  return new Response(
    JSON.stringify({
      busyNights: Array.from(busy).sort(),
      pendingNights: bookings
        .filter((b) => b.status === "pending")
        .flatMap((b) => nightsBetween(b.checkin, b.checkout)),
    }),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=300", // 5 min — availability doesn't need to be instant-fresh
      },
    }
  );
};

export const config = {
  path: "/.netlify/functions/availability",
};
