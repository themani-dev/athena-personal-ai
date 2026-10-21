#!/usr/bin/env python3
"""
Athena Dashboard Data API
-------------------------
Reads real data from:
  - Athena's SQLite DB  (WHOOP health, Hevy workouts, food/water logs)
  - Horus's Google Calendar token (upcoming events)

Outputs a single JSON payload consumed by the dashboard frontend.

Usage (dev):
  python3 api/dashboard.py          → prints JSON to stdout
  python3 api/dashboard.py --serve  → runs a tiny HTTP server on PORT (default 5174)

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

ATHENA_DB = Path("/home/bujji/personal-ai-os/agents/athena/tracking/athena.db")
GOOGLE_TOKEN = Path("/home/bujji/personal-ai-os/agents/horus/google_token.json")
GOOGLE_SECRET = Path("/home/bujji/personal-ai-os/agents/horus/google_client_secret.json")


# ─── Google OAuth helpers ──────────────────────────────────────────────────────

def _refresh_google_token() -> str:
    """Return a valid Google access token, refreshing if needed."""
    tok = json.loads(GOOGLE_TOKEN.read_text())
    secret = json.loads(GOOGLE_SECRET.read_text())
    client = secret.get("installed", secret.get("web", {}))

    # Try existing token first
    access = tok.get("token", tok.get("access_token", ""))
    if access:
        # Quick validity probe
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
    except Exception as e:
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
    today = datetime.now().strftime("%Y-%m-%d")

    recovery = _db_row(conn, "SELECT * FROM whoop_recovery ORDER BY date DESC LIMIT 1")
    sleep = _db_row(conn, "SELECT * FROM whoop_sleep WHERE nap=0 ORDER BY start_local DESC LIMIT 1")
    cycle = _db_row(conn, "SELECT * FROM whoop_cycle ORDER BY start_local DESC LIMIT 1")

    # Recent recovery trend (last 7 days)
    recovery_trend = _db_rows(
        conn,
        "SELECT date, recovery_score FROM whoop_recovery ORDER BY date DESC LIMIT 7"
    )

    # Last workout
    last_workout = _db_row(conn, "SELECT * FROM whoop_workout ORDER BY start_local DESC LIMIT 1")
    last_hevy = _db_row(
        conn,
        "SELECT h.id, h.start_utc, h.title, GROUP_CONCAT(DISTINCT s.exercise) as exercises "
        "FROM hevy_workout h LEFT JOIN hevy_set s ON h.id=s.workout_id "
        "GROUP BY h.id ORDER BY h.start_utc DESC LIMIT 1"
    )

    # Today food & water
    water = _db_row(conn, "SELECT * FROM water_log ORDER BY date DESC LIMIT 1")
    food_today = _db_rows(
        conn,
        "SELECT * FROM food_entries ORDER BY date DESC LIMIT 5"
    )

    # Sleep duration calculation
    sleep_hours = None
    if sleep:
        sleep_hours = round(sleep["in_bed_h"] - sleep["awake_min"] / 60, 1) if sleep["in_bed_h"] else None

    # Recovery status label
    def recovery_label(score):
        if score is None:
            return "Unknown"
        if score >= 67:
            return "Green"
        if score >= 34:
            return "Yellow"
        return "Red"

    # Strain label
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
            "title": last_hevy["title"] if last_hevy else (last_workout["sport"].title() if last_workout else None),
            "date": last_hevy["start_utc"] if last_hevy else (last_workout["start_local"] if last_workout else None),
            "exercises": last_hevy["exercises"].split(",") if last_hevy and last_hevy["exercises"] else [],
            "strain": round(last_workout["strain"], 1) if last_workout and last_workout["strain"] else None,
        },
        "recovery_trend": list(reversed(recovery_trend)),
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
    }


# ─── Main payload builder ──────────────────────────────────────────────────────

def build_payload() -> dict[str, Any]:
    now_local = datetime.now()
    today_str = now_local.strftime("%Y-%m-%d")

    payload: dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "date": today_str,
        "health": {},
        "calendar": [],
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

    # Calendar from Horus / Google
    if GOOGLE_TOKEN.exists() and GOOGLE_SECRET.exists():
        try:
            token = _refresh_google_token()
            payload["calendar"] = _gcal_events(token)
        except Exception as e:
            payload["errors"].append(f"google_calendar: {e}")
    else:
        payload["errors"].append("google_calendar: token files not found")

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
