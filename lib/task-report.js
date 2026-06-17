const TEN_MINUTES_MS = 10 * 60 * 1000;

export const TASK_REPORT_SQL = `
select
    t.id as "ID задачи",
    t.title as "Название задачи",
    t.description as "Описание",

    format_datetime(t.created_date, 'dd.MM.yyyy HH:mm') as "Дата создания",
    format_datetime(t.deadline, 'dd.MM.yyyy HH:mm') as "Дедлайн",
    case
        when t.closed_date is not null then format_datetime(t.closed_date, 'dd.MM.yyyy HH:mm')
        else ''
    end as "Дата закрытия",

    t.status as "Статус",
    t.mark as "Оценка",
    t.task_control as "Требует контроль результата",
    t.group_id as "ID проекта",
    t.group_name as "Проект",
    t.created_by_id as "ID постановщика",
    t.created_by_name as "Постановщик",
    t.responsible_id as "ID исполнителя",
    t.responsible_name as "Исполнитель",

    coalesce(
        os.name,
        nullif(u.dep3_n, ''),
        nullif(u.dep2_n, ''),
        nullif(u.dep1_n, ''),
        nullif(u.department_name, ''),
        'Без отдела'
    ) as "Отдел",

    t.priority as "Приоритет",
    t.stage_name as "Стадия задачи",

    case
        when t.activity_date is not null then format_datetime(t.activity_date, 'dd.MM.yyyy HH:mm')
        else ''
    end as "Последняя активность",

    t.comments_count as "Количество комментариев",
    t.time_estimate as "Плановое время",
    t.time_spent_in_logs as "Фактическое время",
    tuf.uf_crm_task as "Элементы CRM",
    tuf.uf_auto_538301140523 as "ID сделки",
    tuf.uf_auto_249729653696 as "Исполнитель UF",
    tuf.uf_task_overdue_days as "Просрочка UF, дн",
    tuf.uf_mail_message as "ID письма",

    case
        when t.deadline is null then 'Без дедлайна'
        when t.closed_date is not null and t.closed_date <= t.deadline then 'Закрыта в срок'
        when t.closed_date is not null and t.closed_date > t.deadline then 'Закрыта с просрочкой'
        when t.closed_date is null and current_timestamp > t.deadline then 'Открыта просрочена'
        when t.closed_date is null and current_timestamp <= t.deadline then 'Открыта в срок'
        else 'Другое'
    end as "Состояние задачи",

    case
        when t.deadline is null then null
        when t.closed_date is not null and t.closed_date <= t.deadline then 1
        when t.closed_date is not null and t.closed_date > t.deadline then -1
        when t.closed_date is null and current_timestamp > t.deadline then -2
        when t.closed_date is null and current_timestamp <= t.deadline then 0
        else 0
    end as "Баллы эффективности",

    case
        when t.deadline is not null and t.closed_date is not null
            then date_diff('day', t.deadline, t.closed_date)
        when t.deadline is not null and t.closed_date is null
            then date_diff('day', t.deadline, current_timestamp)
        else null
    end as "Сдвиг относительно дедлайна, дней",

    case
        when t.deadline is not null and t.closed_date is not null and t.closed_date > t.deadline
            then date_diff('day', t.deadline, t.closed_date)
        when t.deadline is not null and t.closed_date is null and current_timestamp > t.deadline
            then date_diff('day', t.deadline, current_timestamp)
        else 0
    end as "Просрочка, дней",

    case
        when t.deadline is not null and t.closed_date is not null and t.closed_date <= t.deadline then 1
        else 0
    end as "Закрыта в срок, флаг",

    case
        when t.deadline is not null and t.closed_date is not null and t.closed_date > t.deadline then 1
        else 0
    end as "Закрыта с просрочкой, флаг",

    case
        when t.deadline is not null and t.closed_date is null and current_timestamp > t.deadline then 1
        else 0
    end as "Открыта просрочена, флаг",

    case
        when t.deadline is not null and t.closed_date is null and current_timestamp <= t.deadline then 1
        else 0
    end as "Открыта в срок, флаг"

from task t
left join "user" u
    on u.id = t.responsible_id
left join org_structure os
    on try_cast(u.department_id as bigint) = os.id
left join task_uf tuf
    on tuf.task_id = t.id
where t.created_date >= current_date - interval '180' day
`;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function getStatementUrl() {
  const base = requireEnv('TASK_REPORT_SQL_ENDPOINT').replace(/\/$/, '');
  return base.endsWith('/v1/statement') ? base : `${base}/v1/statement`;
}

function getHeaders({ includeContentType = false } = {}) {
  const user = process.env.TASK_REPORT_SQL_USER || 'dashboard-apu';
  const headers = {
    Accept: 'application/json',
    'X-Trino-User': user,
    'X-Trino-Source': process.env.TASK_REPORT_SQL_SOURCE || 'dashboard-apu-report'
  };

  if (process.env.TASK_REPORT_SQL_CATALOG) {
    headers['X-Trino-Catalog'] = process.env.TASK_REPORT_SQL_CATALOG;
  }

  if (process.env.TASK_REPORT_SQL_SCHEMA) {
    headers['X-Trino-Schema'] = process.env.TASK_REPORT_SQL_SCHEMA;
  }

  if (process.env.TASK_REPORT_SQL_TOKEN) {
    headers.Authorization = `Bearer ${process.env.TASK_REPORT_SQL_TOKEN}`;
  } else if (process.env.TASK_REPORT_SQL_PASSWORD) {
    headers.Authorization = `Basic ${Buffer.from(`${user}:${process.env.TASK_REPORT_SQL_PASSWORD}`, 'utf8').toString('base64')}`;
  }

  if (includeContentType) {
    headers['Content-Type'] = 'text/plain; charset=utf-8';
  }

  return headers;
}

async function parseJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function requestJson(url, init) {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  const payload = await parseJson(response);

  if (!response.ok || payload.error) {
    const message = payload.error?.message || payload.error || response.statusText;
    throw new Error(`SQL request failed: ${message}`);
  }

  return payload;
}

function mapRows(columnNames, rows) {
  return rows.map((row) => Object.fromEntries(columnNames.map((column, index) => [column, row[index] ?? null])));
}

export async function runTaskReport() {
  const startedAt = Date.now();
  const sql = process.env.TASK_REPORT_SQL_OVERRIDE || TASK_REPORT_SQL;

  let payload = await requestJson(getStatementUrl(), {
    method: 'POST',
    headers: getHeaders({ includeContentType: true }),
    body: sql
  });

  const rows = [];
  let columns = payload.columns || [];

  if (Array.isArray(payload.data)) {
    rows.push(...payload.data);
  }

  while (payload.nextUri) {
    payload = await requestJson(payload.nextUri, {
      method: 'GET',
      headers: getHeaders()
    });

    if (!columns.length && Array.isArray(payload.columns)) {
      columns = payload.columns;
    }

    if (Array.isArray(payload.data)) {
      rows.push(...payload.data);
    }
  }

  const columnNames = columns.map((column) => column.name);

  return {
    fetchedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    refreshIntervalMs: TEN_MINUTES_MS,
    columns: columnNames,
    rows: mapRows(columnNames, rows),
    rowCount: rows.length
  };
}
