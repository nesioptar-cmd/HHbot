// Логика Telegram-бота: меню, мастер подборки кнопками, подписки.
// Чистые функции поверх store + tg. Порт команд Python-версии + нативный мастер.

import { sendMessage, editMessage, answerCallback } from "./tg.mjs";
import { formatVacancy } from "./filters.mjs";
import { SEEDS } from "./seeds.mjs";

export const BOT = () => process.env.BOT_USERNAME || "hhedz_bot";

export const SCHEDULE_ALIASES = {
  remote: ["remote"], fullday: ["fullDay"], flexible: ["flexible"],
  shift: ["shift"], vahta: ["flyInFlyOut"], any: [],
};
export const AREA_IDS = { 1: "Москва", 2: "СПб", 113: "Россия" };
export const FIELD_RU = {
  everywhere: "везде", name: "в названии",
  description: "в описании", company_name: "в компании",
};
export const EXP_RU = {
  noExperience: "без опыта", between1And3: "1–3 года",
  between3And6: "3–6 лет", moreThan6: "6+ лет",
};
export const EMPLOYMENT_RU = {
  full: "полная", part: "частичная", project: "проектная",
};

export function blankDraft(text = "") {
  return {
    text, search_field: "everywhere", area: [113], schedule: [],
    employment: [], experience: [], salary_from: 0, only_with_salary: false,
    search_period: 7, min_employer_rating: 0, exclude_keywords: [],
    max_results: 30, enabled: true,
  };
}

export function describe(s) {
  const bits = [`«${s.text}»`, `ищем ${FIELD_RU[s.search_field] || "везде"}`];
  bits.push("регион: " + (s.area || []).map((a) => AREA_IDS[a] || a).join(","));
  const sch = s.schedule || [];
  const schRu = { remote: "удалённо", fullDay: "полный день", flexible: "гибкий", shift: "сменный", flyInFlyOut: "вахта" };
  bits.push("график: " + (sch.length ? sch.map((x) => schRu[x] || x).join(",") : "любой"));
  if (s.salary_from) bits.push(`от ${Number(s.salary_from).toLocaleString("ru-RU")} ₽`);
  if (s.min_employer_rating) bits.push(`рейтинг ≥ ${s.min_employer_rating}`);
  if (s.employment?.length) bits.push("занятость: " + s.employment.map((e) => EMPLOYMENT_RU[e] || e).join(","));
  if (s.experience?.length) bits.push("опыт: " + s.experience.map((e) => EXP_RU[e] || e).join(","));
  if (!s.enabled) bits.push("⏸ выкл");
  return bits.join(" · ");
}

const AREA_ALIASES = { 1: [1], "москва": [1], "мск": [1], 2: [2], "питер": [2], "спб": [2], 113: [113], "россия": [113], "вся": [113] };
const FIELD_ALIASES = {
  "везде": "everywhere", "everywhere": "everywhere",
  "название": "name", "name": "name", "описание": "description",
  "description": "description", "компания": "company_name", "company": "company_name",
};
const EXP_ALIASES = {
  "any": "", "не важно": "", "без опыта": "noExperience", "нет опыта": "noExperience",
  "1-3": "between1And3", "1–3": "between1And3", "3-6": "between3And6",
  "3–6": "between3And6", "6+": "moreThan6", "более 6": "moreThan6",
};
const SCHED_ALIASES = {
  "remote": ["remote"], "удалённо": ["remote"], "fullday": ["fullDay"],
  "полный": ["fullDay"], "flexible": ["flexible"], "гибкий": ["flexible"],
  "shift": ["shift"], "сменный": ["shift"], "vahta": ["flyInFlyOut"],
  "вахта": ["flyInFlyOut"], "any": ["any"], "любой": ["any"],
};
const EMP_ALIASES = {
  "full": ["full"], "полная": ["full"], "part": ["part"], "частичная": ["part"],
  "project": ["project"], "проектная": ["project"], "any": ["any"], "любая": ["any"],
};

