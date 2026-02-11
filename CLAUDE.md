# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

A real-time aircraft tracking web app. The actual tracker feature lives entirely in **`index.html`** as self-contained vanilla HTML/CSS/JavaScript — no React, no build step required for the core feature. It calls the [OpenSky Network API](https://opensky-network.org) directly from the browser.

The rest of the project is Zo Site infrastructure (Hono server, React scaffolding) that hosts and wraps `index.html`. See the workspace-level `../CLAUDE.md` for Zo Site patterns.

## File Roles

```
index.html          # THE plane tracker — all logic, styles, and markup inline
server.ts           # Hono server: serves index.html + demo API routes
backend-lib/
  db.ts             # SQLite helpers for event registration demo (event-registrations.db)
  zo-api.ts         # Zo AI API client
src/                # Unused React scaffolding from Zo Site template (not loaded by index.html)
```

The `src/` directory contains the Zo Site React template but is **not used** — `index.html` does not import `src/main.tsx`. It exists for future use or if the project is converted to a React app.

## Key Architecture: index.html

All plane tracking logic is in `index.html`'s inline `<script>`:

- `userLocation` — set via `navigator.geolocation`, defaults to central US (`39.8283, -98.5795`)
- `fetchPlanes()` — calls OpenSky API with a 1° bounding box (`boxSize = 1.0`), maps raw state vectors to named fields
- `handleRateLimit()` — exponential backoff (30s → 60s → 120s → 240s → 300s max) on HTTP 429
- `createPlaneCard(plane)` — builds the DOM card for each aircraft; converts m/s → knots, m → feet

**OpenSky state vector field mapping** (index used in the `state[]` array):
| Index | Field |
|-------|-------|
| 0 | icao24 |
| 1 | callsign |
| 2 | origin_country |
| 5 | longitude |
| 6 | latitude |
| 7 | altitude (meters) |
| 8 | on_ground |
| 9 | velocity (m/s → multiply by 1.94384 for knots) |
| 10 | track/heading (degrees) |
| 11 | vertical_rate (m/s) |

## API Routes (server.ts)

These are demo endpoints from the Zo Site template, not related to the plane tracker itself:

- `GET /api/hello-zo` — greeting endpoint
- `GET /api/_zo/demo/registrations` — list event registrations (SQLite)
- `POST /api/_zo/demo/register` — create event registration; requires `name` and `email`

## Database

`event-registrations.db` (SQLite, at project root) — used only by the registration demo routes. Schema: `id, name, email, company, notes, created_at`.

## Commands

```bash
bun install                # Install dependencies
bunx tsc --noEmit          # Type check
```

Do NOT run `bun run dev` or `bun run prod` — Zo manages the server process.

## Debugging

Server logs: `/dev/shm/zosite-53799.log`
Browser console logs: `/dev/shm/zosite-53799-browser.log`

Use `agent-browser` to preview the running site:
```bash
agent-browser open http://localhost:53799
agent-browser screenshot
```

## Making Changes

- **Plane tracker UI/logic**: edit `index.html` — changes hot-reload automatically
- **New API routes**: add to `server.ts` before the Vite middleware block
- **Convert to React**: add `<script type="module" src="/src/main.tsx">` to `index.html` and build out `src/` — the Vite config and React scaffolding are ready
