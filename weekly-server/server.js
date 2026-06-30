import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// Load .env manually
try {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) {
      let v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      process.env[t.slice(0, i).trim()] = v;
    }
  }
} catch {}

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// Для "Серверного" типа Битрикс24 отправляет POST к обработчику при открытии.
// Извлекаем userId и managerId из POST-параметров, вшиваем в HTML.
app.all('/', async (req, res) => {
  const p = { ...req.query, ...req.body };
  const userId = p.user_id || p['auth[user_id]'] || null;
  const authId = p.AUTH_ID || p.auth_token || null;

  let userName = null;
  let managerIdInject = null;

  if (userId) {
    try {
      const ur = await bitrix('user.get', { ID: userId });
      const u = ur.result?.[0];
      if (u) {
        userName = [u.NAME, u.LAST_NAME].filter(Boolean).join(' ') || null;
        const depts = u.UF_DEPARTMENT || [];
        if (depts.length) {
          const dr = await bitrix('department.get', { ID: depts[0] });
          managerIdInject = dr.result?.[0]?.UF_HEAD || null;
        }
      }
    } catch(e) { console.error('handler user fetch:', e.message); }
  }

  let html = fs.readFileSync(path.join(__dirname, 'public/weekly.html'), 'utf8');
  const inject = `<script>
    window.__BX_USER_ID__   = ${JSON.stringify(userId)};
    window.__BX_USER_NAME__ = ${JSON.stringify(userName)};
    window.__BX_MANAGER_ID__= ${JSON.stringify(managerIdInject)};
    window.__BX_AUTH_ID__   = ${JSON.stringify(authId)};
  </script>`;
  html = html.replace('</head>', inject + '</head>');
  res.send(html);
});

app.all('/weekly.html', async (req, res) => res.redirect(307, '/'));

// ── Helpers ───────────────────────────────────────────────────────────────────

function weekLabel() {
  const now = new Date();
  const d = (now.getDay() + 6) % 7;
  const mon = new Date(now); mon.setDate(now.getDate() - d); mon.setHours(0,0,0,0);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const fmt = x => x.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  return `${fmt(mon)} – ${fmt(sun)}`;
}

function weekDeadline() {
  const now = new Date();
  const d = (now.getDay() + 6) % 7;
  const sun = new Date(now); sun.setDate(now.getDate() - d + 6); sun.setHours(23,59,59,0);
  return sun.toISOString();
}

