import { createClient } from "@supabase/supabase-js";

export const config = {
  maxDuration: 120
};

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

// Initialize Supabase for caching
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const ANALYSIS_PROMPT = `Ты — аналитик эффективности в компании iC group (Казахстан, клининг + IT-разработка платформы ozym.kz/i1c).

ЗАДАЧА ДЛЯ ОЦЕНКИ:
Название: {title}
Описание: {description}
Исполнитель: {executor} (отдел: {department})
Дедлайн: {deadline}
Статус: {status}

ГЛАВНЫЙ ПРИНЦИП: балл = РОЛЬ (ЦКП исполнителя) + СЛОЖНОСТЬ задачи.
Сначала пойми, входит ли задача в обычные обязанности (ЦКП) этого человека. Рутина в рамках его роли = средний балл. Инициатива/решение/работа вне роли = высокий балл.

СПРАВОЧНИК РОЛЕЙ И ЦКП (что является рутиной для человека):
- Тамерлан (Битрикс админ): автоматизация, сбор информации, настройка Bitrix — это его рутина, он реализует чужие решения.
- Бекулан / Yrys / Айдар / Сабит (разработчики i1c): код, фичи, инфраструктура платформы — их рутина.
- Ержан (product manager): создание продукта с нуля, бизнес-логика, продуктовая аналитика — стратегия.
- Людмила (технолог-методолог УКС): стандарты уборки, чек-листы, обучающие материалы, техкарты — её рутина.
- Ольга (главбух) / Наталья / Елизавета / Диана (бухгалтеры/финансисты): учёт, отчётность, ЭСФ, кредиторка, налоги — их рутина.
- Светлана (финансист-аналитик): реестр на оплату, упр.отчётность, контроль кредитов/овердрафтов — её рутина.
- Ирина (финдир): финансовая устойчивость, контроль обязательств и прибыльности — стратегия/контроль.
- Балжан (рук. проектного офиса): поиск узких мест, оптимизация и автоматизация процессов — стратегия.
- Алина/Анара/Асия/Арайлым/Лейла (УКС/аккаунт-менеджеры): работа с клиентами, сохранение объектов, счета/договоры/реализации — их рутина.
- Алмас/Арай (юристы): договоры, правовое сопровождение, риски — их рутина.
- Данара (адм.директор): команда, процессы, регламенты — управление.
- Айгерим (офис-менеджер): снабжение офиса, админзадачи — её рутина.
- Мархаба (HR) / Nurlan (кадры): найм, кадровый учёт, мероприятия — их рутина.
- Максат (продажи): деньги в кассе, сделки — его рутина.
- Виктория (ассистент): график руководителя, задачи команды — её рутина.
Если исполнителя нет в списке — определи рутину по его должности/отделу.

ВАЖНО ПРО РОЛЬ vs СЛОЖНОСТЬ: роль задаёт базовый уровень, НО если задача — это создание НОВОЙ системы, внедрение новой технологии (например ИИ), нетривиальная ИНТЕГРАЦИЯ между системами (Bitrix↔1C), крупный многокомпонентный проект с чек-листом из нескольких этапов — это НЕ рутина, даже если человек "занимается автоматизацией/разработкой". Такое оценивается по сложности и влиянию на бизнес = 7-9. Рутина автоматизатора/админа — это мелкие настройки, правки, уведомления, перенос данных (3-5). Построение новой системы ≠ мелкая настройка. Не придавливай крупный сложный проект до рутины только потому, что человек "по автоматизации".

ГЛАВНЫЙ ПРИНЦИП ОЦЕНКИ — БУДЬ СТРОГИМ, НЕ ЩЕДРЫМ. Высокий балл надо ЗАСЛУЖИТЬ. Если сомневаешься между двумя баллами — всегда выбирай МЕНЬШИЙ. Большинство обычных задач — это 3-5 баллов. Баллы 7+ это исключение для реально ценной/сложной/критичной работы, а не норма.

ШКАЛА ЦЕННОСТИ (value, 1-10):
- 9-10: только КРИТИЧНОЕ для выживания компании ПРЯМО СЕЙЧАС — фактический крупный платёж/погашение долга в срок, устранение аварии/сбоя, спасение клиента/контракта. Большая редкость.
- 7-8: стратегическое решение или создание чего-то нового и ценного (новый продукт/процесс/система), сложная задача с реальной ответственностью и влиянием на бизнес.
- 5-6: рутина в рамках роли, но ЗАМЕТНО сложная или ответственная (много этапов, чек-листы, важная операционная поддержка).
- 3-4: обычная повседневная рутина — типовой отчёт, ведение/обновление файла, сверка данных, ввод данных, типовая настройка, копипаст-задачи, мелкие правки. СЮДА ПОПАДАЕТ БОЛЬШИНСТВО ЗАДАЧ.
- 1-2: пустышка, мелочь, нет ценности — можно исключить.

ВАЖНЫЕ МОДИФИКАТОРЫ:
1. ПРОСРОЧКА (статус "Закрыта с просрочкой" или "Открыта просрочена"): +1 к value (макс 10).
2. НЕПОНЯТНАЯ / ТОНКАЯ ЗАДАЧА: занижай ТОЛЬКО когда суть задачи реально неясна — описание пустое/короткое И название тоже размытое (например "Kaspi PST", "файл обновить"). Тогда −1-2 и нижняя граница. НО если название ЯВНО говорит о сути — интеграция, внедрение, новая система, стратегическое действие ("Интегрировать задачи в АУП", "Внедрить ИИ", "Реализовать счета через 1С") — оценивай по сути названия, лишь слегка снизив за отсутствие деталей. НЕ обнуляй очевидно стратегическую/интеграционную задачу из-за пустого описания.
3. СЛОЖНОСТЬ: только настоящая многоэтапность (детальные чек-листы, несколько участников, интеграции) поднимает балл. Простое перечисление шагов — не повод завышать.
4. ДЕНЬГИ: если задача связана с деньгами/финансами/оплатами/обязательствами/кредитами/бюджетом/долгами/счетами — добавь +1 к итоговой важности (макс 10). Деньги всегда чуть весомее. (Это лёгкий бонус, он НЕ превращает финансовую рутину в 8-10 — реестр/сверка с бонусом = 4-5, а не выше.)

ФИНАНСЫ — это НЕ повод для высокого балла сам по себе! Высоко (8-10) оценивается ТОЛЬКО реальное критичное ДЕЙСТВИЕ: фактический платёж/погашение долга в срок, устранение налогового/юридического риска. А вся обработка ДАННЫХ — «реестр на оплату» (составление списка), «сверить», «обновить файл/данные», «собрать документы», «построить отчёт», «вести таблицу», «ввести данные», «шаблон», «регламент» — это рутина учёта = 3-5, ДАЖЕ если про кредиты, оплаты, бюджет. Составить реестр ≠ оплатить. Не путай подготовку данных (3-5) с самим платежом (8-10).

isRoutine: true если задача в рамках обычных обязанностей роли; false если инициатива/решение/нетипичная.

recommendation (одно из):
- "делать" — ценная задача для правильного человека.
- "делегировать" — задача дана не тому отделу (компетенции не совпадают: финансы кодят / разработка ведёт бухучёт и т.п.).
- "автоматизировать" — повторяющаяся рутина (ежемесячные платежи, регулярные отчёты, синхронизация).
- "исключить" — нет ценности для компании.

Ответь ТОЛЬКО валидным JSON, начиная с { и заканчивая }. Без markdown:
{"value": 4, "isRoutine": true, "recommendation": "делать", "reasoning": "краткое обоснование с учётом роли, сложности и понятности задачи", "protocol": "развёрнутый разбор: роль исполнителя → рутина или нет → модификаторы (просрочка/непонятность/сложность) → итоговый балл и рекомендация"}`;

