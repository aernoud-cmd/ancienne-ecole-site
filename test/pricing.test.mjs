// Unit tests for the single, shared price calculator (_lib/pricing.mjs).
// These cover the scenarios explicitly required for this delivery: exact
// nightly-sum pricing, minimum-stay enforcement (incl. a per-date
// override), the week/month discount boundary and non-stacking rule, a
// stay crossing a rate change, adults-vs-children handling (linen counts
// children, tourist tax doesn't), both linen fee modes including a partial
// extra week, over-capacity rejection, a missing-rate rejection, and the
// arrival-weekday restriction.
import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateQuote, QuoteError } from "../netlify/functions/_lib/pricing.mjs";
import { baseSettings, baseRates } from "./helpers.mjs";

// node:assert's assert.throws() doesn't hand back the caught error, just a
// pass/fail — so where a test needs to inspect the QuoteError's code/details
// (rather than just confirm *something* threw), it calls this instead.
function expectQuoteError(fn) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof QuoteError, `expected a QuoteError, got ${err}`);
    return err;
  }
  assert.fail("expected calculateQuote to throw a QuoteError, but it returned normally");
}

test("7-night stay: total is exactly the sum of the 7 entered nightly prices, minus the configured week discount", () => {
  const settings = baseSettings(); // weekDiscount: enabled, minNights 7, 10%
  const rates = baseRates();
  const q = calculateQuote(
    { checkin: "2027-06-12", checkout: "2027-06-19", adults: 8, children: 0 },
    settings,
    rates
  );
  const expectedSubtotal = 18000 * 7; // 126000
  assert.equal(q.rentalSubtotalCents, expectedSubtotal);
  assert.equal(q.discountKind, "week");
  assert.equal(q.discountAmountCents, Math.round(expectedSubtotal * 0.10));
  assert.equal(q.rentalAfterDiscountCents, expectedSubtotal - q.discountAmountCents);
  // The full total is rent-after-discount + linen + cleaning + tax — never
  // re-derived any other way.
  assert.equal(
    q.totalCents,
    q.rentalAfterDiscountCents + q.linenFeeCents + q.cleaningFeeCents + q.touristTaxCents
  );
});

test("week discount boundary: 6 nights gets no discount, 7 nights (the configured minimum) does", () => {
  const settings = baseSettings();
  const rates = baseRates();
  const q6 = calculateQuote(
    { checkin: "2027-06-13", checkout: "2027-06-19", adults: 2, children: 0 }, // 6 nights
    settings,
    rates
  );
  assert.equal(q6.discountKind, null);
  assert.equal(q6.discountAmountCents, 0);

  const q7 = calculateQuote(
    { checkin: "2027-06-12", checkout: "2027-06-19", adults: 2, children: 0 }, // 7 nights
    settings,
    rates
  );
  assert.equal(q7.discountKind, "week");
});

test("month discount wins over week discount and they never stack", () => {
  const settings = baseSettings({
    weekDiscount: { enabled: true, minNights: 7, percent: 10 },
    monthDiscount: { enabled: true, minNights: 10, percent: 20 }, // low threshold so our fixture can reach it
  });
  const rates = {};
  for (let i = 1; i <= 12; i++) rates[`2027-09-${String(i).padStart(2, "0")}`] = { priceCents: 10000 };
  const q = calculateQuote(
    { checkin: "2027-09-01", checkout: "2027-09-11", adults: 2, children: 0 }, // 10 nights: qualifies for both
    settings,
    rates
  );
  assert.equal(q.discountKind, "month");
  assert.equal(q.discountPercent, 20);
  // Never both: the amount must match a single 20% cut, not 10%+20%.
  assert.equal(q.discountAmountCents, Math.round(100000 * 0.20));
});

test("minimum stay: a stay shorter than the arrival date's minimum is rejected with the required length", () => {
  const settings = baseSettings({ defaultMinNights: 1 });
  const rates = baseRates(); // 2027-09-03 has minNights: 5
  const err = expectQuoteError(() =>
    calculateQuote(
      { checkin: "2027-09-03", checkout: "2027-09-06", adults: 2, children: 0 }, // 3 nights, needs 5
      settings,
      rates
    )
  );
  assert.equal(err.code, "MIN_NIGHTS_NOT_MET");
  assert.equal(err.details.requiredNights, 5);

  // Exactly 5 nights from that same arrival date must succeed.
  const ok = calculateQuote(
    { checkin: "2027-09-03", checkout: "2027-09-08", adults: 2, children: 0 },
    settings,
    rates
  );
  assert.equal(ok.nights, 5);
});

