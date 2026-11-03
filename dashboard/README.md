# Athena Dashboard

A personal health and productivity dashboard. It shows WHOOP recovery, sleep, and strain, a Health tab with metric and nutrition charts, daily progress rings, and calendar and email summaries. All personal data routes sit behind a login.

## Layout

- `app/src/` frontend (TanStack Start, React, Recharts)
- `app/api/dashboard.py` data API (Python stdlib, read-only SQLite access)
- `app/docker/` Dockerfiles and compose file for the API and frontend
- `docker-compose.yaml` root compose file (same services)

## Setup

1. Copy `.env.example` to `.env` and set the paths. Names only; never commit `.env`.
   - `ATHENA_DB_PATH` path to the health database (mounted read-only)
   - `GOOGLE_TOKEN_PATH`, `GOOGLE_SECRET_PATH` OAuth files (optional)
   - `AUTH_CREDENTIALS_PATH` path to the login credentials file
   - `FRONTEND_PORT`, `API_PORT` host ports
2. Create the login credentials file, outside the repo:
   ```
   cd app/api
   python3 create_credentials.py
   ```
   The script prompts for a username and password, stores only a salt and a scrypt hash, and sets file mode 600.
3. Build and start:
   ```
   cd app/docker
   docker compose --env-file ../../.env up -d --build
   ```

## Login and security

- Every data route returns `401` without a valid session.
- Sessions are random tokens in an HttpOnly, Secure, SameSite=Strict cookie, valid 12 hours.
- Five failed logins lock that username and IP for 15 minutes.
- Data responses send `Cache-Control: no-store, private`.
- The database is opened read-only.

Do not expose the API or frontend ports directly to the internet. Put them behind an authenticated tunnel or private network.

## Targets

Calorie, protein, weight, and waist targets live in `app/api/dashboard.py`. They default to 0, which means "not set": no threshold line is drawn until a value is entered.

## Health checks

The API container's health check calls `/api/auth/status`, which returns 200 without data.

## Not included

Health data, credentials, OAuth tokens, `.env` files, and database files are excluded by `.gitignore`.
