export const config = { maxDuration: 60 };

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

function weekLabel() {
  const now = new Date();
  const d = (now.getDay() + 6) % 7;
  const mon = new Date(now); mon.setDate(now.getDate() - d); mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const fmt = x => x.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  return `${fmt(mon)} – ${fmt(sun)}`;
}

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
- Результат без конкретики = не выше 4 по result.

Ответь ТОЛЬКО JSON без пояснений:
{"scores":{"situation":0,"data":0,"solution":0,"result":0},"total":0,"verdict":"отлично|хорошо|нужно улучшить","feedback":"2-3 предложения на русском"}`;

  const r = await fetch(`${GEMINI_URL}?key=${process.env.GOOGLE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  const data2 = await r.json();
  const text = data2.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Gemini вернул невалидный ответ');
  const result = JSON.parse(match[0]);
  result.total = Math.round((result.scores.situation + result.scores.data + result.scores.solution + result.scores.result) / 4);
  return result;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { situation, data, solution1, solution2, userName, userId } = req.body || {};
  if (!situation || !data || !solution1 || !solution2)
    return res.status(400).json({ ok: false, error: 'Все поля обязательны' });

  try {
    const wk = weekLabel();
    const who = userName || 'Сотрудник';

    const desc =
`📌 СИТУАЦИЯ:
${situation}

📊 ДАННЫЕ:
${data}

💡 РЕШЕНИЕ 1 (что сделано):
${solution1}

✅ РЕШЕНИЕ 2 (результат):
${solution2}`;

    const taskRes = await bitrix('tasks.task.add', {
      fields: {
        TITLE: `ЗРС | ${wk} | ${who}`,
        DESCRIPTION: desc,
        DEADLINE: weekDeadline(),
        ...(userId ? { RESPONSIBLE_ID: userId } : {}),
        STATUS: 5,
        TAGS: ['ЗРС'],
      }
    });

    res.json({ ok: true, taskId: taskRes.result?.task?.id });
  } catch (e) {
    console.error('weekly-zrs error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
}
