# DashboardAPU Technical Notes

## Purpose

`DashboardAPU` is a small Vercel project that renders a task efficiency dashboard for Bitrix24 and exposes one serverless endpoint used by the static frontend.

## Architecture

- `public/index.html`:
  - single-page dashboard UI
  - loads report data from `/api/task-report`
  - supports auto-refresh and manual refresh
- `api/task-report.js`:
  - Vercel serverless function
  - returns JSON for the dashboard
  - adds permissive CORS and disables caching
- `lib/task-report.js`:
  - report assembly logic
  - if `TASK_REPORT_WEBHOOK_URL` is a Bitrix REST webhook, it calls Bitrix directly
  - otherwise it calls an external webhook and normalizes the response
- `scripts/dev.mjs`:
  - local server for static UI + API handler

## Required Environment

- `TASK_REPORT_WEBHOOK_URL`

Current local setup uses a Bitrix REST webhook URL, so the app reads tasks, users, and departments directly from Bitrix24.

## TV Browser Incident

Symptom:

- on Smart TV browsers the dashboard could show `Failed to fetch` before any data rendered

Likely cause:

- older TV browsers are flaky with `fetch()` even for same-origin requests to local/serverless JSON endpoints

Fix applied on 2026-06-18:

- frontend now detects common Smart TV user agents
- TV browsers use `XMLHttpRequest` first instead of `fetch`
- non-TV browsers still use `fetch`, with automatic XHR fallback on network failure
- XHR requests also send no-cache headers and surface HTTP error codes more clearly

## Verification

Local verification completed against:

- `GET /api/task-report`
- HTTP 200 response
- live payload returned from Bitrix with rows and departments

## Safe Change Areas

- UI-only transport behavior: `public/index.html`
- API contract: `api/task-report.js`
- Bitrix/report mapping logic: `lib/task-report.js`

If the dashboard breaks only on specific devices, inspect `public/index.html` first before touching report generation.
