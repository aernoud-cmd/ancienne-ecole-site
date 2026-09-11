// Unit tests for isStripeTestMode() — the one function admin.js relies on
// to word the cancel+refund confirmation dialogs honestly (never calling a
// test refund a real money transaction, and never softening a real one).
// Deliberately only tests the pure prefix check, not any actual Stripe API
// call (see _lib/stripe.mjs's client(), which this never touches).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isStripeTestMode } from "../netlify/functions/_lib/stripe.mjs";

const ORIGINAL = process.env.STRIPE_SECRET_KEY;

function restore() {
  if (ORIGINAL === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = ORIGINAL;
}

test("isStripeTestMode: true for a sk_test_ key", () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_abc123";
  try {
    assert.equal(isStripeTestMode(), true);
  } finally {
    restore();
  }
});

test("isStripeTestMode: false for a sk_live_ key", () => {
  process.env.STRIPE_SECRET_KEY = "sk_live_abc123";
  try {
    assert.equal(isStripeTestMode(), false);
  } finally {
    restore();
  }
});

test("isStripeTestMode: null (unknown) when no key is set at all", () => {
  delete process.env.STRIPE_SECRET_KEY;
  try {
    assert.equal(isStripeTestMode(), null);
  } finally {
    restore();
  }
});
