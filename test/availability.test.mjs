// Unit tests for the pure, Blobs-free parts of _lib/availability.mjs.
// computeAvailability() itself needs live Netlify Blobs and is only covered
// by manual/live verification (see README) — but ownBlockedNightsFromRates()
// and effectiveStatus() are plain functions and fully testable here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ownBlockedNightsFromRates, effectiveStatus, buildPricesByDate } from "../netlify/functions/_lib/availability.mjs";

test("ownBlockedNightsFromRates returns only the dates explicitly marked blocked", () => {
  const rates = {
    "2027-06-01": { priceCents: 18000 },
    "2027-06-02": { priceCents: 18000, blocked: true },
    "2027-06-03": { blocked: true }, // blocked with no price at all
    "2027-06-04": { priceCents: 18000, blocked: false },
  };
  const blocked = ownBlockedNightsFromRates(rates);
  assert.deepEqual(blocked.sort(), ["2027-06-02", "2027-06-03"]);
});

test("ownBlockedNightsFromRates handles an empty/missing rates map without throwing", () => {
  assert.deepEqual(ownBlockedNightsFromRates({}), []);
  assert.deepEqual(ownBlockedNightsFromRates(undefined), []);
});

test("effectiveStatus expires a pending request once it's older than the configured threshold", () => {
  const settings = { pendingRequestExpiryHours: 24 };
  const createdAt = new Date(Date.now() - 25 * 3600000).toISOString();
  const status = effectiveStatus({ status: "pending", createdAt }, settings);
  assert.equal(status, "expired_unanswered");
});

test("effectiveStatus expires an approved-but-unpaid booking once older than the configured threshold", () => {
  const settings = { unpaidApprovedExpiryHours: 72 };
  const respondedAt = new Date(Date.now() - 73 * 3600000).toISOString();
  const status = effectiveStatus({ status: "confirmed", paid: false, respondedAt, createdAt: respondedAt }, settings);
  assert.equal(status, "expired_unpaid");
});

test("effectiveStatus never expires a confirmed booking that's already paid", () => {
  const settings = { unpaidApprovedExpiryHours: 72 };
  const respondedAt = new Date(Date.now() - 1000 * 3600000).toISOString();
  const status = effectiveStatus({ status: "confirmed", paid: true, respondedAt, createdAt: respondedAt }, settings);
  assert.equal(status, "confirmed");
});

test("effectiveStatus expires an awaiting_payment hold (direct Checkout) once older than checkoutHoldMinutes", () => {
  const settings = { checkoutHoldMinutes: 45 };
  const createdAt = new Date(Date.now() - 46 * 60000).toISOString();
  const status = effectiveStatus({ status: "awaiting_payment", createdAt }, settings);
  assert.equal(status, "payment_expired");
});

test("effectiveStatus keeps an awaiting_payment hold active while still inside checkoutHoldMinutes", () => {
  const settings = { checkoutHoldMinutes: 45 };
  const createdAt = new Date(Date.now() - 10 * 60000).toISOString();
  const status = effectiveStatus({ status: "awaiting_payment", createdAt }, settings);
  assert.equal(status, "awaiting_payment");
});

// buildPricesByDate() — feeds the public availability endpoint's per-tile
// guest calendar price (see netlify/functions/availability.mjs). Rounds
// with the exact same rule as calculateQuote() (_lib/pricing.mjs), on the
// same raw admin-entered rate, so a number on the tile can never differ
// from what a booking for that night would actually charge.
test("buildPricesByDate rounds every priced date to the nearest €5, the same way calculateQuote() does", () => {
  const rates = {
    "2027-06-01": { priceCents: 32143 }, // -> 32000
    "2027-06-02": { priceCents: 32250 }, // -> 32500 (exact midpoint rounds up)
    "2027-06-03": { priceCents: 32000 }, // already exact -> unchanged
  };
  const out = buildPricesByDate(rates, ["2027-06-01", "2027-06-02", "2027-06-03"]);
  assert.deepEqual(out, { "2027-06-01": 32000, "2027-06-02": 32500, "2027-06-03": 32000 });
});

test("buildPricesByDate omits dates with no price at all, and dates outside the given list", () => {
  const rates = {
    "2027-06-01": { priceCents: 18000 },
    "2027-06-02": { blocked: true }, // blocked but priceless -> still omitted, not €0
    "2027-06-03": {},
  };
  const out = buildPricesByDate(rates, ["2027-06-01", "2027-06-02", "2027-06-03", "2027-06-04"]);
  assert.deepEqual(out, { "2027-06-01": 18000 });
});

test("buildPricesByDate still includes a priced date the owner has separately blocked (price is informational, not an availability signal)", () => {
  const rates = { "2027-06-05": { priceCents: 21749, blocked: true } };
  const out = buildPricesByDate(rates, ["2027-06-05"]);
  assert.deepEqual(out, { "2027-06-05": 21500 });
});

test("buildPricesByDate handles an empty/missing rates map without throwing", () => {
  assert.deepEqual(buildPricesByDate({}, ["2027-06-01"]), {});
  assert.deepEqual(buildPricesByDate(undefined, ["2027-06-01"]), {});
});
