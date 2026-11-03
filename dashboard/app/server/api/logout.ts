/**
 * Nitro server route: POST /api/logout
 * Forwards the session cookie to the internal API to invalidate it there,
 * and relays the cookie-clearing Set-Cookie header back to the browser.
 */
import { defineEventHandler, createError, getHeader, setHeader, setResponseStatus } from "h3";

export default defineEventHandler(async (event) => {
  const base = process.env.API_INTERNAL_URL?.replace(/\/$/, "") ?? "http://api:8000";
  const cookie = getHeader(event, "cookie");
  setHeader(event, "Cache-Control", "no-store, private");

  let response: Response;
  try {
    response = await fetch(`${base}/api/logout`, {
      method: "POST",
      headers: cookie ? { Cookie: cookie } : undefined,
    });
  } catch (err) {
    console.error("[proxy /api/logout] fetch failed:", err);
    throw createError({ statusCode: 502, statusMessage: "Bad Gateway" });
  }

  const setCookie = response.headers.get("set-cookie");
  if (setCookie) setHeader(event, "Set-Cookie", setCookie);
  setResponseStatus(event, response.status);
  return await response.json().catch(() => ({}));
});
