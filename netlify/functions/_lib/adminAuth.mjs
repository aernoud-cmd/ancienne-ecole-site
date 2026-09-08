// Owner-only login for the pricing admin page (/admin). Single account —
// there's one owner — so this is deliberately simple: a username + password
// you set as Netlify environment variables (ADMIN_USERNAME, ADMIN_PASSWORD),
// compared safely, issuing a signed, httpOnly, expiring session cookie.
// Every admin read/write endpoint calls requireAdminSession() and refuses to
// run without a valid one — a hidden URL alone is never enough, because the
// data endpoints behind /admin check this on every single call, not just
// the page itself.
import { createHmac, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

const COOKIE_NAME = "ae_admin_session";
const SESSION_HOURS = 12;
const MAX_FAILED_ATTEMPTS = 8;
const LOCKOUT_WINDOW_MINUTES = 15;

function sessionSecret() {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s) throw new Error("ADMIN_SESSION_SECRET environment variable is not set");
  return s;
}

function sha256hex(s) {
  return createHmac("sha256", "ae-constant").update(s).digest("hex");
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function sign(payload) {
  return createHmac("sha256", sessionSecret()).update(payload).digest("hex");
}

export function createSessionCookie() {
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  const payload = String(exp);
  const sig = sign(payload);
  const value = `${payload}.${sig}`;
  const isLocal = !process.env.URL || process.env.URL.includes("localhost");
  const attrs = [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${SESSION_HOURS * 3600}`,
  ];
  if (!isLocal) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

function parseCookies(req) {
  const header = req.headers.get("cookie") || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

export function hasValidAdminSession(req) {
  const cookies = parseCookies(req);
  const value = cookies[COOKIE_NAME];
  if (!value || !value.includes(".")) return false;
  const [payload, sig] = value.split(".");
  const expected = sign(payload);
  if (!safeEqual(sig, expected)) return false;
  const exp = Number(payload);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  return true;
}

export function adminUnauthorizedResponse() {
  return new Response(JSON.stringify({ ok: false, error: "Not signed in" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

// A very small brute-force throttle: after MAX_FAILED_ATTEMPTS wrong
// passwords within LOCKOUT_WINDOW_MINUTES, further attempts are rejected
// (without even checking the password) until the window rolls over.
function authStore() {
  return getStore("admin-auth");
}

export async function checkLoginThrottle() {
  const store = authStore();
  const rec = await store.get("attempts", { type: "json", consistency: "strong" });
  if (!rec) return { locked: false };
  const ageMinutes = (Date.now() - new Date(rec.windowStart).getTime()) / 60000;
  if (ageMinutes > LOCKOUT_WINDOW_MINUTES) return { locked: false };
  if (rec.count >= MAX_FAILED_ATTEMPTS) {
    return { locked: true, retryAfterMinutes: Math.ceil(LOCKOUT_WINDOW_MINUTES - ageMinutes) };
  }
  return { locked: false };
}

export async function recordFailedLogin() {
  const store = authStore();
  const rec = await store.get("attempts", { type: "json", consistency: "strong" });
  const ageMinutes = rec ? (Date.now() - new Date(rec.windowStart).getTime()) / 60000 : Infinity;
  if (!rec || ageMinutes > LOCKOUT_WINDOW_MINUTES) {
    await store.setJSON("attempts", { count: 1, windowStart: new Date().toISOString() });
  } else {
    await store.setJSON("attempts", { count: rec.count + 1, windowStart: rec.windowStart });
  }
}

export async function clearLoginThrottle() {
  const store = authStore();
  await store.delete("attempts").catch(() => {});
}

export function verifyCredentials(username, password) {
  const expectedUser = process.env.ADMIN_USERNAME;
  const expectedPass = process.env.ADMIN_PASSWORD;
  if (!expectedUser || !expectedPass) {
    throw new Error("ADMIN_USERNAME / ADMIN_PASSWORD environment variables are not set");
  }
  // Hash both sides first so the comparison is constant-length regardless
  // of the input, then compare in constant time.
  const userOk = safeEqual(sha256hex(username || ""), sha256hex(expectedUser));
  const passOk = safeEqual(sha256hex(password || ""), sha256hex(expectedPass));
  return userOk && passOk;
}
