// Seed values used the very first time the admin settings blob is read (i.e.
// before you've ever saved anything on /admin) and as safe fallbacks for any
// field an older saved settings object doesn't have yet. These are NOT
// "the real prices" — nightly rates are never defaulted (a night with no
// price you set is simply not bookable) and every setting here is meant to
// be reviewed and changed on the admin page, not trusted as-is.
export const DEFAULT_SETTINGS = {
  currency: "EUR",

  // Fallback minimum-stay for any date you haven't explicitly set a
  // minimum for. 1 = no extra restriction beyond "at least one night".
  defaultMinNights: 1,

  // Restrict which weekdays a stay may start on, site-wide. null = no
  // restriction (any day). Values are ISO weekdays, 1=Monday .. 7=Sunday.
  // This is intentionally NOT inferred from any minimum-stay setting.
  allowedArrivalWeekdays: null,

  weekDiscount: { enabled: true, minNights: 7, percent: 10 },
  monthDiscount: { enabled: true, minNights: 28, percent: 20 },
  // If a stay qualifies for both, monthDiscount wins — they never stack.

  linenFeeMode: "per_booking", // "per_booking" | "per_week"
  linenFeePerPersonCents: 1500,

  cleaningFeeCents: 12000,

  touristTax: {
    // "percentage": rate% of the per-person, per-night price actually paid
    //   (i.e. AFTER any week/month discount), per adult, per night.
    // "fixed_per_person_per_night": a flat amount per adult per night,
    //   independent of the rental price.
    //
    // Researched note (2026-09, not a legal opinion — please verify against
    // your commune's current deliberation before relying on it): French
    // taxe de séjour law taxes an UNclassified accommodation as a
    // percentage of price ("au réel"), but a CLASSIFIED "meublé de
    // tourisme" like yours is normally taxed at a FIXED tariff per person
    // per night set by star category — not a percentage. Your
    // intercommunality (Pays de Lubersac-Pompadour) confirms elsewhere that
    // the 4% percentage rate specifically applies to unclassified lodging.
    // This ships in "percentage" mode at the 4% you asked for so nothing
    // changes until you decide, but the admin page flags this prominently
    // — check the commune's 2026 tariff table for your star rating and
    // switch to "fixed_per_person_per_night" with that amount if it applies.
    mode: "percentage",
    ratePercent: 4,
    capCentsPerNight: null, // optional plafond per adult per night (percentage mode only)
    fixedAmountCents: 0, // per adult per night (fixed mode only) — set this if you switch modes
    minAge: 18, // national rule: guests under 18 never owe tourist tax
    departmentalSurchargePercent: 0, // some départements add a taxe additionnelle départementale on top — 0 unless yours does
  },

  depositCents: 25000,

  capacity: {
    maxAdults: 8,
    maxChildren: 2,
    maxTotalGuests: 10,
    childMaxAge: 17, // guests older than this must be counted as adults
  },

  // How long an unanswered/unpaid request holds its dates before the site
  // releases them again automatically (a scheduled job applies this — see
  // expire-bookings.mjs — and the availability/quote/book endpoints also
  // apply it live so there's no window where an expired request still
  // blocks new ones just because the sweep hasn't run yet).
  pendingRequestExpiryHours: 48,
  unpaidApprovedExpiryHours: 72,
};

export function mergeWithDefaults(saved) {
  if (!saved) return structuredClone(DEFAULT_SETTINGS);
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...saved,
    weekDiscount: { ...DEFAULT_SETTINGS.weekDiscount, ...(saved.weekDiscount || {}) },
    monthDiscount: { ...DEFAULT_SETTINGS.monthDiscount, ...(saved.monthDiscount || {}) },
    touristTax: { ...DEFAULT_SETTINGS.touristTax, ...(saved.touristTax || {}) },
    capacity: { ...DEFAULT_SETTINGS.capacity, ...(saved.capacity || {}) },
  };
}
