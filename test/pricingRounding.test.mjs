// Integration tests for the nightly-price-rounding feature (explicit,
// limited approval — see README/vervolgopdracht "Werkelijke nachtprijzen
// afronden naar dichtstbijzijnde veelvoud van 5 euro"). These exercise the
// SAME single point money.test.mjs unit-tests in isolation
// (roundNightlyPriceCents, see _lib/money.mjs) but through the real
// calculateQuote() pipeline, to prove the rounding actually reaches the
// numbers a guest is quoted and charged — not just the pure helper.
//
// Explicitly required to stay UNCHANGED by this feature: linen, cleaning,
// tourist tax, the deposit, and the discount/min-stay/Saturday-turnover/
// four-night-gap rules — several tests below combine an odd raw nightly
// rate with those existing rules specifically to prove they still behave
// exactly as before, just on top of an already-rounded per-night rate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateQuote, QuoteError } from "../netlify/functions/_lib/pricing.mjs";
import { baseSettings } from "./helpers.mjs";

function expectQuoteError(fn) {
  try {
    fn();
  } catch (e) {
    if (e instanceof QuoteError) return e;
    throw e;
  }
  assert.fail("expected a QuoteError to be thrown");
}

test("worked example: €321,43/night for 14 nights rounds to €320,00/night, total rent €4.480,00 (not €4.500,02)", () => {
  const settings = baseSettings();
  const rates = {};
  for (let i = 1; i <= 14; i++) {
    const d = `2027-11-${String(i).padStart(2, "0")}`;
    rates[d] = { priceCents: 32143, minNights: 1 }; // €321,43 raw
  }
  const q = calculateQuote(
    { checkin: "2027-11-01", checkout: "2027-11-15", adults: 2, children: 0 },
    settings,
    rates
  );
  assert.equal(q.nights, 14);
  assert.ok(q.perNight.every((n) => n.priceCents === 32000));
  assert.equal(q.rentalSubtotalCents, 14 * 32000); // 448000 = €4.480,00
  assert.equal(q.rentalSubtotalCents, 448000);
});

test("14 nights already at an exact €320,00 rate are completely unaffected by rounding", () => {
  const settings = baseSettings();
  const rates = {};
  for (let i = 1; i <= 14; i++) {
    const d = `2027-11-${String(i).padStart(2, "0")}`;
    rates[d] = { priceCents: 32000, minNights: 1 };
  }
  const q = calculateQuote(
    { checkin: "2027-11-01", checkout: "2027-11-15", adults: 2, children: 0 },
    settings,
    rates
  );
  assert.equal(q.rentalSubtotalCents, 14 * 32000);
});

test("a stay crossing a rate change rounds EACH night's own rate independently, then sums — never rounding the sum", () => {
  const settings = baseSettings();
  const rates = {
    "2027-11-01": { priceCents: 32249, minNights: 1 }, // -> 32000
    "2027-11-02": { priceCents: 32250, minNights: 1 }, // -> 32500
    "2027-11-03": { priceCents: 32750, minNights: 1 }, // -> 33000
  };
  const q = calculateQuote(
    { checkin: "2027-11-01", checkout: "2027-11-04", adults: 1, children: 0 },
    settings,
    rates
  );
  assert.deepEqual(
    q.perNight.map((n) => n.priceCents),
    [32000, 32500, 33000]
  );
  assert.equal(q.rentalSubtotalCents, 32000 + 32500 + 33000);
});

test("long-stay discount is computed on the ROUNDED rental subtotal, and the linen/cleaning/deposit lines are untouched by rounding", () => {
  const settings = baseSettings({
    weekDiscount: { enabled: true, minNights: 7, percent: 10 },
    linenFeeMode: "per_booking",
    linenFeePerPersonCents: 1500,
    cleaningFeeCents: 17500,
    depositCents: 25000,
  });
  const rates = {};
  for (let i = 1; i <= 7; i++) {
    rates[`2027-11-0${i}`] = { priceCents: 32143, minNights: 1 }; // odd raw rate -> rounds to 32000
  }
  const q = calculateQuote(
    { checkin: "2027-11-01", checkout: "2027-11-08", adults: 2, children: 1 },
    settings,
    rates
  );
  assert.equal(q.rentalSubtotalCents, 7 * 32000);
  assert.equal(q.discountAmountCents, Math.round(7 * 32000 * 0.1));
  assert.equal(q.rentalAfterDiscountCents, q.rentalSubtotalCents - q.discountAmountCents);
  // These three are explicitly NEVER rounded by this feature — exact,
  // untouched settings values, independent of the odd raw nightly rate.
  assert.equal(q.linenFeeCents, 1500 * 3); // 3 guests, per-booking mode
  assert.equal(q.cleaningFeeCents, 17500);
  assert.equal(q.depositCents, 25000);
});