async function getCachedAnalysis(taskId) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('task_analyses')
      .select('*')
      .eq('task_id', taskId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error("Supabase fetch error:", error);
      return null;
    }
    return data || null;
  } catch (err) {
    console.error("Cache fetch error:", err);
    return null;
  }
}

async function saveAnalysis(analysis) {
  if (!supabase) return;
  try {
    await supabase
      .from('task_analyses')
      .upsert({
        task_id: analysis.taskId,
        title: analysis.title,
        value: analysis.value,
        is_routine: analysis.isRoutine,
        recommendation: analysis.recommendation,
        reasoning: analysis.reasoning,
        protocol: analysis.protocol,
        analyzed_at: new Date().toISOString()
      }, { onConflict: 'task_id' });
  } catch (err) {
    console.error("Cache save error:", err);
  }
}

export async function analyzeTask(task) {
  let rawText = "";
  try {
    // Check cache first
    const cached = await getCachedAnalysis(task.id);
    if (cached) {
      console.log("Using cached analysis for task:", task.id);
      return {
        value: cached.value,
        isRoutine: cached.is_routine,
        recommendation: cached.recommendation,
        reasoning: cached.reasoning,
        protocol: cached.protocol,
        cached: true
      };
    }

    const prompt = ANALYSIS_PROMPT
      .replace("{title}", task.title || "—")
      .replace("{description}", task.description || "—")
      .replace("{executor}", task.executor || "—")
      .replace("{department}", task.department || "—")
      .replace("{deadline}", task.deadline || "—")
      .replace("{status}", task.status || "—");

    // Retry with exponential backoff for transient errors (503 overloaded, 429 rate limit)
    let apiResponse;
    let lastErrorData;
    const maxRetries = 4;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      apiResponse = await fetch(`${GEMINI_API_URL}?key=${process.env.GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });

      if (apiResponse.ok) break;

      lastErrorData = await apiResponse.json();
      const isTransient = apiResponse.status === 503 || apiResponse.status === 429;
      if (!isTransient || attempt === maxRetries - 1) {
        throw new Error(`Gemini API error: ${apiResponse.status} - ${JSON.stringify(lastErrorData)}`);
      }
      // Wait: 2s, 4s, 8s
      const delay = 2000 * Math.pow(2, attempt);
      console.log(`Gemini ${apiResponse.status}, retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }

    const data = await apiResponse.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
      throw new Error("Empty response from Gemini API");
    }
    rawText = text.substring(0, 100);

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

    // Add task info for cache
    const analysisResult = {
      taskId: task.id,
      title: task.title,
      ...parsed
    };

    // Save to cache asynchronously (don't await)
    saveAnalysis(analysisResult).catch(err => console.error("Failed to save to cache:", err));

    return analysisResult;
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
