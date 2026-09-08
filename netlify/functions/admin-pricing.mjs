// GET/POST /.netlify/functions/admin-pricing — the data endpoint behind the
// /admin pricing calendar. Requires a valid admin session on every call
// (see _lib/adminAuth.mjs) — this is the actual security boundary, not the
// /admin page's URL.
//
// GET  -> { ok, settings, rates }                (rates: full map, sparse)
// POST -> { settingsPatch?, ratesPatch? } -> applies changes, returns the
//         updated settings/rates plus `changedDates` (what actually changed,
//         for the "here's what's about to be saved" confirmation) and
//         `rejected` (any date the change was refused for, with why).
//
// Saved changes apply to new quotes immediately — no redeploy needed —
// because quote.mjs/book.mjs read this same Blobs data on every request.
// A booking already made stores its own price snapshot (see book.mjs) so
// this never silently changes what an existing request already shows a guest.
import { isValidISODate } from "./_lib/dates.mjs";
import { getPricingSettings, savePricingSettings, getAllRates, patchRates, getAirbnbSyncMeta } from "./_lib/store.mjs";
import { mergeWithDefaults } from "./_lib/pricingDefaults.mjs";
import { hasValidAdminSession, adminUnauthorizedResponse } from "./_lib/adminAuth.mjs";
import { computeAvailability } from "./_lib/availability.mjs";
import { hoursSince } from "./_lib/dates.mjs";

