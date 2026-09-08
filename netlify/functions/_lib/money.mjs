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
