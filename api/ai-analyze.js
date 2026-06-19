import { GoogleGenerativeAI } from "@google/generative-ai";

export const config = {
  maxDuration: 120
};

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const ANALYSIS_PROMPT = `Ты — эксперт по оптимизации процессов компании. Проанализируй эту задачу и дай структурированную оценку на русском.

Задача: {title}
Описание: {description}
Исполнитель: {executor} (отдел: {department})
Дедлайн: {deadline}
Статус: {status}

Ответь в JSON формате, обязательно:
{
  "value": число 1-10 (насколько помогает компании: 1=вредит, 10=критична),
  "isRoutine": true/false (типовая ли задача, повторяющаяся),
  "recommendation": "делать|делегировать|автоматизировать|исключить",
  "reasoning": "краткое объяснение почему",
  "protocol": "полный протокол анализа: почему эта задача важна/не важна, какие риски, какие возможности"
}

Будь объективен, учитывай контекст компании (это казахская компания iC group).`;

async function analyzeTask(task) {
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
    const text = response.text();

    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Could not parse JSON from Gemini response");
    }

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error("AI analysis error:", error);
    return {
      value: 0,
      isRoutine: false,
      recommendation: "error",
      reasoning: error.message,
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
