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

function getWebhookMethod() {
  return (process.env.TASK_REPORT_WEBHOOK_METHOD || 'POST').toUpperCase();
}

function getWebhookHeaders() {
  const headers = {
    Accept: 'application/json'
  };

  if (getWebhookMethod() !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }

  const token = process.env.TASK_REPORT_WEBHOOK_TOKEN;
  if (token) {
    const headerName = process.env.TASK_REPORT_WEBHOOK_TOKEN_HEADER || 'Authorization';
    const prefix = process.env.TASK_REPORT_WEBHOOK_TOKEN_PREFIX || 'Bearer';
    headers[headerName] = headerName.toLowerCase() === 'authorization' ? `${prefix} ${token}` : token;
  }

  const extraHeaderName = process.env.TASK_REPORT_WEBHOOK_HEADER_NAME;
  const extraHeaderValue = process.env.TASK_REPORT_WEBHOOK_HEADER_VALUE;
  if (extraHeaderName && extraHeaderValue) {
    headers[extraHeaderName] = extraHeaderValue;
  }

  return headers;
}

async function parseJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

function normalizeColumnNames(columns, rows) {
  if (Array.isArray(columns) && columns.length > 0) {
    return columns.map((column) => typeof column === 'string' ? column : column.name);
  }

  if (Array.isArray(rows) && rows.length > 0 && !Array.isArray(rows[0]) && typeof rows[0] === 'object') {
    return Object.keys(rows[0]);
  }

  return [];
}

function normalizeRows(columnNames, payload) {
  if (Array.isArray(payload.rows)) {
    if (payload.rows.length === 0) return [];
    if (Array.isArray(payload.rows[0])) {
      return payload.rows.map((row) => Object.fromEntries(columnNames.map((column, index) => [column, row[index] ?? null])));
    }
    return payload.rows;
  }

  if (Array.isArray(payload.data)) {
    if (payload.data.length === 0) return [];
    if (Array.isArray(payload.data[0])) {
      return payload.data.map((row) => Object.fromEntries(columnNames.map((column, index) => [column, row[index] ?? null])));
    }
    return payload.data;
  }

  if (Array.isArray(payload.items)) {
    return payload.items;
  }

  return [];
}

function normalizePayload(payload, startedAt) {
  if (payload.ok === false) {
    throw new Error(payload.error || 'Webhook returned ok=false');
  }

  const rowsCandidate = payload.rows || payload.data || payload.items || [];
  const columnNames = normalizeColumnNames(payload.columns, rowsCandidate);
  const rows = normalizeRows(columnNames, payload);

  return {
    fetchedAt: payload.fetchedAt || new Date().toISOString(),
    durationMs: payload.durationMs || (Date.now() - startedAt),
    refreshIntervalMs: payload.refreshIntervalMs || TEN_MINUTES_MS,
    columns: columnNames,
    rows,
    rowCount: payload.rowCount || rows.length
  };
}

export async function runTaskReport() {
  const startedAt = Date.now();
  const webhookUrl = requireEnv('TASK_REPORT_WEBHOOK_URL');
  const method = getWebhookMethod();
  const sql = process.env.TASK_REPORT_SQL_OVERRIDE || TASK_REPORT_SQL;

  const bodyPayload = {
    report: 'tasks-efficiency',
    requestedAt: new Date().toISOString(),
    sql
  };

  const response = await fetch(webhookUrl, {
    method,
    headers: getWebhookHeaders(),
    body: method === 'GET' ? undefined : JSON.stringify(bodyPayload),
    cache: 'no-store'
  });

  const payload = await parseJson(response);

  if (!response.ok) {
    const message = payload.error || payload.message || response.statusText;
    throw new Error(`Webhook request failed: ${message}`);
  }

  return normalizePayload(payload, startedAt);
}