test("minimum stay supports 30 nights, and site-wide default applies when a date has no override", () => {
  const settings = baseSettings({ defaultMinNights: 30 });
  const rates = { "2027-09-01": { priceCents: 10000 } }; // no per-date override -> falls back to defaultMinNights
  const err = expectQuoteError(() =>
    calculateQuote({ checkin: "2027-09-01", checkout: "2027-09-08", adults: 1, children: 0 }, settings, rates)
  );
  assert.equal(err.code, "MIN_NIGHTS_NOT_MET");
  assert.equal(err.details.requiredNights, 30);
});

test("a stay crossing a rate change is priced as the exact sum of each night's own rate", () => {
  const settings = baseSettings({ weekDiscount: { enabled: false, minNights: 7, percent: 10 } });
  const rates = baseRates();
  // 2027-06-28,29,30 @ 180.00 + 2027-07-01,02 @ 250.00 = 5 nights
  const q = calculateQuote(
    { checkin: "2027-06-28", checkout: "2027-07-03", adults: 2, children: 0 },
    settings,
    rates
  );
  assert.equal(q.nights, 5);
  assert.equal(q.rentalSubtotalCents, 18000 * 3 + 25000 * 2);
});

test("a night with no price set is never treated as free or defaulted — it blocks the quote", () => {
  const settings = baseSettings();
  const rates = baseRates(); // 2027-08-01 has no entry at all
  const err = expectQuoteError(() =>
    calculateQuote({ checkin: "2027-07-31", checkout: "2027-08-02", adults: 1, children: 0 }, settings, rates)
  );
  assert.equal(err.code, "RATE_MISSING");
  assert.equal(err.details.date, "2027-08-01");
});

test("occupancy above configured capacity is rejected, and the true configured capacity is used (not a hardcoded 8)", () => {
  const settings = baseSettings({ capacity: { maxAdults: 4, maxChildren: 1, maxTotalGuests: 5, childMaxAge: 17 } });
  const rates = baseRates();
  const err = expectQuoteError(() =>
    calculateQuote({ checkin: "2027-06-12", checkout: "2027-06-19", adults: 5, children: 0 }, settings, rates)
  );
  assert.equal(err.code, "CAPACITY_EXCEEDED");
  assert.equal(err.details.maxAdults, 4);

  // Exactly at the limit must succeed.
  const ok = calculateQuote({ checkin: "2027-06-12", checkout: "2027-06-19", adults: 4, children: 1 }, settings, rates);
  assert.equal(ok.adults, 4);
});

test("arrival-day restriction: a check-in on a disallowed weekday is rejected", () => {
  // 2027-06-12 is a Saturday (ISO weekday 6).
  const settings = baseSettings({ allowedArrivalWeekdays: [6] }); // Saturday-only arrivals
  const rates = baseRates();
  const okSaturday = calculateQuote(
    { checkin: "2027-06-12", checkout: "2027-06-19", adults: 2, children: 0 },
    settings,
    rates
  );
  assert.equal(okSaturday.nights, 7);

  const err = expectQuoteError(() =>
    calculateQuote({ checkin: "2027-06-13", checkout: "2027-06-19", adults: 2, children: 0 }, settings, rates)
  );
  assert.equal(err.code, "ARRIVAL_DAY_NOT_ALLOWED");
});

test("linen fee, per-booking mode: adults AND children both count toward the per-person charge", () => {
  const settings = baseSettings({ linenFeeMode: "per_booking", linenFeePerPersonCents: 1500 });
  const rates = baseRates();
  const q = calculateQuote(
    { checkin: "2027-06-12", checkout: "2027-06-19", adults: 6, children: 2 },
    settings,
    rates
  );
  assert.equal(q.linenFeeCents, 1500 * 8);
  assert.equal(q.linenWeeks, null);
});