export default async (req) => {
  if (!hasValidAdminSession(req)) return adminUnauthorizedResponse();

  if (req.method === "GET") {
    const [settings, rates] = await Promise.all([getPricingSettings({ strong: true }), getAllRates({ strong: true })]);
    const { airbnbNights, confirmedNights, pendingNights, ownBlockedNights } = await computeAvailability(settings, { strong: true });
    // Each busy night gets ONE source label. Priority (highest first):
    // "direct" > "requested" > "airbnb" > "blocked". A night you confirmed
    // directly will also show up in your own Airbnb export once Airbnb has
    // imported confirmed.ics back, and this is what keeps the admin calendar
    // from double-labeling that as a separate Airbnb booking (see README
    // "Avoiding an import loop"). An owner-blocked night that's also part of
    // a real booking should show as that booking, not as a generic block —
    // hence "blocked" is applied first and can be overwritten by the others.
    const nightSources = {};
    for (const n of ownBlockedNights) nightSources[n] = "blocked";
    for (const n of airbnbNights) nightSources[n] = "airbnb";
    for (const n of pendingNights) nightSources[n] = "requested";
    for (const n of confirmedNights) nightSources[n] = "direct";
    const syncMeta = await getAirbnbSyncMeta();
    return json({
      ok: true,
      settings,
      rates,
      nightSources,
      airbnbSync: syncMeta
        ? {
            syncedAt: syncMeta.syncedAt, // last SUCCESSFUL sync
            hoursAgo: syncMeta.syncedAt ? Math.round(hoursSince(syncMeta.syncedAt) * 10) / 10 : null,
            lastAttemptAt: syncMeta.lastAttemptAt || syncMeta.syncedAt || null, // last attempt of any kind
            attemptHoursAgo: syncMeta.lastAttemptAt ? Math.round(hoursSince(syncMeta.lastAttemptAt) * 10) / 10 : null,
            nightCount: syncMeta.nights?.length ?? 0,
            lastError: syncMeta.lastError || null,
            lastErrorAt: syncMeta.lastErrorAt || null,
          }
        : null,
      // Surfaced as a small badge on /admin so it's obvious, without a hard
      // refresh, which deploy is actually live — see netlify.toml/README
      // "Cache busting". Netlify sets these automatically at build/runtime;
      // both are null when running `netlify dev` locally. Netlify Functions
      // v2 (this file uses the v2 `export default` signature) don't reliably
      // forward deploy-metadata env vars onto Node's plain `process.env` the
      // way v1 did — the documented v2 way to read them is the `Netlify`
      // global injected into every v2 function's scope. Try that first and
      // fall back to `process.env` so this also still works if a future
      // Netlify runtime change reverses that.
      buildInfo: {
        commit:
          (typeof Netlify !== "undefined" && Netlify.env && Netlify.env.get("COMMIT_REF")) ||
          process.env.COMMIT_REF ||
          null,
        deployId:
          (typeof Netlify !== "undefined" && Netlify.env && Netlify.env.get("DEPLOY_ID")) ||
          process.env.DEPLOY_ID ||
          null,
      },
    });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON body" }, 400);
    }

    const rejected = [];
    let updatedSettings = await getPricingSettings({ strong: true });

    if (body.settingsPatch) {
      const { value, errors } = validateSettingsPatch(body.settingsPatch, updatedSettings);
      if (errors.length) return json({ ok: false, error: "Invalid settings", details: errors }, 400);
      updatedSettings = value;
      await savePricingSettings(updatedSettings);
    }

    let ratesResult = { rates: await getAllRates({ strong: true }), changed: [] };
    if (body.ratesPatch) {
      const cleanPatch = {};
      for (const [date, fields] of Object.entries(body.ratesPatch)) {
        if (!isValidISODate(date)) {
          rejected.push({ date, reason: "Invalid date" });
          continue;
        }
        const clean = {};
        if ("priceCents" in fields) {
          if (fields.priceCents === null) {
            clean.priceCents = null; // explicit clear = "not bookable"
          } else if (!Number.isInteger(fields.priceCents) || fields.priceCents <= 0) {
            rejected.push({ date, reason: "Price must be a positive whole number of cents" });
            continue;
          } else {
            clean.priceCents = fields.priceCents;
          }
        }
        if ("minNights" in fields) {
          if (fields.minNights === null) {
            clean.minNights = null;
          } else if (!Number.isInteger(fields.minNights) || fields.minNights <= 0) {
            rejected.push({ date, reason: "Minimum stay must be a positive whole number of nights" });
            continue;
          } else {
            clean.minNights = fields.minNights;
          }
        }
        if ("blocked" in fields) {
          if (typeof fields.blocked !== "boolean") {
            rejected.push({ date, reason: "blocked must be true or false" });
            continue;
          }
          clean.blocked = fields.blocked;
        }
        if ("allowedArrivalWeekdays" in fields) {
          const w = fields.allowedArrivalWeekdays;
          if (w !== null && (!Array.isArray(w) || !w.every((n) => Number.isInteger(n) && n >= 1 && n <= 7))) {
            rejected.push({ date, reason: "allowedArrivalWeekdays must be null or an array of 1–7" });
            continue;
          }
          // null = "use the site-wide setting" (this is the arrival date's
          // own per-period override, not a change to that site-wide setting).
          clean.allowedArrivalWeekdays = w;
        }
        if (Object.keys(clean).length) cleanPatch[date] = clean;
      }
      if (Object.keys(cleanPatch).length) {
        ratesResult = await patchRates(cleanPatch);
      }
    }

    return json({
      ok: true,
      settings: updatedSettings,
      rates: ratesResult.rates,
      changedDates: ratesResult.changed,
      rejected,
    });
  }

  return new Response("Method not allowed", { status: 405 });
};

