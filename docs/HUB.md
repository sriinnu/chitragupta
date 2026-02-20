# Hub Dashboard

The Hub is Chitragupta's web-based dashboard — a Preact SPA served directly from `chitragupta serve` on the same port as the REST API (default `3141`). It provides a visual interface for monitoring sessions, costs, models, memory, skills, and managing paired devices.

---

## Quick Start

### 1. Build the Hub

```bash
pnpm -F @chitragupta/hub build
```

This produces a `dist/` folder inside `packages/hub/` with the static assets.

### 2. Start the Server

```bash
chitragupta serve
# or: chitragupta serve --port 3141 --host localhost
```

On startup, the terminal prints a **pairing challenge** — a set of words, a number code, a QR code, and an icon grid:

```
╔═══════════════════════════════════════╗
║  Chitragupta Hub — Pairing Challenge  ║
╠═══════════════════════════════════════╣
║  Passphrase:  castle orange helium    ║
║  Number code: 7291038                 ║
║  QR: [displayed as UTF-8 blocks]     ║
║  Icons: 🔷 🌿 ⚡ 🎯                  ║
╚═══════════════════════════════════════╝

  Hub: http://localhost:3141
```

### 3. Open in Your Browser

Navigate to `http://localhost:3141`. On first visit you'll see the **pairing screen**.

### 4. Complete Pairing

Choose one of four methods to prove you control the terminal:

| Method | How |
|--------|-----|
| **Passphrase** | Type the words shown in the terminal |
| **Number Code** | Enter the 7-digit number code |
| **QR Code** | Scan the QR from your terminal with the browser camera |
| **Visual Match** | Tap the 4 icons shown in the terminal (in order) |

On success, the browser receives a JWT and redirects to the dashboard.

---

## Device Pairing (Dvara-Bandhu)

"Dvara-Bandhu" (Gateway Friend) is the pairing protocol that authenticates browsers to the local Chitragupta server without passwords or API keys.

### Why Pairing?

Chitragupta's server runs locally. The browser has no credentials initially — it must prove it can see the terminal output (same-machine trust).

### How It Works

1. **Server generates a challenge** containing a passphrase, number code, QR token, and icon sequence
2. **Browser shows a pairing screen** with four method tabs
3. **User completes one method** — all four verify the same challenge
4. **Server issues a JWT** (24h expiry, refreshable)
5. **JWT stored in localStorage** — subsequent visits auto-authenticate

### Challenge Rotation

- Challenges expire after **5 minutes** and auto-rotate
- After **3 failed attempts**, the server locks for **30 seconds**
- Generate a fresh challenge: `GET /api/pair/challenge`

### Managing Devices

- View paired devices: **Devices** page in the dashboard
- Revoke a device: click **Revoke** next to it (or `DELETE /api/pair/devices/:id`)
- Re-pair: open the hub in a new incognito window to see the pairing screen

### Security Notes

- JWTs are signed with a secret derived from the server's auth token or a random UUID
- Set `CHITRAGUPTA_JWT_SECRET` environment variable for a stable secret across restarts
- Pairing only verifies local trust — it is NOT designed for internet-facing deployments

---

## Dashboard Pages

### Overview

The home page shows:

- **Cost cards** — session cost, daily cost, monthly trend
- **Session summary** — active session, total today, average duration
- **Health indicators** — daemon state, Triguna scores, provider connectivity
- **Recent activity** — last events (sessions, skills learned, consolidations)

Data from: `GET /api/health`, `GET /api/budget/status`, `GET /api/sessions`

### Sessions

Browse and inspect past coding sessions:

- **Session list** — searchable, filterable by date/provider/cost
- **Session detail** — turn-by-turn view with token counts and tool calls

Data from: `GET /api/sessions`, `GET /api/sessions/:id`

### Models

Catalog of all available models across all configured providers:

- **Model list** — grouped by provider, with capabilities
- **Router insights** — which model TuriyaRouter selected and why
- **Switch model** — change the active model

Data from: `GET /api/models`, `GET /api/models/router`

### Memory

Explore the knowledge graph and learned patterns:

