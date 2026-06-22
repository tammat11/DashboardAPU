// One-off: analyze every task with Gemini, cache importance to public/ai-scores.json
// Run locally: node scripts/analyze-all.mjs
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
} catch { console.log('no .env'); }

// Fetch tasks via the report handler (mock req/res)
function getTasks() {
  return new Promise((resolve, reject) => {
    const req = { method: 'GET', query: {}, headers: {} };
    const res = {
      statusCode: 200,
      setHeader() {},
      status(c) { this.statusCode = c; return this; },
      json(data) { resolve(data); return this; },
      end() {}
    };
    taskReportHandler(req, res).catch(reject);
  });
}

const CONCURRENCY = 4;

async function run() {
  const report = await getTasks();
  const rows = report.rows || [];
  console.log(`Получено задач: ${rows.length}`);

  const scores = {};
  let done = 0;

  const queue = rows.map((row) => ({
    id: String(row['ID задачи']),
    title: row['Название задачи'] || '',
    description: row['Описание'] || '',
    executor: row['Исполнитель'] || '',
    department: row['Отдел'] || '',
    deadline: row['Дедлайн'] || '',
    status: row['Состояние задачи'] || ''
  }));

  async function worker() {
    while (queue.length) {
      const task = queue.shift();
      try {
        const r = await analyzeTask(task);
        scores[task.id] = {
          value: r.value,
          isRoutine: r.isRoutine,
          recommendation: r.recommendation,
          reasoning: r.reasoning
        };
      } catch (e) {
        scores[task.id] = { value: 0, recommendation: 'error', reasoning: String(e.message || e) };
      }
      done++;
      if (done % 10 === 0 || done === rows.length) console.log(`  ${done}/${rows.length}`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const outPath = path.join(__dirname, '..', 'public', 'ai-scores.json');
  await fs.writeFile(outPath, JSON.stringify(scores, null, 2), 'utf8');
  console.log(`Готово. Сохранено ${Object.keys(scores).length} оценок в public/ai-scores.json`);
}

run().catch((e) => { console.error(e); process.exit(1); });
