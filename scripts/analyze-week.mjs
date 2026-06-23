// Re-analyze importance for THIS WEEK's tasks only, merge into public/ai-scores.json.
// Picks up edited descriptions without re-running the whole backlog.
// Run: node scripts/analyze-week.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import taskReportHandler from '../api/task-report.js';
import { analyzeTask } from '../api/ai-analyze.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env
try {
  const envContent = await fs.readFile(path.join(__dirname, '..', '.env'), 'utf8');
  for (const line of envContent.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) {
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[t.slice(0, i).trim()] = v;
    }
  }
} catch { console.log('no .env, using system env'); }

function getTasks() {
  return new Promise((resolve, reject) => {
    const req = { method: 'GET', query: {}, headers: {} };
    const res = {
      statusCode: 200, setHeader() {},
      status(c) { this.statusCode = c; return this; },
      json(data) { resolve(data); return this; }, end() {}
    };
    taskReportHandler(req, res).catch(reject);
  });
}

// Current week: Monday 00:00 .. Sunday 23:59 (local time of the runner)
function weekBounds() {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // 0 = Monday
  const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(now.getDate() - day);
  const end = new Date(start); end.setDate(start.getDate() + 7);
  return { start, end };
}

function inWeek(raw, start, end) {
  if (!raw) return false;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return false;
  return d >= start && d < end;
}

const CONCURRENCY = 4;

async function run() {
  const report = await getTasks();
  const rows = report.rows || [];
  const { start, end } = weekBounds();
  console.log(`Неделя: ${start.toISOString().slice(0, 10)} .. ${end.toISOString().slice(0, 10)}`);

  // This week = created OR deadline OR last activity within the week, plus any still-open task
  const weekRows = rows.filter((r) =>
    inWeek(r['createdDateRaw'], start, end) ||
    inWeek(r['deadlineRaw'], start, end) ||
    inWeek(r['closedDateRaw'], start, end) ||
    !String(r['Состояние задачи'] || '').startsWith('Закрыта')
  );
  console.log(`Задач всего: ${rows.length}, на этой неделе/активных: ${weekRows.length}`);

  const scoresPath = path.join(__dirname, '..', 'public', 'ai-scores.json');
  let scores = {};
  try { scores = JSON.parse(await fs.readFile(scoresPath, 'utf8')); } catch {}

  const queue = weekRows.map((row) => ({
    id: String(row['ID задачи']),
    title: row['Название задачи'] || '',
    description: row['Описание'] || '',
    executor: row['Исполнитель'] || '',
    department: row['Отдел'] || '',
    deadline: row['Дедлайн'] || '',
    status: row['Состояние задачи'] || ''
  }));

  let done = 0, changed = 0;
  async function worker() {
    while (queue.length) {
      const task = queue.shift();
      try {
        const r = await analyzeTask(task);
        if (r && r.recommendation !== 'error' && r.value != null) {
          const prev = scores[task.id]?.value;
          scores[task.id] = { value: r.value, isRoutine: r.isRoutine, recommendation: r.recommendation, reasoning: r.reasoning };
          if (prev !== r.value) changed++;
        }
      } catch (e) { /* keep previous score on error */ }
      done++;
      if (done % 10 === 0 || done === weekRows.length) console.log(`  ${done}/${weekRows.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  await fs.writeFile(scoresPath, JSON.stringify(scores, null, 2), 'utf8');
  console.log(`Готово. Переоценено ${done}, изменилось баллов: ${changed}. Всего в кэше: ${Object.keys(scores).length}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
