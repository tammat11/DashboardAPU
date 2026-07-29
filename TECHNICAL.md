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

## TV visibility field

Users with the Bitrix boolean field `UF_USR_1785305377085`
(`Не показывать на телевизоре`) enabled are automatically excluded from the
TV employee directory and their assigned tasks.

## Report analytics view

The `Отчёт` tab is the last visible tab in the view switcher. Its TV layout
is rendered by `renderStructureDashboard()` in `public/index.html` and contains:

- tasks tagged exactly `Закрывающий документ` are removed in
  `lib/task-report.js` before any dashboard counts and are also filtered in the
  client as a defensive fallback;
- proportional task distribution by top-level department;
- workload ratio by department: filtered-period primary tasks divided by the
  full visible employee roster of that top-level department; `ТБУ` is the
  arithmetic mean of these department ratios. The view renders a categorical
  line diagram with department points and a separate horizontal TBU line.
  Staffed departments remain visible with ratio `0.0` when the selected period
  contains no tasks;
- total overdue days by department; clicking a department bar opens its
  unfinished task list with Bitrix links and deadlines;
- a compact `Отклонения нагрузки` section with avatars: one list contains
  employees whose primary task count is above TBU, and the other contains those
  below 40% of their department's selected-period average (minimum comparison
  threshold: one task);
- expandable department cards with employee task counts, overdue days, and a
  workload header showing visible employee count and
  `filtered primary tasks / visible employees`.
- each department's `UF_HEAD` user is pinned as the first employee in the
  `Оценка` table and rendered with an avatar, manager badge, and green highlight;
- expandable employee rows with the selected period's task names, statuses,
  deadlines, and links back to Bitrix24.
- employee rows include a separate `Помогает` count column; the nested
  `Помогает` section contains
  tasks where that person is a Bitrix24 co-executor or observer but not the
  primary executor. Duplicate roles on the same task are merged.

Department and employee scores combine:

- `70%` average execution quality for tasks where the person is the primary
  executor;
- `30%` current deadline discipline: start at `100`, subtract `20` for each
  currently overdue task and `2` for every current overdue day, floor at `0`.

Execution quality per task is:

- closed or currently open in time: `100`;
- closed late: `100 - 2 × overdue days`, with a floor of `50`;
- currently open late: `70 - 5 × overdue days`, with a floor of `0`;
- without a deadline or unknown state: `75`.

This extra current-discipline component prevents a long task history from
diluting an active overdue problem. Task volume does not increase the score,
and `Помогает` tasks do not affect it.
Each employee row renders two score bars: `Все` uses all primary-executor tasks,
while `По плану` applies the identical formula only to tasks whose `ID проекта`
equals `51` (`OP_GROUP_ID`). If the employee has no project-51 tasks, the plan
score is shown as `—`.
The overdue day chart and employee overdue column include only currently open
overdue tasks; historical lateness still affects the quality score through the
softer closed-late rule. Child departments are rolled up to the direct children
of the AУП department (`157`). The view follows the global period and employee
search filters.
