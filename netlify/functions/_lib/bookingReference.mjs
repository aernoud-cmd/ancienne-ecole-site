// Human-readable reference; internal UUIDs remain the keys for all actions.
export function referenceBase(b) {
  const [y, m, d] = b.checkin.split('-');
  return `AE${d}${m}${y.slice(-2)}${b.nights}`;
}
function letters(n) {
  let s = '';
  do { s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}
export function nextReference(b, bookings) {
  const base = referenceBase(b);
  const used = new Set(bookings.map(x => x.reference));
  let n = 0;
  while (used.has(base + letters(n))) n++;
  return base + letters(n);
}
export function withReferences(bookings) {
  const result = bookings.map(b => ({...b}));
  // Reserve saved codes first; cancelled/expired bookings keep their letters.
  const used = result.filter(b => b.reference);
  const legacy = result.filter(b => !b.reference).sort((a,b) =>
    String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.id.localeCompare(b.id));
  for (const b of legacy) {
    b.reference = nextReference(b, used);
    used.push(b);
  }
  return result;
}