test("tourist tax (percentage mode) is computed on the discounted, ROUNDED per-night rate — children's tax exemption still holds", () => {
  const settings = baseSettings({
    weekDiscount: { enabled: false, minNights: 7, percent: 10 },
    touristTax: { mode: "percentage", ratePercent: 4, capCentsPerNight: null, fixedAmountCents: 0, minAge: 18, departmentalSurchargePercent: 0 },
  });
  const rates = {};
  for (let i = 1; i <= 3; i++) {
    rates[`2027-11-0${i}`] = { priceCents: 32249, minNights: 1 }; // rounds to 32000
  }
  const adultsOnly = calculateQuote({ checkin: "2027-11-01", checkout: "2027-11-04", adults: 3, children: 0 }, settings, rates);
  const withChildren = calculateQuote({ checkin: "2027-11-01", checkout: "2027-11-04", adults: 3, children: 2 }, settings, rates);
  assert.ok(adultsOnly.touristTaxCents > 0);
  // Diluting the same 3 adults' per-person share across more occupants
  // lowers the tax — same existing behaviour as before rounding existed,
  // just recomputed here on the rounded 32000 rate instead of 32249.
  assert.ok(withChildren.touristTaxCents < adultsOnly.touristTaxCents);
  const perPersonShare = 32000 / 3;
  const perAdultPerNight = Math.round((perPersonShare * 4) / 100);
  assert.equal(adultsOnly.touristTaxCents, perAdultPerNight * 3 * 3);
});

test("minimum stay (winter, 30 nights): an odd raw rate still enforces the 30-night minimum and rounds every night", () => {
  const settings = baseSettings({ defaultMinNights: 1 });
  const rates = {};
  for (let i = 1; i <= 31; i++) {
    const d = `2027-12-${String(i).padStart(2, "0")}`;
    rates[d] = { priceCents: 21749, minNights: 30 }; // -> rounds to 21500
  }
  // Short of the 30-night minimum -> still rejected exactly as before.
  const err = expectQuoteError(() =>
    calculateQuote({ checkin: "2027-12-01", checkout: "2027-12-11", adults: 2, children: 0 }, settings, rates)
  );
  assert.equal(err.code, "MIN_NIGHTS_NOT_MET");
  assert.equal(err.details.requiredNights, 30);

  // Exactly 30 nights succeeds, and every night is the rounded rate.
  const ok = calculateQuote({ checkin: "2027-12-01", checkout: "2027-12-31", adults: 2, children: 0 }, settings, rates);
  assert.equal(ok.nights, 30);
  assert.ok(ok.perNight.every((n) => n.priceCents === 21500));
  assert.equal(ok.rentalSubtotalCents, 30 * 21500);
});

test("Saturday-turnover high season (7-night minimum): odd raw rates round per night and the Saturday-only rule is unaffected", () => {
  const settings = baseSettings();
  const rates = {};
  // 2027-04-03 (Sat) .. 2027-04-09 (Fri) = the 7 nights of a 04-03 -> 04-10 stay.
  for (const d of ["2027-04-03", "2027-04-04", "2027-04-05", "2027-04-06", "2027-04-07", "2027-04-08", "2027-04-09"]) {
    rates[d] = { priceCents: 42750, minNights: 7, saturdayTurnover: true }; // -> rounds to 43000
  }
  // Departure not a Saturday -> still rejected exactly as before rounding.
  const err = expectQuoteError(() =>
    calculateQuote({ checkin: "2027-04-03", checkout: "2027-04-09", adults: 2, children: 0 }, settings, rates)
  );
  assert.equal(err.code, "MIN_NIGHTS_NOT_MET"); // 6 nights, below the 7-night minimum

  const q = calculateQuote({ checkin: "2027-04-03", checkout: "2027-04-10", adults: 2, children: 0 }, settings, rates);
  assert.equal(q.nights, 7);
  assert.ok(q.perNight.every((n) => n.priceCents === 43000));
  assert.equal(q.rentalSubtotalCents, 7 * 43000);
});

test("exactly-4-free-nights exception: still applies with an odd raw rate, and rounds each of the 4 nights", () => {
  const settings = baseSettings();
  const rates = {};
  for (let i = 1; i <= 20; i++) {
    rates[`2027-10-${String(i).padStart(2, "0")}`] = { priceCents: 17651, minNights: 5 }; // -> rounds to 17500
  }
  const busyNights = new Set(["2027-10-01", "2027-10-02", "2027-10-03", "2027-10-04", "2027-10-09", "2027-10-10"]);
  const q = calculateQuote(
    { checkin: "2027-10-05", checkout: "2027-10-09", adults: 2, children: 0 },
    settings,
    rates,
    { busyNights }
  );
  assert.equal(q.nights, 4);
  assert.equal(q.fourNightGapException, true);
  assert.ok(q.perNight.every((n) => n.priceCents === 17500));
  assert.equal(q.rentalSubtotalCents, 4 * 17500);
});
