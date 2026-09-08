// GET /.netlify/functions/availability
// Public endpoint the reserve-page calendar calls to know which nights are
// already taken — merges the synced Airbnb calendar with confirmed AND
// pending direct bookings from our own store (an unanswered request still
// holds its dates until it's declined or expires — see README), so
// double-booking is never possible either way.
import { getPricingSettings, getAllRates } from "./_lib/store.mjs";
import { computeAvailability } from "./_lib/availability.mjs";
import { datesInclusive } from "./_lib/dates.mjs";

// How far ahead we tell the guest calendar about "no price set yet" /
// per-date minimum-stay overrides. Bounded so the payload stays small —
// the owner is expected to price a rolling window, not decades ahead.
const HORIZON_DAYS = 545; // ~18 months

export default async () => {
  const settings = await getPricingSettings();
  const [{ busyNights, pendingNights }, rates] = await Promise.all([
    computeAvailability(settings),
    getAllRates(),
  ]);

  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);
  const horizon = new Date(today.getTime() + HORIZON_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);
  const allDates = datesInclusive(todayISO, horizon);

  // Nights with no admin-entered price at all: NOT bookable, and must be
  // shown to the guest as such rather than silently treated as free/€0.
  const noPriceNights = allDates.filter((d) => !rates[d] || rates[d].priceCents == null);

  // Sparse map of dates whose minimum-stay differs from the site default —
  // only these are sent, so the guest calendar can flag "min N nights"
  // without needing to know every single date's value.
  const minNightsByDate = {};
  for (const d of allDates) {
    const override = rates[d] && rates[d].minNights;
    if (override != null && override !== settings.defaultMinNights) {
      minNightsByDate[d] = override;
    }
  }

  return new Response(
    JSON.stringify({
      busyNights: Array.from(busyNights).sort(),
      pendingNights: Array.from(pendingNights).sort(),
      noPriceNights,
      minNightsByDate,
      capacity: settings.capacity,
      currency: settings.currency,
      defaultMinNights: settings.defaultMinNights,
      allowedArrivalWeekdays: settings.allowedArrivalWeekdays,
    }),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=120",
      },
    }
  );
};

export const config = {
  path: "/.netlify/functions/availability",
};
