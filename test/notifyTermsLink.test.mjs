// Tests for the plain terms-page link added to the booking-confirmation
// ("paid") guest email. No PDF is fetched, stored, or attached anywhere in
// this codebase — a prior round of this feature did attach a fetched PDF,
// but that approach was explicitly dropped in favour of a plain link, so
// there is nothing here to mock a fetch/attachment for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GUEST_COPY, TERMS_PAGE_URL, bookingSummaryTable } from "../netlify/functions/_lib/notify.mjs";

const booking = {
  name: "Marie Dupont",
  checkin: "2027-07-17",
  checkout: "2027-07-24",
  nights: 7,
  adults: 2,
  children: 1,
  quote: { nights: 7, currency: "EUR", rentalSubtotalCents: 100000, linenFeeCents: 4500, cleaningFeeCents: 8000, touristTaxCents: 2100, totalCents: 114600, depositCents: 25000 },
};

test("TERMS_PAGE_URL holds the three real, published WordPress pages (not placeholders)", () => {
  assert.equal(TERMS_PAGE_URL.nl, "https://ancienne-ecole.rent/de-kleine-lettertjes/");
  assert.equal(TERMS_PAGE_URL.en, "https://ancienne-ecole.rent/en/the-small-print/");
  assert.equal(TERMS_PAGE_URL.fr, "https://ancienne-ecole.rent/fr/les-petites-lignes/");
});

test('GUEST_COPY.nl.paid matches Aernoud\'s approved wording and links "De kleine lettertjes" to the real NL page', () => {
  const html = GUEST_COPY.nl.paid.body(booking);
  assert.match(html, /Dank u wel voor uw boeking\./);
  assert.match(html, /Hieronder treft u de samenvatting van uw boeking aan\./);
  assert.match(html, /Onze algemene voorwaarden vindt u via de link/);
  assert.match(html, new RegExp(`<a href="${TERMS_PAGE_URL.nl}">De kleine lettertjes</a>`));
  assert.doesNotMatch(html, /bijlage/i, "no PDF attachment is sent any more — the copy must not claim one");
});

test('GUEST_COPY.en.paid links "The small print" to the real EN page', () => {
  const html = GUEST_COPY.en.paid.body(booking);
  assert.match(html, /summary of your booking/i);
  assert.match(html, new RegExp(`<a href="${TERMS_PAGE_URL.en}">The small print</a>`));
  assert.doesNotMatch(html, /attach/i, "no PDF attachment is sent any more — the copy must not claim one");
});

test('GUEST_COPY.fr.paid links "Les petites lignes" to the real FR page', () => {
  const html = GUEST_COPY.fr.paid.body(booking);
  assert.match(html, /récapitulatif de votre réservation/i);
  assert.match(html, new RegExp(`<a href="${TERMS_PAGE_URL.fr}">Les petites lignes</a>`));
  assert.doesNotMatch(html, /pièce jointe/i, "no PDF attachment is sent any more — the copy must not claim one");
});

test("bookingSummaryTable: renders check-in/check-out/guests localized per language", () => {
  const nl = bookingSummaryTable(booking, "nl");
  assert.match(nl, /Aankomst/);
  assert.match(nl, /Vertrek/);
  assert.match(nl, /2027-07-17/);
  assert.match(nl, /2027-07-24/);
  assert.match(nl, /2 volwassene\(n\) \+ 1 kind\(eren\)/);

  const fr = bookingSummaryTable(booking, "fr");
  assert.match(fr, /Arrivée/);
  assert.match(fr, /Départ/);
});
