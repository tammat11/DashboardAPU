// AI chat over the dashboard's task data (Gemini)
export const config = {
  maxDuration: 60
};

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const SYSTEM_CONTEXT = `Ты — AI-аналитик дашборда эффективности компании iC group (Казахстан: клининг + IT-разработка платформы ozym.kz/i1c).
Ты помогаешь руководителю понять данные о задачах и сотрудниках.

Отвечай на русском, кратко и по делу. Используй конкретные цифры из данных.
Если спрашивают про эффективность — опирайся на баллы (0-10): чем выше балл, тем критичнее/ценнее задача.
Можешь анализировать: кто перегружен, какие задачи стоит автоматизировать или исключить, кто отстаёт по срокам, распределение нагрузки по отделам.
Если данных не хватает для ответа — честно скажи об этом. Не выдумывай.`;

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
      `| постановщик: ${t.creator || "—"}`,
      `| статус: ${t.status || "—"}`,
      t.score != null ? `| баллы: ${t.score}` : "",
      t.deadline ? `| дедлайн: ${t.deadline}` : ""
    ];
    return parts.filter(Boolean).join(" ");
  });

  return `Всего задач: ${tasks.length}.\n\nСписок задач:\n${lines.join("\n")}`;
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
    const { message, tasks, history } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ ok: false, error: "message is required" });
    }

    const context = buildContext(tasks);

    // Render prior turns (keep it short)
    let historyText = "";
    if (Array.isArray(history) && history.length > 0) {
      historyText = "\n\nПредыдущий диалог:\n" + history.slice(-6).map(
        (m) => `${m.role === "user" ? "Пользователь" : "Аналитик"}: ${m.text}`
      ).join("\n");
    }

    const prompt = `${SYSTEM_CONTEXT}

ДАННЫЕ ДАШБОРДА:
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
