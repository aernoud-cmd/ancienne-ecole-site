// Tests for the GUEST calendar's own selection-phase logic in
// assets/booking.js — specifically the checkout-candidate gating added to
// fix the reported bug: after picking an arrival date, almost every later
// day still rendered/behaved as if it were a valid check-out, even ones far
// too short (below the period's minimum stay) or on the wrong side of the
// Saturday-turnover rule.
//
// assets/booking.js is a plain browser IIFE (no exports, talks to `window`/
// `document`/`fetch` directly) rather than an ES module, so it can't be
// `import`ed like the netlify/functions/_lib modules the rest of test/
// covers. It's loaded here via Node's built-in `vm` module against a small
// hand-rolled fake DOM/fetch — enough to drive AE_BOOKING.pickDate() and
// AE_BOOKING.nextMonth() and read back the actual rendered calendar HTML
// (aria-disabled, tabindex/onclick presence, CSS class, aria-label text)
// exactly as a real browser would produce it. This is NOT a substitute for
// a real-browser/live-site check — see the delivery notes for that — but it
// does mechanically verify the actual logic bundled to guests, not merely a
// paraphrase of it.
//
// The fixture below intentionally uses the RULE Aernoud explicitly
// confirmed (end of June: 5-night minimum, free arrival/departure; high
// season EXCLUSIVELY 2027-07-03 through 2027-09-03 nights, minimum 7
// nights, Saturday-only arrival/departure) — not the live rates data, which
// a separate investigation (see delivery notes / booking-module-setup.md)
// found still has two of those three period boundaries mis-set. That's a
// live /admin data issue, not something this test file (or any code change)
// can fix — this file proves the CODE correctly enforces the confirmed rule
// once the rates data actually matches it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { calculateQuote } from "../netlify/functions/_lib/pricing.mjs";

const REPO = new URL("..", import.meta.url).pathname;
const SRC = fs.readFileSync(`${REPO}assets/booking.js`, "utf8");

function makeElement(all) {
  const el = {
    id: "",
    _style: {},
    _html: "",
    textContent: "",
    value: "",
    disabled: false,
    parentNode: { insertBefore() {}, appendChild() {} },
    children: [],
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; },
    get style() { return this._style; },
    setAttribute(k, v) { this[`attr_${k}`] = v; if (k === "id") { this.id = v; all.push(el); } },
    getAttribute(k) { return this[`attr_${k}`]; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    addEventListener() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
    closest() { return null; },
    focus() {},
    classList: { add() {}, remove() {}, contains() { return false; } },
  };
  return el;
}

function buildContext(availabilityPayload) {
  const ALL = [];
  function seed(id) { const el = makeElement(ALL); el.id = id; return el; }
  const ids = [
    "ae-cal-days", "ae-cal-month-label", "ae-booking-submit", "total-guests", "children",
    "ae-cal-nights", "ae-cal-minstay-note", "checkin", "checkout", "ae-price-breakdown",
    "ae-capacity-warning", "guest-name", "guest-email", "guest-phone", "guest-message",
    "terms-accept", "ae-booking-status", "ae-booking-form",
  ];
  for (const id of ids) ALL.push(seed(id));

  const documentStub = {
    getElementById(id) { return ALL.find((e) => e.id === id) || null; },
    createElement() { const el = makeElement(ALL); return el; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
  };
  const windowStub = { location: { search: "", href: "http://test/" } };
  function fakeFetch(url) {
    if (String(url).includes("availability")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(availabilityPayload) });
    }
    if (String(url).includes("quote")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    if (String(url).includes("book")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, checkoutUrl: "https://stripe.example/test-session" }) });
    }
    return Promise.reject(new Error("unexpected fetch: " + url));
  }
  const context = { document: documentStub, window: windowStub, fetch: fakeFetch, console, URL, URLSearchParams, setTimeout, Intl, alert() {} };
  vm.createContext(context);
  vm.runInContext(SRC, context, { filename: "booking.js" });
  return { context, documentStub };
}

