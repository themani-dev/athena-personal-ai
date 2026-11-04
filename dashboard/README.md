# Athena Dashboard

A personal health and productivity command center. Shows WHOOP recovery, sleep, and strain data; a Health tab with timeseries metrics, physical measurements, and nutrition charts; daily progress rings; and calendar and email summaries. All data routes require a login.

## Features

- **Overview tab** — WHOOP recovery score, sleep performance, strain, hydration, steps, calories, today's workouts, Athena coaching suggestion, upcoming calendar events, email triage, and AI insights
- **Health tab** — collapsible sections for health metrics (WHOOP timeseries with 7-day averages), physical measurements (weight, waist with optional target thresholds), and nutrition (calories, protein with optional target thresholds)
- **Login gate** — session-cookie auth with rate limiting and account lockout; every data route returns `401` without a valid session
- **Proxy architecture** — Nitro server routes forward all `/api/*` requests to the internal Python data API, keeping browser fetch URLs stable and credentials server-side
- **Docker deployment** — two-container stack (Python API + Bun/Nitro frontend) on a private bridge network

## Architecture

```
Browser
  │
  │  HTTPS (tunnel / private network)
  ▼
┌─────────────────────────────────┐
│  Frontend container             │
│  TanStack Start + Nitro (Bun)  │
│  Port: FRONTEND_PORT → 3000    │
│                                 │
│  /api/* server routes           │
│    proxy to internal API ──────►│──┐
└─────────────────────────────────┘  │
                                     ▼
                        ┌────────────────────────┐
                        │  API container          │
                        │  Python stdlib HTTP     │
                        │  Port: API_PORT → 8000  │
                        │                         │
                        │  reads (read-only):     │
                        │  - Athena SQLite DB      │
                        │  - Google OAuth token   │
                        │  - Suggestions dir      │
                        └────────────────────────┘
```

Both containers share `dashboard-net` (bridge). Neither port should be exposed directly to the internet.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose plugin (v2)
- Athena SQLite database file (health, workout, food/water logs)
- Google OAuth token and client secret JSON files (for calendar/email; optional)
- Login credentials file created by `app/api/dashboard.py` (see Setup)

For local development without Docker:
- [Bun](https://bun.sh/) ≥ 1.0
- Python 3.12+

## Setup

### 1. Create the login credentials file

The API reads a credentials file containing a username and a scrypt hash. Create it once, outside the repo, with `chmod 600`:

```sh
python3 app/api/dashboard.py --create-credentials
```

The script prompts for a username and password. It writes only the salt and hash — never the plaintext password.

Store the file at a path you control; you will reference it in `.env` as `AUTH_CREDENTIALS_PATH`.

### 2. Create `.env`

Copy the table below into a `.env` file at `dashboard/` (never commit it):

| Variable | Required | Description |
|---|---|---|
| `ATHENA_DB_PATH` | yes | Absolute path to the Athena SQLite database file. Mounted read-only. |
| `AUTH_CREDENTIALS_PATH` | yes | Absolute path to the credentials file created in step 1. Must be `chmod 600`. Mounted read-only. |
| `GOOGLE_TOKEN_PATH` | optional | Absolute path to the Horus Google OAuth token JSON. Mounted read-write (API refreshes and writes back). |
| `GOOGLE_SECRET_PATH` | optional | Absolute path to the Horus Google client secret JSON. Mounted read-only. |
| `SUGGESTIONS_DIR_PATH` | optional | Directory where Athena writes `athena-daily-suggestion-*.json` files. Defaults to `~/reports/dashboard-v3`. Mounted read-only. |
| `FRONTEND_PORT` | optional | Host port for the frontend container. Defaults to `3001`. |
| `API_PORT` | optional | Host port for the API container. Defaults to `8001`. |

### 3. Build and start

```sh
cd dashboard/app/docker
docker compose --env-file ../../.env up -d --build
```

The frontend waits for the API health check (`GET /api/auth/status → 200`) before starting.

## Usage

### Start

```sh
cd dashboard/app/docker
docker compose --env-file ../../.env up -d
```

### Stop

```sh
docker compose --env-file ../../.env down
```

### View logs

```sh
# Both containers
docker compose --env-file ../../.env logs -f

# API only
docker compose --env-file ../../.env logs -f api

# Frontend only
docker compose --env-file ../../.env logs -f frontend
```

### Restart after a code change

```sh
docker compose --env-file ../../.env up -d --build
```

### Local development (no Docker)

Start the Python API:

```sh
cd dashboard/app
python3 api/dashboard.py --serve
```

The API defaults to port `5175`. Start the frontend dev server in a second terminal:

```sh
cd dashboard/app
bun install
bun run dev
```

Vite proxies `/api/*` to the local Python server.

## Configuration

### Health and nutrition targets

Calorie, protein, weight, and waist targets are set as constants near the top of `app/api/dashboard.py`. They default to `0`, which means "not set" — no threshold line is drawn on the charts until a non-zero value is entered.

### Session and lockout

| Variable | Default | Description |
|---|---|---|
| `SESSION_TTL_SECONDS` | `43200` (12 h) | How long a session cookie stays valid. |
| `MAX_LOGIN_ATTEMPTS` | `5` | Failed attempts before lockout. |
| `LOGIN_LOCKOUT_SECONDS` | `900` (15 min) | Lockout duration per username and IP. |

These can be overridden as environment variables passed to the API container.

## Security notes

- Every data route returns `401` without a valid session cookie.
- Sessions are random tokens stored in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie.
- Five failed logins lock that username and IP for 15 minutes.
- All data responses send `Cache-Control: no-store, private`.
- The Athena database is opened read-only.
- The API runs as a non-root user inside the container.
- Do not expose `FRONTEND_PORT` or `API_PORT` directly to the internet — put them behind an authenticated tunnel or private network.

## Health check

The API container's health check polls `GET /api/auth/status`, which returns `200` with no data payload. The frontend container depends on this check passing before it starts.

Manual check:

```sh
curl -s http://localhost:${API_PORT:-8001}/api/auth/status
```

Expected response: `{"status": "ok"}` with HTTP 200.

## API routes

| Method | Path | Auth required | Description |
|---|---|---|---|
| `POST` | `/api/login` | no | Exchange credentials for a session cookie. |
| `POST` | `/api/logout` | yes | Invalidate the current session. |
| `GET` | `/api/auth/status` | no | Health check; returns `200` with no data. |
| `GET` | `/api/dashboard` | yes | Full dashboard JSON payload. |
| `GET` | `/api/health/today` | yes | Today's health metrics snapshot. |
| `GET` | `/api/health/timeseries` | yes | WHOOP metric timeseries data. |
| `GET` | `/api/health/calories` | yes | Daily calorie and protein log. |
| `GET` | `/api/health/suggestion` | yes | Latest Athena coaching suggestion. |

## Excluded files

`.gitignore` covers:
- `__pycache__/` and `*.pyc` — Python bytecode
- `.env` — local environment overrides (never commit)
- Health data, credentials files, OAuth tokens, and database files are excluded by the root `.gitignore`

## License

TBD by owner.
