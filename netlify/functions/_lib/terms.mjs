// Single source of truth for "which version of the booking terms is
// currently in force". Bump this string whenever the terms/cancellation/
// deposit copy shown on the reserve page changes materially — book.mjs
// stores whatever value was current AT THE TIME on the booking itself
// (booking.termsVersion), so a later bump never silently rewrites what an
// existing guest is considered to have agreed to (see README/spec section
// 10: "capture and store which terms version the guest accepted").
export const CURRENT_TERMS_VERSION = "2026-09-10";
