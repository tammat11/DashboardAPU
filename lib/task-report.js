const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const TASKS_PAGE_SIZE = 50;

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
    end as "Состояние задачи"
`;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function toIsoDate(daysAgo = 0) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString();
}

function formatDateTime(value) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const pad = (part) => String(part).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getIsoString(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function pick(task, candidates, fallback = null) {
  for (const key of candidates) {
    if (task && Object.prototype.hasOwnProperty.call(task, key) && task[key] !== undefined) {
      return task[key];
    }
  }
  return fallback;
}

function normalizeBitrixBaseUrl(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

function isBitrixRestBaseUrl(url) {
  return /\/rest\/\d+\/[^/]+\/?$/i.test(url);
}

async function parseJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function bitrixRequest(baseUrl, method, params = {}) {
  const response = await fetch(`${normalizeBitrixBaseUrl(baseUrl)}${method}.json`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(params),
    cache: 'no-store'
  });

  const payload = await parseJson(response);

  if (!response.ok || payload.error) {
    const message = payload.error_description || payload.error || response.statusText;
    throw new Error(message);
  }

  return payload;
}

async function fetchAllTasks(baseUrl) {
  const tasks = [];

  for (let start = 0; ; start += TASKS_PAGE_SIZE) {
    const payload = await bitrixRequest(baseUrl, 'tasks.task.list', {
      order: {
        ID: 'asc'
      },
      filter: {
        '>=CREATED_DATE': toIsoDate(180)
      },
      select: [
        'ID',
        'TITLE',
        'DESCRIPTION',
        'CREATED_DATE',
        'DEADLINE',
        'CLOSED_DATE',
        'STATUS',
        'REAL_STATUS',
        'MARK',
        'TASK_CONTROL',
        'GROUP_ID',
        'CREATED_BY',
        'RESPONSIBLE_ID',
        'ACCOMPLICE',
        'PRIORITY',
        'STAGE_ID',
        'STAGE_NAME',
        'ACTIVITY_DATE',
        'COMMENTS_COUNT',
        'TIME_ESTIMATE',
        'TIME_SPENT_IN_LOGS',
        'UF_CRM_TASK',
        'UF_AUTO_538301140523',
        'UF_AUTO_249729653696',
        'UF_TASK_OVERDUE_DAYS',
        'UF_MAIL_MESSAGE'
      ],
      params: {
        WITH_TIMER_INFO: true
      },
      start
    });

    const pageTasks = payload.result?.tasks || payload.result || [];
    tasks.push(...pageTasks);

    if (!Array.isArray(pageTasks) || pageTasks.length < TASKS_PAGE_SIZE) {
      break;
    }
  }

  return tasks;
}

async function fetchUsersMap(baseUrl, ids) {
  if (ids.length === 0) return new Map();

  try {
    const payload = await bitrixRequest(baseUrl, 'user.get', {
      ID: ids,
      ADMIN_MODE: true
    });

    const users = payload.result || [];
    return new Map(users.map((user) => [String(user.ID), user]));
  } catch {
    const map = new Map();

    for (const id of ids) {
      try {
        const payload = await bitrixRequest(baseUrl, 'user.get', {
          ID: id,
          ADMIN_MODE: true
        });
        const user = Array.isArray(payload.result) ? payload.result[0] : null;
        if (user?.ID) {
          map.set(String(user.ID), user);
        }
      } catch {
        // Ignore single user failures and keep rendering the report.
      }
    }

    return map;
  }
}

async function fetchDepartmentsMap(baseUrl) {
  try {
    const payload = await bitrixRequest(baseUrl, 'department.get', {});
    const departments = payload.result || [];
    return new Map(departments.map((department) => [String(department.ID), department.NAME]));
  } catch {
    return new Map();
  }
}

function getUserDisplayName(user) {
  if (!user) return '';
  return [user.NAME, user.LAST_NAME].filter(Boolean).join(' ').trim();
}

function getUserAvatar(user) {
  if (!user) return '';
  const photo = user.PERSONAL_PHOTO || user.personalPhoto || '';
  return typeof photo === 'string' ? photo : '';
}

function getUserDepartmentName(user, departmentsMap) {
  const departmentIds = Array.isArray(user?.UF_DEPARTMENT) ? user.UF_DEPARTMENT : [];

  for (const departmentId of departmentIds) {
    const name = departmentsMap.get(String(departmentId));
    if (name) return name;
  }

  return 'Без отдела';
}

function getUserPosition(user) {
  if (!user) return '';
  return user.WORK_POSITION || user.workPosition || '';
}

function formatAccomplices(task, usersMap, departmentsMap) {
  const accompliceData = pick(task, ['accomplice', 'ACCOMPLICE'], {});
  if (!accompliceData || typeof accompliceData !== 'object') return JSON.stringify([]);

  const accomplices = [];
  for (const [userId, accompliceInfo] of Object.entries(accompliceData)) {
    const user = usersMap.get(String(userId));
    if (user) {
      accomplices.push({
        id: String(userId),
        name: getUserDisplayName(user),
        dept: getUserDepartmentName(user, departmentsMap),
        avatar: getUserAvatar(user)
      });
    }
  }
  return JSON.stringify(accomplices);
}

function mapTaskRow(task, usersMap, departmentsMap) {
  const createdById = String(pick(task, ['createdBy', 'createdById', 'CREATED_BY', 'created_by'], ''));
  const responsibleId = String(pick(task, ['responsibleId', 'RESPONSIBLE_ID', 'responsible_id'], ''));
  const createdByUser = usersMap.get(createdById);
  const responsibleUser = usersMap.get(responsibleId);

  const createdDate = pick(task, ['createdDate', 'CREATED_DATE', 'created_date']);
  const deadline = pick(task, ['deadline', 'DEADLINE']);
  const closedDate = pick(task, ['closedDate', 'CLOSED_DATE', 'closed_date']);
  const activityDate = pick(task, ['activityDate', 'ACTIVITY_DATE', 'activity_date']);
  const status = pick(task, ['status', 'REAL_STATUS', 'STATUS']);

  const now = Date.now();
  const deadlineTs = deadline ? new Date(deadline).getTime() : null;
  const closedTs = closedDate ? new Date(closedDate).getTime() : null;

  let state = 'Другое';
  let efficiency = 0;
  let shiftDays = null;
  let overdueDays = 0;

  if (!deadlineTs || Number.isNaN(deadlineTs)) {
    state = 'Без дедлайна';
    efficiency = 1;
  } else if (closedTs && !Number.isNaN(closedTs)) {
    const deadlineDay = new Date(deadlineTs);
    const closedDay = new Date(closedTs);
    const deadlineDateOnly = new Date(deadlineDay.getFullYear(), deadlineDay.getMonth(), deadlineDay.getDate());
    const closedDateOnly = new Date(closedDay.getFullYear(), closedDay.getMonth(), closedDay.getDate());
    const daysDiff = Math.floor((closedDateOnly - deadlineDateOnly) / 86400000);

    shiftDays = Math.max(0, daysDiff);

    if (closedTs <= deadlineTs) {
      state = 'Закрыта в срок';
      efficiency = 5;
      overdueDays = 0;
    } else if (daysDiff >= 1) {
      state = 'Закрыта с просрочкой';
      efficiency = 3;
      overdueDays = daysDiff;
    } else {
      // Overdue by hours, but closed on the same calendar day -> do not deduct points
      state = 'Закрыта в срок';
      efficiency = 5;
      overdueDays = 0;
    }
  } else {
    shiftDays = Math.floor((now - deadlineTs) / 86400000);
    if (now > deadlineTs) {
      state = 'Открыта просрочена';
      efficiency = 0;
      overdueDays = Math.max(1, shiftDays);
    } else {
      state = 'Открыта в срок';
      efficiency = 2;
    }
  }

  return {
    'ID задачи': pick(task, ['id', 'ID']),
    'Название задачи': pick(task, ['title', 'TITLE'], ''),
    'Описание': pick(task, ['description', 'DESCRIPTION'], ''),
    'Дата создания': formatDateTime(createdDate),
    'Дедлайн': formatDateTime(deadline),
    'Дата закрытия': formatDateTime(closedDate),
    'createdDateRaw': getIsoString(createdDate),
    'deadlineRaw': getIsoString(deadline),
    'closedDateRaw': getIsoString(closedDate),
    'Статус': status,
    'Оценка': pick(task, ['mark', 'MARK'], ''),
    'Требует контроль результата': pick(task, ['taskControl', 'TASK_CONTROL'], ''),
    'ID проекта': pick(task, ['groupId', 'GROUP_ID'], ''),
    'Проект': pick(task, ['groupName', 'GROUP_NAME'], pick(task, ['groupId', 'GROUP_ID'], '')),
    'ID постановщика': createdById,
    'Постановщик': getUserDisplayName(createdByUser),
    'Аватар постановщика': getUserAvatar(createdByUser),
    'Отдел постановщика': getUserDepartmentName(createdByUser, departmentsMap),
    'ID исполнителя': responsibleId,
    'Исполнитель': getUserDisplayName(responsibleUser),
    'Должность исполнителя': getUserPosition(responsibleUser),
    'Аватар': getUserAvatar(responsibleUser),
    'Отдел': getUserDepartmentName(responsibleUser, departmentsMap),
    'Соисполнители': formatAccomplices(task, usersMap, departmentsMap),
    'Приоритет': pick(task, ['priority', 'PRIORITY'], ''),
    'Стадия задачи': pick(task, ['stageName', 'STAGE_NAME', 'stageId', 'STAGE_ID'], ''),
    'Последняя активность': formatDateTime(activityDate),
    'Количество комментариев': pick(task, ['commentsCount', 'COMMENTS_COUNT'], 0),
    'Плановое время': pick(task, ['timeEstimate', 'TIME_ESTIMATE'], 0),
    'Фактическое время': pick(task, ['timeSpentInLogs', 'TIME_SPENT_IN_LOGS'], 0),
    'Элементы CRM': pick(task, ['ufCrmTask', 'UF_CRM_TASK'], ''),
    'ID сделки': pick(task, ['ufAuto538301140523', 'UF_AUTO_538301140523'], ''),
    'Исполнитель UF': pick(task, ['ufAuto249729653696', 'UF_AUTO_249729653696'], ''),
    'Просрочка UF, дн': pick(task, ['ufTaskOverdueDays', 'UF_TASK_OVERDUE_DAYS'], ''),
    'ID письма': pick(task, ['ufMailMessage', 'UF_MAIL_MESSAGE'], ''),
    'Состояние задачи': state,
    'Баллы эффективности': efficiency,
    'Сдвиг относительно дедлайна, дней': shiftDays,
    'Просрочка, дней': overdueDays,
    'Закрыта в срок, флаг': state === 'Закрыта в срок' ? 1 : 0,
    'Закрыта с просрочкой, флаг': state === 'Закрыта с просрочкой' ? 1 : 0,
    'Открыта просрочена, флаг': state === 'Открыта просрочена' ? 1 : 0,
    'Открыта в срок, флаг': state === 'Открыта в срок' ? 1 : 0
  };
}

async function runBitrixTaskReport(baseUrl) {
  const startedAt = Date.now();
  const tasks = await fetchAllTasks(baseUrl);

  const userIds = Array.from(new Set(tasks.flatMap((task) => {
    const createdBy = parseInteger(pick(task, ['createdBy', 'createdById', 'CREATED_BY', 'created_by']));
    const responsible = parseInteger(pick(task, ['responsibleId', 'RESPONSIBLE_ID', 'responsible_id']));
    return [createdBy, responsible].filter(Boolean).map(String);
  })));

  const [usersMap, departments] = await Promise.all([
    fetchUsersMap(baseUrl, userIds),
    bitrixRequest(baseUrl, 'department.get', {}).then(r => r.result || []).catch(() => [])
  ]);

  const departmentsMap = new Map(departments.map((d) => [String(d.ID), d.NAME]));

  // Fetch all active employees in АУП (157) and sub-departments
  let allEmployees = [];
  try {
    const aupId = '157';
    const aupDeptIds = new Set([aupId]);
    let changed = true;
    while (changed) {
      changed = false;
      departments.forEach(d => {
        if (aupDeptIds.has(String(d.PARENT || '')) && !aupDeptIds.has(String(d.ID))) {
          aupDeptIds.add(String(d.ID)); changed = true;
        }
      });
    }
    const allEmployeesMap = new Map();
    // Sequential to avoid Bitrix rate limits
    for (const deptId of aupDeptIds) {
      try {
        const r = await bitrixRequest(baseUrl, 'user.get', { UF_DEPARTMENT: deptId, ACTIVE: true });
        // Label by the АУП department the user was found under. Users often also
        // belong to the root "IC Group", which getUserDepartmentName would pick first.
        const deptName = departmentsMap.get(String(deptId)) || 'Без отдела';
        (r.result || []).forEach(u => {
          if (!allEmployeesMap.has(String(u.ID))) {
            allEmployeesMap.set(String(u.ID), { user: u, dept: deptName });
          }
        });
      } catch { /* skip failed dept */ }
    }
    allEmployees = Array.from(allEmployeesMap.values()).map(({ user, dept }) => ({
      id: String(user.ID),
      name: getUserDisplayName(user),
      avatar: getUserAvatar(user),
      dept
    }));
  } catch { /* allEmployees stays [] */ }

  const rows = tasks.map((task) => mapTaskRow(task, usersMap, departmentsMap));
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [
    'ID задачи',
    'Название задачи',
    'Описание'
  ];

  let portalHost = null;
  try {
    portalHost = new URL(baseUrl).host;
  } catch {}

  return {
    fetchedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    columns,
    rows,
    rowCount: rows.length,
    departments,
    portalHost,
    allEmployees
  };
}

function getWebhookMethod() {
  return (process.env.TASK_REPORT_WEBHOOK_METHOD || 'POST').toUpperCase();
}

function getWebhookHeaders() {
  const headers = { Accept: 'application/json' };

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
    refreshIntervalMs: payload.refreshIntervalMs || REFRESH_INTERVAL_MS,
    columns: columnNames,
    rows,
    rowCount: payload.rowCount || rows.length
  };
}

async function runGenericWebhookReport(webhookUrl) {
  const startedAt = Date.now();
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

export async function runTaskReport() {
  const webhookUrl = requireEnv('TASK_REPORT_WEBHOOK_URL');

  if (isBitrixRestBaseUrl(webhookUrl)) {
    return runBitrixTaskReport(webhookUrl);
  }

  return runGenericWebhookReport(webhookUrl);
}
