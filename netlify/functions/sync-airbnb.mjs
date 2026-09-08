// Scheduled function — runs automatically every 3 hours (see `config` below).
// Fetches the owner's Airbnb calendar export (AIRBNB_ICAL_URL, set as a
// Netlify environment variable) and stores the list of booked nights, so the
// public availability endpoint and the reserve-page calendar can block them.
// A failed fetch never wipes out the last-known-good list — it's better to
// keep working from slightly-stale data than to suddenly show everything as
// free — but it DOES record the failure, surfaced on /admin, so it doesn't
// go unnoticed. See _lib/store.mjs setAirbnbSyncError().
import ical from "node-ical";
import { setAirbnbBusyNights, setAirbnbSyncError } from "./_lib/store.mjs";
import { toISODate } from "./_lib/dates.mjs";

export default async () => {
  const url = process.env.AIRBNB_ICAL_URL;
  if (!url) {
    console.warn("sync-airbnb: AIRBNB_ICAL_URL is not set — skipping sync.");
    return new Response("AIRBNB_ICAL_URL not set", { status: 200 });
  }

  try {
    const events = await ical.async.fromURL(url);
    const nights = new Set();

    for (const key of Object.keys(events)) {
      const ev = events[key];
      if (ev.type !== "VEVENT" || !ev.start || !ev.end) continue;
      // Airbnb's export marks each booked stay as one VEVENT spanning
      // check-in (start) to check-out (end) — walk every night in between.
      let cur = new Date(Date.UTC(ev.start.getFullYear(), ev.start.getMonth(), ev.start.getDate()));
      const end = new Date(Date.UTC(ev.end.getFullYear(), ev.end.getMonth(), ev.end.getDate()));
      while (cur < end) {
        nights.add(toISODate(cur));
        cur = new Date(cur.getTime() + 86400000);
      }
    }

    const nightsList = Array.from(nights).sort();
    await setAirbnbBusyNights(nightsList, { source: "airbnb", eventCount: Object.keys(events).length });
    console.log(`sync-airbnb: stored ${nightsList.length} busy nights from ${Object.keys(events).length} calendar entries.`);
    return new Response(JSON.stringify({ ok: true, nights: nightsList.length }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    console.error("sync-airbnb failed:", e);
    await setAirbnbSyncError(e.message);
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config = {
  schedule: "0 */3 * * *", // every 3 hours
};