- **GraphRAG explorer** — visual node graph of knowledge connections
- **Consolidation rules** — list with decay status and category filters
- **Vidhis** — learned procedures with confidence and success rate

Data from: `GET /api/memory/*` routes

### Skills

Manage the skill ecosystem:

- **Skill registry** — all registered skills with metadata
- **Approval queue** — quarantined skills awaiting review
- **Learning timeline** — Shiksha learning events

Data from: `GET /api/skills/*` routes

### Settings

Configure budget, preferences, and daemon controls:

- **Budget config** — max session/daily cost, warning thresholds
- **Provider preferences** — default provider and model
- **Skill discovery** — auto / suggest / off

Data from: `GET /api/settings`, `PUT /api/settings`

### Devices

Manage paired browser sessions:

- **Paired devices** — list with last-seen time and browser info
- **Revoke** — one-click device revocation
- **Re-pair** — generate new pairing challenge

Data from: `GET /api/pair/devices`, `DELETE /api/pair/devices/:id`

---

## Hub API Endpoints

These endpoints power the Hub and are also available for programmatic use.

### Pairing

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/pair/challenge` | Current pairing challenge (passphrase, icons, QR data) |
| `POST` | `/api/pair/verify` | Submit pairing attempt (method + response) |
| `POST` | `/api/pair/refresh` | Refresh JWT before expiry |
| `GET` | `/api/pair/devices` | List paired devices (requires Bearer token) |
| `DELETE` | `/api/pair/devices/:id` | Revoke a paired device (requires Bearer token) |

### Budget

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/budget/status` | Session + daily cost, limits, warnings |
| `GET` | `/api/budget/history` | Daily cost history (last 30 days) |
| `GET` | `/api/budget/breakdown` | Cost breakdown by provider and model |

### Models

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/models` | All available models across providers |
| `GET` | `/api/models/:id` | Model detail (pricing, capabilities) |
| `GET` | `/api/models/router` | TuriyaRouter state and strategy |

### Settings

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/settings` | Current ChitraguptaSettings |
| `PUT` | `/api/settings` | Partial settings merge |

---

## Architecture

```
packages/hub/                     ← Preact SPA (3KB gzipped)
├── src/
│   ├── app.tsx                   ← Root app + pathname router
│   ├── api.ts                    ← Fetch wrapper with JWT injection
│   ├── auth/
│   │   ├── pairing.tsx           ← Pairing flow (4 method tabs)
│   │   ├── passphrase-entry.tsx  ← Word input with autocomplete
│   │   └── visual-match.tsx      ← Icon grid picker
│   ├── pages/                    ← Dashboard pages (overview, sessions, ...)
│   ├── components/               ← Layout, stat cards, charts
│   └── signals/                  ← Preact Signals for auth, budget, realtime
├── index.html
└── vite.config.ts

packages/cli/src/
├── pairing-engine.ts             ← Pairing state machine
├── routes/pairing.ts             ← Pairing REST endpoints
├── routes/budget.ts              ← Budget REST endpoints
├── routes/models.ts              ← Model catalog REST endpoints
└── routes/settings.ts            ← Settings CRUD REST endpoints
```

The CLI serves the Hub's built `dist/` folder as static assets. Any non-API GET request falls through to `index.html` (SPA fallback).

---

## Troubleshooting

### Hub shows a blank page

Ensure the Hub is built: `pnpm -F @chitragupta/hub build`. The CLI looks for `packages/hub/dist/index.html` — if it's missing, static serving is disabled.

### Pairing screen doesn't appear

Check that the terminal printed a pairing challenge on `chitragupta serve` startup. If the Hub dist is not available, the server runs in API-only mode.

### JWT expired / session lost

Clear `localStorage` in the browser and re-pair. JWTs expire after 24 hours if not refreshed. The Hub auto-refreshes tokens before expiry.

### WebSocket not connecting

The Hub connects to `ws://localhost:<port>/ws` for real-time updates. Ensure the server is running and no firewall is blocking WebSocket connections.

---

*See also: [API.md](./API.md) | [ARCHITECTURE.md](./ARCHITECTURE.md) | [../GETTING_STARTED.md](../GETTING_STARTED.md)*
