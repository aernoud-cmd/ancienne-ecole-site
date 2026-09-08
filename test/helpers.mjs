// Shared test fixtures — a settings object and a small nightly-rate map,
// built the same way the admin page would produce them, used across the
// pricing test files below.
import { mergeWithDefaults } from "../netlify/functions/_lib/pricingDefaults.mjs";

export function baseSettings(overrides = {}) {
  return mergeWithDefaults(overrides);
}

// 2027-06-12 .. 2027-06-19 (7 nights), all at 180.00, plus a couple of
// neighbouring dates at a different rate to test a rate-boundary stay, and
// one intentionally-unpriced date to test RATE_MISSING.
export function baseRates() {
  const rates = {};
  const juneNights = [
    "2027-06-12", "2027-06-13", "2027-06-14", "2027-06-15",
    "2027-06-16", "2027-06-17", "2027-06-18",
  ];
  for (const d of juneNights) rates[d] = { priceCents: 18000 };

  // A rate boundary: July is priced higher.
  rates["2027-06-28"] = { priceCents: 18000 };
  rates["2027-06-29"] = { priceCents: 18000 };
  rates["2027-06-30"] = { priceCents: 18000 };
  rates["2027-07-01"] = { priceCents: 25000 };
  rates["2027-07-02"] = { priceCents: 25000 };

  // 2027-07-31 is priced; 2027-08-01 deliberately has NO price set at all
  // (RATE_MISSING case) — the one gap in an otherwise-priced stretch.
  rates["2027-07-31"] = { priceCents: 18000 };
  // 2027-09-01..08 for minimum-stay-override tests.
  for (let i = 1; i <= 10; i++) {
    const d = `2027-09-${String(i).padStart(2, "0")}`;
    rates[d] = { priceCents: 15000 };
  }
  rates["2027-09-03"].minNights = 5;

  return rates;
}