// "текст | москва | удалённо | 4.5 | 150000 | 1-3 | название" -> подборка
export function parseSpec(spec) {
  const s = blankDraft("");
  const texts = [];
  for (const raw of spec.split("|")) {
    const part = raw.trim();
    if (!part) continue;
    const low = part.toLowerCase();
    if (AREA_ALIASES[low]) { s.area = AREA_ALIASES[low]; continue; }
    const sch = SCHED_ALIASES[low];
    if (sch) { s.schedule = sch[0] === "any" ? [] : sch; continue; }
    const empA = EMP_ALIASES[low];
    if (empA) { s.employment = empA[0] === "any" ? [] : empA; continue; }
    if (FIELD_ALIASES[low]) { s.search_field = FIELD_ALIASES[low]; continue; }
    if (low in EXP_ALIASES) {
      s.experience = EXP_ALIASES[low] ? [EXP_ALIASES[low]] : [];
      continue;
    }
    const digits = part.replace(/\D/g, "");
    if (digits && low.replace(/[\s\u00a0]/g, "") === digits) {
      const num = parseInt(digits, 10);
      if (num <= 5 && !s.min_employer_rating) s.min_employer_rating = num;
      else s.salary_from = num;
      continue;
    }
    const r = parseFloat(part.replace(",", "."));
    if (!isNaN(r) && r > 0 && r <= 5 && !s.min_employer_rating) {
      s.min_employer_rating = r;
      continue;
    }
    texts.push(part);
  }
  s.text = texts.join(" ").trim().slice(0, 100);
  s.name = `👤 ${s.text.slice(0, 40)}`;
  return s;
}

// ── Клавиатуры ──

const btn = (text, cb) => ({ text, callback_data: cb });

export function mainMenu() {
  return {
    text: "🤖 <b>Мониторинг вакансий hh.ru</b>\nПроверка каждые 3 часа. Что делаем?",
    kb: { inline_keyboard: [
      [btn("🔍 Новая подборка", "menu:new")],
      [btn("🆕 Что нового", "menu:fresh")],
      [btn("📋 Мои подборки", "menu:list")],
      [btn("📊 Дашборд", "menu:dash")],
      [btn("❓ Помощь", "menu:help")],
    ]},
  };
}

// Последние вакансии по подпискам пользователя (из кэша планового сбора).
export async function showFresh(ctx, state) {
  const { chatId } = ctx;
  const cache = state.cache || { generated_at: "", vacancies: [] };
  const seedNames = SEEDS.filter((s) => s.enabled !== false).map((s) => s.name);
  const myNames = new Set([...seedNames,
    ...state.searches.filter((s) => s.enabled !== false).map((s) => s.name)]);
  const mine = (cache.vacancies || []).filter((v) =>
    (v.search_names || []).some((n) => myNames.has(n)));
  mine.sort((a, b) => String(b.published_at || "").localeCompare(String(a.published_at || "")));
  const top = mine.slice(0, 8);
  if (!top.length) {
    await sendMessage(chatId, "Пока пусто — кэш обновляется каждые 3 часа.");
    return;
  }
  await sendMessage(chatId,
    `🆕 <b>Последние по вашим подпискам</b> (обновлено ${cache.generated_at || "—"}):`);
  for (const v of top) {
    await sendMessage(chatId, formatVacancy(v, (v.search_names || []).join(" · ")));
  }
}

