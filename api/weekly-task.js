export const config = { maxDuration: 60 };

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

function weekDeadline() {
  const now = new Date();
  const d = (now.getDay() + 6) % 7;
  const sun = new Date(now); sun.setDate(now.getDate() - d + 6); sun.setHours(23, 59, 59, 0);
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

async function analyzeTask({ title, benefit, measure, checklist }) {
  const prompt = `Ты строгий HR-аналитик компании iC Group (Казахстан, клининг + IT).
Оцени НЕДЕЛЬНУЮ ЗАДАЧУ сотрудника по 4 критериям.

ЗАДАЧА:
Название: ${title}
Польза для компании: ${benefit}
Единица измерения: ${measure}
Чек-лист: ${checklist.map((x, i) => `${i + 1}. ${x}`).join('\n')}

Критерии оценки (1–10):
1. clarity — Конкретность задачи: понятно ли ЧТО и ЗАЧЕМ нужно сделать?
2. value — Ценность для компании: реальная ли польза, не надуманная?
3. measurability — Измеримость: SMART-метрика, можно ли объективно проверить результат?
4. checklist — Чек-лист: конкретны ли шаги, достаточно ли их для выполнения задачи?

Правила:
- Расплывчатая польза ("улучшить процесс") = не выше 4 по value.
- Единица измерения без числа ("хорошо", "выполнено") = не выше 5 по measurability.
- Чек-лист из 1 пункта или абстрактных шагов = не выше 4 по checklist.

Ответь ТОЛЬКО JSON без пояснений:
{"scores":{"clarity":0,"value":0,"measurability":0,"checklist":0},"total":0,"verdict":"отлично|хорошо|нужно улучшить","feedback":"2-3 предложения на русском"}`;

  const r = await fetch(`${GEMINI_URL}?key=${process.env.GOOGLE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  const data = await r.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Gemini вернул невалидный ответ');
  const result = JSON.parse(match[0]);
  result.total = Math.round((result.scores.clarity + result.scores.value + result.scores.measurability + result.scores.checklist) / 4);
  return result;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { title, benefit, measure, checklist, userName, userId } = req.body || {};
  if (!title || !benefit || !measure || !checklist?.length)
    return res.status(400).json({ ok: false, error: 'Все поля обязательны' });

  try {
    const desc =
`📌 ПОЛЬЗА ДЛЯ КОМПАНИИ:
${benefit}

📏 ЕДИНИЦА ИЗМЕРЕНИЯ:
${measure}`;

    const taskRes = await bitrix('tasks.task.add', {
      fields: {
        TITLE: title,
        DESCRIPTION: desc,
        DEADLINE: weekDeadline(),
        ...(userId ? { RESPONSIBLE_ID: userId } : {}),
        TAGS: ['Недельная задача'],
      }
    });

    const taskId = taskRes.result?.task?.id;
    if (taskId) {
      for (const item of checklist) {
        await bitrix('tasks.task.checklist.add', { taskId, fields: { TITLE: item, IS_COMPLETE: 'N' } });
      }
    }

    res.json({ ok: true, taskId });
  } catch (e) {
    console.error('weekly-task error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
}
