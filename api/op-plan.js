export const config = { maxDuration: 60 };

const TASKS_PAGE_SIZE = 50;
const OP_GROUP_ID = 51;
const TAG_PREFIX = 'ОП2026:';

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
      select: ['ID', 'TITLE', 'TAGS', 'STATUS', 'REAL_STATUS', 'DEADLINE', 'RESPONSIBLE_ID'],
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

  return {
    code,
    text,
    deadline,
    responsible,
    done: (item.IS_COMPLETE || item.isComplete) === 'Y'
  };
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
    const tasks = await fetchOpTasks();

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

    const now = Date.now();
    const SOON_MS = 14 * 24 * 60 * 60 * 1000;

    // Build tactical task objects with their steps
    const tactByCode = {};
    for (const tt of tact) {
      const id = String(tt.id || tt.ID);
      // Only real steps — the "Тактические подзадачи" header has PARENT_ID 0
      const items = (checklists[id] || []).filter(i => String(i.PARENT_ID || 0) !== '0');
      const steps = items.map(parseStep);

      let done = 0, overdue = 0, soon = 0;
      for (const s of steps) {
        if (s.done) { done++; continue; }
        if (!s.deadline) continue;
        const dt = new Date(s.deadline).getTime();
        if (dt < now) overdue++;
        else if (dt - now <= SOON_MS) soon++;
      }

      tactByCode[tt._code] = {
        id,
        code: tt._code,
        title: String(tt.title || tt.TITLE || '').replace(/^[\d.]+\s*/, ''),
        deadline: tt.deadline || tt.DEADLINE || null,
        steps,
        totalSteps: steps.length,
        doneSteps: done,
        overdueSteps: overdue,
        soonSteps: soon
      };
    }

    const tree = goals.map(g => {
      const gNum = ROMAN[g._code] || 0;

      const children = strat
        .filter(s => s._code.split('.')[0] === String(gNum))
        .sort((a, b) => a._code.localeCompare(b._code, undefined, { numeric: true }))
        .map(s => {
          const tacts = Object.values(tactByCode)
            .filter(t => t.code.startsWith(s._code + '.'))
            .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
          return {
            code: s._code,
            title: String(s.title || s.TITLE || '').replace(/^[\d.]+\s*/, ''),
            tacts,
            totalSteps: tacts.reduce((a, t) => a + t.totalSteps, 0),
            doneSteps: tacts.reduce((a, t) => a + t.doneSteps, 0),
            overdueSteps: tacts.reduce((a, t) => a + t.overdueSteps, 0),
            soonSteps: tacts.reduce((a, t) => a + t.soonSteps, 0)
          };
        });

      return {
        code: g._code,
        num: gNum,
        title: String(g.title || g.TITLE || '').replace(/^[IVX]+\.\s*/, '').trim(),
        children,
        totalSteps: children.reduce((a, c) => a + c.totalSteps, 0),
        doneSteps: children.reduce((a, c) => a + c.doneSteps, 0),
        overdueSteps: children.reduce((a, c) => a + c.overdueSteps, 0),
        soonSteps: children.reduce((a, c) => a + c.soonSteps, 0)
      };
    }).sort((a, b) => a.num - b.num);

    // Flat list of open steps sorted by deadline — for the upcoming-deadlines strip
    const upcoming = [];
    for (const g of tree) {
      for (const s of g.children) {
        for (const t of s.tacts) {
          for (const st of t.steps) {
            if (st.done || !st.deadline) continue;
            upcoming.push({ ...st, goal: g.code, goalTitle: g.title });
          }
        }
      }
    }
    upcoming.sort((a, b) => a.deadline.localeCompare(b.deadline));

    const totals = {
      goals: tree.length,
      strat: strat.length,
      tact: tact.length,
      steps: tree.reduce((a, g) => a + g.totalSteps, 0),
      done: tree.reduce((a, g) => a + g.doneSteps, 0),
      overdue: tree.reduce((a, g) => a + g.overdueSteps, 0),
      soon: tree.reduce((a, g) => a + g.soonSteps, 0)
    };

    return res.status(200).json({
      ok: true,
      goals: tree,
      upcoming: upcoming.slice(0, 40),
      totals,
      fetchedAt: new Date().toISOString()
    });
  } catch (e) {
    console.error('op-plan error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
