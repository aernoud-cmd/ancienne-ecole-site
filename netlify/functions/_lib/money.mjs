// Money is always handled as an integer number of eurocents internally —
// never as a float — so nothing can drift from floating-point rounding.
// Rounding rule (documented once, here, and used everywhere): every
// percentage or division is rounded to the nearest cent with "round half
// away from zero" (Math.round), applied at the point the amount is
// computed — never on an already-rounded intermediate value twice, and
// never by summing floats and rounding at the end. Line items are summed
// as integer cents, which is exact.

// Rounds a possibly-fractional number of cents to the nearest whole cent.
export function roundCents(cents) {
  return Math.round(cents);
}

// percentOfCents(1000, 10) -> 100 (10% of €10.00 = €1.00), rounded to the
// nearest cent.
export function percentOfCents(cents, percent) {
  return roundCents((cents * percent) / 100);
}

// Formats an integer cents amount as a decimal euro string for places that
// need it as a plain number (never used for further arithmetic).
export function centsToMajor(cents) {
  return Math.round(cents) / 100;
}

export function majorToCents(amount) {
  return Math.round(Number(amount) * 100);
}

// ---- Nightly-price rounding (explicit, limited approval — see README/
// vervolgopdracht "Werkelijke nachtprijzen afronden naar dichtstbijzijnde
// veelvoud van 5 euro") --------------------------------------------------
//
// Rounds a per-NIGHT rental price to the nearest whole €5 (500 cents).
// Deliberately narrow: this is applied ONLY to the nightly rental rate
// itself, at the single point calculateQuote() reads a night's rate from
// admin-entered rates (see _lib/pricing.mjs) — never to linen, cleaning,
// tourist tax, the deposit, or any already-summed total, and never a
// second time on an already-rounded amount.
//
// Rule: round to the nearest multiple of €5; a price exactly halfway
// between two multiples (…,50 within the €5 step — e.g. €322,50 or
// €327,50) rounds UP, by explicit convention. Examples:
//   €321,43 -> €320,00   €322,49 -> €320,00   €322,50 -> €325,00
//   €322,51 -> €325,00   €327,49 -> €325,00   €327,50 -> €330,00
//   €327,51 -> €330,00
//
// Implemented with pure integer arithmetic (never a float division), so
// there is no floating-point ambiguity at the exact halfway point.
const NIGHTLY_ROUNDING_UNIT_CENTS = 500; // €5

export function roundNightlyPriceCents(cents) {
  const remainder = cents % NIGHTLY_ROUNDING_UNIT_CENTS;
  const base = cents - remainder;
  const rounded = remainder >= NIGHTLY_ROUNDING_UNIT_CENTS / 2 ? base + NIGHTLY_ROUNDING_UNIT_CENTS : base;
  // Safety clamp: a genuinely tiny raw price (under €2.50) would otherwise
  // round down to €0, silently making a priced night free. Never intended —
  // floor the rounded result at one full €5 unit whenever the raw price was
  // actually positive. Irrelevant at this property's real price levels
  // (hundreds of euros/night); kept as a defensive guard, not a live case.
  return rounded <= 0 && cents > 0 ? NIGHTLY_ROUNDING_UNIT_CENTS : rounded;
}
