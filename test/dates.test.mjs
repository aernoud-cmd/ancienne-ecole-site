import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nightsBetween,
  datesInclusive,
  isoWeekday,
  isValidISODate,
  rangeOverlapsBusy,
} from "../netlify/functions/_lib/dates.mjs";

test("nightsBetween excludes the checkout date — hospitality convention", () => {
  const nights = nightsBetween("2027-06-12", "2027-06-19");
  assert.equal(nights.length, 7);
  assert.equal(nights[0], "2027-06-12");
  assert.equal(nights[nights.length - 1], "2027-06-18"); // NOT the 19th
});

test("datesInclusive includes BOTH ends — used for admin period edits, not nights", () => {
  const dates = datesInclusive("2027-06-12", "2027-06-19");
  assert.equal(dates.length, 8);
  assert.equal(dates[dates.length - 1], "2027-06-19"); // the 19th IS included here
});

test("isoWeekday: Monday is 1, Sunday is 7 (never 0)", () => {
  assert.equal(isoWeekday("2027-06-14"), 1); // a Monday
  assert.equal(isoWeekday("2027-06-20"), 7); // a Sunday
});

test("isValidISODate rejects dates JS would otherwise silently roll over", () => {
  assert.equal(isValidISODate("2027-06-19"), true);
  assert.equal(isValidISODate("2027-13-40"), false);
  assert.equal(isValidISODate("not-a-date"), false);
});

test("rangeOverlapsBusy true iff any booked night falls inside [checkin, checkout)", () => {
  const busy = new Set(["2027-06-15"]);
  assert.equal(rangeOverlapsBusy("2027-06-12", "2027-06-19", busy), true);
  assert.equal(rangeOverlapsBusy("2027-06-12", "2027-06-15", busy), false); // checkout excludes the 15th
});
