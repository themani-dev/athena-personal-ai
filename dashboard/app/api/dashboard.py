#!/usr/bin/env python3
"""
Athena Dashboard Data API
-------------------------
Reads real data from:
  - Athena's SQLite DB  (WHOOP health, Hevy workouts, food/water logs)
  - Horus's Google Calendar token (upcoming events)
  - Horus's Gmail token (email triage summary)

Outputs a single JSON payload consumed by the dashboard frontend.

Usage (dev):
  python3 api/dashboard.py          → prints JSON to stdout
  python3 api/dashboard.py --serve  → runs a tiny HTTP server on PORT (default 5175)

The frontend calls GET /api/dashboard during dev (proxied by Vite)
and via a TanStack Start server function in production.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

# ─── Paths ────────────────────────────────────────────────────────────────────
# Defaults are the local dev paths; override via env vars for Docker deployment.

ATHENA_DB = Path(os.environ.get(
    "ATHENA_DB",
    "/path/to/personal-ai-os/agents/athena/tracking/athena.db"
))
GOOGLE_TOKEN = Path(os.environ.get(
    "GOOGLE_TOKEN",
    "/path/to/personal-ai-os/agents/horus/google_token.json"
))
GOOGLE_SECRET = Path(os.environ.get(
    "GOOGLE_SECRET",
    "/path/to/personal-ai-os/agents/horus/google_client_secret.json"
))

# Credential record (username + scrypt hash) created by scripts/create_credentials.py.
# Never generated or edited by this file — read-only here. Defaults to a dev path
# outside the repo; Docker deployment overrides via env (bind-mounted, read-only).
AUTH_CREDENTIALS = Path(os.environ.get(
    "AUTH_CREDENTIALS",
    str(Path.home() / ".config" / "athena-dashboard" / "credentials.env")
))


# ─── Auth: sessions, rate limiting, credential verification ───────────────────
# Single-user app login. Sessions and lockout counters are kept in-process memory
# only — acceptable because _serve() runs a single-threaded http.server.HTTPServer
# (one request handled at a time, no cross-request races) and sessions are
# short-lived. A process restart invalidates all sessions and lockouts, which is
# an accepted trade-off for a personal dashboard (documented in the build report).

SESSION_COOKIE_NAME = "athena_session"
SESSION_TTL_SECONDS = int(os.environ.get("SESSION_TTL_SECONDS", str(12 * 3600)))  # 12h
MAX_LOGIN_ATTEMPTS = int(os.environ.get("MAX_LOGIN_ATTEMPTS", "5"))
LOGIN_LOCKOUT_SECONDS = int(os.environ.get("LOGIN_LOCKOUT_SECONDS", "900"))  # 15 min

_SESSIONS: dict[str, dict[str, Any]] = {}      # token -> {"username": ..., "expires": epoch}
_LOGIN_FAILS: dict[str, dict[str, Any]] = {}   # "user|ip" -> {"count": int, "locked_until": epoch|None}


def _load_credentials() -> dict[str, str] | None:
    """Read the username/scrypt-hash record. Returns None if unset/unreadable —
    this makes the API fail CLOSED (no login possible) until the owner runs the
    credential bootstrap script."""
    try:
        text = AUTH_CREDENTIALS.read_text()
    except OSError:
        return None
    rec: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        rec[k.strip()] = v.strip()
    if not {"AUTH_USERNAME", "AUTH_SALT_HEX", "AUTH_HASH_HEX"}.issubset(rec):
        return None
    return rec


def _verify_password(username: str, password: str) -> bool:
    """Constant-time-ish credential check against the stored scrypt hash."""
    rec = _load_credentials()
    if not rec:
        return False
    username_ok = hmac.compare_digest(username.strip().encode(), rec["AUTH_USERNAME"].encode())
    try:
        salt = bytes.fromhex(rec["AUTH_SALT_HEX"])
        expected = bytes.fromhex(rec["AUTH_HASH_HEX"])
        n = int(rec.get("AUTH_SCRYPT_N", "16384"))
        r = int(rec.get("AUTH_SCRYPT_R", "8"))
        p = int(rec.get("AUTH_SCRYPT_P", "1"))
        computed = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=len(expected))
    except Exception:
        return False
    # Always run the scrypt computation (even on a bad username) so failed
    # logins take ~the same time whether or not the username matched.
    password_ok = hmac.compare_digest(computed, expected)
    return username_ok and password_ok


def _new_session(username: str) -> str:
    token = secrets.token_urlsafe(32)
    _SESSIONS[token] = {"username": username, "expires": time.time() + SESSION_TTL_SECONDS}
    return token


def _parse_cookie_header(header: str | None) -> dict[str, str]:
    jar: dict[str, str] = {}
    if not header:
        return jar
    for part in header.split(";"):
        if "=" in part:
            k, _, v = part.strip().partition("=")
            jar[k] = v
    return jar


def _purge_expired_sessions() -> None:
    now = time.time()
    for tok in [t for t, s in _SESSIONS.items() if s["expires"] < now]:
        _SESSIONS.pop(tok, None)


def _session_username(cookie_header: str | None) -> str | None:
    _purge_expired_sessions()
    token = _parse_cookie_header(cookie_header).get(SESSION_COOKIE_NAME)
    if not token:
        return None
    sess = _SESSIONS.get(token)
    if not sess:
        return None
    if sess["expires"] < time.time():
        _SESSIONS.pop(token, None)
        return None
    return sess["username"]


def _invalidate_session(cookie_header: str | None) -> None:
    token = _parse_cookie_header(cookie_header).get(SESSION_COOKIE_NAME)
    if token:
        _SESSIONS.pop(token, None)


def _session_cookie_header(token: str) -> str:
    return (
        f"{SESSION_COOKIE_NAME}={token}; Path=/; HttpOnly; Secure; SameSite=Strict; "
        f"Max-Age={SESSION_TTL_SECONDS}"
    )


def _clear_cookie_header() -> str:
    return f"{SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"


def _login_throttle_key(username: str, addr: str) -> str:
    return f"{username.strip().lower()}|{addr}"


def _is_locked_out(key: str) -> float:
    """Seconds remaining in lockout, or 0.0 if not locked."""
    rec = _LOGIN_FAILS.get(key)
    if not rec or not rec.get("locked_until"):
        return 0.0
    return max(0.0, rec["locked_until"] - time.time())


def _record_login_failure(key: str) -> None:
    rec = _LOGIN_FAILS.setdefault(key, {"count": 0, "locked_until": None})
    rec["count"] += 1
    if rec["count"] >= MAX_LOGIN_ATTEMPTS:
        rec["locked_until"] = time.time() + LOGIN_LOCKOUT_SECONDS
        rec["count"] = 0


def _record_login_success(key: str) -> None:
    _LOGIN_FAILS.pop(key, None)

# Domains that are known recruiter/spam senders — filtered from "needs attention" count
_RECRUITER_DOMAINS = {
    "postjobfree.com", "tanishasys.com", "3bstaffing.com", "cognitek.io",
    "natsoft.us", "synchronycorp.com", "worknovasllc.com", "axelon.com",
    "clifyx.com", "smartjobalert", "staffingagency", "jobalert",
    "email.experteer.com", "email.lifecare-news",
    "steneral.com", "excelonsolutions.com", "quantumworldit.com",
    "tekgence.com", "staffingfirm", "recruiting", "hirequest",
}

_RECRUITER_SUBJECT_KEYWORDS = [
    "urgent hiring", "urgent requirement", "looking for w2", "all visas",
    "opt ead", "job opportunity", "w2 contract", "c2c", "contract role",
    "staffing", "placement", "immediate opening", "job alert",
]


# ─── Google OAuth helpers ──────────────────────────────────────────────────────

def _refresh_google_token() -> str:
    """Return a valid Google access token, refreshing if needed."""
    tok = json.loads(GOOGLE_TOKEN.read_text())
    secret = json.loads(GOOGLE_SECRET.read_text())
    client = secret.get("installed", secret.get("web", {}))

    # Try existing token first
    access = tok.get("token", tok.get("access_token", ""))
    if access:
        probe = urllib.request.Request(
            "https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=" + access
        )
        try:
            with urllib.request.urlopen(probe, timeout=5) as r:
                info = json.loads(r.read())
                if int(info.get("expires_in", 0)) > 60:
                    return access
        except Exception:
            pass

    # Refresh
    data = urllib.parse.urlencode({
        "client_id": client["client_id"],
        "client_secret": client["client_secret"],
        "refresh_token": tok["refresh_token"],
        "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=data)
    with urllib.request.urlopen(req, timeout=15) as r:
        new = json.loads(r.read())
    tok["token"] = new["access_token"]
    tok["access_token"] = new["access_token"]
    GOOGLE_TOKEN.write_text(json.dumps(tok, indent=2))
    return new["access_token"]


def _gcal_events(token: str, max_results: int = 15) -> list[dict]:
    """Fetch upcoming Google Calendar events (today + 7 days)."""
    now = datetime.now(timezone.utc)
    time_min = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    time_max = (now + timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
    url = (
        "https://www.googleapis.com/calendar/v3/calendars/primary/events"
        f"?maxResults={max_results}&orderBy=startTime&singleEvents=true"
        f"&timeMin={time_min}&timeMax={time_max}"
    )
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
    except Exception:
        return []
    events = []
    for ev in data.get("items", []):
        start_raw = ev.get("start", {}).get("dateTime") or ev.get("start", {}).get("date", "")
        end_raw = ev.get("end", {}).get("dateTime") or ev.get("end", {}).get("date", "")
        events.append({
            "id": ev.get("id", ""),
            "title": ev.get("summary", "(No title)"),
            "start": start_raw,
            "end": end_raw,
            "location": ev.get("location", ""),
            "description": ev.get("description", ""),
            "all_day": "dateTime" not in ev.get("start", {}),
        })
    return events


def _is_recruiter(from_header: str, subject: str = "") -> bool:
    """Heuristic: is this sender a recruiter / job-alert bot?"""
    from_lower = from_header.lower()
    subject_lower = subject.lower()
    if any(d in from_lower for d in _RECRUITER_DOMAINS):
        return True
    recruiter_from_keywords = ["recruiter", "staffing", "hiring", "talent", "placement",
                               "jobalert", "smartjobalert", "job alert", "career opportunity"]
    if any(k in from_lower for k in recruiter_from_keywords):
        return True
    if any(k in subject_lower for k in _RECRUITER_SUBJECT_KEYWORDS):
        return True
    return False


def _gmail_summary(token: str) -> dict:
    """
    Return a triage summary of the inbox:
      - total_unread: raw Gmail unread count estimate
      - needs_attention: non-recruiter important unread messages (last 14 days)
      - recent: up to 5 actionable message summaries
    """
    headers = {"Authorization": f"Bearer {token}"}

    def gget(url: str) -> dict:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())

    # Total unread estimate
    total_unread = 0
    try:
        d = gget("https://gmail.googleapis.com/gmail/v1/users/me/messages"
                  "?q=" + urllib.parse.quote("in:inbox is:unread") + "&maxResults=1")
        total_unread = d.get("resultSizeEstimate", 0)
    except Exception:
        pass

    # Fetch up to 20 recent important unread (last 14 days) for filtering
    recent_msgs: list[dict] = []
    try:
        q = urllib.parse.quote("in:inbox is:unread newer_than:14d")
        d = gget(f"https://gmail.googleapis.com/gmail/v1/users/me/messages?q={q}&maxResults=20")
        msg_ids = [m["id"] for m in d.get("messages", [])]
    except Exception:
        msg_ids = []

    needs_attention_count = 0
    for mid in msg_ids:
        try:
            msg = gget(
                f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{mid}"
                "?format=metadata"
                "&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date"
            )
            hdrs = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
            labels = msg.get("labelIds", [])
            from_val = hdrs.get("From", "")
            subject = hdrs.get("Subject", "(no subject)")
            date_val = hdrs.get("Date", "")
            snippet = msg.get("snippet", "")[:120]

            if _is_recruiter(from_val, subject):
                continue  # skip recruiter noise

            needs_attention_count += 1
            if len(recent_msgs) < 5:
                recent_msgs.append({
                    "id": mid,
                    "from": from_val[:60],
                    "subject": subject[:80],
                    "date": date_val,
                    "snippet": snippet,
                    "labels": [l for l in labels if not l.startswith("CATEGORY_")],
                })
        except Exception:
            continue

    return {
        "total_unread": total_unread,
        "needs_attention": needs_attention_count,
        "recent": recent_msgs,
    }


# ─── Athena DB helpers ─────────────────────────────────────────────────────────

def _db_row(conn: sqlite3.Connection, query: str, params: tuple = ()) -> dict | None:
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute(query, params)
    row = c.fetchone()
    return dict(row) if row else None


def _db_rows(conn: sqlite3.Connection, query: str, params: tuple = ()) -> list[dict]:
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute(query, params)
    return [dict(r) for r in c.fetchall()]


def _health_data(conn: sqlite3.Connection) -> dict:
    recovery = _db_row(conn, "SELECT * FROM whoop_recovery ORDER BY date DESC LIMIT 1")
    sleep = _db_row(conn, "SELECT * FROM whoop_sleep WHERE nap=0 ORDER BY start_local DESC LIMIT 1")
    cycle = _db_row(conn, "SELECT * FROM whoop_cycle ORDER BY start_local DESC LIMIT 1")

    # 14-day recovery trend (enough for a mini chart)
    recovery_trend = _db_rows(
        conn,
        "SELECT date, recovery_score FROM whoop_recovery ORDER BY date DESC LIMIT 14"
    )

    # Last WHOOP workout
    last_whoop_workout = _db_row(
        conn, "SELECT * FROM whoop_workout ORDER BY start_local DESC LIMIT 1"
    )

    # Last Hevy workout with per-exercise set detail
    last_hevy = _db_row(
        conn,
        "SELECT h.id, h.start_utc, h.title FROM hevy_workout h ORDER BY h.start_utc DESC LIMIT 1"
    )
    hevy_sets: list[dict] = []
    if last_hevy:
        hevy_sets = _db_rows(
            conn,
            "SELECT exercise, weight_kg, reps, set_type, set_index "
            "FROM hevy_set WHERE workout_id=? ORDER BY set_index",
            (last_hevy["id"],),
        )
        # Dedupe: group sets per exercise, keep first set's weight/reps as representative
        seen: dict[str, dict] = {}
        for s in hevy_sets:
            ex = s["exercise"]
            if ex not in seen:
                seen[ex] = {
                    "exercise": ex,
                    # Convert kg to lbs and round — Hevy stores in kg but weights entered as lbs
                    "weight_lbs": round(s["weight_kg"] * 2.20462) if s["weight_kg"] else None,
                    "reps": s["reps"],
                    "sets": 1,
                }
            else:
                seen[ex]["sets"] += 1
        hevy_sets = list(seen.values())

    # Food & water
    water = _db_row(conn, "SELECT * FROM water_log ORDER BY date DESC LIMIT 1")
    food_today = _db_rows(conn, "SELECT * FROM food_entries ORDER BY date DESC LIMIT 5")

    # Sleep duration (actual sleep = in_bed - awake)
    sleep_hours = None
    if sleep and sleep["in_bed_h"]:
        sleep_hours = round(sleep["in_bed_h"] - sleep["awake_min"] / 60, 1)

    def recovery_label(score):
        if score is None:
            return "Unknown"
        if score >= 67:
            return "Green"
        if score >= 34:
            return "Yellow"
        return "Red"

    def strain_label(strain):
        if strain is None:
            return "Rest"
        if strain >= 18:
            return "All Out"
        if strain >= 14:
            return "Strenuous"
        if strain >= 10:
            return "Moderate"
        return "Light"

    recovery_score = recovery["recovery_score"] if recovery else None
    day_strain = cycle["day_strain"] if cycle else None

    # ── Cross-domain insights ────────────────────────────────────────────────
    # Compute real observations from actual data
    insights = _compute_insights(recovery_trend, last_whoop_workout, sleep, recovery_score)

    return {
        "recovery": {
            "score": round(recovery_score) if recovery_score else None,
            "label": recovery_label(recovery_score),
            "resting_hr": round(recovery["resting_hr"]) if recovery and recovery["resting_hr"] else None,
            "hrv": round(recovery["hrv_rmssd_ms"], 1) if recovery and recovery["hrv_rmssd_ms"] else None,
            "spo2": round(recovery["spo2_pct"], 1) if recovery and recovery["spo2_pct"] else None,
            "date": recovery["date"] if recovery else None,
        },
        "sleep": {
            "hours": sleep_hours,
            "performance_pct": round(sleep["performance_pct"]) if sleep and sleep["performance_pct"] else None,
            "efficiency_pct": round(sleep["efficiency_pct"], 1) if sleep and sleep["efficiency_pct"] else None,
            "disturbances": sleep["disturbances"] if sleep else None,
            "start": sleep["start_local"] if sleep else None,
            "end": sleep["end_local"] if sleep else None,
        },
        "strain": {
            "score": round(day_strain, 1) if day_strain else None,
            "label": strain_label(day_strain),
            "avg_hr": round(cycle["avg_hr"]) if cycle and cycle["avg_hr"] else None,
            "max_hr": round(cycle["max_hr"]) if cycle and cycle["max_hr"] else None,
        },
        "last_workout": {
            "title": last_hevy["title"] if last_hevy else (
                last_whoop_workout["sport"].title() if last_whoop_workout else None
            ),
            "date": last_hevy["start_utc"] if last_hevy else (
                last_whoop_workout["start_local"] if last_whoop_workout else None
            ),
            "sets": hevy_sets,
            "strain": round(last_whoop_workout["strain"], 1) if last_whoop_workout and last_whoop_workout["strain"] else None,
            "kilojoules": round(last_whoop_workout["kilojoule"]) if last_whoop_workout and last_whoop_workout["kilojoule"] else None,
        },
        "recovery_trend": list(reversed(recovery_trend)),  # oldest → newest for charting
        "nutrition": {
            "water_litres": water["litres"] if water else None,
            "meals": [
                {
                    "meal": f["meal"],
                    "description": f["description"],
                    "kcal": f["kcal"],
                    "protein_g": f["protein_g"],
                }
                for f in food_today
            ],
            "total_kcal": sum(f["kcal"] or 0 for f in food_today) or None,
            "total_protein_g": sum(f["protein_g"] or 0 for f in food_today) or None,
        },
        "insights": insights,
    }


def _compute_insights(
    recovery_trend: list[dict],
    last_workout: dict | None,
    sleep: dict | None,
    current_recovery: float | None,
) -> list[dict]:
    """
    Generate real cross-domain observations from actual data.
    Returns list of {type, domain, title, body, label} dicts.
    """
    insights = []

    if len(recovery_trend) >= 2:
        scores = [r["recovery_score"] for r in recovery_trend]  # newest first
        latest = scores[0]
        prev = scores[1]
        delta = latest - prev
        avg_7 = sum(scores[:7]) / min(7, len(scores))
        avg_14 = sum(scores) / len(scores) if len(scores) >= 14 else None

        # Big single-day drop
        if delta <= -20:
            insights.append({
                "type": "observation",
                "domain": "Health",
                "title": f"Recovery dropped {abs(round(delta))} points overnight",
                "body": f"From {round(prev)}% yesterday to {round(latest)}% today. Check sleep quality and last workout load.",
                "label": "warning",
            })
        elif delta >= 20:
            insights.append({
                "type": "observation",
                "domain": "Health",
                "title": f"Recovery jumped {round(delta)} points",
                "body": f"From {round(prev)}% to {round(latest)}% — strong rebound. Good window for a harder session.",
                "label": "good",
            })

        # Sustained low trend
        low_streak = sum(1 for s in scores[:7] if s < 50)
        if low_streak >= 4:
            insights.append({
                "type": "observation",
                "domain": "Health + Training",
                "title": f"Recovery has been below 50% for {low_streak} of the last 7 days",
                "body": "Consistent low recovery may signal accumulated fatigue. Consider a deload or prioritising sleep.",
                "label": "warning",
            })

        # Recovery vs workout load
        if last_workout and last_workout.get("strain") and latest < 50 and last_workout["strain"] > 14:
            insights.append({
                "type": "interpretation",
                "domain": "Health + Training",
                "title": "High workout strain with low recovery today",
                "body": f"Yesterday's strain was {round(last_workout['strain'], 1)}. Current recovery is {round(latest)}%. Today is a good day to keep load light.",
                "label": "warning",
            })

    # Sleep disturbances
    if sleep and sleep.get("disturbances") and sleep["disturbances"] >= 8:
        insights.append({
            "type": "observation",
            "domain": "Sleep",
            "title": f"{sleep['disturbances']} sleep disturbances last night",
            "body": "High disturbances fragment deep sleep. If this is recurring, review late caffeine, screen time, or stress levels.",
            "label": "neutral",
        })

    # Fallback if nothing noteworthy
    if not insights and current_recovery is not None:
        if current_recovery >= 67:
            insights.append({
                "type": "observation",
                "domain": "Health",
                "title": "Recovery is in the green",
                "body": f"{round(current_recovery)}% recovery — body is well-rested. Good day to push harder if scheduled.",
                "label": "good",
            })
        else:
            insights.append({
                "type": "observation",
                "domain": "Health",
                "title": f"Recovery at {round(current_recovery)}% — moderate",
                "body": "Listen to your body today. Moderate intensity is appropriate.",
                "label": "neutral",
            })

    return insights[:3]  # cap at 3 cards


# ─── Main payload builder ──────────────────────────────────────────────────────

def build_payload() -> dict[str, Any]:
    now_local = datetime.now()
    today_str = now_local.strftime("%Y-%m-%d")

    payload: dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "date": today_str,
        "health": {},
        "calendar": [],
        "email": {},
        "errors": [],
    }

    # Health from Athena DB
    if ATHENA_DB.exists():
        try:
            conn = sqlite3.connect(str(ATHENA_DB))
            payload["health"] = _health_data(conn)
            conn.close()
        except Exception as e:
            payload["errors"].append(f"athena_db: {e}")
    else:
        payload["errors"].append("athena_db: file not found")

    # Calendar + Gmail from Horus / Google
    if GOOGLE_TOKEN.exists() and GOOGLE_SECRET.exists():
        try:
            token = _refresh_google_token()
            payload["calendar"] = _gcal_events(token)
            payload["email"] = _gmail_summary(token)
        except Exception as e:
            payload["errors"].append(f"google: {e}")
    else:
        payload["errors"].append("google: token files not found")

    return payload


# ─── CLI entrypoints ───────────────────────────────────────────────────────────

# ── Health Timeseries & Calories endpoints ──────────────────────────────────────

# ── Calorie / physical targets — TODO for the owner to set real values ────────────
# These are placeholder defaults. Edit these lines to set your targets.
# Placeholder targets, kept at 0 until the owner sets them manually.
_TARGET_DAILY_KCAL: float = 0        # set manually later (Athena's planning estimate: ~2115 kcal, pending age/sex)
_TARGET_DAILY_PROTEIN_G: float = 0   # set manually later (Athena's planning estimate: 140-165 g, pending)
_TARGET_DAILY_CALORIE_BURN: float = 0  # set manually later (TDEE estimate)
_TARGET_DAILY_STEPS: int = 0         # set manually later
_TARGET_WEIGHT_KG: float = 0         # set manually later
_TARGET_WAIST_CM: float = 0          # set manually later

_MAX_RANGE_DAYS = 3 * 365  # 3 years

_VALID_METRICS = {
    "recovery_score", "resting_hr", "hrv", "sleep_performance",
    "sleep_efficiency", "day_strain", "weight_kg", "waist_cm",
}
_VALID_GRANULARITIES = {"day", "week", "month"}

_METRIC_META: dict[str, dict] = {
    "recovery_score":    {"source": "whoop", "unit": "%",   "table": "whoop_recovery",   "col": "recovery_score"},
    "resting_hr":        {"source": "whoop", "unit": "bpm", "table": "whoop_recovery",   "col": "resting_hr"},
    "hrv":               {"source": "whoop", "unit": "ms",  "table": "whoop_recovery",   "col": "hrv_rmssd_ms"},
    "sleep_performance": {"source": "whoop", "unit": "%",   "table": "whoop_sleep",      "col": "performance_pct"},
    "sleep_efficiency":  {"source": "whoop", "unit": "%",   "table": "whoop_sleep",      "col": "efficiency_pct"},
    "day_strain":        {"source": "whoop", "unit": "",    "table": "whoop_cycle",      "col": "day_strain"},
    "weight_kg":         {"source": "self_reported", "unit": "kg",  "table": "body_measurements", "col": "weight_kg"},
    "waist_cm":          {"source": "self_reported", "unit": "cm",  "table": "body_measurements", "col": "waist_cm"},
}

# Map table → date column name
_TABLE_DATE_COL: dict[str, str] = {
    "whoop_recovery":    "date",
    "whoop_sleep":       "start_local",
    "whoop_cycle":       "start_local",
    "body_measurements": "date",
}


def _validate_dates(from_str: str, to_str: str) -> tuple[str, str]:
    """Parse and validate YYYY-MM-DD dates. Raises ValueError on bad input."""
    from datetime import date as _date
    try:
        d_from = datetime.strptime(from_str, "%Y-%m-%d").date()
        d_to   = datetime.strptime(to_str,   "%Y-%m-%d").date()
    except ValueError:
        raise ValueError("Invalid date format; use YYYY-MM-DD")
    if d_to < d_from:
        raise ValueError("to must be >= from")
    if (d_to - d_from).days > _MAX_RANGE_DAYS:
        raise ValueError(f"Date range exceeds 3-year limit ({_MAX_RANGE_DAYS} days)")
    return str(d_from), str(d_to)


def _bucket_key(d: "datetime", granularity: str) -> str:
    """Return the bucket start date string for a date and granularity."""
    from datetime import timedelta
    if granularity == "day":
        return d.strftime("%Y-%m-%d")
    if granularity == "month":
        return f"{d.year}-{d.month:02d}-01"
    # week — ISO week Monday
    week_start = d - timedelta(days=d.weekday())
    return week_start.strftime("%Y-%m-%d")


def _aggregate_series(
    rows: list[dict],
    date_col: str,
    value_col: str,
    from_date: str,
    to_date: str,
    granularity: str,
) -> list[dict]:
    """
    Bucket raw rows into day/week/month buckets across [from_date, to_date].
    Returns [{"date": ..., "value": ...}] with None where a bucket has no data.
    """
    from datetime import date as _date, timedelta

    # Build bucket → [values]
    bucket_values: dict[str, list[float]] = {}
    for row in rows:
        raw = row.get(date_col, "")
        if not raw:
            continue
        try:
            day_str = str(raw)[:10]
            d = datetime.strptime(day_str, "%Y-%m-%d")
        except ValueError:
            continue
        v = row.get(value_col)
        if v is None:
            continue
        try:
            fv = float(v)
        except (TypeError, ValueError):
            continue
        key = _bucket_key(d, granularity)
        bucket_values.setdefault(key, []).append(fv)

    # Walk the full range and emit one point per bucket
    result: list[dict] = []
    seen: set[str] = set()
    cursor = _date.fromisoformat(from_date)
    d_to   = _date.fromisoformat(to_date)
    while cursor <= d_to:
        key = _bucket_key(datetime.combine(cursor, datetime.min.time()), granularity)
        if key not in seen:
            seen.add(key)
            vals = bucket_values.get(key)
            avg = round(sum(vals) / len(vals), 2) if vals else None
            result.append({"date": key, "value": avg})
        cursor += timedelta(days=1)
    return result


def _compute_ts_insight(data_points: list[dict]) -> dict:
    """Compute trend insight for a timeseries. Returns {trend, change_pct, period_avg, prev_period_avg, gap_days}."""
    values = [p["value"] for p in data_points]
    total  = len(values)
    has_data = [v for v in values if v is not None]
    gap_days = sum(1 for v in values if v is None)

    if len(has_data) < 2:
        return {
            "trend": "insufficient",
            "change_pct": None,
            "period_avg": round(has_data[0], 2) if len(has_data) == 1 else None,
            "prev_period_avg": None,
            "gap_days": gap_days,
        }

    half = max(1, total // 2)
    first_half  = [v for v in values[:half] if v is not None]
    second_half = [v for v in values[half:] if v is not None]

    period_avg = round(sum(has_data) / len(has_data), 2)
    prev_avg   = round(sum(first_half)  / len(first_half),  2) if first_half  else None
    curr_avg   = round(sum(second_half) / len(second_half), 2) if second_half else None

    trend: str = "flat"
    change_pct: float | None = None
    if prev_avg is not None and curr_avg is not None and prev_avg != 0:
        change_pct = round((curr_avg - prev_avg) / abs(prev_avg) * 100, 1)
        if abs(change_pct) < 3:
            trend = "flat"
        elif change_pct > 0:
            trend = "up"
        else:
            trend = "down"

    return {
        "trend": trend,
        "change_pct": change_pct,
        "period_avg": period_avg,
        "prev_period_avg": prev_avg,
        "gap_days": gap_days,
    }


def _health_timeseries(
    conn: sqlite3.Connection,
    metric: str,
    from_date: str,
    to_date: str,
    granularity: str,
) -> dict:
    """Build /api/health/timeseries response for one metric."""
    meta     = _METRIC_META[metric]
    table    = meta["table"]
    col      = meta["col"]
    date_col = _TABLE_DATE_COL[table]

    rows = _db_rows(
        conn,
        f"SELECT substr({date_col}, 1, 10) AS _date, {col} AS _val "
        f"FROM {table} "
        f"WHERE substr({date_col}, 1, 10) >= ? AND substr({date_col}, 1, 10) <= ? "
        f"ORDER BY {date_col} ASC",
        (from_date, to_date),
    )

    series  = _aggregate_series(rows, "_date", "_val", from_date, to_date, granularity)
    insight = _compute_ts_insight(series)

    return {
        "metric":      metric,
        "source":      meta["source"],
        "unit":        meta["unit"],
        "from":        from_date,
        "to":          to_date,
        "granularity": granularity,
        "data":        series,
        "insight":     insight,
    }


def _health_calories(
    conn: sqlite3.Connection,
    from_date: str,
    to_date: str,
) -> dict:
    """Build /api/health/calories response."""
    from datetime import date as _date, timedelta

    rows = _db_rows(
        conn,
        "SELECT date, "
        "       SUM(kcal) AS kcal, "
        "       SUM(protein_g) AS protein_g, "
        "       COUNT(*) AS cnt "
        "FROM food_entries "
        "WHERE date >= ? AND date <= ? "
        "GROUP BY date "
        "ORDER BY date ASC",
        (from_date, to_date),
    )

    by_date = {r["date"]: r for r in rows}
    daily: list[dict] = []
    cursor = _date.fromisoformat(from_date)
    d_to   = _date.fromisoformat(to_date)
    while cursor <= d_to:
        day_str = cursor.isoformat()
        r = by_date.get(day_str)
        daily.append({
            "date":        day_str,
            "kcal":        round(float(r["kcal"]), 1) if r and r["kcal"] is not None else None,
            "protein_g":   round(float(r["protein_g"]), 1) if r and r["protein_g"] is not None else None,
            "entry_count": int(r["cnt"]) if r else 0,
        })
        cursor += timedelta(days=1)

    days_in_range  = len(daily)
    days_with_data = sum(1 for d in daily if d["entry_count"] > 0)
    kcal_vals      = [d["kcal"] for d in daily if d["kcal"] is not None]
    protein_vals   = [d["protein_g"] for d in daily if d["protein_g"] is not None]

    total_kcal    = round(sum(kcal_vals), 1)    if kcal_vals    else None
    total_protein = round(sum(protein_vals), 1) if protein_vals else None

    cal_points = [{"value": d["kcal"]} for d in daily]
    cal_insight = _compute_ts_insight(cal_points)
    gap_days    = sum(1 for d in daily if d["entry_count"] == 0)

    return {
        "from":   from_date,
        "to":     to_date,
        "source": "self_reported",
        "targets": {
            "daily_kcal":       _TARGET_DAILY_KCAL,
            "daily_protein_g":  _TARGET_DAILY_PROTEIN_G,
        },
        "daily": daily,
        "summary": {
            "total_kcal":       total_kcal,
            "total_protein_g":  total_protein,
            "days_with_data":   days_with_data,
            "days_in_range":    days_in_range,
        },
        "insight": {
            "trend":      cal_insight["trend"],
            "change_pct": cal_insight["change_pct"],
            "gap_days":   gap_days,
        },
    }


def _health_today(conn: sqlite3.Connection) -> dict:
    """Build /api/health/today response: today's calorie intake, calorie burn, and steps."""
    from datetime import date as _date
    today = _date.today().isoformat()

    # Calorie intake today
    row = _db_row(
        conn,
        "SELECT SUM(kcal) AS kcal, SUM(protein_g) AS protein_g, COUNT(*) AS cnt "
        "FROM food_entries WHERE date = ?",
        (today,),
    )
    actual_kcal_intake = round(float(row["kcal"]), 1) if row and row["kcal"] is not None else None

    # Calorie burn today — from whoop_cycle (day_strain kilojoule equivalent)
    # We surface WHOOP's kilojoule output converted to kcal as burn proxy.
    # No steps table exists yet: steps will be None with an honest empty-state flag.
    cycle_today = _db_row(
        conn,
        "SELECT day_strain FROM whoop_cycle "
        "WHERE substr(start_local, 1, 10) = ? "
        "ORDER BY start_local DESC LIMIT 1",
        (today,),
    )
    # No direct kcal-burn column in schema; expose None with target so frontend can
    # show "target not set" ring.  When calories_burn data becomes available, this
    # can be wired to a kilojoule column.
    actual_calorie_burn: float | None = None  # data not yet populated in schema

    # Steps — no table in schema yet
    actual_steps: int | None = None  # no steps table in DB

    return {
        "date": today,
        "calorie_intake": {
            "actual": actual_kcal_intake,
            "target": _TARGET_DAILY_KCAL if _TARGET_DAILY_KCAL > 0 else None,
        },
        "calorie_burn": {
            "actual": actual_calorie_burn,
            "target": _TARGET_DAILY_CALORIE_BURN if _TARGET_DAILY_CALORIE_BURN > 0 else None,
            "empty_reason": "Calorie burn data not yet available in DB schema.",
        },
        "steps": {
            "actual": actual_steps,
            "target": _TARGET_DAILY_STEPS if _TARGET_DAILY_STEPS > 0 else None,
            "empty_reason": "No steps data in DB yet.",
        },
    }


