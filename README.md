# DashboardAPU

Отдельный Vercel-проект под отчетный поддомен.

## Что внутри

- `public/index.html` — статическая витрина отчета
- `api/task-report.js` — serverless endpoint
- `lib/task-report.js` — SQL и webhook-клиент

## Нужные env

- `TASK_REPORT_WEBHOOK_URL`

Опционально:

- `TASK_REPORT_WEBHOOK_METHOD` (`POST` по умолчанию)
- `TASK_REPORT_WEBHOOK_TOKEN`
- `TASK_REPORT_WEBHOOK_TOKEN_HEADER`
- `TASK_REPORT_WEBHOOK_TOKEN_PREFIX`
- `TASK_REPORT_WEBHOOK_HEADER_NAME`
- `TASK_REPORT_WEBHOOK_HEADER_VALUE`
- `TASK_REPORT_SQL_OVERRIDE`

## Формат webhook

По умолчанию проект шлет `POST` JSON:

```json
{
  "report": "tasks-efficiency",
  "requestedAt": "2026-06-17T10:00:00.000Z",
  "sql": "select ..."
}
```

Webhook в ответ может вернуть:

```json
{
  "ok": true,
  "columns": ["ID задачи", "Название задачи"],
  "rows": [
    { "ID задачи": 1, "Название задачи": "..." }
  ]
}
```

или массивы:

```json
{
  "ok": true,
  "columns": ["ID задачи", "Название задачи"],
  "rows": [
    [1, "..."]
  ]
}
```

## Поведение

- автообновление каждые 10 минут
- ручная кнопка принудительного обновления
- выгрузка CSV
- без индексации поисковиками