export function wizardMenu(draft) {
  const mark = (cur, v) => (cur === v ? "✅ " : "");
  const f = draft.search_field || "everywhere";
  const a = String((draft.area || [113])[0]);
  const sch = (draft.schedule || [])[0] || "any";
  const emp = (draft.employment || [])[0] || "any";
  const exp = (draft.experience || [])[0] || "any";
  const r = draft.min_employer_rating >= 4.5 ? "4.5" : draft.min_employer_rating >= 4 ? "4.0" : "0";
  const sal = draft.salary_from || 0;
  const salBtn = (v, l) => btn(((sal === v) ? "✅ " : "") + l, `wiz:salary:${v}`);
  return {
    text: `⚙️ <b>Настройка «${draft.text}»</b>\nСейчас: ${describe(draft)}\nНажимайте кнопки, затем «Подписаться».`,
    kb: { inline_keyboard: [
      ["everywhere", "name", "description"].map((v) =>
        btn(mark(f, v) + { everywhere: "Везде", name: "В названии", description: "В описании" }[v], `wiz:field:${v}`)),
      ["1", "2", "113"].map((v) =>
        btn(mark(a, v) + { 1: "Москва", 2: "СПб", 113: "Россия" }[v], `wiz:area:${v}`)),
      [["any", "Любой"], ["remote", "Удалённо"], ["fullDay", "Полный день"]].map(([v, l]) =>
        btn(mark(sch, v) + l, `wiz:schedule:${v}`)),
      [["any", "Любая"], ["full", "Полная"], ["part", "Частичная"], ["project", "Проектная"]].map(([v, l]) =>
        btn(mark(emp, v) + l, `wiz:employment:${v}`)),
      [["any", "Любой"], ["noExperience", "Без опыта"], ["between1And3", "1–3"], ["between3And6", "3–6"], ["moreThan6", "6+"]].map(([v, l]) =>
        btn(mark(exp, v) + l, `wiz:exp:${v}`)),
      [["0", "Любой"], ["4.0", "4.0+"], ["4.5", "4.5+"]].map(([v, l]) =>
        btn(mark(r, v) + l, `wiz:rating:${v}`)),
      [salBtn(0, "Любая"), salBtn(50000, "50k"), salBtn(100000, "100k"), salBtn(150000, "150k")],
      [btn("✏️ Своя сумма", "wiz:salarycustom")],
      [btn("✅ Подписаться", "wiz:done"), btn("🗑 Отмена", "wiz:cancel")],
    ]},
  };
}

export function listMenu(searches) {
  if (!searches.length) {
    return {
      text: "Пока пусто. Создайте первую подборку:",
      kb: { inline_keyboard: [[btn("🔍 Новая подборка", "menu:new")], [btn("◀️ Меню", "menu:main")]] },
    };
  }
  const rows = searches.map((s, i) => [
    btn(`${s.enabled === false ? "⏸" : "▶"} ${i + 1}. ${(s.text || "").slice(0, 24)}`, `sub:toggle:${i}`),
    btn("✏️", `sub:edit:${i}`),
    btn("🗑", `sub:del:${i}`),
  ]);
  rows.push([btn("🔍 Новая", "menu:new"), btn("◀️ Меню", "menu:main")]);
  return {
    text: "📋 <b>Мои подборки</b> (▶/⏸ — вкл/выкл, ✏️ — изменить, 🗑 — удалить):",
    kb: { inline_keyboard: rows },
  };
}

export const HELP =
  "🤖 Я слежу за hh.ru каждые 3 часа и присылаю новые вакансии.\n\n" +
  "• <b>Новая подборка</b> — мастер с кнопками: ключевые слова → регион → график → " +
  "занятость → зарплата → рейтинг.\n" +
  "• <b>Мои подборки</b> — вкл/выкл, изменить, удалить.\n" +
  "• <b>Что нового</b> — последние вакансии по подпискам прямо сейчас.\n" +
  "• <b>Дашборд</b> — все вакансии с фильтрами.\n\n" +
  "Быстрые команды: /new, /list, /del 1, /on 1, /off 1, /add <i>текст</i>.";

// ── Обработка ──
// Возвращает список действий для handler'а через колбэки окружения.
// Упрощённо: функции принимают ctx {chatId, username} и делают вызовы tg напрямую.

