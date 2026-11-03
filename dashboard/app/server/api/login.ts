/**
 * Nitro server route: POST /api/login
 * Forwards credentials to the internal API (which owns the session store and
 * the rate-limit/lockout counters) and relays its Set-Cookie + status back
 * to the browser untouched. Never logs the request body.
 */
import { defineEventHandler, createError, readBody, setHeader, setResponseStatus } from "h3";

export default defineEventHandler(async (event) => {
  const base = process.env.API_INTERNAL_URL?.replace(/\/$/, "") ?? "http://api:8000";
  const body = await readBody<{ username?: string; password?: string }>(event).catch(() => ({}));

  setHeader(event, "Cache-Control", "no-store, private");

  let response: Response;
  try {
    response = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: body?.username ?? "", password: body?.password ?? "" }),
    });
  } catch (err) {
    console.error("[proxy /api/login] fetch failed:", err);
    throw createError({ statusCode: 502, statusMessage: "Bad Gateway" });
  }

  const setCookie = response.headers.get("set-cookie");
  if (setCookie) setHeader(event, "Set-Cookie", setCookie);

  setResponseStatus(event, response.status);
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) setHeader(event, "Retry-After", retryAfter);

  return await response.json().catch(() => ({}));
});
