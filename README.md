# DashboardAPU

Отдельный Vercel-проект под отчетный поддомен.

## Что внутри

- `public/index.html` — статическая витрина отчета
- `api/task-report.js` — serverless endpoint
- `lib/task-report.js` — SQL и клиент к Trino/Presto HTTP API

## Нужные env

- `TASK_REPORT_SQL_ENDPOINT`
- `TASK_REPORT_SQL_USER`

Опционально:

- `TASK_REPORT_SQL_CATALOG`
- `TASK_REPORT_SQL_SCHEMA`
- `TASK_REPORT_SQL_SOURCE`
- `TASK_REPORT_SQL_TOKEN`
- `TASK_REPORT_SQL_PASSWORD`
- `TASK_REPORT_SQL_OVERRIDE`

## Поведение

- автообновление каждые 10 минут
- ручная кнопка принудительного обновления
- выгрузка CSV
- без индексации поисковиками