async function init(context, documentStub) {
  context.window.AE_BOOKING.init("en");
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

async function gotoMonth(context, documentStub, needle) {
  const monthLabel = documentStub.getElementById("ae-cal-month-label");
  for (let i = 0; i < 40 && !monthLabel.textContent.toLowerCase().includes(needle); i++) {
    context.window.AE_BOOKING.nextMonth();
  }
  if (!monthLabel.textContent.toLowerCase().includes(needle)) {
    throw new Error(`Could not reach "${needle}" (stuck at "${monthLabel.textContent}")`);
  }
}

function cellFor(documentStub, dateISO) {
  const grid = documentStub.getElementById("ae-cal-days");
  const html = grid.innerHTML;
  const re = new RegExp(`<div class="[^"]*" role="gridcell" data-date="${dateISO}"[^>]*>.*?</div>(?=(<div class="[^"]*" role="gridcell"|\\s*$))`, "s");
  const m = html.match(re);
  return m ? m[0] : null;
}

function isClickable(cellHtml) {
  return /aria-disabled="false"/.test(cellHtml) && /onclick="AE_BOOKING\.pickDate/.test(cellHtml);
}

// ---- fixture: the CONFIRMED rule, correctly shaped ------------------------
function buildDates(fromISO, toISO) {
  const out = [];
  let d = new Date(fromISO + "T00:00:00Z");
  const end = new Date(toISO + "T00:00:00Z");
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}

const HIGH_SEASON_START = "2027-07-03"; // Saturday
const HIGH_SEASON_END = "2027-09-03"; // last high-season NIGHT (last departure 2027-09-04, a Saturday)
const highSeasonNights = new Set(buildDates(HIGH_SEASON_START, HIGH_SEASON_END));

function buildRates() {
  const rates = {};
  for (const d of buildDates("2027-06-01", "2027-09-20")) {
    rates[d] = { priceCents: highSeasonNights.has(d) ? 32143 : 18500, minNights: highSeasonNights.has(d) ? 7 : 5 };
    if (highSeasonNights.has(d)) rates[d].saturdayTurnover = true;
  }
  // A short, standalone winter period (unaffected by any of this) so the
  // pre-existing 30-night-minimum rule is proven untouched by this change.
  for (const d of buildDates("2027-01-16", "2027-02-14")) {
    rates[d] = { priceCents: 5500, minNights: 30 };
  }
  return rates;
}

function buildAvailabilityPayload(rates, { busyNights = [] } = {}) {
  const dates = Object.keys(rates);
  const pricesByDate = {};
  const minNightsByDate = {};
  const saturdayTurnoverNights = [];
  for (const d of dates) {
    pricesByDate[d] = rates[d].priceCents; // pre-rounded, as the real endpoint sends it (all whole €5 already here)
    minNightsByDate[d] = rates[d].minNights;
    if (rates[d].saturdayTurnover) saturdayTurnoverNights.push(d);
  }
  return {
    busyNights,
    pendingNights: [],
    noPriceNights: [],
    ownBlockedNights: [],
    saturdayTurnoverNights,
    minNightsByDate,
    pricesByDate,
    defaultMinNights: 5,
    currency: "EUR",
    capacity: { maxAdults: 8, maxChildren: 2, maxTotalGuests: 10 },
  };
}

// ---- guest-calendar (assets/booking.js) tests -----------------------------

test("calendar: 18 -> 23 June (5 nights, ordinary shoulder period) is a valid, clickable checkout", async () => {
  const rates = buildRates();
  const { context, documentStub } = buildContext(buildAvailabilityPayload(rates));
  await init(context, documentStub);
  await gotoMonth(context, documentStub, "june 2027");
  context.window.AE_BOOKING.pickDate("2027-06-18");
  const cell23 = cellFor(documentStub, "2027-06-23");
  assert.ok(isClickable(cell23), `expected 2027-06-23 clickable as a 5-night checkout\n${cell23}`);
});

test("calendar: 19 -> 24 June (5 nights) is also a valid, clickable checkout", async () => {
  const rates = buildRates();
  const { context, documentStub } = buildContext(buildAvailabilityPayload(rates));
  await init(context, documentStub);
  await gotoMonth(context, documentStub, "june 2027");
  context.window.AE_BOOKING.pickDate("2027-06-19");
  const cell24 = cellFor(documentStub, "2027-06-24");
  assert.ok(isClickable(cell24), `expected 2027-06-24 clickable as a 5-night checkout\n${cell24}`);
});

test("calendar: after picking 18 June as arrival, every checkout candidate BEFORE the 5-night minimum is dark/non-clickable/aria-disabled, not just the exact reported day", async () => {
  const rates = buildRates();
  const { context, documentStub } = buildContext(buildAvailabilityPayload(rates));
  await init(context, documentStub);
  await gotoMonth(context, documentStub, "june 2027");
  context.window.AE_BOOKING.pickDate("2027-06-18");
  // 19, 20, 21, 22 June are 1-4 nights from the 18th — all short of the
  // 5-night minimum, and none of them is busy/no-price/owner-blocked, so
  // before this fix they fell through to the same light "available" look
  // and were, before the fix, indistinguishable from a real valid checkout.
  for (const short of ["2027-06-19", "2027-06-20", "2027-06-21", "2027-06-22"]) {
    const cell = cellFor(documentStub, short);
    assert.ok(!isClickable(cell), `expected ${short} NOT clickable (too few nights from 18 June)\n${cell}`);
    assert.match(cell, /aria-disabled="true"/, `expected ${short} aria-disabled=true\n${cell}`);
    assert.match(cell, /minimum stay|nights/i, `expected ${short}'s aria-label to explain why (min-stay wording)\n${cell}`);
  }
});

test("calendar: the 2/3 July boundary — a stay starting before high season that would extend into a high-season (Saturday-turnover) night is only a valid checkout if both ends are Saturday", async () => {
  const rates = buildRates();
  const { context, documentStub } = buildContext(buildAvailabilityPayload(rates));
  await init(context, documentStub);
  await gotoMonth(context, documentStub, "june 2027");
  // 2027-06-26 is a Saturday; a stay from there through 2027-07-03 (7
  // nights: 26,27,28,29,30,1,2) never actually stays the night of 3 July
  // (checkout IS the 3rd, so that night isn't "stayed" — see nightsInRange),
  // so it should be a perfectly ordinary, valid low-season checkout.
  context.window.AE_BOOKING.pickDate("2027-06-26");
  await gotoMonth(context, documentStub, "july 2027");
  const cellJul3 = cellFor(documentStub, "2027-07-03");
  assert.ok(isClickable(cellJul3), `expected 2027-07-03 clickable as checkout for a stay that doesn't reach the high-season night\n${cellJul3}`);

  // But extending one more night — checkout 2027-07-04 — DOES include the
  // night of 3 July (a flagged high-season/Saturday-turnover night), so
  // this must now require both ends to be Saturday. Checkout-in is
  // 2027-06-26 (Saturday) but checkout-out 2027-07-04 is a Sunday, so it
  // must be rejected.
  const cellJul4 = cellFor(documentStub, "2027-07-04");
  assert.ok(!isClickable(cellJul4), `expected 2027-07-04 NOT clickable — touches the high-season night but isn't a Saturday checkout\n${cellJul4}`);
  assert.match(cellJul4, /saturday/i, `expected 2027-07-04's aria-label to explain the Saturday-turnover reason\n${cellJul4}`);
});

test("calendar: 3 -> 10 July (7 nights, Saturday to Saturday) is a valid, clickable high-season checkout", async () => {
  const rates = buildRates();
  const { context, documentStub } = buildContext(buildAvailabilityPayload(rates));
  await init(context, documentStub);
  await gotoMonth(context, documentStub, "july 2027");
  context.window.AE_BOOKING.pickDate("2027-07-03");
  const cell10 = cellFor(documentStub, "2027-07-10");
  assert.ok(isClickable(cell10), `expected 2027-07-10 clickable as a 7-night Saturday-to-Saturday checkout\n${cell10}`);
});

test("calendar: 3 -> 17 July (14 nights, two high-season weeks) is a valid, clickable checkout", async () => {
  const rates = buildRates();
  const { context, documentStub } = buildContext(buildAvailabilityPayload(rates));
  await init(context, documentStub);
  await gotoMonth(context, documentStub, "july 2027");
  context.window.AE_BOOKING.pickDate("2027-07-03");
  const cell17 = cellFor(documentStub, "2027-07-17");
  assert.ok(isClickable(cell17), `expected 2027-07-17 clickable as a 14-night high-season checkout\n${cell17}`);
});

test("calendar: high season already shows non-Saturday nights as dark/non-clickable ARRIVAL candidates, before any date is picked at all", async () => {
  const rates = buildRates();
  const { context, documentStub } = buildContext(buildAvailabilityPayload(rates));
  await init(context, documentStub);
  await gotoMonth(context, documentStub, "july 2027");
  // 2027-07-06 is a Tuesday, inside high season, no selection made yet.
  const cellWeekday = cellFor(documentStub, "2027-07-06");
  assert.ok(!isClickable(cellWeekday), `expected 2027-07-06 (weekday, high season) NOT clickable as a fresh arrival, before any pick\n${cellWeekday}`);
  // 2027-07-10 (a Saturday) should be clickable as a fresh arrival.
  const cellSaturday = cellFor(documentStub, "2027-07-10");
  assert.ok(isClickable(cellSaturday), `expected 2027-07-10 (Saturday, high season) clickable as a fresh arrival\n${cellSaturday}`);
});

test("calendar: 2027-09-04 (the last possible high-season departure) behaves as low season for a NEW arrival — clickable as an ordinary weekday start", async () => {
  const rates = buildRates();
  const { context, documentStub } = buildContext(buildAvailabilityPayload(rates));
  await init(context, documentStub);
  await gotoMonth(context, documentStub, "september 2027");
  const cell = cellFor(documentStub, "2027-09-04");
  assert.ok(isClickable(cell), `expected 2027-09-04 clickable as a fresh (low-season) arrival\n${cell}`);
});

test("calendar: an owner-blocked date is never clickable as a fresh arrival (incidental fix: was previously missing !isOwnBlocked)", async () => {
  const rates = buildRates();
  const payload = buildAvailabilityPayload(rates);
  payload.ownBlockedNights = ["2027-06-15"];
  payload.busyNights = ["2027-06-15"];
  const { context, documentStub } = buildContext(payload);
  await init(context, documentStub);
  await gotoMonth(context, documentStub, "june 2027");
  const cell = cellFor(documentStub, "2027-06-15");
  assert.ok(!isClickable(cell), `expected an owner-blocked date to never be clickable as a fresh arrival\n${cell}`);
});

test("calendar: winter's pre-existing 30-night minimum still gates checkout candidates exactly as before (unaffected by this change)", async () => {
  const rates = buildRates();
  const { context, documentStub } = buildContext(buildAvailabilityPayload(rates));
  await init(context, documentStub);
  await gotoMonth(context, documentStub, "january 2027");
  context.window.AE_BOOKING.pickDate("2027-01-16");
  await gotoMonth(context, documentStub, "february 2027");
  const shortCell = cellFor(documentStub, "2027-02-01"); // 16 nights, short of 30
  assert.ok(!isClickable(shortCell), `expected 2027-02-01 NOT clickable (16 nights, winter minimum is 30)\n${shortCell}`);
});

test("calendar: the exactly-4-night-gap exception still renders a valid, clickable checkout (unaffected by this change)", async () => {
  const rates = buildRates();
  // A 4-night gap between two bookings inside the ordinary (min-5) June
  // period: 2027-06-14 is busy, 2027-06-15..18 are free, 2027-06-19 is busy.
  const payload = buildAvailabilityPayload(rates, { busyNights: ["2027-06-14", "2027-06-19"] });
  const { context, documentStub } = buildContext(payload);
  await init(context, documentStub);
  await gotoMonth(context, documentStub, "june 2027");
  context.window.AE_BOOKING.pickDate("2027-06-15");
  const cell19 = cellFor(documentStub, "2027-06-19");
  assert.ok(isClickable(cell19), `expected 2027-06-19 clickable as checkout — exactly the 4-night gap between two bookings\n${cell19}`);
});

// ---- cross-check against the SAME fixture, server-side (calculateQuote) --
// These don't touch booking.js at all — they prove the server would decide
// each of the explicitly required cases exactly the same way the calendar
// above now renders it, using the identical rates fixture.

const SETTINGS = {
  defaultMinNights: 5,
  weekDiscount: { enabled: false, minNights: 7, percent: 10 },
  monthDiscount: { enabled: false, minNights: 28, percent: 20 },
  linenFeeMode: "per_booking",
  linenFeePerPersonCents: 0,
  cleaningFeeCents: 0,
  touristTax: { mode: "fixed_per_person_per_night", fixedAmountCents: 0, minAge: 18, ratePercent: 0, capCentsPerNight: null, departmentalSurchargePercent: 0 },
  depositCents: 0,
  capacity: { maxAdults: 8, maxChildren: 2, maxTotalGuests: 10 },
};

test("server: calculateQuote agrees with the calendar on every explicitly required case", () => {
  const rates = buildRates();
  const cases = [
    { checkin: "2027-06-18", checkout: "2027-06-23", adults: 2, ok: true, label: "18->23 June, 5 nights" },
    { checkin: "2027-06-19", checkout: "2027-06-24", adults: 2, ok: true, label: "19->24 June, 5 nights" },
    { checkin: "2027-06-19", checkout: "2027-06-21", adults: 2, ok: false, code: "MIN_NIGHTS_NOT_MET", label: "19->21 June, only 2 nights" },
    { checkin: "2027-07-03", checkout: "2027-07-10", adults: 2, ok: true, label: "3->10 July, 7 nights Sat-Sat" },
    { checkin: "2027-07-03", checkout: "2027-07-17", adults: 2, ok: true, label: "3->17 July, 14 nights" },
    { checkin: "2027-07-06", checkout: "2027-07-13", adults: 2, ok: false, code: "SATURDAY_TURNOVER_REQUIRED", label: "weekday (Tuesday) July arrival, 7 nights (enough nights, but not a Saturday)" },
    { checkin: "2027-08-28", checkout: "2027-09-04", adults: 2, ok: true, label: "28 Aug -> 4 Sept, 7 nights, last valid high-season departure" },
    { checkin: "2027-09-04", checkout: "2027-09-09", adults: 2, ok: true, label: "4 Sept behaves as low season for a NEW arrival, 5 nights" },
  ];
  for (const c of cases) {
    if (c.ok) {
      assert.doesNotThrow(() => calculateQuote(c, SETTINGS, rates), `${c.label}: expected calculateQuote to accept`);
    } else {
      assert.throws(
        () => calculateQuote(c, SETTINGS, rates),
        (err) => err.code === c.code,
        `${c.label}: expected calculateQuote to reject with ${c.code}`
      );
    }
  }
});

test("server: a genuinely non-Saturday July arrival with a long-enough stay is still rejected — this time specifically for SATURDAY_TURNOVER_REQUIRED, not min-nights", () => {
  const rates = buildRates();
  // 2027-07-06 (Tuesday) for 14 nights easily clears the 7-night minimum,
  // isolating the Saturday-turnover rejection from the min-nights one.
  assert.throws(
    () => calculateQuote({ checkin: "2027-07-06", checkout: "2027-07-20", adults: 2 }, SETTINGS, rates),
    (err) => err.code === "SATURDAY_TURNOVER_REQUIRED",
    "expected SATURDAY_TURNOVER_REQUIRED for a non-Saturday July arrival even with enough nights"
  );
});

test("server: winter's 30-night minimum and the 4-night-gap exception are both unaffected by this change", () => {
  const rates = buildRates();
  assert.throws(
    () => calculateQuote({ checkin: "2027-01-16", checkout: "2027-02-01", adults: 2 }, SETTINGS, rates),
    (err) => err.code === "MIN_NIGHTS_NOT_MET",
    "expected the pre-existing 30-night winter minimum to still apply"
  );
  const quote = calculateQuote(
    { checkin: "2027-06-15", checkout: "2027-06-19", adults: 2 },
    SETTINGS,
    rates,
    { busyNights: new Set(["2027-06-14", "2027-06-19"]) }
  );
  assert.equal(quote.fourNightGapException, true, "expected the pre-existing 4-night-gap exception to still apply unchanged");
});

// ---- selection-state note, "earliest check-out" hint, and clear-selection
// link (new: "de kalender moet ongeldige vertrekdatums onmiddellijk
// uitschakelen" + "toon direct bij de kalender een duidelijke melding") ---

test("calendar: arrival 7 May, default 5-night minimum -> the next 4 days are disabled, 12 May is the first valid checkout, and the note next to the calendar says so", async () => {
  const rates = buildRates();
  const { context, documentStub } = buildContext(buildAvailabilityPayload(rates));
  await init(context, documentStub);
  await gotoMonth(context, documentStub, "may 2027");
  context.window.AE_BOOKING.pickDate("2027-05-07");
  for (const disabled of ["2027-05-08", "2027-05-09", "2027-05-10", "2027-05-11"]) {
    const cell = cellFor(documentStub, disabled);
    assert.ok(!isClickable(cell), `expected ${disabled} disabled (fewer than 5 nights from 7 May)\n${cell}`);
  }
  const validCell = cellFor(documentStub, "2027-05-12");
  assert.ok(isClickable(validCell), `expected 2027-05-12 clickable (exactly 5 nights from 7 May)\n${validCell}`);
  const note = documentStub.getElementById("ae-cal-minstay-note");
  assert.match(note.innerHTML, /5 nights/, `expected the note to mention the 5-night minimum\n${note.innerHTML}`);
  assert.match(note.innerHTML, /12 May/, `expected the note to name 12 May as the earliest check-out\n${note.innerHTML}`);
});

test("calendar: a 4-night minimum disables exactly the next 3 days, not 4", async () => {
  const rates = buildRates();
  rates["2027-05-01"] = { priceCents: 10000, minNights: 4 };
  const { context, documentStub } = buildContext(buildAvailabilityPayload(rates));
  await init(context, documentStub);
  await gotoMonth(context, documentStub, "may 2027");
  context.window.AE_BOOKING.pickDate("2027-05-01");
  for (const disabled of ["2027-05-02", "2027-05-03", "2027-05-04"]) {
    const cell = cellFor(documentStub, disabled);
    assert.ok(!isClickable(cell), `expected ${disabled} disabled (fewer than 4 nights from 1 May)\n${cell}`);
  }
  const validCell = cellFor(documentStub, "2027-05-05");
  assert.ok(isClickable(validCell), `expected 2027-05-05 clickable (exactly 4 nights from 1 May)\n${validCell}`);
});

test("calendar: winter's 30-night minimum — arrival 20 January, 18 February rejected, 19 February the first valid checkout, note names it", async () => {
  const rates = buildRates();
  const { context, documentStub } = buildContext(buildAvailabilityPayload(rates));
  await init(context, documentStub);
  await gotoMonth(context, documentStub, "january 2027");
  context.window.AE_BOOKING.pickDate("2027-01-20");
  await gotoMonth(context, documentStub, "february 2027");
  const rejected = cellFor(documentStub, "2027-02-18");
  assert.ok(!isClickable(rejected), `expected 2027-02-18 rejected (29 nights, short of the 30-night winter minimum)\n${rejected}`);
  const accepted = cellFor(documentStub, "2027-02-19");
  assert.ok(isClickable(accepted), `expected 2027-02-19 accepted (exactly 30 nights)\n${accepted}`);
  const note = documentStub.getElementById("ae-cal-minstay-note");
  assert.match(note.innerHTML, /30 nights/, `expected the note to mention the 30-night minimum\n${note.innerHTML}`);
  assert.match(note.innerHTML, /19 February/, `expected the note to name 19 February as the earliest check-out\n${note.innerHTML}`);
});

test("calendar: the 'clear selection' link is offered once an arrival is picked, and actually clears it", async () => {
  const rates = buildRates();
  const { context, documentStub } = buildContext(buildAvailabilityPayload(rates));
  await init(context, documentStub);
  await gotoMonth(context, documentStub, "june 2027");
  context.window.AE_BOOKING.pickDate("2027-06-18");
  const note = documentStub.getElementById("ae-cal-minstay-note");
  assert.match(note.innerHTML, /AE_BOOKING\.clearSelection\(\)/, `expected a clear-selection control next to the calendar\n${note.innerHTML}`);
  context.window.AE_BOOKING.clearSelection();
  const nightsEl = documentStub.getElementById("ae-cal-nights");
  assert.equal(nightsEl.textContent, STRINGS_EN_selectRange(context), "expected the selection to be fully cleared");
  const cellAfterClear = cellFor(documentStub, "2027-06-18");
  assert.ok(isClickable(cellAfterClear), "expected 2027-06-18 clickable again as a fresh arrival after clearing");
});

function STRINGS_EN_selectRange() {
  return "Select your check-in and check-out dates on the calendar";
}

test("calendar: an invalid checkout attempt (defense in depth) reports the error next to the calendar and keeps the existing arrival selected", async () => {
  const rates = buildRates();
  const { context, documentStub } = buildContext(buildAvailabilityPayload(rates));
  await init(context, documentStub);
  await gotoMonth(context, documentStub, "june 2027");
  context.window.AE_BOOKING.pickDate("2027-06-18");
  // Bypasses the UI's own clickability gate to exercise pickDate()'s
  // internal defense-in-depth check directly.
  context.window.AE_BOOKING.pickDate("2027-06-19"); // only 1 night — invalid
  const note = documentStub.getElementById("ae-cal-minstay-note");
  assert.match(note.textContent, /already booked or requested|Please pick different dates/i, `expected the range-unavailable message next to the calendar\n${note.textContent}`);
  // The original arrival must still be intact — completing a genuinely
  // valid checkout afterwards should still work.
  context.window.AE_BOOKING.pickDate("2027-06-23");
  const checkoutEl = documentStub.getElementById("checkout");
  assert.match(checkoutEl.textContent, /23/, `expected the checkout to have completed at 2027-06-23\n${checkoutEl.textContent}`);
});

// ---- submit-time messaging: selection problems now surface NEXT TO the
// calendar, not only via #ae-booking-status below the personal-data fields
// (the explicitly reported bug) ----------------------------------------

test("submit: no dates selected -> the error appears next to the calendar, not only at the bottom of the form", async () => {
  const rates = buildRates();
  const { context, documentStub } = buildContext(buildAvailabilityPayload(rates));
  await init(context, documentStub);
  const fakeEvent = { preventDefault() {} };
  await context.window.AE_BOOKING.submit(fakeEvent);
  const note = documentStub.getElementById("ae-cal-minstay-note");
  const status = documentStub.getElementById("ae-booking-status");
  assert.match(note.textContent, /select both a check-in and a check-out/i, `expected the calendar note to explain the missing selection\n${note.textContent}`);
  assert.equal(status.textContent, "", "expected the bottom status area to stay empty for this specific error");
});

test("submit: a complete, genuinely valid selection does not trigger the calendar-note error path (regression check for the isValidCheckout upgrade)", async () => {
  const rates = buildRates();
  const { context, documentStub } = buildContext(buildAvailabilityPayload(rates));
  await init(context, documentStub);
  await gotoMonth(context, documentStub, "june 2027");
  context.window.AE_BOOKING.pickDate("2027-06-18");
  context.window.AE_BOOKING.pickDate("2027-06-23");
  documentStub.getElementById("guest-name").value = "Test Guest";
  documentStub.getElementById("guest-email").value = "guest@example.com";
  documentStub.getElementById("guest-phone").value = "";
  documentStub.getElementById("guest-message").value = "";
  const termsEl = documentStub.getElementById("terms-accept");
  termsEl.checked = true;
  const fakeEvent = { preventDefault() {} };
  await context.window.AE_BOOKING.submit(fakeEvent);
  const note = documentStub.getElementById("ae-cal-minstay-note");
  assert.doesNotMatch(note.textContent, /already booked|select both/i, `expected no selection-error text after a valid, complete booking submit\n${note.textContent}`);
});

// ---- "kleine lettertjes" terms checkbox: still genuinely mandatory -------
// The checkbox's LABEL/LINK markup changed (assets/*/reserve.html), but the
// gate itself lives here in submitBooking() and was deliberately left
// untouched. These two tests prove submission is still blocked while the
// (default-unchecked) box is unchecked, and still proceeds once it is
// checked — i.e. the new label/link wiring didn't quietly break the
// existing required-acceptance behaviour.
test("submit: an otherwise-complete, valid booking is BLOCKED when the terms checkbox is left unchecked (its default state)", async () => {
  const rates = buildRates();
  const { context, documentStub } = buildContext(buildAvailabilityPayload(rates));
  await init(context, documentStub);
  await gotoMonth(context, documentStub, "june 2027");
  context.window.AE_BOOKING.pickDate("2027-06-18");
  context.window.AE_BOOKING.pickDate("2027-06-23");
  documentStub.getElementById("guest-name").value = "Test Guest";
  documentStub.getElementById("guest-email").value = "guest@example.com";
  documentStub.getElementById("guest-phone").value = "";
  documentStub.getElementById("guest-message").value = "";
  const termsEl = documentStub.getElementById("terms-accept");
  assert.ok(!termsEl.checked, "the fake terms checkbox must default to unchecked, same as the real one");
  const fakeEvent = { preventDefault() {} };
  await context.window.AE_BOOKING.submit(fakeEvent);
  const status = documentStub.getElementById("ae-booking-status");
  assert.match(status.textContent, /accept the booking terms/i, `expected the mandatory-terms message, got:\n${status.textContent}`);
  assert.equal(
    context.window.location.href,
    "http://test/",
    "submission must not proceed to Stripe checkout while terms are unaccepted"
  );
});

test("submit: the same booking proceeds to Stripe checkout once the terms checkbox is checked", async () => {
  const rates = buildRates();
  const { context, documentStub } = buildContext(buildAvailabilityPayload(rates));
  await init(context, documentStub);
  await gotoMonth(context, documentStub, "june 2027");
  context.window.AE_BOOKING.pickDate("2027-06-18");
  context.window.AE_BOOKING.pickDate("2027-06-23");
  documentStub.getElementById("guest-name").value = "Test Guest";
  documentStub.getElementById("guest-email").value = "guest@example.com";
  documentStub.getElementById("guest-phone").value = "";
  documentStub.getElementById("guest-message").value = "";
  documentStub.getElementById("terms-accept").checked = true;
  const fakeEvent = { preventDefault() {} };
  await context.window.AE_BOOKING.submit(fakeEvent);
  assert.equal(
    context.window.location.href,
    "https://stripe.example/test-session",
    "a checked terms box must let the booking proceed to the Stripe checkout redirect"
  );
});

// ---- direct regression test for the live bug report: "na het kiezen van
// 17 juli lijkt alles aanklikbaar, maar dat is het niet" — picking a
// high-season Saturday arrival must leave ONLY the next Saturdays (7/14/...
// nights later) with the normal available look; every other day in between
// must be BOTH functionally non-clickable AND visually unmistakable from an
// available tile (this was the guest-facing complaint: opacity+line-through
// alone didn't read as clearly disabled) ----------------------------------
test("calendar: arrival 17 July (high season) — only 24 and 31 July (the next Saturdays) stay available-looking; every day in between is dark, struck through, and NOT just dimmed available styling", async () => {
  const rates = buildRates();
  const { context, documentStub } = buildContext(buildAvailabilityPayload(rates));
  await init(context, documentStub);
  await gotoMonth(context, documentStub, "july 2027");
  context.window.AE_BOOKING.pickDate("2027-07-17");

  const validCheckouts = ["2027-07-24", "2027-07-31"];
  const invalidCheckouts = [
    "2027-07-18", "2027-07-19", "2027-07-20", "2027-07-21", "2027-07-22", "2027-07-23",
    "2027-07-25", "2027-07-26", "2027-07-27", "2027-07-28", "2027-07-29", "2027-07-30",
  ];

  for (const d of validCheckouts) {
    const cell = cellFor(documentStub, d);
    assert.ok(isClickable(cell), `expected ${d} clickable (next high-season Saturday)\n${cell}`);
    assert.match(cell, /var\(--bg-available\)/, `expected ${d} to use the normal available background\n${cell}`);
  }

  for (const d of invalidCheckouts) {
    const cell = cellFor(documentStub, d);
    assert.ok(!isClickable(cell), `expected ${d} NOT clickable (not a valid high-season checkout)\n${cell}`);
    // The exact complaint: these must not merely be dimmed while still
    // using the same fill as an available day. They must use the darker
    // panel background, be struck through, and show a non-clickable
    // cursor — the same treatment already used for booked/held nights.
    assert.doesNotMatch(cell, /var\(--bg-available\)/, `expected ${d} to NOT use the available background\n${cell}`);
    assert.match(cell, /var\(--bg-panel\)/, `expected ${d} to use the darker panel background\n${cell}`);
    assert.match(cell, /text-decoration: line-through/, `expected ${d} to be struck through\n${cell}`);
    assert.match(cell, /cursor: not-allowed/, `expected ${d} to show a not-allowed cursor\n${cell}`);
    assert.match(cell, /aria-disabled="true"/, `expected ${d} to be aria-disabled\n${cell}`);
  }
});

test("calendar: Saturday arrival in high season with enough nights but a non-Saturday departure is still rejected (Saturday-turnover, isolated from minimum-stay)", async () => {
  const rates = buildRates();
  const { context, documentStub } = buildContext(buildAvailabilityPayload(rates));
  await init(context, documentStub);
  await gotoMonth(context, documentStub, "july 2027");
  context.window.AE_BOOKING.pickDate("2027-07-03");
  // 2027-07-11 is 8 nights later (well past the 7-night minimum) but a
  // Sunday, not a Saturday — must still be rejected, isolating the
  // Saturday-turnover check from the minimum-stay check.
  const cell11 = cellFor(documentStub, "2027-07-11");
  assert.ok(!isClickable(cell11), `expected 2027-07-11 NOT clickable (enough nights, but not a Saturday)\n${cell11}`);
});

test("calendar: a booked/blocked night inside the requested range makes every checkout candidate past it non-clickable, outside the narrow 4-night-gap exception", async () => {
  const rates = buildRates();
  // 2027-06-22 is an ordinary (non-gap) confirmed booking sitting between a
  // 18 June arrival and what would otherwise be a valid 25 June (7-night)
  // checkout.
  const payload = buildAvailabilityPayload(rates, { busyNights: ["2027-06-22"] });
  const { context, documentStub } = buildContext(payload);
  await init(context, documentStub);
  await gotoMonth(context, documentStub, "june 2027");
  context.window.AE_BOOKING.pickDate("2027-06-18");
  const cell25 = cellFor(documentStub, "2027-06-25");
  assert.ok(!isClickable(cell25), `expected 2027-06-25 NOT clickable — 2027-06-22 is booked in between and this isn't the narrow 4-night-gap case\n${cell25}`);
});