export async function onText(ctx, text, state) {
  const { chatId, username } = ctx;
  const t = (text || "").trim();
  if (t === "/start") {
    state.user = { username };
    state.awaiting = null;
    const m = mainMenu();
    await sendMessage(chatId, `Привет, @${username}! ` + m.text, { reply_markup: m.kb });
    return;
  }
  if (t === "/help") { await sendMessage(chatId, HELP); return; }
  if (t === "/new") { await showFresh(ctx, state); return; }
  if (t === "/list") {
    const m = listMenu(state.searches);
    await sendMessage(chatId, m.text, { reply_markup: m.kb });
    return;
  }
  if (t.startsWith("/add ")) {
    const arg = t.slice(5).trim();
    if (!arg) { await sendMessage(chatId, "Использование: /add <i>текст</i>"); return; }
    const s = arg.includes("|") ? parseSpec(arg) : { ...blankDraft(arg.slice(0, 100)) };
    if (!s.text) { await sendMessage(chatId, "Не понял запрос. Пример: /add <i>врач терапевт | москва</i>"); return; }
    if (!s.name) s.name = `👤 ${s.text.slice(0, 40)}`;
    s.id = "u" + Date.now().toString(36);
    state.searches.push(s);
    await sendMessage(chatId, `✅ Добавлена: ${describe(s)}`);
    return;
  }
  if (t.startsWith("/replace ")) {
    const arg = t.slice(9).trim();
    const head = arg.split("|")[0].trim();
    const n = parseInt(head, 10);
    if (!head.match(/^\d+$/) || !(n >= 1 && n <= state.searches.length)) {
      await sendMessage(chatId, "Использование: /replace <i>номер | текст | …</i>"); return;
    }
    const s = parseSpec(arg.slice(arg.indexOf("|") + 1));
    if (!s.text) { await sendMessage(chatId, "Не понял запрос."); return; }
    state.searches[n - 1] = s;
    await sendMessage(chatId, `✅ Подборка №${n} заменена: ${describe(s)}`);
    return;
  }
  const parts = t.split(/\s+/);
  if ((parts[0] === "/del" || parts[0] === "/on" || parts[0] === "/off") && parts[1]) {
    const n = parseInt(parts[1], 10);
    if (n >= 1 && n <= state.searches.length) {
      if (parts[0] === "/del") {
        const [rm] = state.searches.splice(n - 1, 1);
        await sendMessage(chatId, `🗑 Удалена: «${rm.text}»`);
      } else {
        state.searches[n - 1].enabled = parts[0] === "/on";
        await sendMessage(chatId, `✅ Подборка №${n} ${parts[0] === "/on" ? "включена" : "выключена"}.`);
      }
    } else await sendMessage(chatId, "Нет подборки с таким номером. /list");
    return;
  }
  if (state.awaiting === "keyword" && t && !t.startsWith("/")) {
    state.draft = { ...blankDraft(t.slice(0, 100)), editIndex: null };
    state.awaiting = null;
    const m = wizardMenu(state.draft);
    const sent = await sendMessage(chatId, m.text, { reply_markup: m.kb });
    state.draft.menuMsgId = sent.message_id;
    return;
  }
  if (state.awaiting === "salary" && t && !t.startsWith("/")) {
    const digits = t.replace(/\D/g, "");
    if (digits) {
      state.draft.salary_from = parseInt(digits, 10);
      state.awaiting = null;
      const m = wizardMenu(state.draft);
      await editMessage(chatId, state.draft.menuMsgId, m.text, m.kb);
    } else await sendMessage(chatId, "Пришлите сумму числом, напр. 150000, или нажмите «Пропустить».");
    return;
  }
  const m = mainMenu();
  await sendMessage(chatId, "Не понял. Выберите действие:", { reply_markup: m.kb });
}

