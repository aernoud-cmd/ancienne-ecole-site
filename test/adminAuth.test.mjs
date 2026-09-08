// Unit tests for the admin login/session layer: credential comparison,
// session cookie round-trip, and rejection of a tampered or expired
// session. (The Blobs-backed login-throttle functions need a live Netlify
// Blobs context and are exercised manually after deployment instead — see
// the delivery notes.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

process.env.ADMIN_USERNAME = "test-owner";
process.env.ADMIN_PASSWORD = "correct-horse-battery-staple";
process.env.ADMIN_SESSION_SECRET = "unit-test-secret-do-not-use-in-prod";

const {
  verifyCredentials,
  createSessionCookie,
  hasValidAdminSession,
} = await import("../netlify/functions/_lib/adminAuth.mjs");

function cookieHeaderFrom(setCookieString) {
  // createSessionCookie() returns a full Set-Cookie line; a request only
  // needs the "name=value" part before the first ";".
  return setCookieString.split(";")[0];
}

function fakeRequest(cookieHeader) {
  return new Request("https://example.test/.netlify/functions/admin-pricing", {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
}

test("verifyCredentials accepts only the exact configured username+password", () => {
  assert.equal(verifyCredentials("test-owner", "correct-horse-battery-staple"), true);
  assert.equal(verifyCredentials("test-owner", "wrong"), false);
  assert.equal(verifyCredentials("someone-else", "correct-horse-battery-staple"), false);
  assert.equal(verifyCredentials("", ""), false);
});

test("a freshly issued session cookie is accepted", () => {
  const setCookie = createSessionCookie();
  const req = fakeRequest(cookieHeaderFrom(setCookie));
  assert.equal(hasValidAdminSession(req), true);
});

test("no cookie at all is rejected", () => {
  assert.equal(hasValidAdminSession(fakeRequest(null)), false);
});

test("a tampered signature is rejected", () => {
  const setCookie = createSessionCookie();
  const [payload] = cookieHeaderFrom(setCookie).split("=")[1].split(".");
  const forged = `ae_admin_session=${payload}.0000000000000000000000000000000000000000000000000000000000000000`;
  assert.equal(hasValidAdminSession(fakeRequest(forged)), false);
});

test("a correctly-signed but expired session is rejected", () => {
  // Re-implements the module's own (public, documented) signing scheme —
  // HMAC-SHA256 of the expiry timestamp with ADMIN_SESSION_SECRET — to
  // build a cookie that expired one hour ago, without reaching into the
  // module's internals.
  const expiredPayload = String(Date.now() - 3600 * 1000);
  const sig = createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(expiredPayload).digest("hex");
  const cookie = `ae_admin_session=${expiredPayload}.${sig}`;
  assert.equal(hasValidAdminSession(fakeRequest(cookie)), false);
});
