// Shared price calculator — the single source of truth for what a stay
// costs. Used by quote.mjs (live price shown to the guest while picking
// dates), book.mjs (price locked in on the booking record at request time),
// and respond.mjs (amount charged via the Stripe payment link on approval).
// Never trust a price computed anywhere else — always recompute from here.
import pricingConfig from "../../../pricing.json" with { type: "json" };
import { nightsBetween } from "./dates.mjs";

export function loadPricingConfig() {
  return pricingConfig;
}

// Nightly rental price for one specific night (YYYY-MM-DD), before any fees
// or discounts — the base rate, or a matching dateOverrides entry.
function nightlyRate(dateISO, config) {
  for (const o of config.dateOverrides || []) {
    if (dateISO >= o.start && dateISO <= o.end) return o.pricePerNight;
  }
  return config.basePricePerNight;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Computes the full Airbnb-style price breakdown for a stay.
 * @param {string} checkin  YYYY-MM-DD
 * @param {string} checkout YYYY-MM-DD
 * @param {number} adults
 * @param {number} children
 * @param {object} [config] defaults to pricing.json
 */
export function calculateQuote(checkin, checkout, adults, children, config = pricingConfig) {
  const nights = nightsBetween(checkin, checkout); // array of YYYY-MM-DD
  const nNights = nights.length;
  const totalGuests = Math.max(1, Number(adults) + Number(children || 0));
  const nAdults = Number(adults);

  // 1. Base rental cost — sum of that night's rate for every night booked.
  const perNight = nights.map((d) => ({ date: d, rate: nightlyRate(d, config) }));
  const rentalSubtotal = perNight.reduce((sum, n) => sum + n.rate, 0);

  // 2. Long-stay discount on the rental subtotal only. Month discount wins
  // over week discount when a stay qualifies for both.
  let discountLabel = null;
  let discountPercent = 0;
  if (config.monthDiscountPercent && nNights >= config.monthDiscountMinNights) {
    discountPercent = config.monthDiscountPercent;
    discountLabel = "Maandkorting";
  } else if (config.weekDiscountPercent && nNights >= config.weekDiscountMinNights) {
    discountPercent = config.weekDiscountPercent;
    discountLabel = "Weekkorting";
  }
  const discountAmount = round2((rentalSubtotal * discountPercent) / 100);
  const rentalAfterDiscount = round2(rentalSubtotal - discountAmount);

  // 3. Linen surcharge — per person, either once for the whole booking or
  // per person per (part of a) week of the stay.
  let linenFee = 0;
  if (config.linenFeeMode === "per_week") {
    const weeks = Math.max(1, Math.ceil(nNights / 7));
    linenFee = round2(config.linenFeePerPerson * totalGuests * weeks);
  } else {
    linenFee = round2(config.linenFeePerPerson * totalGuests);
  }

  // 4. Final cleaning — flat fee.
  const cleaningFee = round2(config.cleaningFee || 0);

  // 5. Tourist tax — per night: rate% × (that night's rental rate ÷ total
  // guests) × number of adults. Children don't owe the tax themselves, but
  // still count toward splitting the night's price into a "per person" share.
  const touristTax = round2(
    perNight.reduce((sum, n) => {
      const perPersonShare = n.rate / totalGuests;
      return sum + (config.touristTaxRatePercent / 100) * perPersonShare * nAdults;
    }, 0)
  );

  const depositAmount = round2(config.depositAmount || 0);

  const total = round2(rentalAfterDiscount + linenFee + cleaningFee + touristTax);
  const totalWithDeposit = round2(total + depositAmount);

  return {
    currency: config.currency || "EUR",
    nights: nNights,
    adults: nAdults,
    children: Number(children || 0),
    perNight, // [{date, rate}]
    rentalSubtotal: round2(rentalSubtotal),
    discountLabel,
    discountPercent,
    discountAmount,
    rentalAfterDiscount,
    linenFee,
    linenFeeMode: config.linenFeeMode,
    cleaningFee,
    touristTaxRatePercent: config.touristTaxRatePercent,
    touristTax,
    total, // rent + linen + cleaning + tax — what the guest owes for the stay
    depositAmount, // shown/charged separately, not part of `total`
    totalWithDeposit, // what's actually charged via the Stripe link
  };
}