async function bitrix(method, params) {
  const url = `${process.env.BITRIX_WEBHOOK}${method}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  return r.json();
}

async function gemini(prompt) {
  const r = await fetch(`${GEMINI_URL}?key=${process.env.GOOGLE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  const data = await r.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Gemini вернул невалидный JSON: ' + text.slice(0, 200));
  return JSON.parse(match[0]);
}

// ── AI Analysis ───────────────────────────────────────────────────────────────

async function analyzeZRS({ situation, data, solution1, solution2 }) {
  const prompt = `Ты строгий HR-аналитик компании iC Group (Казахстан, клининг + IT).
Оцени отчёт о ЗАВЕРШЁННОЙ работе сотрудника (ЗРС) по 4 критериям.

ОТЧЁТ:
Ситуация: ${situation}
Данные: ${data}
Решение 1 (что сделано): ${solution1}
Решение 2 (результат): ${solution2}

Критерии оценки (1–10):
1. situation — Конкретность ситуации: чётко ли описана проблема/задача?
2. data — Качество данных: есть ли цифры, факты, измеримые показатели?
3. solution — Практичность: конкретно ли описано что было сделано?
4. result — Результат: виден ли реальный измеримый итог для компании?

Правила:
- Будь строгим. Расплывчатые формулировки = низкий балл.
- Отсутствие цифр в "Данных" = не выше 5 по data.
- Результат без конкретики ("всё хорошо") = не выше 4 по result.

Ответь ТОЛЬКО JSON, без пояснений до/после:
{
  "scores": { "situation": 0, "data": 0, "solution": 0, "result": 0 },
  "comments": {
    "situation": "1 предложение — что конкретно не так или что хорошо",
    "data": "1 предложение — что конкретно не так или что хорошо",
    "solution": "1 предложение — что конкретно не так или что хорошо",
    "result": "1 предложение — что конкретно не так или что хорошо"
  },
  "total": 0,
  "verdict": "отлично|хорошо|нужно улучшить",
  "feedback": "1-2 предложения — общий итог и главное что улучшить"
}`;
  const r = await gemini(prompt);
  r.total = Math.round((r.scores.situation + r.scores.data + r.scores.solution + r.scores.result) / 4);
  return r;
}

async function analyzeTask({ title, benefit, measure, checklist }) {
  const prompt = `Ты строгий HR-аналитик компании iC Group (Казахстан, клининг + IT).
Оцени НЕДЕЛЬНУЮ ЗАДАЧУ сотрудника по 4 критериям.

ЗАДАЧА:
Название: ${title}
Польза для компании: ${benefit}
Единица измерения: ${measure}
Чек-лист: ${checklist.map((x,i) => `${i+1}. ${x}`).join('\n')}

Критерии оценки (1–10):
1. clarity — Конкретность задачи: понятно ли ЧТО и ЗАЧЕМ нужно сделать?
2. value — Ценность для компании: реальная ли польза, не надуманная?
3. measurability — Измеримость: SMART-метрика, можно ли объективно проверить результат?
4. checklist — Чек-лист: конкретны ли шаги, достаточно ли их для выполнения задачи?

Правила:
- Расплывчатая польза ("улучшить процесс") = не выше 4 по value.
- Единица измерения без числа ("хорошо", "выполнено") = не выше 5 по measurability.
- Чек-лист из 1 пункта или абстрактных шагов = не выше 4 по checklist.

Ответь ТОЛЬКО JSON, без пояснений до/после:
{
  "scores": { "clarity": 0, "value": 0, "measurability": 0, "checklist": 0 },
  "comments": {
    "clarity": "1 предложение — что конкретно не так или что хорошо",
    "value": "1 предложение — что конкретно не так или что хорошо",
    "measurability": "1 предложение — что конкретно не так или что хорошо",
    "checklist": "1 предложение — что конкретно не так или что хорошо"
  },
  "total": 0,
  "verdict": "отлично|хорошо|нужно улучшить",
  "feedback": "2-3 конкретных предложения на русском — что хорошо и что улучшить"
}`;
  const r = await gemini(prompt);
  r.total = Math.round((r.scores.clarity + r.scores.value + r.scores.measurability + r.scores.checklist) / 4);
  return r;
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.post('/api/zrs', async (req, res) => {
  const { situation, data, solution1, solution2, userName, userId, managerId } = req.body || {};
  if (!situation || !data || !solution1 || !solution2) {
    return res.status(400).json({ ok: false, error: 'Все поля обязательны' });
  }

  try {
    const analysis = await analyzeZRS({ situation, data, solution1, solution2 });
    const wk = weekLabel();
    const who = userName || 'Сотрудник';

    const verdictIcon = analysis.verdict === 'отлично' ? '🟢' : analysis.verdict === 'хорошо' ? '🟡' : '🔴';
    const critComments = Object.entries(analysis.comments || {})
      .map(([k, v]) => `  • ${({situation:'Ситуация',data:'Данные',solution:'Решение',result:'Результат'}[k]||k)}: ${v}`)
      .join('\n');
    const desc =
`ЗРС от: ${who}
Неделя: ${wk}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 СИТУАЦИЯ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${situation}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 ДАННЫЕ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${data}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 РЕШЕНИЕ 1 — что было сделано
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${solution1}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ РЕШЕНИЕ 2 — результат для компании
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${solution2}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 AI АНАЛИЗ: ${analysis.total}/10 ${verdictIcon} ${analysis.verdict.toUpperCase()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${critComments}

${analysis.feedback}`;

    // Постановщик = сотрудник, Исполнитель = руководитель
    // Если taskId передан — обновляем существующую задачу, иначе создаём новую
    let taskId = req.body.taskId || null;
    if (taskId) {
      await bitrix('tasks.task.update', { taskId, fields: { TITLE: `ЗРС | ${wk} | ${who}`, DESCRIPTION: desc } });
    } else {
      const taskRes = await bitrix('tasks.task.add', {
        fields: {
          TITLE: `ЗРС | ${wk} | ${who}`,
          DESCRIPTION: desc,
          DEADLINE: weekDeadline(),
          ...(managerId ? { RESPONSIBLE_ID: managerId } : userId ? { RESPONSIBLE_ID: userId } : {}),
          ...(userId ? { CREATED_BY: userId } : {}),
          STATUS: 5,
          TAGS: ['ЗРС'],
        }
      });
      taskId = taskRes.result?.task?.id;
    }

    res.json({ ok: true, analysis, taskId });
  } catch (e) {
    console.error('ZRS error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/task', async (req, res) => {
  const { title, benefit, measure, checklist, userName, userId, managerId } = req.body || {};
  if (!title || !benefit || !measure || !checklist?.length) {
    return res.status(400).json({ ok: false, error: 'Все поля обязательны' });
  }

  try {
    const analysis = await analyzeTask({ title, benefit, measure, checklist });
    const who = userName || 'Сотрудник';

    const verdictIcon = analysis.verdict === 'отлично' ? '🟢' : analysis.verdict === 'хорошо' ? '🟡' : '🔴';
    const critComments = Object.entries(analysis.comments || {})
      .map(([k, v]) => `  • ${({clarity:'Конкретность',value:'Ценность',measurability:'Измеримость',checklist:'Чек-лист'}[k]||k)}: ${v}`)
      .join('\n');
    const desc =
`Задача от: ${who}
Неделя: ${weekLabel()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 ПОЛЬЗА ДЛЯ КОМПАНИИ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${benefit}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📏 ЕДИНИЦА ИЗМЕРЕНИЯ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${measure}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 AI АНАЛИЗ: ${analysis.total}/10 ${verdictIcon} ${analysis.verdict.toUpperCase()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${critComments}

${analysis.feedback}`;

    // Постановщик = сотрудник, Исполнитель = руководитель
    let taskId = req.body.taskId || null;
    if (taskId) {
      await bitrix('tasks.task.update', { taskId, fields: { TITLE: title, DESCRIPTION: desc } });
    } else {
      const taskRes = await bitrix('tasks.task.add', {
        fields: {
          TITLE: title,
          DESCRIPTION: desc,
          DEADLINE: weekDeadline(),
          ...(managerId ? { RESPONSIBLE_ID: managerId } : userId ? { RESPONSIBLE_ID: userId } : {}),
          ...(userId ? { CREATED_BY: userId } : {}),
          TAGS: ['Недельная задача'],
        }
      });
      taskId = taskRes.result?.task?.id;
    }

    if (taskId) {
      // При обновлении — удаляем старые пункты чеклиста и добавляем новые
      if (req.body.taskId) {
        const existing = await bitrix('tasks.task.checklist.getlist', { taskId });
        for (const item of (existing.result || [])) {
          await bitrix('tasks.task.checklist.delete', { taskId, itemId: item.ID });
        }
      }
      for (const item of checklist) {
        await bitrix('tasks.task.checklist.add', { taskId, fields: { TITLE: item, IS_COMPLETE: 'N' } });
      }
    }

    res.json({ ok: true, analysis, taskId });
  } catch (e) {
    console.error('Task error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => console.log(`✅ Weekly server running on port ${PORT}`));
