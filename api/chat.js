// AI chat over the dashboard's task data (Gemini)
export const config = {
  maxDuration: 60
};

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const SYSTEM_CONTEXT = `Ты — AI-аналитик дашборда эффективности компании iC group (Казахстан: клининг + IT-разработка платформы ozym.kz/i1c).
Ты помогаешь руководителю понять данные о задачах и сотрудниках.

КАК СЧИТАЮТСЯ БАЛЛЫ (важно — не выдумывай свою формулу!):
Балл сотрудника = сумма баллов за его задачи + бонус за поручения.
За каждую задачу: берётся ВАЖНОСТЬ задачи по оценке AI (V, от 1 до 10), умножается на долю за статус:
- закрыта в срок = V (100%), закрыта с просрочкой = 0.6×V, открыта в срок = 0.4×V, без дедлайна = 0.2×V, открыта просрочена = 0. Результат округляется.
- Исполнитель получает этот балл полностью; соисполнитель — 0.8 от него (округляя).
- Постановщик получает за делегирование: +1 за задачу, порученную внутри своего отдела, и +0.5×важность(V) за задачу, порученную в другой отдел (округляя).
Пример: задача важностью 8, закрыта в срок → исполнитель +8, соисполнитель +6 (8×0.8).
Итоговые баллы каждого человека УЖЕ ПОСЧИТАНЫ и переданы тебе в разделе "РЕЙТИНГ СОТРУДНИКОВ" (поле totalScore). Это единственный источник правды по итогу.
В списке задач у каждой задачи есть готовое поле "балл исполнителя" (уже посчитано по формуле выше) и "важность" (V) — используй именно их, не пересчитывай сам.

КОГДА ПРОСЯТ РАЗЛОЖИТЬ/ОБЪЯСНИТЬ БАЛЛ СОТРУДНИКА — отвечай как аналитик, подробно:
1. Найди все его задачи-исполнителя в списке и выпиши их таблицей: задача | важность V | статус | балл исполнителя.
2. Просуммируй баллы за задачи (= "работа").
3. Отдельно посчитай поручения: сколько задач он поставил внутри своего отдела (+1 каждая) и в другие отделы (+0.5×важность). Постановщик виден в поле "постановщик", его отдел — в скобках.
4. Покажи итог: работа + поручения = totalScore (должно совпасть с РЕЙТИНГОМ).
5. Коротко объясни, ПОЧЕМУ так получилось (много закрытых в срок ценных задач / делегирование / просрочки и т.п.).
Используй markdown-таблицу и **жирный** для ключевых чисел.

ПРАВИЛА:
- Когда спрашивают про баллы/рейтинг сотрудника — бери число строго из totalScore в РЕЙТИНГЕ. НИКОГДА не пересчитывай баллы сам по задачам.
- Если просят разложить балл — объясни через формулу выше (баллы за статусы задач + 3 за каждое поручение), но итог должен совпадать с totalScore.
- Отвечай на русском, кратко и по делу, с конкретными цифрами.
- Если данных не хватает — честно скажи. Не выдумывай.`;

async function callGemini(prompt) {
  const maxRetries = 4;
  let apiResponse, lastErr;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    apiResponse = await fetch(`${GEMINI_API_URL}?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    if (apiResponse.ok) break;
    lastErr = await apiResponse.json();
    const transient = apiResponse.status === 503 || apiResponse.status === 429;
    if (!transient || attempt === maxRetries - 1) {
      throw new Error(`Gemini API error: ${apiResponse.status} - ${JSON.stringify(lastErr)}`);
    }
    await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt)));
  }
  const data = await apiResponse.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error("Empty response from Gemini");
  return text;
}

// Build a compact text summary of tasks so we stay within token limits
function buildContext(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return "Данных о задачах нет.";

  const lines = tasks.slice(0, 250).map((t, i) => {
    const parts = [
      `${i + 1}.`,
      t.title || "—",
      `| исполнитель: ${t.executor || "—"}`,
      `| отдел: ${t.department || "—"}`,
      `| постановщик: ${t.creator || "—"}${t.creatorDept ? ` (${t.creatorDept})` : ""}`,
      `| статус: ${t.status || "—"}`,
      t.importance != null ? `| важность: ${t.importance}` : "",
      t.points != null ? `| балл исполнителя: ${t.points}` : "",
      t.deadline ? `| дедлайн: ${t.deadline}` : ""
    ];
    return parts.filter(Boolean).join(" ");
  });

  return `Всего задач: ${tasks.length}.\n\nСписок задач:\n${lines.join("\n")}`;
}

// Authoritative per-person totals (already computed on the dashboard)
function buildPeopleContext(people) {
  if (!Array.isArray(people) || people.length === 0) return "";
  const lines = people.map((p) =>
    `#${p.rank} ${p.name} | отдел: ${p.department || "—"} | БАЛЛЫ: ${p.totalScore} | задач: ${p.tasks} | в работе: ${p.active} | поручил: ${p.assigned} | просрочка: ${p.overdueDays} дн.`
  );
  return `РЕЙТИНГ СОТРУДНИКОВ (готовые баллы — единственный источник правды, totalScore):\n${lines.join("\n")}`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (!process.env.GOOGLE_API_KEY) {
    return res.status(500).json({ ok: false, error: "GOOGLE_API_KEY not configured" });
  }

  try {
    const { message, tasks, people, history } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ ok: false, error: "message is required" });
    }

    const context = buildContext(tasks);
    const peopleContext = buildPeopleContext(people);

    // Render prior turns (keep it short)
    let historyText = "";
    if (Array.isArray(history) && history.length > 0) {
      historyText = "\n\nПредыдущий диалог:\n" + history.slice(-6).map(
        (m) => `${m.role === "user" ? "Пользователь" : "Аналитик"}: ${m.text}`
      ).join("\n");
    }

    const prompt = `${SYSTEM_CONTEXT}

${peopleContext}

ДАННЫЕ ДАШБОРДА (задачи):
${context}
${historyText}

Вопрос пользователя: ${message}

Ответь как аналитик:`;

    const answer = await callGemini(prompt);
    return res.status(200).json({ ok: true, answer });
  } catch (error) {
    console.error("Chat error:", error);
    return res.status(500).json({ ok: false, error: error.message || "Chat error" });
  }
}