test("linen fee, per-week mode: a partial extra week still counts as a full extra week", () => {
  const settings = baseSettings({ linenFeeMode: "per_week", linenFeePerPersonCents: 1500 });
  const rates = {};
  for (let i = 1; i <= 9; i++) rates[`2027-09-${String(i).padStart(2, "0")}`] = { priceCents: 10000 };
  // 9 nights = 1 week + 2 days -> must bill as 2 full weeks, not 1.28 weeks.
  const q = calculateQuote(
    { checkin: "2027-09-01", checkout: "2027-09-10", adults: 4, children: 0 },
    settings,
    rates
  );
  assert.equal(q.nights, 9);
  assert.equal(q.linenWeeks, 2);
  assert.equal(q.linenFeeCents, 1500 * 4 * 2);
});

test("tourist tax (percentage mode): children are never themselves taxed, and it's computed on the post-discount price", () => {
  const settings = baseSettings({
    weekDiscount: { enabled: true, minNights: 7, percent: 10 },
    touristTax: { mode: "percentage", ratePercent: 4, capCentsPerNight: null, fixedAmountCents: 0, minAge: 18, departmentalSurchargePercent: 0 },
  });
  const rates = baseRates();
  const adultsOnly = calculateQuote({ checkin: "2027-06-12", checkout: "2027-06-19", adults: 4, children: 0 }, settings, rates);
  assert.ok(adultsOnly.touristTaxCents > 0);

  // Official "au réel" percentage-mode tax base is the price per OCCUPANT
  // per night (minors included in that division), taxed only for the
  // adults among them — so adding children to the same 4 adults dilutes
  // each adult's imputed per-person share and lowers the total tax, but
  // never adds a cent of tax "for" the children themselves.
  const withChildren = calculateQuote({ checkin: "2027-06-12", checkout: "2027-06-19", adults: 4, children: 2 }, settings, rates);
  assert.ok(withChildren.touristTaxCents < adultsOnly.touristTaxCents);
  assert.ok(withChildren.touristTaxCents > 0);

  // Manually recompute the post-discount tax to confirm it is NOT based on
  // the pre-discount nightly rate (the previously-flagged bug).
  const discountRatio = adultsOnly.rentalAfterDiscountCents / adultsOnly.rentalSubtotalCents;
  const perNightDiscounted = 18000 * discountRatio;
  const perPersonShare = perNightDiscounted / 4; // 4 occupants that night, 0 children
  const perAdultPerNight = Math.round((perPersonShare * 4) / 100);
  const expectedTotal = perAdultPerNight * 4 /* adults */ * 7 /* nights */;
  assert.equal(adultsOnly.touristTaxCents, expectedTotal);
});

test("tourist tax, fixed-per-person-per-night mode: exact amount x adults x nights, independent of the rental price", () => {
  const settings = baseSettings({
    touristTax: { mode: "fixed_per_person_per_night", ratePercent: 0, capCentsPerNight: null, fixedAmountCents: 220, minAge: 18, departmentalSurchargePercent: 0 },
  });
  const rates = baseRates();
  const q = calculateQuote({ checkin: "2027-06-12", checkout: "2027-06-19", adults: 5, children: 2 }, settings, rates);
  assert.equal(q.touristTaxCents, 220 * 5 * 7);
});

test("cleaning fee is charged exactly once per stay, with no separate double-charge", () => {
  const settings = baseSettings({ cleaningFeeCents: 12000 });
  const rates = baseRates();
  const short = calculateQuote({ checkin: "2027-06-12", checkout: "2027-06-14", adults: 2, children: 0 }, settings, rates);
  const long = calculateQuote({ checkin: "2027-06-12", checkout: "2027-06-19", adults: 2, children: 0 }, settings, rates);
  assert.equal(short.cleaningFeeCents, 12000);
  assert.equal(long.cleaningFeeCents, 12000);
});

test("changing settings afterwards does not affect a quote already computed (frozen settingsSnapshot)", () => {
  const settings = baseSettings();
  const rates = baseRates();
  const q = calculateQuote({ checkin: "2027-06-12", checkout: "2027-06-19", adults: 2, children: 0 }, settings, rates);
  assert.equal(q.settingsSnapshot.weekDiscount.percent, 10);
  // Mutating the live settings object afterwards must not reach back into
  // the already-returned quote.
  settings.weekDiscount.percent = 50;
  assert.equal(q.settingsSnapshot.weekDiscount.percent, 10);
});
