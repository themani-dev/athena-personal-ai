/**
 * Nitro server route: /api/dashboard
 *
 * Proxies the request to the internal API container at
 * process.env.API_INTERNAL_URL (set to http://daily-dashboard-api:8000
 * in the Docker container, or http://api:8000 when started via
 * docker-compose). Falls back to http://api:8000 if the env var is absent.
 *
 * This keeps the browser-side fetch URL unchanged ("/api/dashboard") while
 * letting the production Nitro server forward the request server-side.
 *
 * Auth note: the session cookie lives on the browser <-> frontend hop. This
 * route forwards the incoming Cookie header to the upstream API (which owns
 * the session store) and relays the upstream status code back untouched —
 * so a missing/expired session cookie yields a real 401 with no data, not a
 * 200 from a cache or a swallowed error.
 */
import { defineEventHandler, createError, getHeader, setHeader, setResponseStatus } from "h3";

export default defineEventHandler(async (event) => {
  const base = process.env.API_INTERNAL_URL?.replace(/\/$/, "") ?? "http://api:8000";
  const url = `${base}/api/dashboard`;
  const cookie = getHeader(event, "cookie");

  let response: Response;
  try {
    response = await fetch(url, {
      headers: cookie ? { Cookie: cookie } : undefined,
    });
  } catch (err) {
    console.error("[proxy /api/dashboard] fetch failed:", err);
    throw createError({
      statusCode: 502,
      statusMessage: "Bad Gateway",
      message: `API proxy failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // Set Cache-Control before setResponseStatus/return (not before `throw
  // createError`, which replaces the response and drops headers set on the
  // event) so it survives on both the 200 and the relayed-401/err paths.
  setHeader(event, "Cache-Control", "no-store, private");
  const data: unknown = await response.json().catch(() => ({}));

  if (!response.ok) {
    setResponseStatus(event, response.status, response.statusText);
    return data;
  }

  return data;
});
