import { GoogleGenerativeAI } from "@google/generative-ai";

export const config = {
  maxDuration: 120
};

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

const ANALYSIS_PROMPT = `Ты — аналитик эффективности в казахской компании iC group. Оценивай задачи по их реальному влиянию на выживание и развитие компании.

Задача: {title}
Описание: {description}
Исполнитель: {executor} (отдел: {department})
Дедлайн: {deadline}
Статус: {status}

КРИТЕРИИ ОЦЕНКИ:
1. КРИТИЧНОСТЬ для компании (спасает/развивает/улучшает):
   - Level 1 (9-10): Финансовые обязательства (зарплата, платежи поставщикам, погашение долгов, счета) - без этого компания не может работать
   - Level 2 (7-9): Стратегический развитие (проекты, оптимизации, новые функции) - улучшают конкурентоспособность
   - Level 3 (5-6): Операционная поддержка (техническое обслуживание, рутины) - важны но не критичны
   - Level 0 (1-3): Отсутствие ценности - можно исключить

2. ПРОСРОЧКА = +2 балла к критичности (задача теряет доверие с каждым днем просрочки)

3. МАТРИЦА КОМПЕТЕНЦИЙ:
   - ФУ (Финансы) НЕ должна: кодить, разрабатывать, писать код
   - Оптимизация (Разработка) НЕ должна: вводить счета, делать финансовые платежи, вести бухучет
   - Если задача дана "неправильному" отделу → рекомендуй "делегировать"

4. АВТОМАТИЗАЦИЯ:
   - Повторяющиеся рутины (ежемесячные платежи, отчеты) → кандидаты на автоматизацию
   - Системные операции (очистка, синхронизация) → могут быть автоматизированы

Ответь ТОЛЬКО валидным JSON объектом, начиная с { и заканчивая }. Без markdown, без пояснений:
{"value": 8, "isRoutine": false, "recommendation": "делать", "reasoning": "пример", "protocol": "пример анализа"}

Логика:
- Если ФИНАНСОВАЯ + ПРОСРОЧКА → 9-10, делать срочно
- Если ФИНАНСОВАЯ + в срок → 8-9, делать
- Если ФИНАНСОВАЯ + чужой отдел → 8-9, делегировать
- Если СТРАТЕГИЧЕСКАЯ + правильный отдел → 7-8, делать
- Если РУТИНА + повторяется → 6, автоматизировать
- Если БЕЗ ЦЕННОСТИ → 1-3, исключить`;

async function analyzeTask(task) {
  let rawText = "";
  try {
    const prompt = ANALYSIS_PROMPT
      .replace("{title}", task.title || "—")
      .replace("{description}", task.description || "—")
      .replace("{executor}", task.executor || "—")
      .replace("{department}", task.department || "—")
      .replace("{deadline}", task.deadline || "—")
      .replace("{status}", task.status || "—");

    const result = await model.generateContent(prompt);
    const response = result.response;
    let text = response.text().trim();
    rawText = text.substring(0, 100); // Save for error reporting

    // Debug: log first 200 chars
    console.log("Gemini raw response:", text.substring(0, 200));

    // Try multiple parsing strategies
    let parsed = null;

    // Strategy 1: Try direct parse (might be wrapped in markdown)
    try {
      // Remove markdown code blocks if present
      let cleanText = text;
      if (cleanText.startsWith('```json')) {
        cleanText = cleanText.slice(7); // Remove ```json
      } else if (cleanText.startsWith('```')) {
        cleanText = cleanText.slice(3); // Remove ```
      }

      const endIdx = cleanText.lastIndexOf('```');
      if (endIdx !== -1) {
        cleanText = cleanText.slice(0, endIdx);
      }

      cleanText = cleanText.trim();
      parsed = JSON.parse(cleanText);
    } catch (e1) {
      // Strategy 2: Extract JSON object between curly braces
      const startIdx = text.indexOf('{');
      if (startIdx === -1) {
        throw new Error("No JSON object found in response");
      }

      let braceCount = 0;
      let endIdx = -1;
      for (let i = startIdx; i < text.length; i++) {
        if (text[i] === '{') braceCount++;
        if (text[i] === '}') {
          braceCount--;
          if (braceCount === 0) {
            endIdx = i;
            break;
          }
        }
      }

      if (endIdx === -1) {
        throw new Error("Malformed JSON (no closing brace)");
      }

      const jsonStr = text.substring(startIdx, endIdx + 1);
      try {
        parsed = JSON.parse(jsonStr);
      } catch (e2) {
        throw new Error("JSON parse failed: " + e2.message + " | Attempted: " + jsonStr.substring(0, 50));
      }
    }

    // Validate required fields
    if (!parsed || typeof parsed !== 'object') {
      throw new Error("Invalid response structure: not an object");
    }

    if (!parsed.value || !parsed.recommendation || !parsed.reasoning) {
      throw new Error("Missing required fields: value, recommendation, reasoning");
    }

    return parsed;
  } catch (error) {
    console.error("AI analysis error:", error);
    // Return detailed error for debugging
    const debugInfo = rawText.replace(/\n/g, "\\n").replace(/\t/g, "\\t");
    return {
      value: 0,
      isRoutine: false,
      recommendation: "error",
      reasoning: error.message + " | Raw: [" + debugInfo + "]",
      protocol: "Ошибка анализа"
    };
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (!process.env.GOOGLE_API_KEY) {
    return res.status(500).json({ ok: false, error: "GOOGLE_API_KEY not configured" });
  }

  try {
    const { tasks } = req.body;
    if (!Array.isArray(tasks)) {
      return res.status(400).json({ ok: false, error: "tasks must be an array" });
    }

    // Analyze each task (max 20 to avoid timeout)
    const taskList = tasks.slice(0, 20);
    const analyses = await Promise.all(
      taskList.map((task) => analyzeTask(task))
    );

    return res.status(200).json({
      ok: true,
      analyses: taskList.map((task, i) => ({
        taskId: task.id,
        title: task.title,
        ...analyses[i]
      })),
      analyzedCount: taskList.length
    });
  } catch (error) {
    console.error("ai-analyze handler error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "AI analysis failed"
    });
  }
}