// Exported (in addition to being used internally above) so it can be unit
// tested directly — see test/adminPricing.test.mjs — without needing a live
// Netlify Blobs context or a real HTTP request.
export function validateSettingsPatch(patch, current) {
  const errors = [];
  const next = mergeWithDefaults({ ...current, ...patch });

  const isPercent = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
  const isPosInt = (v) => Number.isInteger(v) && v >= 0;

  if (patch.weekDiscount) {
    next.weekDiscount = { ...current.weekDiscount, ...patch.weekDiscount };
    if (typeof next.weekDiscount.enabled !== "boolean") errors.push("weekDiscount.enabled must be true/false");
    if (!Number.isInteger(next.weekDiscount.minNights) || next.weekDiscount.minNights < 1)
      errors.push("weekDiscount.minNights must be a whole number ≥ 1");
    if (!isPercent(next.weekDiscount.percent)) errors.push("weekDiscount.percent must be 0–100");
  }
  if (patch.monthDiscount) {
    next.monthDiscount = { ...current.monthDiscount, ...patch.monthDiscount };
    if (typeof next.monthDiscount.enabled !== "boolean") errors.push("monthDiscount.enabled must be true/false");
    if (!Number.isInteger(next.monthDiscount.minNights) || next.monthDiscount.minNights < 1)
      errors.push("monthDiscount.minNights must be a whole number ≥ 1");
    if (!isPercent(next.monthDiscount.percent)) errors.push("monthDiscount.percent must be 0–100");
  }
  if (patch.linenFeeMode && !["per_booking", "per_week"].includes(patch.linenFeeMode)) {
    errors.push("linenFeeMode must be per_booking or per_week");
  }
  if ("linenFeePerPersonCents" in patch && !isPosInt(patch.linenFeePerPersonCents)) {
    errors.push("linenFeePerPersonCents must be a whole number ≥ 0");
  }
  if ("cleaningFeeCents" in patch && !isPosInt(patch.cleaningFeeCents)) {
    errors.push("cleaningFeeCents must be a whole number ≥ 0");
  }
  if (patch.touristTax) {
    next.touristTax = { ...current.touristTax, ...patch.touristTax };
    const t = next.touristTax;
    if (!["percentage", "fixed_per_person_per_night"].includes(t.mode)) errors.push("touristTax.mode invalid");
    if (!isPercent(t.ratePercent)) errors.push("touristTax.ratePercent must be 0–100");
    if (t.capCentsPerNight !== null && !isPosInt(t.capCentsPerNight)) errors.push("touristTax.capCentsPerNight must be ≥ 0 or null");
    if (!isPosInt(t.fixedAmountCents)) errors.push("touristTax.fixedAmountCents must be ≥ 0");
    if (!Number.isInteger(t.minAge) || t.minAge < 0) errors.push("touristTax.minAge must be ≥ 0");
    if (!isPercent(t.departmentalSurchargePercent)) errors.push("touristTax.departmentalSurchargePercent must be 0–100");
  }
  if ("depositCents" in patch && !isPosInt(patch.depositCents)) {
    errors.push("depositCents must be a whole number ≥ 0");
  }
  if (patch.capacity) {
    next.capacity = { ...current.capacity, ...patch.capacity };
    const c = next.capacity;
    if (!Number.isInteger(c.maxAdults) || c.maxAdults < 1) errors.push("capacity.maxAdults must be a whole number ≥ 1");
    if (!Number.isInteger(c.maxChildren) || c.maxChildren < 0) errors.push("capacity.maxChildren must be a whole number ≥ 0");
    if (!Number.isInteger(c.maxTotalGuests) || c.maxTotalGuests < 1) errors.push("capacity.maxTotalGuests must be a whole number ≥ 1");
    if (c.maxTotalGuests > c.maxAdults + c.maxChildren) errors.push("capacity.maxTotalGuests can't exceed maxAdults + maxChildren");
    if (!Number.isInteger(c.childMaxAge) || c.childMaxAge < 0) errors.push("capacity.childMaxAge must be a whole number ≥ 0");
  }
  if ("defaultMinNights" in patch && (!Number.isInteger(patch.defaultMinNights) || patch.defaultMinNights < 1)) {
    errors.push("defaultMinNights must be a whole number ≥ 1");
  }
  if ("allowedArrivalWeekdays" in patch) {
    const w = patch.allowedArrivalWeekdays;
    if (w !== null && (!Array.isArray(w) || !w.every((n) => Number.isInteger(n) && n >= 1 && n <= 7))) {
      errors.push("allowedArrivalWeekdays must be null or an array of 1–7");
    }
  }
  if ("pendingRequestExpiryHours" in patch && (!Number.isInteger(patch.pendingRequestExpiryHours) || patch.pendingRequestExpiryHours < 1)) {
    errors.push("pendingRequestExpiryHours must be a whole number ≥ 1");
  }
  if ("unpaidApprovedExpiryHours" in patch && (!Number.isInteger(patch.unpaidApprovedExpiryHours) || patch.unpaidApprovedExpiryHours < 1)) {
    errors.push("unpaidApprovedExpiryHours must be a whole number ≥ 1");
  }

  return { value: next, errors };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

export const config = {
  path: "/.netlify/functions/admin-pricing",
};