def _serve(port: int = 5175) -> None:
    """Minimal HTTP server for local dev — Vite proxies /api/* here."""
    import http.server

    host = os.environ.get("API_HOST", "127.0.0.1")

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass  # quiet

        def _send_json(
            self,
            data: dict,
            status: int = 200,
            extra_headers: list[tuple[str, str]] | None = None,
        ) -> None:
            body = json.dumps(data, default=str).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            # Never let proxies/browsers cache personal/health data or auth responses.
            self.send_header("Cache-Control", "no-store, private")
            self.send_header("Access-Control-Allow-Origin", "*")
            for name, value in (extra_headers or []):
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(body)

        def _send_error(self, status: int, message: str, extra_headers: list[tuple[str, str]] | None = None) -> None:
            self._send_json({"error": message}, status, extra_headers)

        def _authenticated_username(self) -> str | None:
            return _session_username(self.headers.get("Cookie"))

        def _require_auth(self) -> str | None:
            """Return the logged-in username, or send 401 (no data) and return None."""
            username = self._authenticated_username()
            if not username:
                self._send_error(401, "Authentication required")
            return username

        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            path   = parsed.path.rstrip("/")
            qs     = urllib.parse.parse_qs(parsed.query)

            def qp(key: str, default: str = "") -> str:
                vals = qs.get(key, [default])
                return vals[0] if vals else default

            # ── /api/auth/status — never requires auth; never returns data ─────
            if path == "/api/auth/status":
                self._send_json({"authenticated": self._authenticated_username() is not None})
                return

            # ── /api/dashboard ────────────────────────────────────────────────
            if path in ("/api/dashboard", "/dashboard"):
                if not self._require_auth():
                    return
                try:
                    self._send_json(build_payload())
                except Exception as e:
                    self._send_error(500, str(e))
                return

            # ── /api/health/timeseries ────────────────────────────────────────
            if path == "/api/health/timeseries":
                if not self._require_auth():
                    return
                metric      = qp("metric")
                from_str    = qp("from")
                to_str      = qp("to")
                granularity = qp("granularity", "day")
                if metric not in _VALID_METRICS:
                    self._send_error(400, f"Invalid metric. Valid: {sorted(_VALID_METRICS)}")
                    return
                if granularity not in _VALID_GRANULARITIES:
                    self._send_error(400, f"Invalid granularity. Valid: {sorted(_VALID_GRANULARITIES)}")
                    return
                if not from_str or not to_str:
                    self._send_error(400, "Missing required params: from, to")
                    return
                try:
                    from_date, to_date = _validate_dates(from_str, to_str)
                except ValueError as e:
                    self._send_error(400, str(e))
                    return
                if not ATHENA_DB.exists():
                    self._send_error(503, "athena.db not found")
                    return
                try:
                    # Read-only URI connection
                    uri = f"file:{ATHENA_DB}?mode=ro"
                    conn = sqlite3.connect(uri, uri=True)
                    result = _health_timeseries(conn, metric, from_date, to_date, granularity)
                    conn.close()
                    self._send_json(result)
                except Exception as e:
                    self._send_error(500, type(e).__name__)
                return

            # ── /api/health/calories ──────────────────────────────────────────
            if path == "/api/health/calories":
                if not self._require_auth():
                    return
                from_str = qp("from")
                to_str   = qp("to")
                if not from_str or not to_str:
                    self._send_error(400, "Missing required params: from, to")
                    return
                try:
                    from_date, to_date = _validate_dates(from_str, to_str)
                except ValueError as e:
                    self._send_error(400, str(e))
                    return
                if not ATHENA_DB.exists():
                    self._send_error(503, "athena.db not found")
                    return
                try:
                    uri = f"file:{ATHENA_DB}?mode=ro"
                    conn = sqlite3.connect(uri, uri=True)
                    result = _health_calories(conn, from_date, to_date)
                    conn.close()
                    self._send_json(result)
                except Exception as e:
                    self._send_error(500, type(e).__name__)
                return

            # ── /api/health/today ─────────────────────────────────────────────
            if path == "/api/health/today":
                if not self._require_auth():
                    return
                if not ATHENA_DB.exists():
                    self._send_error(503, "athena.db not found")
                    return
                try:
                    uri = f"file:{ATHENA_DB}?mode=ro"
                    conn = sqlite3.connect(uri, uri=True)
                    result = _health_today(conn)
                    conn.close()
                    self._send_json(result)
                except Exception as e:
                    self._send_error(500, type(e).__name__)
                return

            self.send_response(404)
            self.end_headers()

        def do_POST(self):
            parsed = urllib.parse.urlparse(self.path)
            path   = parsed.path.rstrip("/")

            def read_json_body(max_len: int = 10_000) -> dict:
                try:
                    length = int(self.headers.get("Content-Length", "0") or "0")
                except ValueError:
                    length = 0
                if length <= 0 or length > max_len:
                    return {}
                raw = self.rfile.read(length)
                try:
                    parsed_body = json.loads(raw.decode("utf-8"))
                    return parsed_body if isinstance(parsed_body, dict) else {}
                except Exception:
                    return {}

            # ── /api/login ───────────────────────────────────────────────────
            if path == "/api/login":
                body = read_json_body()
                username = str(body.get("username", ""))[:200]
                password = str(body.get("password", ""))[:1000]
                addr = self.client_address[0] if self.client_address else "unknown"
                key = _login_throttle_key(username, addr)

                remaining = _is_locked_out(key)
                if remaining > 0:
                    self._send_error(
                        429,
                        "Too many failed attempts. Try again later.",
                        extra_headers=[("Retry-After", str(int(remaining) + 1))],
                    )
                    return

                if not username or not password or not _verify_password(username, password):
                    _record_login_failure(key)
                    time.sleep(0.3)  # slow brute-force guessing
                    self._send_error(401, "Invalid username or password")
                    return

                _record_login_success(key)
                token = _new_session(username.strip())
                self._send_json(
                    {"ok": True},
                    200,
                    extra_headers=[("Set-Cookie", _session_cookie_header(token))],
                )
                return

            # ── /api/logout ──────────────────────────────────────────────────
            if path == "/api/logout":
                _invalidate_session(self.headers.get("Cookie"))
                self._send_json(
                    {"ok": True},
                    200,
                    extra_headers=[("Set-Cookie", _clear_cookie_header())],
                )
                return

            self.send_response(404)
            self.end_headers()

    httpd = http.server.HTTPServer((host, port), Handler)
    print(f"Athena data API running on http://{host}:{port}/api/dashboard", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    if "--serve" in sys.argv:
        port = int(os.environ.get("API_PORT", "5175"))
        _serve(port)
    else:
        print(json.dumps(build_payload(), indent=2, default=str))
