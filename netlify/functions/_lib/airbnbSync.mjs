// Keep the existing scheduled/manual endpoint names for deployment compatibility.
import ical from "node-ical";
import { CALENDAR_SOURCES, saveCalendarSnapshot, saveCalendarError } from "./store.mjs";

export function parseCalendarNights(text) {
  if (!/^BEGIN:VCALENDAR\s*$/m.test(text) || !/^END:VCALENDAR\s*$/m.test(text)) {
    throw new Error("Invalid calendar");
  }
  const events = ical.sync.parseICS(text);
  const nights = new Set();
  let eventCount = 0;
  for (const event of Object.values(events)) {
    if (event.type !== "VEVENT" || event.status === "CANCELLED") continue;
    // These OTA feeds use date ranges, not recurring events. Refuse an
    // unsupported response rather than silently losing its blocked nights.
    if (event.rrule || !event.start || !event.end) throw new Error("Unsupported event");
    const day = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    const start = day(event.start), end = day(event.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end-start > 3660*86400000) throw new Error("Invalid event range");
    eventCount++;
    for (let date = start; date < end; date += 86400000) nights.add(new Date(date).toISOString().slice(0,10));
  }
  return { nights: [...nights].sort(), eventCount };
}

export async function runAirbnbSync({ env = process.env, fetcher = fetch, save = saveCalendarSnapshot, fail = saveCalendarError } = {}) {
  const configured = CALENDAR_SOURCES.filter(source => env[`${source.toUpperCase()}_ICAL_URL`]);
  if (!configured.length) return { ok: false, error: "Er zijn geen kalenderkoppelingen ingesteld." };
  const sources = await Promise.all(configured.map(async source => {
    try {
      const url = new URL(env[`${source.toUpperCase()}_ICAL_URL`]);
      if (url.protocol !== "https:") throw new Error("HTTPS required");
      const response = await fetcher(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error("Calendar request failed");
      const { nights, eventCount } = parseCalendarNights(await response.text());
      await save(source, nights, eventCount);
      return { source, ok: true, nights, eventCount };
    } catch {
      // Never expose private feed URLs/tokens in the admin or function logs.
      const error = "Kalender kon niet worden opgehaald of verwerkt; bestaande blokkades blijven behouden.";
      await fail(source, error);
      return { source, ok: false, error };
    }
  }));
  const ok = sources.every(source => source.ok);
  return { ok, nightCount: new Set(sources.flatMap(source => source.nights || [])).size,
    eventCount: sources.reduce((n, source) => n + (source.eventCount || 0), 0),
    sources: sources.map(({ nights, ...source }) => ({ ...source, nightCount: nights?.length })),
    ...(ok ? {} : { error: "Een of meer kalenderkoppelingen zijn niet ververst. Zie de status per platform." }) };
}
