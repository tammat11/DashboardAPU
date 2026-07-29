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

## Bitrix Project 51 Tag Classification

Task tags in Bitrix project `51` are classified from the numeric prefix of the
task title:

- `1.1.1 ...` (two dots) -> `ТАКТИЧЕСКИЕ ЗАДАЧИ`
- `1.1 ...` (one dot) -> `СТРАТЕГИЧЕСКИЕ ЗАДАЧИ`
- `I. ...`, `II. ...`, etc. -> `СТРАТЕГИЧЕСКИЕ ЦЕЛИ`

When applying the classification, remove every existing tag, including
`ОП2026`, `ОП2026:*`, and the legacy classification tags. Each task must retain
exactly one classification tag from the list above.

Live reconciliation completed on 2026-07-28:

- total tasks: 136
- tactical tasks: 100
- strategic tasks: 27
- strategic goals: 9
- residual mismatches: 0
- tasks with additional tags: 0

## Project 51 Plan Item Widget

Handler URL:

`https://weekly.185.98.7.103.nip.io/widget/plan-item`

The widget is embedded into a Bitrix task card and is available only when:

- the task belongs to project `51`;
- the task has the tag `ТАКТИЧЕСКИЕ ЗАДАЧИ`;
- its title starts with a number such as `1.1.1`.

The placement uses a two-panel flow:

- the original Bitrix application layer shows the current task context:
  status, deadline, participants, parent, description, and checklist;
- `BX24.openApplication` opens the compact add-item form in a 620 px slider on
  the right.

After a successful save, the right-hand form closes automatically while the
task context remains visible on the left.

The form collects the action, expected result, deadline, executor, and optional
working group. On submit it:

1. calculates the next checklist number;
2. adds the item under `Тактические подзадачи`;
3. appends structured result information to the task description;
4. extends the parent task deadline when necessary;
5. rereads the task and verifies the new checklist item.

Form usability:

- deadlines use the native date picker and quick actions for today, tomorrow,
  end of week, and end of month;
- the executor is selected from active Bitrix users;
- the working group supports search and multiple selection;
- the selected executor is added to task accomplices when needed;
- selected working-group members are added to task auditors;
- the active-user directory is cached server-side for 10 minutes.

The write endpoint is `POST /api/plan-item`. It requires a server-generated
HMAC token and revalidates the project and task tag before making changes.

Deployment:

- server: `tammat@185.98.7.103`
- directory: `/home/tammat/weekly-server`
- PM2 process: `weekly`

## План + задачи

Представление `План + задачи` в `public/index.html` использует структуру:

1. верхний отдел (`АУ`, `ФУ`, `УРК`, `УРБ`);
2. сотрудники отдела;
3. задачи сотрудника за выбранный период.

Дочерние подразделения сворачиваются в верхний отдел по актуальной иерархии
`department.get`: например, `Аккаунты` и `Аудиторы` входят в `УРК`, а
`Бухгалтерия` и `Юристы` — в `ФУ`. Сотрудники подразделений, которые не входят
ни в один из четырёх верхних отделов, в этом представлении не показываются.

Отделы раскрыты по умолчанию. Карточка сотрудника показывает полное ФИО,
выполненные и общие задачи, задачи по плану, вне плана и просрочку. После
раскрытия сотрудника видны название задачи, принадлежность к плану, статус,
роль сотрудника, дедлайн и ссылка на карточку задачи в Bitrix.

Карточки в этом представлении намеренно компактные и используют аватары 24 px:
четыре верхних отдела должны помещаться рядом на широком экране.

В детализацию входят все роли Bitrix: исполнитель, соисполнитель, постановщик
и наблюдатель. Одна задача показывается сотруднику только один раз, даже если
он занимает в ней несколько ролей.
