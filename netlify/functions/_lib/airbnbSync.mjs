// The actual Airbnb-calendar-fetch-and-store logic, extracted so it can be
// called both by the scheduled function (sync-airbnb.mjs, every 3 hours) and
// by an admin-triggered manual sync (admin-sync-airbnb.mjs — Netlify returns
// 403 if you try to invoke a scheduled function directly, so "Sync now" in
// /admin needs its own endpoint that does the same work on demand).
import ical from "node-ical";
import { setAirbnbBusyNights, setAirbnbSyncError } from "./store.mjs";
import { toISODate } from "./dates.mjs";

/**
 * @returns {Promise<{ok: true, nightCount: number, eventCount: number} | {ok: false, error: string}>}
 */
export async function runAirbnbSync() {
  const url = process.env.AIRBNB_ICAL_URL;
  if (!url) {
    return { ok: false, error: "AIRBNB_ICAL_URL is niet ingesteld." };
  }

  try {
    const events = await ical.async.fromURL(url);
    const nights = new Set();

    for (const key of Object.keys(events)) {
      const ev = events[key];
      if (ev.type !== "VEVENT" || !ev.start || !ev.end) continue;
      // Airbnb's export marks each booked/blocked stay as one VEVENT spanning
      // check-in (start) to check-out (end) — walk every night in between.
      let cur = new Date(Date.UTC(ev.start.getFullYear(), ev.start.getMonth(), ev.start.getDate()));
      const end = new Date(Date.UTC(ev.end.getFullYear(), ev.end.getMonth(), ev.end.getDate()));
      while (cur < end) {
        nights.add(toISODate(cur));
        cur = new Date(cur.getTime() + 86400000);
      }
    }

    const nightsList = Array.from(nights).sort();
    const eventCount = Object.keys(events).length;
    await setAirbnbBusyNights(nightsList, { source: "airbnb", eventCount });
    return { ok: true, nightCount: nightsList.length, eventCount };
  } catch (e) {
    await setAirbnbSyncError(e.message);
    return { ok: false, error: e.message };
  }
}
