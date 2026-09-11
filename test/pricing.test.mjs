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
import { calculateQuote, derivePartySize, QuoteError } from "../netlify/functions/_lib/pricing.mjs";
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

test("a night the owner has explicitly blocked is never bookable, even if it still has a price set", () => {
  const settings = baseSettings();
  const rates = baseRates();
  rates["2027-06-15"] = { ...rates["2027-06-15"], blocked: true };
  const err = expectQuoteError(() =>
    calculateQuote({ checkin: "2027-06-14", checkout: "2027-06-16", adults: 1, children: 0 }, settings, rates)
  );
  assert.equal(err.code, "DATE_BLOCKED");
  assert.equal(err.details.date, "2027-06-15");
});

test("a blocked date with no price at all is reported as DATE_BLOCKED, not the less specific RATE_MISSING", () => {
  const settings = baseSettings();
  const rates = { "2027-06-15": { blocked: true } };
  const err = expectQuoteError(() =>
    calculateQuote({ checkin: "2027-06-15", checkout: "2027-06-16", adults: 1, children: 0 }, settings, rates)
  );
  assert.equal(err.code, "DATE_BLOCKED");
});

test("a per-date allowedArrivalWeekdays override on the arrival date takes priority over the site-wide setting", () => {
  const settings = baseSettings({ allowedArrivalWeekdays: null }); // site-wide: any day allowed
  const rates = baseRates();
  // 2027-06-12 is a Saturday; override this one arrival date to Sunday-only.
  rates["2027-06-12"] = { ...rates["2027-06-12"], allowedArrivalWeekdays: [7] };
  const err = expectQuoteError(() =>
    calculateQuote({ checkin: "2027-06-12", checkout: "2027-06-19", adults: 1, children: 0 }, settings, rates)
  );
  assert.equal(err.code, "ARRIVAL_DAY_NOT_ALLOWED");
  assert.deepEqual(err.details.allowedWeekdays, [7]);
});

