// Thin wrapper around Netlify Blobs — the small built-in key/value store we
// use instead of a separate database. Three logical stores:
//   "bookings"   — one JSON object per booking request, keyed by its id
//   "calendar"   — cached busy-date data: the Airbnb feed (from the scheduled
//                  sync) and the list of confirmed direct bookings
import { getStore } from "@netlify/blobs";

export function bookingsStore() {
  return getStore("bookings");
}

export function calendarStore() {
  return getStore("calendar");
}

export async function getBooking(id) {
  const store = bookingsStore();
  return store.get(id, { type: "json" });
}

export async function saveBooking(id, data) {
  const store = bookingsStore();
  await store.setJSON(id, data);
}

export async function listBookings() {
  const store = bookingsStore();
  const { blobs } = await store.list();
  const all = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  return all.filter(Boolean);
}

export async function getAirbnbBusyNights() {
  const store = calendarStore();
  const data = await store.get("airbnb-busy-nights", { type: "json" });
  return data?.nights ?? [];
}

export async function setAirbnbBusyNights(nights, sourceMeta) {
  const store = calendarStore();
  await store.setJSON("airbnb-busy-nights", {
    nights,
    syncedAt: new Date().toISOString(),
    ...sourceMeta,
  });
}
