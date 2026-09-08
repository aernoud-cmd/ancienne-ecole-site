// Unit tests for the admin settings-patch validator — the guard that keeps
// the owner from accidentally saving a zero/negative price, an invalid
// discount, or an inconsistent capacity from the admin page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSettingsPatch } from "../netlify/functions/admin-pricing.mjs";
import { baseSettings } from "./helpers.mjs";

test("a valid week-discount patch is accepted", () => {
  const current = baseSettings();
  const { errors, value } = validateSettingsPatch({ weekDiscount: { enabled: true, minNights: 7, percent: 12 } }, current);
  assert.deepEqual(errors, []);
  assert.equal(value.weekDiscount.percent, 12);
});

test("a negative or out-of-range discount percent is rejected", () => {
  const current = baseSettings();
  const { errors } = validateSettingsPatch({ weekDiscount: { enabled: true, minNights: 7, percent: -5 } }, current);
  assert.ok(errors.some((e) => e.includes("weekDiscount.percent")));
});

test("capacity.maxTotalGuests can't exceed maxAdults + maxChildren", () => {
  const current = baseSettings();
  const { errors } = validateSettingsPatch({ capacity: { maxAdults: 4, maxChildren: 1, maxTotalGuests: 8, childMaxAge: 17 } }, current);
  assert.ok(errors.some((e) => e.includes("maxTotalGuests")));
});

test("a valid capacity patch is accepted and becomes the true configured capacity", () => {
  const current = baseSettings();
  const { errors, value } = validateSettingsPatch(
    { capacity: { maxAdults: 12, maxChildren: 4, maxTotalGuests: 14, childMaxAge: 15 } },
    current
  );
  assert.deepEqual(errors, []);
  assert.equal(value.capacity.maxAdults, 12);
});

test("allowedArrivalWeekdays accepts null (no restriction) or an array of 1-7", () => {
  const current = baseSettings();
  assert.deepEqual(validateSettingsPatch({ allowedArrivalWeekdays: null }, current).errors, []);
  assert.deepEqual(validateSettingsPatch({ allowedArrivalWeekdays: [6] }, current).errors, []);
  assert.ok(validateSettingsPatch({ allowedArrivalWeekdays: [0, 8] }, current).errors.length > 0);
});

test("an invalid tourist tax mode is rejected", () => {
  const current = baseSettings();
  const { errors } = validateSettingsPatch(
    { touristTax: { ...current.touristTax, mode: "made_up_mode" } },
    current
  );
  assert.ok(errors.some((e) => e.includes("touristTax.mode")));
});

test("defaultMinNights must be a whole number of at least 1 (so 5/7/30-night minimums are always representable)", () => {
  const current = baseSettings();
  assert.deepEqual(validateSettingsPatch({ defaultMinNights: 30 }, current).errors, []);
  assert.ok(validateSettingsPatch({ defaultMinNights: 0 }, current).errors.length > 0);
  assert.ok(validateSettingsPatch({ defaultMinNights: 2.5 }, current).errors.length > 0);
});
