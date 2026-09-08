// POST /.netlify/functions/admin-login  { username, password }
// Verifies the owner's credentials (set as ADMIN_USERNAME / ADMIN_PASSWORD
// in Netlify's environment variables) and, on success, sets a signed,
// httpOnly session cookie used by every other /admin-* endpoint.
import { verifyCredentials, createSessionCookie, checkLoginThrottle, recordFailedLogin, clearLoginThrottle } from "./_lib/adminAuth.mjs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const throttle = await checkLoginThrottle();
  if (throttle.locked) {
    return json({ ok: false, error: `Too many attempts. Try again in about ${throttle.retryAfterMinutes} minute(s).` }, 429);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid request" }, 400);
  }

  let valid = false;
  try {
    valid = verifyCredentials(body.username, body.password);
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }

  if (!valid) {
    await recordFailedLogin();
    return json({ ok: false, error: "Incorrect username or password." }, 401);
  }

  await clearLoginThrottle();
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": createSessionCookie(),
    },
  });
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

export const config = {
  path: "/.netlify/functions/admin-login",
};
