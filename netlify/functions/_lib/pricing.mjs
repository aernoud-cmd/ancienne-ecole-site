// The single source of truth for what a stay costs. Pure and synchronous —
// it takes the settings and nightly-rates data as plain arguments (fetched
// once by the caller) rather than reaching into Blobs itself, so the exact
// same function can be unit-tested with fixed inputs and is trivially
// reused by quote.mjs (live price while picking dates), book.mjs (the price
// locked into the request), and respond.mjs (the amount actually charged).
// Never trust a price computed anywhere else — always recompute from here,
// from the CURRENT settings/rates — except for an existing booking, whose
// stored quote (see book.mjs) is never recomputed once created.
import { nightsBetween, isoWeekday } from "./dates.mjs";
import { percentOfCents, roundCents } from "./money.mjs";

export class QuoteError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "QuoteError";
    this.code = code;
    this.details = details;
  }
}

/**
 * @param {object} input
 * @param {string} input.checkin  YYYY-MM-DD
 * @param {string} input.checkout YYYY-MM-DD
 * @param {number} input.adults
 * @param {number} input.children
 * @param {object} settings  from getPricingSettings()
 * @param {object} rates     from getAllRates() — { "YYYY-MM-DD": {priceCents,minNights} }
 */
export function calculateQuote({ checkin, checkout, adults, children }, settings, rates) {
  const nAdults = Number(adults);
  const nChildren = Number(children || 0);

  if (!Number.isInteger(nAdults) || nAdults < 1 || !Number.isInteger(nChildren) || nChildren < 0) {
    throw new QuoteError("PARTY_INVALID");
  }
  const cap = settings.capacity;
  if (nAdults > cap.maxAdults || nChildren > cap.maxChildren || nAdults + nChildren > cap.maxTotalGuests) {
    throw new QuoteError("CAPACITY_EXCEEDED", {
      maxAdults: cap.maxAdults,
      maxChildren: cap.maxChildren,
      maxTotalGuests: cap.maxTotalGuests,
    });
  }

  const nights = nightsBetween(checkin, checkout);
  const nNights = nights.length;
  if (nNights < 1) throw new QuoteError("DATES_INVALID");

  // Minimum stay is a per-arrival-date rule (the same convention Airbnb and
  // every other channel manager use): the night the guest checks in on is
  // what decides the minimum, not every night the stay happens to touch.
  // Explicit, deliberate choice — see README "Minimum stay across periods"
  // for the edge case this doesn't try to solve on its own.
  const arrivalMinNights = rates[checkin]?.minNights ?? settings.defaultMinNights ?? 1;
  if (nNights < arrivalMinNights) {
    throw new QuoteError("MIN_NIGHTS_NOT_MET", { requiredNights: arrivalMinNights });
  }

  // A per-date override (set from /admin on the arrival date itself) takes
  // priority over the site-wide default — e.g. "arrivals Saturday-only
  // except during the July/August school-holiday weeks, which also allow
  // Sunday". Absent an override, the site-wide settings.allowedArrivalWeekdays
  // applies exactly as before.
  const allowedArrivalWeekdays = rates[checkin]?.allowedArrivalWeekdays ?? settings.allowedArrivalWeekdays;
  if (Array.isArray(allowedArrivalWeekdays) && allowedArrivalWeekdays.length > 0) {
    if (!allowedArrivalWeekdays.includes(isoWeekday(checkin))) {
      throw new QuoteError("ARRIVAL_DAY_NOT_ALLOWED", { allowedWeekdays: allowedArrivalWeekdays });
    }
  }

  // 1. Base rental cost — sum of that night's rate for every night booked.
  // A night with no price set is simply not bookable — never €0, never a
  // silent fallback to some other night's price.
  const perNight = [];
  for (const date of nights) {
    const rate = rates[date];
    // A night the owner has explicitly blocked (personal use, maintenance,
    // etc. — set from /admin, independent of whether a price happens to be
    // set) is never bookable, checked before RATE_MISSING so the guest gets
    // the more specific reason.
    if (rate?.blocked) {
      throw new QuoteError("DATE_BLOCKED", { date });
    }
    if (!rate || !Number.isFinite(rate.priceCents) || rate.priceCents <= 0) {
      throw new QuoteError("RATE_MISSING", { date });
    }
    perNight.push({ date, priceCents: rate.priceCents });
  }
  const rentalSubtotalCents = perNight.reduce((sum, n) => sum + n.priceCents, 0);

  // 2. Long-stay discount, on the rental subtotal only. Month and week
  // discounts never stack — month wins when a stay qualifies for both.
  let discountKind = null; // "month" | "week" | null
  let discountPercent = 0;
  if (settings.monthDiscount?.enabled && nNights >= settings.monthDiscount.minNights) {
    discountKind = "month";
    discountPercent = settings.monthDiscount.percent;
  } else if (settings.weekDiscount?.enabled && nNights >= settings.weekDiscount.minNights) {
    discountKind = "week";
    discountPercent = settings.weekDiscount.percent;
  }
  const discountAmountCents = discountPercent ? percentOfCents(rentalSubtotalCents, discountPercent) : 0;
  const rentalAfterDiscountCents = rentalSubtotalCents - discountAmountCents;
  // The same discount ratio applied per night, used below so tourist tax is
  // computed on the price actually paid, not the pre-discount rate.
  const discountRatio = rentalSubtotalCents > 0 ? rentalAfterDiscountCents / rentalSubtotalCents : 1;

  // 3. Linen surcharge — per person, either once for the whole booking or
  // per person per (part of a) week of the stay.
  const totalGuests = nAdults + nChildren;
  let linenWeeks = null;
  let linenFeeCents;
  if (settings.linenFeeMode === "per_week") {
    linenWeeks = Math.max(1, Math.ceil(nNights / 7));
    linenFeeCents = settings.linenFeePerPersonCents * totalGuests * linenWeeks;
  } else {
    linenFeeCents = settings.linenFeePerPersonCents * totalGuests;
  }

  // 4. Final cleaning — flat, once per stay. (Deliberately no separate
  // "included cleaning" toggle plus a fee on top — that would double-charge;
  // cleaningFeeCents is the one and only cleaning line.)
  const cleaningFeeCents = settings.cleaningFeeCents || 0;

  // 5. Tourist tax. Only adults owe it (settings.touristTax.minAge is
  // documentation of the legal threshold — the site only ever collects an
  // "adults" count, so every adult counted here is assumed to meet it).
  // Computed on the price the guest actually pays: for "percentage" mode
  // that means the post-discount per-night rate, not the sticker rate —
  // see pricingDefaults.mjs for why, and for the "fixed_per_person_per_night"
  // mode (the one that actually matches a classified accommodation's rules).
  const tax = settings.touristTax;
  let touristTaxBaseCents = 0;
  if (tax.mode === "fixed_per_person_per_night") {
    touristTaxBaseCents = roundCents(tax.fixedAmountCents * nAdults * nNights);
  } else {
    touristTaxBaseCents = perNight.reduce((sum, n) => {
      const discountedNightCents = n.priceCents * discountRatio;
      const perPersonShare = discountedNightCents / totalGuests;
      let perAdultPerNight = percentOfCents(perPersonShare, tax.ratePercent);
      if (Number.isFinite(tax.capCentsPerNight) && tax.capCentsPerNight > 0) {
        perAdultPerNight = Math.min(perAdultPerNight, tax.capCentsPerNight);
      }
      return sum + perAdultPerNight * nAdults;
    }, 0);
    touristTaxBaseCents = roundCents(touristTaxBaseCents);
  }
  const touristTaxSurchargeCents = tax.departmentalSurchargePercent
    ? percentOfCents(touristTaxBaseCents, tax.departmentalSurchargePercent)
    : 0;
  const touristTaxCents = touristTaxBaseCents + touristTaxSurchargeCents;

  const depositCents = settings.depositCents || 0;

  const totalCents = rentalAfterDiscountCents + linenFeeCents + cleaningFeeCents + touristTaxCents;
  const totalWithDepositCents = totalCents + depositCents;

  return {
    currency: settings.currency || "EUR",
    nights: nNights,
    adults: nAdults,
    children: nChildren,
    perNight, // [{date, priceCents}]
    rentalSubtotalCents,
    discountKind, // "month" | "week" | null — frontend/email translate the label
    discountPercent,
    discountAmountCents,
    rentalAfterDiscountCents,
    linenFeeCents,
    linenFeeMode: settings.linenFeeMode,
    linenWeeks,
    cleaningFeeCents,
    touristTaxMode: tax.mode,
    touristTaxRatePercent: tax.ratePercent,
    touristTaxFixedAmountCents: tax.fixedAmountCents,
    touristTaxSurchargePercent: tax.departmentalSurchargePercent || 0,
    touristTaxBaseCents,
    touristTaxSurchargeCents,
    touristTaxCents,
    depositCents,
    totalCents, // rent + linen + cleaning + tax — what the guest owes for the stay
    totalWithDepositCents, // what's actually charged via the Stripe link
    // Full settings used for this calculation, so a booking created from
    // this quote can store exactly what applied — later settings changes
    // must never silently change an existing request's price. Cloned, not
    // a live reference, so mutating the caller's settings object after the
    // fact (e.g. the same `settings` reused for a later calculation) can
    // never reach back into an already-issued quote.
    settingsSnapshot: structuredClone(settings),
    computedAt: new Date().toISOString(),
  };
}
