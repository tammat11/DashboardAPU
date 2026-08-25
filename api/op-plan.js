export const config = { maxDuration: 60 };

const TASKS_PAGE_SIZE = 50;
const OP_GROUP_ID = 51;
const TAG_PREFIX = 'ОП2026:';
const EXCLUDED_USER_IDS = new Set(['57']);

function isExcludedPerson(value) {
  const name = String(value || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  return name.includes('арайлым') && name.includes('ташенова');
}

function isExcludedTask(task) {
  const responsibleId = task.responsibleId || task.RESPONSIBLE_ID || '';
  return EXCLUDED_USER_IDS.has(String(responsibleId));
}

// AUDITORS/ACCOMPLICES come back as an array or an id-keyed object.
function idList(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : Object.values(raw);
  return arr.map(String).filter(v => /^\d+$/.test(v));
}

function baseUrl() {
  const url = process.env.TASK_REPORT_WEBHOOK_URL || '';
  return url.endsWith('/') ? url : url + '/';
}

async function bx(method, params = {}) {
  const res = await fetch(`${baseUrl()}${method}.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(params),
    cache: 'no-store'
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok || json.error) throw new Error(json.error_description || json.error || res.statusText);
  return json;
}

async function fetchOpTasks() {
  const tasks = [];
  for (let start = 0; ; start += TASKS_PAGE_SIZE) {
    const payload = await bx('tasks.task.list', {
      order: { ID: 'asc' },
      filter: { GROUP_ID: OP_GROUP_ID },
      select: ['ID', 'TITLE', 'TAGS', 'STATUS', 'REAL_STATUS', 'DEADLINE', 'RESPONSIBLE_ID', 'ACCOMPLICES', 'AUDITORS'],
      start
    });
    const page = payload.result?.tasks || payload.result || [];
    tasks.push(...page);
    if (!Array.isArray(page) || page.length < TASKS_PAGE_SIZE) break;
  }
  return tasks;
}

// Кол-во прикреплённых результатов (вкладка «Результат» задачи Bitrix).
async function fetchResultCounts(taskIds) {
  const map = {};
  for (let i = 0; i < taskIds.length; i += 45) {
    const chunk = taskIds.slice(i, i + 45);
    const cmd = {};
    chunk.forEach(id => { cmd[`r${id}`] = `tasks.task.result.list?taskId=${id}`; });
    try {
      const r = await bx('batch', { halt: 0, cmd });
      const result = r.result?.result || {};
      Object.keys(result).forEach(k => {
        let res = result[k];
        if (res && res.result) res = res.result;
        const arr = Array.isArray(res) ? res : Object.values(res || {});
        map[k.slice(1)] = arr.length;
      });
    } catch { /* skip failed batch */ }
  }
  return map;
}

async function fetchChecklists(taskIds) {
  const map = {};
  for (let i = 0; i < taskIds.length; i += 45) {
    const chunk = taskIds.slice(i, i + 45);
    const cmd = {};
    chunk.forEach(id => { cmd[`c${id}`] = `task.checklistitem.getlist?taskId=${id}`; });
    try {
      const r = await bx('batch', { halt: 0, cmd });
      const result = r.result?.result || {};
      Object.keys(result).forEach(k => {
        const items = result[k];
        map[k.slice(1)] = Array.isArray(items) ? items : Object.values(items || {});
      });
    } catch { /* skip failed batch */ }
  }
  return map;
}

// Bitrix returns tags as { "101": { id, title }, … } — not an array
function opCode(task) {
  const tags = task.tags || task.TAGS || {};
  const titles = Array.isArray(tags)
    ? tags.map(t => (typeof t === 'string' ? t : t?.title || ''))
    : Object.values(tags).map(t => (typeof t === 'string' ? t : t?.title || ''));
  const tag = titles.find(t => t.startsWith(TAG_PREFIX));
  return tag ? tag.slice(TAG_PREFIX.length).trim() : null;
}

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9 };

// Step title format: "1.1.1.1 Текст задачи · до 01.08.2026 · исполнитель: Шынырбай Б."
function parseStep(item) {
  const raw = String(item.TITLE || item.title || '').trim();
  const parts = raw.split('·').map(s => s.trim());

  let head = parts[0] || '';
  const codeMatch = head.match(/^(\d+(?:\.\d+)+)\s+/);
  const code = codeMatch ? codeMatch[1] : null;
  const text = codeMatch ? head.slice(codeMatch[0].length).trim() : head;

  let deadline = null;
  let responsible = '';
  for (const p of parts.slice(1)) {
    const d = p.match(/до\s+(\d{2})\.(\d{2})\.(\d{4})/);
    if (d) { deadline = `${d[3]}-${d[2]}-${d[1]}`; continue; }
    const r = p.match(/исполнитель:\s*(.+)$/i);
    if (r) responsible = r[1].trim();
  }

  const rawMembers = Array.isArray(item.MEMBERS) ? item.MEMBERS : Object.values(item.MEMBERS || {});
  const members = rawMembers
    .filter(m => m && m.ID)
    .map(m => ({ id: String(m.ID), type: String(m.TYPE || '') }));

  return {
    code,
    text,
    deadline,
    responsible,
    members,
    done: (item.IS_COMPLETE || item.isComplete) === 'Y'
  };
}

// Resolve Bitrix user ids to name + avatar (batched user.get).
async function fetchUsers(ids) {
  const map = {};
  const unique = Array.from(new Set(ids.map(String).filter(Boolean)));
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    try {
      const r = await bx('user.get', { ID: chunk, ADMIN_MODE: true });
      (r.result || []).forEach(u => {
        const name = [u.NAME, u.LAST_NAME].filter(Boolean).join(' ').trim() || u.EMAIL || `ID ${u.ID}`;
        map[String(u.ID)] = { id: String(u.ID), name, avatar: u.PERSONAL_PHOTO || '' };
      });
    } catch { /* skip */ }
  }
  return map;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.TASK_REPORT_WEBHOOK_URL) {
    return res.status(500).json({ ok: false, error: 'TASK_REPORT_WEBHOOK_URL не настроен' });
  }

  try {
    const tasks = (await fetchOpTasks()).filter(task => !isExcludedTask(task));

    const goals = [], strat = [], tact = [];
    for (const t of tasks) {
      const code = opCode(t);
      if (!code) continue;
      t._code = code;
      const depth = code.split('.').length - 1;
      if (ROMAN[code] !== undefined) goals.push(t);
      else if (depth === 1) strat.push(t);
      else if (depth === 2) tact.push(t);
    }

    const tactIds = tact.map(t => String(t.id || t.ID));
    const checklists = tactIds.length ? await fetchChecklists(tactIds) : {};
    const resultCounts = tactIds.length ? await fetchResultCounts(tactIds) : {};

    // Build tactical task objects with their steps. Counters are deliberately NOT
    // computed here: the client aggregates them so the period filter can apply.
    const tactByCode = {};
    for (const tt of tact) {
      const id = String(tt.id || tt.ID);
      // Only real steps — the "Тактические подзадачи" header has PARENT_ID 0
      const items = (checklists[id] || []).filter(i => String(i.PARENT_ID || 0) !== '0');

      tactByCode[tt._code] = {
        id,
        code: tt._code,
        title: String(tt.title || tt.TITLE || '').replace(/^[\d.]+\s*/, ''),
        deadline: tt.deadline || tt.DEADLINE || null,
        responsibleId: String(tt.responsibleId || tt.RESPONSIBLE_ID || ''),
        auditorIds: idList(tt.auditors ?? tt.AUDITORS),
        resultCount: resultCounts[id] || 0,
        steps: items.map(parseStep).filter(step => !isExcludedPerson(step.responsible))
      };
    }

    // Resolve people to name + avatar: the tactical task's responsible person and
    // any checklist members (type A = executor, U = observer) still set in Bitrix.
    const memberIds = [];
    Object.values(tactByCode).forEach(t => {
      if (t.responsibleId) memberIds.push(t.responsibleId);
      (t.auditorIds || []).forEach(id => memberIds.push(id));
      t.steps.forEach(s => (s.members || []).forEach(m => memberIds.push(m.id)));
    });
    const usersMap = memberIds.length ? await fetchUsers(memberIds) : {};
    Object.values(tactByCode).forEach(t => {
      t.responsible = usersMap[t.responsibleId] || null;
      t.observers = (t.auditorIds || [])
        .map(id => usersMap[id])
        .filter(u => u && u.id !== t.responsibleId && !isExcludedPerson(u.name));
      delete t.responsibleId;
      delete t.auditorIds;
    });
    Object.values(tactByCode).forEach(t => t.steps.forEach(s => {
      const executors = [];
      const observers = [];
      (s.members || []).forEach(m => {
        const u = usersMap[m.id];
        if (!u || isExcludedPerson(u.name)) return;
        (m.type === 'U' ? observers : executors).push(u);
      });
      s.executors = executors;
      s.observers = observers;
      delete s.members;
    }));

    const tree = goals.map(g => {
      const gNum = ROMAN[g._code] || 0;

      const children = strat
        .filter(s => s._code.split('.')[0] === String(gNum))
        .sort((a, b) => a._code.localeCompare(b._code, undefined, { numeric: true }))
        .map(s => ({
          code: s._code,
          title: String(s.title || s.TITLE || '').replace(/^[\d.]+\s*/, ''),
          tacts: Object.values(tactByCode)
            .filter(t => t.code.startsWith(s._code + '.'))
            .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
        }));

      return {
        code: g._code,
        num: gNum,
        title: String(g.title || g.TITLE || '').replace(/^[IVX]+\.\s*/, '').trim(),
        children
      };
    }).sort((a, b) => a.num - b.num);

    return res.status(200).json({
      ok: true,
      goals: tree,
      fetchedAt: new Date().toISOString()
    });
  } catch (e) {
    console.error('op-plan error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
