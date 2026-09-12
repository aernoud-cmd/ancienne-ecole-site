// Static checks on the "kleine lettertjes" / "small print" / "petites
// lignes" mandatory checkbox across all 6 guest-facing reserve pages
// (standalone + embed, x EN/FR/NL). These pages hardcode this markup
// directly in HTML rather than rendering it from assets/booking.js, so it
// can't be exercised through the vm-based harness in
// bookingCalendar.test.mjs — this file reads the actual shipped HTML
// instead, exactly as a browser would receive it.
//
// What this guards, per the guest-facing requirement:
//   - the checkbox itself has no "checked" attribute (default unchecked)
//   - its label contains the approved sentence, in the guest's language
//   - "de kleine lettertjes" / "the small print" / "les petites lignes" is
//     a real <a> link, not plain text
//   - that link opens in a NEW tab (target="_blank" + rel="noopener", so a
//     window.opener reference can't be used to drive the original tab, and
//     nothing about the click can replace/navigate the tab holding the
//     guest's already-filled-in form)
//
// It also checks the link's href is exactly the real, published WordPress
// page for that language (supplied by Codex/Aernoud) — see
// netlify/functions/_lib/notify.mjs's TERMS_PAGE_URL for the single other
// place these same three URLs are used (the confirmation email).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { TERMS_PAGE_URL } from "../netlify/functions/_lib/notify.mjs";

const REPO = new URL("..", import.meta.url).pathname;

const PAGES = [
  { file: "reserve.html", lang: "EN", linkText: "the small print", mustInclude: "including the cancellation terms", url: TERMS_PAGE_URL.en },
  { file: "embed/reserve.html", lang: "EN", linkText: "the small print", mustInclude: "including the cancellation terms", url: TERMS_PAGE_URL.en },
  { file: "fr/reserve.html", lang: "FR", linkText: "les petites lignes", mustInclude: "conditions d&#39;annulation", url: TERMS_PAGE_URL.fr },
  { file: "embed/fr/reserve.html", lang: "FR", linkText: "les petites lignes", mustInclude: "conditions d&#39;annulation", url: TERMS_PAGE_URL.fr },
  { file: "nl/reserve.html", lang: "NL", linkText: "de kleine lettertjes", mustInclude: "inclusief de annuleringsvoorwaarden", url: TERMS_PAGE_URL.nl },
  { file: "embed/nl/reserve.html", lang: "NL", linkText: "de kleine lettertjes", mustInclude: "inclusief de annuleringsvoorwaarden", url: TERMS_PAGE_URL.nl },
];

function extractTermsBlock(html) {
  const inputIdx = html.indexOf('id="terms-accept"');
  assert.ok(inputIdx !== -1, "expected a #terms-accept checkbox to exist on the page");
  // The whole <label>...</label> wrapping the checkbox and its link.
  const labelStart = html.lastIndexOf("<label", inputIdx);
  const labelEnd = html.indexOf("</label>", inputIdx) + "</label>".length;
  return html.slice(labelStart, labelEnd);
}

for (const { file, lang, linkText, mustInclude, url } of PAGES) {
  test(`${file}: terms checkbox defaults unchecked, links to ${lang} "${linkText}" in a new tab`, () => {
    const html = fs.readFileSync(`${REPO}${file}`, "utf8");
    const block = extractTermsBlock(html);

    // Mandatory + default-unchecked: the input tag itself carries no
    // "checked" attribute anywhere in the label block.
    const inputTag = block.match(/<input[^>]*id="terms-accept"[^>]*>/)[0];
    assert.doesNotMatch(inputTag, /\bchecked\b/, `expected the checkbox to have no "checked" attribute\n${inputTag}`);
    assert.match(inputTag, /type="checkbox"/, "expected an actual checkbox input");

    // The link itself: real <a>, correct visible text, opens in a new tab
    // without granting it a handle back to the opener, pointing at the
    // real, published WordPress page for this language.
    const linkMatch = block.match(/<a\s+href="([^"]+)"([^>]*)>([^<]+)<\/a>/);
    assert.ok(linkMatch, `expected a <a href="...">...</a> inside the terms label\n${block}`);
    const [, href, attrs, text] = linkMatch;
    assert.equal(text, linkText, `expected the link text to read "${linkText}"`);
    assert.match(attrs, /target="_blank"/, "expected the terms link to open in a new tab (target=\"_blank\")");
    assert.match(attrs, /rel="noopener/, 'expected rel="noopener..." alongside target="_blank"');
    assert.equal(href, url, `expected the real published terms-page URL, got: ${href}`);

    // The rest of the approved sentence around the link is present.
    assert.match(block, new RegExp(mustInclude.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `expected the approved sentence text\n${block}`);
  });
}
