export const config = { maxDuration: 60 };

const TASKS_PAGE_SIZE = 50;

function getBitrixBaseUrl() {
  const url = process.env.TASK_REPORT_WEBHOOK_URL || '';
  return url.endsWith('/') ? url : url + '/';
}

async function bx(method, params = {}) {
  const base = getBitrixBaseUrl();
  const res = await fetch(`${base}${method}.json`, {
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
      filter: { TAG: 'ОП2026' },
      select: ['ID', 'TITLE', 'TAGS', 'STATUS', 'REAL_STATUS', 'DEADLINE', 'RESPONSIBLE_ID', 'RESPONSIBLE_NAME'],
      start
    });
    const page = payload.result?.tasks || payload.result || [];
    tasks.push(...page);
    if (!Array.isArray(page) || page.length < TASKS_PAGE_SIZE) break;
  }
  return tasks;
}

async function fetchChecklists(taskIds) {
  const map = {};
  // batch 45 at a time
  for (let i = 0; i < taskIds.length; i += 45) {
    const chunk = taskIds.slice(i, i + 45);
    const cmd = {};
    chunk.forEach(id => { cmd[`cl_${id}`] = `task.checklistitem.getlist?taskId=${id}`; });
    try {
      const r = await bx('batch', { cmd, halt: 0 });
      const result = r.result?.result || {};
      Object.keys(result).forEach(k => {
        const tid = k.replace('cl_', '');
        const items = result[k];
        map[tid] = Array.isArray(items) ? items : Object.values(items || {});
      });
    } catch { /* skip */ }
  }
  return map;
}

function getOpCode(tags) {
  const arr = Array.isArray(tags) ? tags : [];
  const tag = arr.find(t => (t || '').startsWith('ОП2026:'));
  return tag ? tag.replace('ОП2026:', '').trim() : null;
}

const ROMAN = { I:1,II:2,III:3,IV:4,V:5,VI:6,VII:7,VIII:8,IX:9 };

function codeLevel(code) {
  if (!code) return -1;
  if (ROMAN[code] !== undefined) return 0;  // goal: I, II ...
  const parts = code.split('.');
  return parts.length - 1; // 1.1 → 1, 1.1.1 → 2
}

function goalNum(code) {
  return ROMAN[code] || parseInt(code) || 0;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.TASK_REPORT_WEBHOOK_URL) {
    return res.status(500).json({ ok: false, error: 'Webhook URL not configured' });
  }

  try {
    const tasks = await fetchOpTasks();

    const goals = [], stratTasks = [], tactTasks = [];
    tasks.forEach(t => {
      const tags = t.tags || t.TAGS || [];
      const code = getOpCode(tags);
      t._code = code;
      const lvl = codeLevel(code);
      if (lvl === 0) goals.push(t);
      else if (lvl === 1) stratTasks.push(t);
      else if (lvl === 2) tactTasks.push(t);
    });

    // Fetch checklists for tactical tasks
    const tactIds = tactTasks.map(t => String(t.id || t.ID));
    const checklists = tactIds.length ? await fetchChecklists(tactIds) : {};

    const tree = goals.map(g => {
      const gCode = g._code;
      const gNum = goalNum(gCode);

      const children = stratTasks
        .filter(st => st._code && st._code.startsWith(gNum + '.') && st._code.split('.').length === 2)
        .sort((a, b) => a._code.localeCompare(b._code))
        .map(st => {
          const stPrefix = st._code + '.';
          const tacts = tactTasks
            .filter(tt => tt._code && tt._code.startsWith(stPrefix) && tt._code.split('.').length === 3)
            .sort((a, b) => a._code.localeCompare(b._code))
            .map(tt => {
              const ttId = String(tt.id || tt.ID);
              const items = checklists[ttId] || [];
              const totalSteps = items.length;
              const doneSteps = items.filter(i => i.IS_COMPLETE === 'Y' || i.isComplete === 'Y').length;
              const overdueSteps = items.filter(i => {
                if (i.IS_COMPLETE === 'Y' || i.isComplete === 'Y') return false;
                const d = i.DEADLINE || i.deadline;
                return d && new Date(d) < new Date();
              }).length;
              return {
                id: ttId,
                code: tt._code,
                title: String(tt.title || tt.TITLE || ''),
                deadline: tt.deadline || tt.DEADLINE || null,
                responsible: tt.responsibleName || tt.RESPONSIBLE_NAME || '',
                done: (tt.realStatus || tt.REAL_STATUS) === '5',
                totalSteps,
                doneSteps,
                overdueSteps
              };
            });

          const totalSteps = tacts.reduce((a, t) => a + t.totalSteps, 0);
          const doneSteps  = tacts.reduce((a, t) => a + t.doneSteps, 0);
          const overdueSteps = tacts.reduce((a, t) => a + t.overdueSteps, 0);
          return { code: st._code, title: String(st.title || st.TITLE || ''), tacts, totalSteps, doneSteps, overdueSteps };
        });

      const totalSteps   = children.reduce((a, c) => a + c.totalSteps, 0);
      const doneSteps    = children.reduce((a, c) => a + c.doneSteps, 0);
      const overdueSteps = children.reduce((a, c) => a + c.overdueSteps, 0);

      return { code: gCode, num: gNum, title: String(g.title || g.TITLE || ''), children, totalSteps, doneSteps, overdueSteps };
    }).sort((a, b) => a.num - b.num);

    return res.status(200).json({ ok: true, goals: tree, fetchedAt: new Date().toISOString() });
  } catch (e) {
    console.error('op-plan error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
