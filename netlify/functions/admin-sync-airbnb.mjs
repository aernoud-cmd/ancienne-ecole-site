// POST /.netlify/functions/admin-sync-airbnb — the "Nu synchroniseren" button
// on /admin. Netlify refuses to let anything invoke a *scheduled* function
// (sync-airbnb.mjs) directly over HTTP (403), so a manual on-demand sync
// needs its own plain endpoint. Requires a valid admin session, same as
// every other admin-* endpoint — this is not a public way to hammer the
// owner's Airbnb export.
import { hasValidAdminSession, adminUnauthorizedResponse } from "./_lib/adminAuth.mjs";
import { runAirbnbSync } from "./_lib/airbnbSync.mjs";

export default async (req) => {
  if (!hasValidAdminSession(req)) return adminUnauthorizedResponse();
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const result = await runAirbnbSync();
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 502,
    headers: { "content-type": "application/json" },
  });
};

export const config = {
  path: "/.netlify/functions/admin-sync-airbnb",
};
