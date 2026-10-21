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

import json
import os
import sqlite3
import sys
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
    "/home/bujji/personal-ai-os/agents/athena/tracking/athena.db"
))
GOOGLE_TOKEN = Path(os.environ.get(
    "GOOGLE_TOKEN",
    "/home/bujji/personal-ai-os/agents/horus/google_token.json"
))
GOOGLE_SECRET = Path(os.environ.get(
    "GOOGLE_SECRET",
    "/home/bujji/personal-ai-os/agents/horus/google_client_secret.json"
))

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

def _serve(port: int = 5175) -> None:
    """Minimal HTTP server for local dev — Vite proxies /api/dashboard here."""
    import http.server

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass  # quiet

        def do_GET(self):
            if self.path.rstrip("/") in ("/api/dashboard", "/dashboard"):
                try:
                    data = json.dumps(build_payload(), default=str).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    self.wfile.write(data)
                except Exception as e:
                    err = json.dumps({"error": str(e)}).encode()
                    self.send_response(500)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(err)))
                    self.end_headers()
                    self.wfile.write(err)
            else:
                self.send_response(404)
                self.end_headers()

    httpd = http.server.HTTPServer(("127.0.0.1", port), Handler)
    print(f"Athena data API running on http://127.0.0.1:{port}/api/dashboard", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    if "--serve" in sys.argv:
        port = int(os.environ.get("API_PORT", "5175"))
        _serve(port)
    else:
        print(json.dumps(build_payload(), indent=2, default=str))