test("with no per-date override, the site-wide allowedArrivalWeekdays still applies exactly as before", () => {
  const settings = baseSettings({ allowedArrivalWeekdays: [6] }); // Saturday-only site-wide
  const rates = baseRates(); // 2027-06-12 has no per-date override
  const err = expectQuoteError(() =>
    calculateQuote({ checkin: "2027-06-13", checkout: "2027-06-19", adults: 1, children: 0 }, settings, rates)
  );
  assert.equal(err.code, "ARRIVAL_DAY_NOT_ALLOWED");
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

// Saturday-turnover rule (an explicit `saturdayTurnover` flag per night —
// deliberately NOT inferred from any particular minNights value, so a
// 7-night minimum can exist elsewhere without silently requiring Saturday-
// only turnover there too) — both the arrival AND the departure must fall
// on a Saturday for a stay touching such a night. All dates below are in
// April 2027: 04-03 and 04-10 are Saturdays; 04-01 is a Thursday. See
// _lib/pricing.mjs for why this is checked against every night actually
// stayed, not only the check-in date.
function saturdayTurnoverRates() {
  const rates = {};
  // A laxer shoulder period just before the turnover week: low minimum, no
  // Saturday-turnover flag of its own.
  rates["2027-04-01"] = { priceCents: 10000, minNights: 2 };
  rates["2027-04-02"] = { priceCents: 10000, minNights: 2 };
  // The Saturday-turnover week itself: 2027-04-03 (Sat) .. 2027-04-09 (Fri),
  // i.e. the 7 nights of a 04-03->04-10 stay.
  for (const d of ["2027-04-03", "2027-04-04", "2027-04-05", "2027-04-06", "2027-04-07", "2027-04-08", "2027-04-09"]) {
    rates[d] = { priceCents: 20000, minNights: 7, saturdayTurnover: true };
  }
  // A few more priced nights after the turnover week so a longer stay that
  // overshoots 04-10 doesn't hit RATE_MISSING instead of the rule we're
  // actually testing.
  rates["2027-04-10"] = { priceCents: 20000, minNights: 7, saturdayTurnover: true };
  rates["2027-04-11"] = { priceCents: 10000, minNights: 2 };
  rates["2027-04-12"] = { priceCents: 10000, minNights: 2 };
  return rates;
}

test("Saturday-turnover week: a stay that starts and ends on Saturday is accepted", () => {
  const settings = baseSettings();
  const rates = saturdayTurnoverRates();
  const q = calculateQuote(
    { checkin: "2027-04-03", checkout: "2027-04-10", adults: 2, children: 0 }, // Sat -> Sat, 7 nights
    settings,
    rates
  );
  assert.equal(q.nights, 7);
});

test("Saturday-turnover week: a stay entirely inside it that doesn't start on Saturday is rejected", () => {
  const settings = baseSettings();
  const rates = saturdayTurnoverRates();
  // 2027-04-04 (Sun) -> 2027-04-13 (Tue): 9 nights, comfortably above the
  // 7-night minimum (so this isn't just re-testing MIN_NIGHTS_NOT_MET) —
  // fails purely because check-in isn't a Saturday.
  const err = expectQuoteError(() =>
    calculateQuote({ checkin: "2027-04-04", checkout: "2027-04-13", adults: 2, children: 0 }, settings, rates)
  );
  assert.equal(err.code, "SATURDAY_TURNOVER_REQUIRED");
});

test("Saturday-turnover week: starting on Saturday but leaving on a non-Saturday is rejected, even on a longer stay that satisfies the raw night count", () => {
  const settings = baseSettings();
  const rates = saturdayTurnoverRates();
  // 2027-04-03 (Sat) -> 2027-04-13 (Tue): 10 nights, well above the 7-night
  // minimum, so this only fails because the departure isn't a Saturday.
  const err = expectQuoteError(() =>
    calculateQuote({ checkin: "2027-04-03", checkout: "2027-04-13", adults: 2, children: 0 }, settings, rates)
  );
  assert.equal(err.code, "SATURDAY_TURNOVER_REQUIRED");
});

test("Saturday-turnover bypass is closed: an arrival in a laxer period that stays through part of a Saturday-turnover week still requires the Saturday rule", () => {
  const settings = baseSettings();
  const rates = saturdayTurnoverRates();
  // Arrives Thursday 04-01 in the low-minimum shoulder period (arrival's own
  // minNights is 2, satisfied by this 4-night stay), but the stay extends
  // into 04-03 which belongs to the Saturday-turnover week — the arrival
  // weekday rule must still apply, not be skipped just because check-in
  // itself sits in a laxer period.
  const err = expectQuoteError(() =>
    calculateQuote({ checkin: "2027-04-01", checkout: "2027-04-05", adults: 2, children: 0 }, settings, rates)
  );
  assert.equal(err.code, "SATURDAY_TURNOVER_REQUIRED");
});

test("Saturday-turnover rule doesn't fire at all for a stay that never touches a saturdayTurnover-flagged night", () => {
  const settings = baseSettings();
  const rates = saturdayTurnoverRates();
  // Entirely within the laxer shoulder period, Thursday -> Saturday — would
  // fail the Saturday rule if it wrongly applied here, but it shouldn't
  // apply at all since no night in this stay is flagged saturdayTurnover.
  const q = calculateQuote({ checkin: "2027-04-01", checkout: "2027-04-03", adults: 2, children: 0 }, settings, rates);
  assert.equal(q.nights, 2);
});

test("Saturday-turnover rule is decoupled from minNights: a 7-night minimum WITHOUT the explicit saturdayTurnover flag never requires Saturday-only turnover", () => {
  const settings = baseSettings();
  const rates = {
    "2027-05-01": { priceCents: 10000, minNights: 7 }, // 7-night minimum, but no saturdayTurnover flag
    "2027-05-02": { priceCents: 10000, minNights: 7 },
    "2027-05-03": { priceCents: 10000, minNights: 7 },
    "2027-05-04": { priceCents: 10000, minNights: 7 },
    "2027-05-05": { priceCents: 10000, minNights: 7 },
    "2027-05-06": { priceCents: 10000, minNights: 7 },
    "2027-05-07": { priceCents: 10000, minNights: 7 },
  };
  // 2027-05-01 is a Saturday, 2027-05-05 is a Wednesday — would be rejected
  // by the old (minNights === 7 implies Saturday-turnover) behavior even
  // though the arrival itself (05-01) is fine and 7 nights meets the
  // minimum; must now succeed since nothing here is saturdayTurnover-flagged.
  const q = calculateQuote({ checkin: "2027-05-01", checkout: "2027-05-08", adults: 2, children: 0 }, settings, rates);
  assert.equal(q.nights, 7);
});

// The exact, Aernoud-approved high-season 2027 window: nights 2027-07-03
// (Saturday) through 2027-09-03 (Friday) — 9 full weeks, 63 nights — with
// checkout on 2027-09-04 (Saturday) as the last possible departure. These
// tests use the literal governing dates (not a placeholder period) so the
// window itself is pinned down, on top of the generic Saturday-turnover
// tests above which prove the underlying rule in isolation.
function realHighSeason2027Rates() {
  const rates = {
    // A laxer shoulder night right before the window: its own 5-night
    // minimum, no saturdayTurnover flag — used to prove the rule still
    // applies to a stay that starts here but reaches into the window.
    "2027-07-02": { priceCents: 15000, minNights: 5 },
  };
  let d = new Date("2027-07-03T00:00:00Z");
  const end = new Date("2027-09-03T00:00:00Z");
  while (d <= end) {
    const iso = d.toISOString().slice(0, 10);
    rates[iso] = { priceCents: 25000, minNights: 7, saturdayTurnover: true };
    d = new Date(d.getTime() + 86400000);
  }
  return rates;
}

test("2027 high season: the earliest possible arrival (2027-07-03, Saturday) can depart exactly 7 nights later (2027-07-10, Saturday)", () => {
  const settings = baseSettings();
  const rates = realHighSeason2027Rates();
  const q = calculateQuote({ checkin: "2027-07-03", checkout: "2027-07-10", adults: 2, children: 0 }, settings, rates);
  assert.equal(q.nights, 7);
});

test("2027 high season: satisfying the 7-night minimum is not enough on its own — 2027-07-03 to a non-Saturday 2027-07-11 (8 nights) is still rejected", () => {
  const settings = baseSettings();
  const rates = realHighSeason2027Rates();
  const err = expectQuoteError(() =>
    calculateQuote({ checkin: "2027-07-03", checkout: "2027-07-11", adults: 2, children: 0 }, settings, rates)
  );
  assert.equal(err.code, "SATURDAY_TURNOVER_REQUIRED");
});

test("2027 high season: a 14-night (two-week) stay from 2027-07-03 to 2027-07-17 is accepted", () => {
  const settings = baseSettings();
  const rates = realHighSeason2027Rates();
  const q = calculateQuote({ checkin: "2027-07-03", checkout: "2027-07-17", adults: 2, children: 0 }, settings, rates);
  assert.equal(q.nights, 14);
});

test("2027 high season: the last possible departure is 2027-09-04 (Saturday), 7 nights after 2027-08-28", () => {
  const settings = baseSettings();
  const rates = realHighSeason2027Rates();
  const q = calculateQuote({ checkin: "2027-08-28", checkout: "2027-09-04", adults: 2, children: 0 }, settings, rates);
  assert.equal(q.nights, 7);
});

test("2027 high season: an arrival the day before the window (2027-07-02, its own 5-night minimum) that stays into it still requires the Saturday rule", () => {
  const settings = baseSettings();
  const rates = realHighSeason2027Rates();
  // 07-02 -> 07-07: 5 nights, satisfies the arrival date's own minimum (5),
  // but touches 07-03..07-06 which are saturdayTurnover-flagged.
  const err = expectQuoteError(() =>
    calculateQuote({ checkin: "2027-07-02", checkout: "2027-07-07", adults: 2, children: 0 }, settings, rates)
  );
  assert.equal(err.code, "SATURDAY_TURNOVER_REQUIRED");
});

test("2027 high season: the exactly-4-free-nights exception never applies inside this window even if neighboring nights are busy", () => {
  const settings = baseSettings();
  const rates = realHighSeason2027Rates();
  // A hypothetical 4-night slice fully inside the window (which has its own
  // 7-night minimum, not 5) — arrivalMinNights !== 5 alone already closes
  // the exception, confirmed here with the real window's own rates.
  const busyNights = new Set(["2027-07-19", "2027-07-24"]); // night before / checkout night
  const err = expectQuoteError(() =>
    calculateQuote(
      { checkin: "2027-07-20", checkout: "2027-07-24", adults: 2, children: 0 },
      settings,
      rates,
      { busyNights }
    )
  );
  assert.equal(err.code, "MIN_NIGHTS_NOT_MET");
});

// The exactly-4-free-nights-between-two-bookings exception — see
// _lib/pricing.mjs fourNightGapException(). All dates below sit in a plain
// 5-night-minimum period; 2027-10-01..04 are "busy" (an existing booking's
// nights, simulated purely as a Set passed in as opts.busyNights — nothing
// here actually reads or writes real booking data).
function fourNightGapRates() {
  const rates = {};
  for (let i = 1; i <= 20; i++) {
    const d = `2027-10-${String(i).padStart(2, "0")}`;
    rates[d] = { priceCents: 10000, minNights: 5 };
  }
  return rates;
}

test("exactly a 4-night gap between two bookings is bookable as a whole, below the normal 5-night minimum", () => {
  const settings = baseSettings();
  const rates = fourNightGapRates();
  // Booking A occupies through 2027-10-04 (i.e. 10-04 itself is the last
  // booked night); the gap is 10-05..10-08 (4 free nights); booking B's
  // first night is 10-09 (so checkout 10-09 is itself "busy").
  const busyNights = new Set(["2027-10-01", "2027-10-02", "2027-10-03", "2027-10-04", "2027-10-09", "2027-10-10"]);
  const q = calculateQuote(
    { checkin: "2027-10-05", checkout: "2027-10-09", adults: 2, children: 0 },
    settings,
    rates,
    { busyNights }
  );
  assert.equal(q.nights, 4);
  assert.equal(q.fourNightGapException, true);
});

test("four-night-gap exception never applies to 1-3 nights", () => {
  const settings = baseSettings();
  const rates = fourNightGapRates();
  const busyNights = new Set(["2027-10-01", "2027-10-02", "2027-10-03", "2027-10-04", "2027-10-08", "2027-10-09"]);
  // Same sandwiching, but only a 3-night gap (10-05..10-07, checkout 10-08).
  const err = expectQuoteError(() =>
    calculateQuote({ checkin: "2027-10-05", checkout: "2027-10-08", adults: 2, children: 0 }, settings, rates, { busyNights })
  );
  assert.equal(err.code, "MIN_NIGHTS_NOT_MET");
});

test("four-night-gap exception never applies when only one side is an actual booking", () => {
  const settings = baseSettings();
  const rates = fourNightGapRates();
  // Busy right before check-in, but nothing booked at checkout — this is a
  // 4-night slice of open-ended availability, not "between two bookings".
  const busyNights = new Set(["2027-10-01", "2027-10-02", "2027-10-03", "2027-10-04"]);
  const err = expectQuoteError(() =>
    calculateQuote({ checkin: "2027-10-05", checkout: "2027-10-09", adults: 2, children: 0 }, settings, rates, { busyNights })
  );
  assert.equal(err.code, "MIN_NIGHTS_NOT_MET");
});

test("four-night-gap exception never applies inside a winter (30-night) or high-season (Saturday-turnover) period", () => {
  const settings = baseSettings();
  const rates = fourNightGapRates();
  rates["2027-10-05"].minNights = 30; // this arrival date is actually winter, not the normal 5-night period
  const busyNights = new Set(["2027-10-01", "2027-10-02", "2027-10-03", "2027-10-04", "2027-10-09", "2027-10-10"]);
  const err = expectQuoteError(() =>
    calculateQuote({ checkin: "2027-10-05", checkout: "2027-10-09", adults: 2, children: 0 }, settings, rates, { busyNights })
  );
  assert.equal(err.code, "MIN_NIGHTS_NOT_MET");
  assert.equal(err.details.requiredNights, 30);
});

test("four-night-gap exception is never granted without busyNights (e.g. an older call site that doesn't pass opts)", () => {
  const settings = baseSettings();
  const rates = fourNightGapRates();
  // No opts.busyNights passed at all — must behave exactly as before this
  // feature existed: a below-minimum stay is always rejected.
  const err = expectQuoteError(() =>
    calculateQuote({ checkin: "2027-10-05", checkout: "2027-10-09", adults: 2, children: 0 }, settings, rates)
  );
  assert.equal(err.code, "MIN_NIGHTS_NOT_MET");
});

// ---- derivePartySize() -----------------------------------------------
// The one place quote.mjs/book.mjs turn the guest form's "total people" +
// "of which children" input into the {adults, children} calculateQuote()
// itself has always used — re-validated here server-side, never trusted
// as given by the client (see _lib/pricing.mjs derivePartySize()).

test("derivePartySize: splits total guests and children into adults/children", () => {
  const { adults, children, totalGuests } = derivePartySize({ totalGuests: 6, children: 2 });
  assert.equal(adults, 4);
  assert.equal(children, 2);
  assert.equal(totalGuests, 6);
});

test("derivePartySize: defaults children to 0 when omitted", () => {
  const { adults, children } = derivePartySize({ totalGuests: 3 });
  assert.equal(adults, 3);
  assert.equal(children, 0);
});

test("derivePartySize: rejects children greater than the total number of guests", () => {
  try {
    derivePartySize({ totalGuests: 3, children: 4 });
    assert.fail("expected derivePartySize to throw");
  } catch (err) {
    assert.ok(err instanceof QuoteError);
    assert.equal(err.code, "CHILDREN_EXCEED_TOTAL");
    assert.equal(err.details.totalGuests, 3);
    assert.equal(err.details.children, 4);
  }
});

test("derivePartySize: rejects a non-integer, zero, or negative total guest count", () => {
  for (const bad of [0, -1, 1.5, "abc", undefined, NaN]) {
    try {
      derivePartySize({ totalGuests: bad, children: 0 });
      assert.fail(`expected derivePartySize to throw for totalGuests=${bad}`);
    } catch (err) {
      assert.ok(err instanceof QuoteError);
      assert.equal(err.code, "PARTY_INVALID");
    }
  }
});

test("derivePartySize: rejects a non-integer or negative children count", () => {
  // NaN/undefined/0 aren't in this list — derivePartySize treats a falsy
  // children value as "0 children" (`Number(children || 0)`), same as
  // omitting the field entirely; that's covered by the "defaults to 0" test
  // above, not a rejection case.
  for (const bad of [-1, 1.5, "abc"]) {
    try {
      derivePartySize({ totalGuests: 4, children: bad });
      assert.fail(`expected derivePartySize to throw for children=${bad}`);
    } catch (err) {
      assert.ok(err instanceof QuoteError);
      assert.equal(err.code, "PARTY_INVALID");
    }
  }
});

test("derivePartySize: exactly all children (adults derived as 0) is allowed by derivePartySize itself", () => {
  // derivePartySize only checks children <= totalGuests — an all-children
  // party being unrealistic/rejected is calculateQuote's own concern (it
  // requires adults >= 1 via PARTY_INVALID), not this translation step's.
  const { adults, children } = derivePartySize({ totalGuests: 2, children: 2 });
  assert.equal(adults, 0);
  assert.equal(children, 2);
});
