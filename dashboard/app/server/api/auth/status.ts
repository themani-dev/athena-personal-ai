/**
 * Nitro server route: GET /api/auth/status
 * Lets the frontend check "am I logged in?" without touching any health
 * data. Always 200; never caches.
 */
import { defineEventHandler, getHeader, setHeader } from "h3";

export default defineEventHandler(async (event) => {
  const base = process.env.API_INTERNAL_URL?.replace(/\/$/, "") ?? "http://api:8000";
  const cookie = getHeader(event, "cookie");
  setHeader(event, "Cache-Control", "no-store, private");

  try {
    const response = await fetch(`${base}/api/auth/status`, {
      headers: cookie ? { Cookie: cookie } : undefined,
    });
    if (!response.ok) return { authenticated: false };
    return await response.json();
  } catch (err) {
    console.error("[proxy /api/auth/status] fetch failed:", err);
    return { authenticated: false };
  }
});