export async function onCallback(ctx, data, msgId, state) {
  const { chatId } = ctx;
  const [ns, ...rest] = data.split(":");
  if (ns === "menu") {
    const m = mainMenu();
    if (rest[0] === "fresh") {
      await showFresh(ctx, state);
      return;
    }
    if (rest[0] === "new") {
      state.awaiting = "keyword";
      await editMessage(chatId, msgId, "🔍 <b>Что ищем?</b>\nНапишите ключевые слова одним сообщением (напр. <i>врач терапевт</i>).");
    } else if (rest[0] === "list") {
      const l = listMenu(state.searches);
      await editMessage(chatId, msgId, l.text, l.kb);
    } else if (rest[0] === "help") {
      await editMessage(chatId, msgId, HELP, { inline_keyboard: [[btn("◀️ Меню", "menu:main")]] });
    } else if (rest[0] === "dash") {
      await editMessage(chatId, msgId,
        `📊 <b>Дашборд:</b> ${process.env.DASHBOARD_URL || "(ссылка появится после деплоя)"}`,
        { inline_keyboard: [[btn("◀️ Меню", "menu:main")]] });
    } else {
      await editMessage(chatId, msgId, m.text, m.kb);
    }
    return;
  }
  if (ns === "wiz") {
    const d = state.draft;
    if (!d) { await editMessage(chatId, msgId, "Черновик устарел. Создайте подборку заново:"); return; }
    const [key, val] = rest;
    if (key === "cancel") {
      state.draft = null; state.awaiting = null;
      const m = mainMenu();
      await editMessage(chatId, msgId, "🗑 Отменено.", m.kb);
      return;
    }
    if (key === "done") {
      const s = { ...d };
      delete s.menuMsgId; delete s.editIndex;
      s.id = "u" + Date.now().toString(36);
      s.name = `👤 ${s.text.slice(0, 40)}`;
      s.enabled = true;
      if (d.editIndex !== null && d.editIndex !== undefined) {
        state.searches[d.editIndex] = s;
      } else state.searches.push(s);
      state.draft = null; state.awaiting = null;
      const m = mainMenu();
      await editMessage(chatId, msgId, `✅ <b>Готово!</b> Подписка активна: ${describe(s)}\nПроверка каждые 3 часа.`, m.kb);
      return;
    }
    if (key === "field" && ["everywhere", "name", "description"].includes(val)) d.search_field = val;
    else if (key === "area" && ["1", "2", "113"].includes(val)) d.area = [parseInt(val, 10)];
    else if (key === "schedule" && ["any", "remote", "fullDay"].includes(val)) d.schedule = val === "any" ? [] : [val];
    else if (key === "employment" && ["any", "full", "part", "project"].includes(val)) d.employment = val === "any" ? [] : [val];
    else if (key === "exp" && ["any", "noExperience", "between1And3", "between3And6", "moreThan6"].includes(val)) d.experience = val === "any" ? [] : [val];
    else if (key === "rating" && ["0", "4.0", "4.5"].includes(val)) d.min_employer_rating = parseFloat(val);
    else if (key === "salary" && /^\d+$/.test(val || "")) d.salary_from = parseInt(val, 10);
    else if (key === "salarycustom") {
      state.awaiting = "salary";
      await editMessage(chatId, msgId, "💰 <b>Напишите сумму числом</b> (напр. 150000) или вернитесь:", {
        inline_keyboard: [[btn("◀️ Назад", "wiz:back")]],
      });
      return;
    } else if (key === "back") { /* просто перерисовать */ }
    const m = wizardMenu(d);
    await editMessage(chatId, msgId, m.text, m.kb);
    return;
  }
  if (ns === "sub") {
    const [action, idxRaw] = rest;
    const i = parseInt(idxRaw, 10);
    if (!(i >= 0 && i < state.searches.length)) return;
    if (action === "toggle") {
      state.searches[i].enabled = state.searches[i].enabled === false ? true : false;
    } else if (action === "del") {
      state.searches.splice(i, 1);
    } else if (action === "edit") {
      state.draft = { ...state.searches[i], editIndex: i };
      const m = wizardMenu(state.draft);
      const sent = await sendMessage(chatId, m.text, { reply_markup: m.kb });
      state.draft.menuMsgId = sent.message_id;
      return;
    }
    const l = listMenu(state.searches);
    await editMessage(chatId, msgId, l.text, l.kb);
  }
}
