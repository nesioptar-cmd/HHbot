// Локальный стенд: прогоняет webhook через подменённый fetch.
// Telegram API мокается (ответы записываются), hh.ru — настоящий.

process.env.STORE = "file";
process.env.FILE_STORE_DIR = ".tmp-test";
process.env.TELEGRAM_BOT_TOKEN = "dummy";
process.env.BOT_USERNAME = "hhedz_bot";

import fs from "node:fs";

const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes("api.telegram.org")) {
    const body = JSON.parse(opts.body || "{}");
    sent.push({ method: u.split("/").pop(), body });
    const mid = 1000 + sent.length;
    return Response.json({ ok: true, result: { message_id: mid } });
  }
  return realFetch(url, opts);
};

fs.rmSync(".tmp-test", { recursive: true, force: true });

const { handler } = await import("../netlify/functions/tg-webhook.mjs");
const post = (update) => handler({ httpMethod: "POST", body: JSON.stringify(update) });

let uid = 1;
const msg = (text) => post({
  update_id: uid++,
  message: { message_id: uid, chat: { id: 777, type: "private" },
    from: { id: 777, username: "tester" }, text },
});
const tap = (data, mid = 1001) => post({
  update_id: uid++,
  callback_query: { id: `cb${uid}`, data,
    from: { id: 777, username: "tester" },
    message: { message_id: mid, chat: { id: 777 } } },
});

const lastText = (n = 1) => sent.filter((s) => s.method === "sendMessage").slice(-n)[0]?.body.text || "";
const lastEdit = (n = 1) => sent.filter((s) => s.method === "editMessageText").slice(-n)[0]?.body.text || "";
const lastAny = () => sent.filter((s) => s.method !== "answerCallbackQuery").slice(-1)[0]?.body.text || "";
const assert = (cond, label) => {
  console.log((cond ? "PASS " : "FAIL ") + label);
  if (!cond) process.exitCode = 1;
};

await msg("/start");
assert(lastText().includes("Мониторинг"), "/start → главное меню");

await tap("menu:new");
assert(lastEdit().includes("Что ищем"), "menu:new → просит ключевые слова");

await msg("врач терапевт");
assert(lastText().includes("Настройка"), "ключевое слово → мастер");

await tap("wiz:area:1");
await tap("wiz:schedule:remote");
await tap("wiz:rating:4.0");
await tap("wiz:salary:100000");
await tap("wiz:exp:between1And3");
assert(lastEdit().includes("1–3"), "кнопка опыта меняет черновик");
assert(lastEdit().includes("Москва") && lastEdit().includes("удалённо"), "кнопки меняют черновик");
await tap("wiz:done");
assert(lastEdit().includes("Готово"), "done → подписка создана");

await msg("/list");
assert(lastAny().includes("Мои подборки"), "/list показывает подборки");

await tap("sub:toggle:0", 1002);
const subs = JSON.parse(fs.readFileSync(".tmp-test/subs.json", "utf8"));
assert(subs["777"].searches[0].enabled === false, "toggle выключает подборку");
assert(subs["777"].searches[0].area[0] === 1, "регион сохранился");
assert(subs["777"].searches[0].schedule[0] === "remote", "график сохранился");

await msg("/add врач | москва");
assert(lastText().includes("Добавлена"), "/add работает");

const { parseSpec } = await import("../netlify/lib/bot.mjs");
const ps = parseSpec("врач | частичная | москва");
assert(ps.employment[0] === "part" && ps.area[0] === 1 && ps.text === "врач", "parseSpec: занятость");

// planned fetch: живая проверка hh.ru
const fetchH = (await import("../netlify/functions/fetch-vacancies.mjs")).handler;
const r = JSON.parse((await fetchH()).body);
console.log("fetch result:", r);
assert(r.chats === 1 && r.vacancies >= 0, "fetch отработал");
const cache = JSON.parse(fs.readFileSync(".tmp-test/cache.json", "utf8"));
assert(cache.vacancies.length > 0, "кэш вакансий записан");

const api = (await import("../netlify/functions/api-data.mjs")).handler;
const data = JSON.parse((await api({ httpMethod: "GET" })).body);
assert(data.vacancies.length === 0, "GET без подписи: чужое скрыто");
assert(data.private !== true, "GET без подписи: публичный режим");
assert(data.bot_username === "hhedz_bot", "bot_username в ответе");

// протухший кэш: вакансия без активных подписок должна отсекаться
cache.vacancies.push({ id: "orphan1", name: "Мусор", search_ids: ["deleted-search"], search_names: ["Удалённая"] });
fs.writeFileSync(".tmp-test/cache.json", JSON.stringify(cache));
const data2 = JSON.parse((await api({ httpMethod: "GET" })).body);
assert(!data2.vacancies.some((v) => v.id === "orphan1"), "осиротевшие вакансии отсекаются");
assert(data2.vacancies.length === 0, "без своих подписок в GET — пусто");

await msg("/new");
const freshMsgs = sent.filter((s) => s.method === "sendMessage").slice(-9);
assert(freshMsgs[0]?.body.text.includes("Последние по вашим подпискам"), "/new → заголовок");
assert(freshMsgs.length > 1 && freshMsgs[1].body.text.includes("💼"), "/new → карточки вакансий");

// /new не показывает выключенные подписки
const { showFresh } = await import("../netlify/lib/bot.mjs");
sent.length = 0;
await showFresh({ chatId: 777 }, {
  searches: [{ name: "👤 on", enabled: true }, { name: "👤 off", enabled: false }],
  cache: { generated_at: "x", vacancies: [
    { id: "1", name: "A", url: "u1", employer: "E", area: "", salary_from: 0, salary_to: 0, currency: "", rating: 0, reviews_count: 0, schedule: "", published_at: "2026-09-17", search_names: ["👤 on"] },
    { id: "2", name: "B", url: "u2", employer: "E", area: "", salary_from: 0, salary_to: 0, currency: "", rating: 0, reviews_count: 0, schedule: "", published_at: "2026-09-17", search_names: ["👤 off"] },
  ] },
});
const out = sent.map((s) => s.body.text).join("\n");
assert(out.includes("A") && !out.includes("\nB") && !out.includes("👤 off"), "/new только по активным");

console.log(`\nAPI-вызовов Telegram смокировано: ${sent.length}`);
