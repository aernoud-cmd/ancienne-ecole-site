// Tests for _lib/countries.mjs — the country list, name lookups, and the
// international address validation book.mjs uses before ever creating a
// Stripe Checkout Session. Aernoud was explicit this must NOT enforce Dutch
// house-number/postcode rules globally, must support countries that don't
// use postal codes at all, and must give the 8 named countries a fixed,
// exact top-of-list order and wording.
import { test } from "node:test";
import assert from "node:assert/strict";
import { COUNTRIES, COUNTRIES_WITHOUT_POSTAL_CODE, countryName, validateAddress } from "../netlify/functions/_lib/countries.mjs";

test("COUNTRIES: no duplicate codes, and every row has a non-empty name in all three languages", () => {
  const codes = COUNTRIES.map((r) => r[0]);
  assert.equal(new Set(codes).size, codes.length, "expected every ISO code to appear exactly once");
  for (const row of COUNTRIES) {
    assert.equal(row.length, 4, `expected [code, en, fr, nl] for ${row[0]}`);
    for (const name of row.slice(1)) {
      assert.ok(name && name.trim().length > 0, `expected a non-empty name in row ${JSON.stringify(row)}`);
    }
  }
});

test("Aernoud's exact top-8 countries exist with the exact wording he specified", () => {
  const expected = {
    GB: ["United Kingdom", "Royaume-Uni", "Verenigd Koninkrijk"],
    BE: ["Belgium", "Belgique", "België"],
    NL: ["Netherlands", "Pays-Bas", "Nederland"],
    FR: ["France", "France", "Frankrijk"],
    ES: ["Spain", "Espagne", "Spanje"],
    DE: ["Germany", "Allemagne", "Duitsland"],
    CH: ["Switzerland", "Suisse", "Zwitserland"],
    AT: ["Austria", "Autriche", "Oostenrijk"],
  };
  for (const [code, [en, fr, nl]] of Object.entries(expected)) {
    assert.equal(countryName(code, "en"), en, `EN name for ${code}`);
    assert.equal(countryName(code, "fr"), fr, `FR name for ${code}`);
    assert.equal(countryName(code, "nl"), nl, `NL name for ${code}`);
  }
});

test("countryName falls back to English for an unknown language, and to the bare code for an unknown code", () => {
  assert.equal(countryName("NL", "de"), "Netherlands");
  assert.equal(countryName("ZZ", "en"), "ZZ");
  assert.equal(countryName("", "en"), "");
});

test("validateAddress: rejects a missing street/house number, city, or country", () => {
  assert.equal(validateAddress({ line1: "", city: "Troche", postalCode: "19230", country: "FR" }), "ADDRESS_LINE1_REQUIRED");
  assert.equal(validateAddress({ line1: "1 Rue de la Paix", city: "", postalCode: "19230", country: "FR" }), "ADDRESS_CITY_REQUIRED");
  assert.equal(validateAddress({ line1: "1 Rue de la Paix", city: "Troche", postalCode: "19230", country: "" }), "ADDRESS_COUNTRY_REQUIRED");
  assert.equal(validateAddress({ line1: "1 Rue de la Paix", city: "Troche", postalCode: "19230", country: "ZZ" }), "ADDRESS_COUNTRY_REQUIRED", "an unknown country code must be rejected, never silently accepted");
});

test("validateAddress: postal code is required by default, but not for a country in COUNTRIES_WITHOUT_POSTAL_CODE", () => {
  assert.equal(validateAddress({ line1: "1 Main St", city: "Springfield", postalCode: "", country: "US" }), "ADDRESS_POSTAL_CODE_REQUIRED");
  assert.ok(COUNTRIES_WITHOUT_POSTAL_CODE.has("HK"), "Hong Kong is expected to be in the no-postal-code list");
  assert.equal(validateAddress({ line1: "1 Nathan Road", city: "Hong Kong", postalCode: "", country: "HK" }), null);
  assert.ok(COUNTRIES_WITHOUT_POSTAL_CODE.has("AE"), "the UAE is expected to be in the no-postal-code list");
  assert.equal(validateAddress({ line1: "Sheikh Zayed Road", city: "Dubai", postalCode: "", country: "AE" }), null);
});

test("validateAddress: exact digit-count formats for the groups Aernoud specified (BE/CH/AT 4 digits, FR/ES/DE 5 digits)", () => {
  for (const country of ["BE", "CH", "AT"]) {
    assert.equal(validateAddress({ line1: "x", city: "y", postalCode: "1234", country }), null, `${country}: 4 digits should be accepted`);
    assert.equal(validateAddress({ line1: "x", city: "y", postalCode: "123", country }), "ADDRESS_POSTAL_CODE_INVALID", `${country}: 3 digits should be rejected`);
    assert.equal(validateAddress({ line1: "x", city: "y", postalCode: "12345", country }), "ADDRESS_POSTAL_CODE_INVALID", `${country}: 5 digits should be rejected`);
  }
  for (const country of ["FR", "ES", "DE"]) {
    assert.equal(validateAddress({ line1: "x", city: "y", postalCode: "75001", country }), null, `${country}: 5 digits should be accepted`);
    assert.equal(validateAddress({ line1: "x", city: "y", postalCode: "7500", country }), "ADDRESS_POSTAL_CODE_INVALID", `${country}: 4 digits should be rejected`);
  }
  // Leading zeros must survive as a plain string, never be parsed/reformatted
  // as a number (e.g. a Paris "0"-leading arrondissement-style code, or a
  // French overseas postal code) — validateAddress never coerces to Number.
  assert.equal(validateAddress({ line1: "x", city: "y", postalCode: "07100", country: "FR" }), null);
});

test("validateAddress: GB/NL accept real alphanumeric postcodes with spaces, and never apply a Dutch house-number pairing rule", () => {
  assert.equal(validateAddress({ line1: "10 Downing Street", city: "London", postalCode: "SW1A 2AA", country: "GB" }), null);
  assert.equal(validateAddress({ line1: "Damrak 1", city: "Amsterdam", postalCode: "1012 LG", country: "NL" }), null);
  // No cross-field validation tying the postal code to the house number in
  // addressLine1 — a postal code is judged purely on its own format.
  assert.equal(validateAddress({ line1: "Some street without a number", city: "Amsterdam", postalCode: "1012 LG", country: "NL" }), null);
});

test("validateAddress: any other country just needs a plausible non-empty postal code — no invented strict format", () => {
  assert.equal(validateAddress({ line1: "1 Main St", city: "Boston", postalCode: "02108", country: "US" }), null);
  assert.equal(validateAddress({ line1: "1 Main St", city: "Boston", postalCode: "0", country: "US" }), "ADDRESS_POSTAL_CODE_INVALID", "a single character is too short to be a real postal code");
});
