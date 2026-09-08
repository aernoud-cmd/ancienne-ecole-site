// Unit tests for the cents-only money helpers and the one documented
// rounding rule (round-half-away-from-zero, applied once per computed
// amount — never on an already-rounded intermediate value again).
import { test } from "node:test";
import assert from "node:assert/strict";
import { roundCents, percentOfCents, centsToMajor, majorToCents } from "../netlify/functions/_lib/money.mjs";

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
