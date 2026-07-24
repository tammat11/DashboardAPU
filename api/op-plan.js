const BITRIX_URL = process.env.TASK_REPORT_WEBHOOK_URL;

export const config = { maxDuration: 60 };

async function bx(method, params = {}) {
  const r = await fetch(`${BITRIX_URL.replace(/\/$/, '')}/${method}.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    cache: 'no-store'
  });
  const j = await r.json();
  return j;
}

async function fetchAllOpTasks() {
  const tasks = [];
  let start = 0;
  while (true) {
    const r = await bx('tasks.task.list', {
      order: { ID: 'asc' },
      filter: { TAG: 'ОП2026' },
      select: ['ID', 'TITLE', 'TAGS', 'STATUS', 'DEADLINE', 'RESPONSIBLE_ID', 'REAL_STATUS'],
      params: { NAV_PARAMS: { nPageSize: 50, iNumPage: Math.floor(start / 50) + 1 } }
    });
    const page = r.result?.tasks || [];
    tasks.push(...page);
    if (page.length < 50) break;
    start += 50;
  }
  return tasks;
}

async function fetchChecklists(taskIds) {
  const map = {};
  // batch requests — 45 per batch
  const chunks = [];
  for (let i = 0; i < taskIds.length; i += 45) chunks.push(taskIds.slice(i, i + 45));
  for (const chunk of chunks) {
    const cmd = {};
    chunk.forEach(id => { cmd[`cl_${id}`] = `task.checklistitem.getlist?taskId=${id}`; });
    const r = await bx('batch', { cmd, halt: 0 });
    const result = r.result?.result || {};
    Object.keys(result).forEach(k => {
      const tid = k.replace('cl_', '');
      map[tid] = Array.isArray(result[k]) ? result[k] : Object.values(result[k] || {});
    });
  }
  return map;
}

function getOpCode(tags) {
  const tag = (tags || []).find(t => t.startsWith('ОП2026:'));
  return tag ? tag.replace('ОП2026:', '').trim() : null;
}

function codeDepth(code) {
  if (!code) return -1;
  return code.split('.').length - 1; // I → 0, 1.1 → 1, 1.1.1 → 2
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!BITRIX_URL) return res.status(500).json({ ok: false, error: 'No webhook URL' });

  try {
    const tasks = await fetchAllOpTasks();

    // Separate by hierarchy level via tag code depth
    const goals = [];        // I, II … IX
    const stratTasks = [];   // 1.1, 1.2 …
    const tactTasks = [];    // 1.1.1 …

    tasks.forEach(t => {
      const code = getOpCode(t.tags || t.TAGS || []);
      t._code = code;
      const d = codeDepth(code);
      if (d === 0) goals.push(t);
      else if (d === 1) stratTasks.push(t);
      else if (d === 2) tactTasks.push(t);
    });

    // Fetch checklists for tactical tasks
    const tactIds = tactTasks.map(t => String(t.id || t.ID));
    const checklists = tactIds.length ? await fetchChecklists(tactIds) : {};

    // Build tree
    const romanToNum = { I:1,II:2,III:3,IV:4,V:5,VI:6,VII:7,VIII:8,IX:9 };

    const tree = goals.map(g => {
      const goalCode = g._code; // e.g. "I"
      const goalNum = romanToNum[goalCode] || 0;

      const children = stratTasks
        .filter(st => st._code && st._code.startsWith(goalNum + '.'))
        .map(st => {
          const stCode = st._code; // e.g. "1.1"
          const tacts = tactTasks
            .filter(tt => tt._code && tt._code.startsWith(stCode + '.'))
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
                status: tt.realStatus || tt.REAL_STATUS || tt.status || tt.STATUS,
                totalSteps,
                doneSteps,
                overdueSteps
              };
            });

          const totalSteps = tacts.reduce((a, t) => a + t.totalSteps, 0);
          const doneSteps = tacts.reduce((a, t) => a + t.doneSteps, 0);
          const overdueSteps = tacts.reduce((a, t) => a + t.overdueSteps, 0);
          return {
            id: String(st.id || st.ID),
            code: stCode,
            title: String(st.title || st.TITLE || ''),
            tacts,
            totalSteps,
            doneSteps,
            overdueSteps
          };
        });

      const totalSteps = children.reduce((a, c) => a + c.totalSteps, 0);
      const doneSteps = children.reduce((a, c) => a + c.doneSteps, 0);
      const overdueSteps = children.reduce((a, c) => a + c.overdueSteps, 0);

      return {
        id: String(g.id || g.ID),
        code: goalCode,
        num: goalNum,
        title: String(g.title || g.TITLE || ''),
        children,
        totalSteps,
        doneSteps,
        overdueSteps
      };
    }).sort((a, b) => a.num - b.num);

    return res.status(200).json({ ok: true, goals: tree, fetchedAt: new Date().toISOString() });
  } catch (e) {
    console.error('op-plan error', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
