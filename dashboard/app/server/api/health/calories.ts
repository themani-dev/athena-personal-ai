/**
 * Nitro server route: GET /api/health/calories
 * Proxies to the internal API, forwarding the session cookie and the full
 * query string (from/to). Relays 401s untouched.
 */
import {
  defineEventHandler,
  createError,
  getHeader,
  getRequestURL,
  setHeader,
  setResponseStatus,
} from "h3";

export default defineEventHandler(async (event) => {
  const base = process.env.API_INTERNAL_URL?.replace(/\/$/, "") ?? "http://api:8000";
  const cookie = getHeader(event, "cookie");
  const search = getRequestURL(event).search;

  let response: Response;
  try {
    response = await fetch(`${base}/api/health/calories${search}`, {
      headers: cookie ? { Cookie: cookie } : undefined,
    });
  } catch (err) {
    console.error("[proxy /api/health/calories] fetch failed:", err);
    throw createError({ statusCode: 502, statusMessage: "Bad Gateway" });
  }

  setHeader(event, "Cache-Control", "no-store, private");
  const data: unknown = await response.json().catch(() => ({}));

  if (!response.ok) {
    setResponseStatus(event, response.status, response.statusText);
    return data;
  }

  return data;
});
