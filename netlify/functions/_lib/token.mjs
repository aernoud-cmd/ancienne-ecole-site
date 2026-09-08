// Signs the approve/decline links sent to the owner, so a booking can only be
// confirmed or declined via a link we actually generated (not by guessing a
// booking id). Uses HMAC-SHA256 with a secret the owner sets in Netlify's own
// environment-variable settings (APPROVAL_SECRET) — this code never sees or
// stores that secret anywhere except reading it from the environment.

import { createHmac, timingSafeEqual } from "node:crypto";

function secret() {
  const s = process.env.APPROVAL_SECRET;
  if (!s) throw new Error("APPROVAL_SECRET environment variable is not set");
  return s;
}

export function signAction(bookingId, action) {
  const payload = `${bookingId}.${action}`;
  const sig = createHmac("sha256", secret()).update(payload).digest("hex").slice(0, 32);
  return sig;
}

export function verifyAction(bookingId, action, sig) {
  if (!sig) return false;
  const expected = signAction(bookingId, action);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
