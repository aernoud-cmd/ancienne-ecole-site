// GET /.netlify/functions/availability
// Public endpoint the reserve-page calendar calls to know which nights are
// already taken — merges the synced Airbnb calendar with confirmed AND
// pending direct bookings from our own store (an unanswered request still
// holds its dates until it's declined or expires — see README), so
// double-booking is never possible either way.
import { getPricingSettings, getAllRates } from "./_lib/store.mjs";
import { computeAvailability, buildPricesByDate } from "./_lib/availability.mjs";
import { datesInclusive } from "./_lib/dates.mjs";

// How far ahead we tell the guest calendar about "no price set yet" /
// per-date minimum-stay overrides. Bounded so the payload stays small —
// the owner is expected to price a rolling window, not decades ahead.
const HORIZON_DAYS = 545; // ~18 months

export default async () => {
  const settings = await getPricingSettings({ strong: true });
  const [{ busyNights, pendingNights, ownBlockedNights }, rates] = await Promise.all([
    computeAvailability(settings, { strong: true }),
    getAllRates({ strong: true }),
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

  // Nights explicitly flagged from /admin as requiring Saturday-to-Saturday
  // turnover (the explicit high-season rule — see _lib/pricing.mjs; this is
  // NOT inferred from any particular minimum-stay value). Surfaced so the
  // guest calendar can show only valid arrival Saturdays as selectable
  // within such a period, instead of only finding out after the fact via a
  // SATURDAY_TURNOVER_REQUIRED error from quote/book.
  const saturdayTurnoverNights = allDates.filter((d) => rates[d]?.saturdayTurnover);

  // Nightly price per date, already rounded to the nearest €5 exactly the
  // way calculateQuote() rounds it (see _lib/availability.mjs
  // buildPricesByDate() and _lib/money.mjs roundNightlyPriceCents()) — shown
  // directly on the guest calendar tile. This reveals nothing a guest
  // couldn't already see by picking that date and requesting a live quote;
  // it's the same number, just shown before the click. Only dates that
  // actually have a price are included (a strict subset of allDates minus
  // noPriceNights).
  const pricesByDate = buildPricesByDate(rates, allDates);

  return new Response(
    JSON.stringify({
      busyNights: Array.from(busyNights).sort(),
      pendingNights: Array.from(pendingNights).sort(),
      // Always a subset of busyNights, never additional dates — surfaced
      // separately purely so the guest/embed calendar can show "not
      // available (owner's own use)" as its own distinct state instead of
      // lumping it in with an Airbnb sync or another guest's booking (see
      // the new vervolgopdracht spec, section 2's state list).
      ownBlockedNights: Array.from(ownBlockedNights).sort(),
      noPriceNights,
      minNightsByDate,
      saturdayTurnoverNights,
      pricesByDate,
      capacity: settings.capacity,
      currency: settings.currency,
      defaultMinNights: settings.defaultMinNights,
      allowedArrivalWeekdays: settings.allowedArrivalWeekdays,
    }),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    }
  );
};

export const config = {
  path: "/.netlify/functions/availability",
};
