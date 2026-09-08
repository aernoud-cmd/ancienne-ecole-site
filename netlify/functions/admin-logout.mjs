// POST /.netlify/functions/admin-logout — clears the admin session cookie.
import { clearSessionCookie } from "./_lib/adminAuth.mjs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": clearSessionCookie(),
    },
  });
};

export const config = {
  path: "/.netlify/functions/admin-logout",
};
