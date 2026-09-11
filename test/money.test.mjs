// Unit tests for the cents-only money helpers and the one documented
// rounding rule (round-half-away-from-zero, applied once per computed
// amount — never on an already-rounded intermediate value again).
import { test } from "node:test";
import assert from "node:assert/strict";
import { roundCents, percentOfCents, centsToMajor, majorToCents, roundNightlyPriceCents } from "../netlify/functions/_lib/money.mjs";

test("percentOfCents rounds to the nearest cent, half away from zero", () => {
  assert.equal(percentOfCents(1000, 10), 100); // exact
  assert.equal(percentOfCents(333, 10), 33); // 33.3 -> 33
  assert.equal(percentOfCents(335, 10), 34); // 33.5 -> 34 (not banker's rounding)
  assert.equal(percentOfCents(999, 4), 40); // 39.96 -> 40
});

test("roundCents never leaves a fractional cent", () => {
  assert.equal(roundCents(100.4), 100);
  assert.equal(roundCents(100.5), 101);
  assert.equal(Number.isInteger(roundCents(12345.6789)), true);
});

test("centsToMajor / majorToCents round-trip exactly for typical euro amounts", () => {
  assert.equal(centsToMajor(18000), 180);
  assert.equal(centsToMajor(12050), 120.5);
  assert.equal(majorToCents(180), 18000);
  assert.equal(majorToCents(120.5), 12050);
  // The classic float trap (0.1 + 0.2 style) must not survive the round-trip.
  assert.equal(majorToCents(19.99), 1999);
});

// roundNightlyPriceCents — explicit, limited approval to round the guest-
// facing nightly rental price to the nearest €5 (see _lib/money.mjs for the
// full rule and _lib/pricing.mjs for the single point this is applied).
// Exact boundary cases as specified: X2,49 / X2,50 / X2,51 and X7,49 /
// X7,50 / X7,51 around two different €5 steps, plus the worked example from
// the request itself.
test("roundNightlyPriceCents: the worked example (€321,43 -> €320,00)", () => {
  assert.equal(roundNightlyPriceCents(32143), 32000);
});

test("roundNightlyPriceCents: boundary around the 320/325 step", () => {
  assert.equal(roundNightlyPriceCents(32249), 32000); // €322,49 -> just below the midpoint -> down
  assert.equal(roundNightlyPriceCents(32250), 32500); // €322,50 -> exact midpoint -> UP by convention
  assert.equal(roundNightlyPriceCents(32251), 32500); // €322,51 -> just above the midpoint -> up
});

test("roundNightlyPriceCents: boundary around the 325/330 step", () => {
  assert.equal(roundNightlyPriceCents(32749), 32500); // €327,49 -> just below the midpoint -> down
  assert.equal(roundNightlyPriceCents(32750), 33000); // €327,50 -> exact midpoint -> UP by convention
  assert.equal(roundNightlyPriceCents(32751), 33000); // €327,51 -> just above the midpoint -> up
});

test("roundNightlyPriceCents: a price already an exact multiple of €5 is left unchanged", () => {
  assert.equal(roundNightlyPriceCents(32000), 32000);
  assert.equal(roundNightlyPriceCents(0), 0);
});

test("roundNightlyPriceCents: never rounds a genuinely positive price down to €0 (safety clamp)", () => {
  assert.equal(roundNightlyPriceCents(100), 500); // €1,00 raw -> floored at the smallest unit, €5,00
  assert.equal(roundNightlyPriceCents(249), 500); // just below the first midpoint -> still floored, never €0
});
