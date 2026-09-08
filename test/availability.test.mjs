// Unit tests for the pure, Blobs-free parts of _lib/availability.mjs.
// computeAvailability() itself needs live Netlify Blobs and is only covered
// by manual/live verification (see README) — but ownBlockedNightsFromRates()
// and effectiveStatus() are plain functions and fully testable here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ownBlockedNightsFromRates, effectiveStatus } from "../netlify/functions/_lib/availability.mjs";

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
