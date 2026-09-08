// Scheduled function — runs automatically every 3 hours (see `config` below).
// Fetches the owner's Airbnb calendar export (AIRBNB_ICAL_URL, set as a
// Netlify environment variable) and stores the list of booked nights, so the
// public availability endpoint and the reserve-page calendar can block them.
// A failed fetch never wipes out the last-known-good list — it's better to
// keep working from slightly-stale data than to suddenly show everything as
// free — but it DOES record the failure, surfaced on /admin, so it doesn't
// go unnoticed. See _lib/store.mjs setAirbnbSyncError().
//
// The actual fetch/parse/store logic lives in _lib/airbnbSync.mjs so the
// admin "Sync now" button (admin-sync-airbnb.mjs) can trigger the exact same
// work on demand — Netlify rejects a direct HTTP call to a scheduled
// function (403), so that button needs its own non-scheduled endpoint.
import { runAirbnbSync } from "./_lib/airbnbSync.mjs";

export default async () => {
  const result = await runAirbnbSync();
  if (!result.ok) {
    console.error("sync-airbnb failed:", result.error);
    return new Response(JSON.stringify(result), { status: 500, headers: { "content-type": "application/json" } });
  }
  console.log(`sync-airbnb: stored ${result.nightCount} busy nights from ${result.eventCount} calendar entries.`);
  return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
};

export const config = {
  schedule: "0 */3 * * *", // every 3 hours
};
