// Плановый сбор: раз в 3 часа (schedule в netlify.toml).
// Для каждого чата: свои включённые + общие сиды → fetch → merge → новые → дайджест.
// Кэш для дашборда пишется в Blobs (cache).

import { storeGet, storeSet } from "../lib/store.mjs";
import { search } from "../lib/hh.mjs";
import { applyFilters, formatVacancy } from "../lib/filters.mjs";
import { sendMessage } from "../lib/tg.mjs";
import { SEEDS } from "../lib/seeds.mjs";

const nowMSK = () =>
  new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");

export async function handler(event) {
  // Ручной запуск: ?key=ADMIN_KEY (для отладки и принудительных обновлений).
  // Плановые вызовы по расписанию идут без ключа.
  const key = event?.queryStringParameters?.key;
  if (key && key !== (process.env.ADMIN_KEY || "")) {
    return { statusCode: 403, body: "forbidden" };
  }
  const subs = (await storeGet("subs", {})) || {};
  const seenAll = (await storeGet("seen", {})) || {};
  const chatIds = Object.keys(subs);
  console.log(`[fetch] chats: ${chatIds.length}`);

  const cacheMerged = new Map();

  for (const chatId of chatIds) {
    const u = subs[chatId];
    const own = (u.searches || []).filter((s) => s.enabled !== false);
    const searches = [...SEEDS.filter((s) => s.enabled !== false), ...own];
    if (!searches.length) continue;
    const seen = new Set(seenAll[chatId] || []);
    const merged = new Map();

    for (const s of searches) {
      const sid = s.id || s.name;
      const sname = s.personal ? s.name : s.name;
      let items = [];
      try {
        const r = await search(s, s.max_results || 50);
        console.log(`[fetch] ${chatId} '${sname}': found=${r.total} got=${r.items.length}`);
        items = applyFilters(r.items, s);
      } catch (e) {
        console.log("[fetch] search error:", e.message);
        continue;
      }
      for (const v of items) {
        const vid = String(v.id);
        if (!merged.has(vid)) {
          merged.set(vid, { ...v, search_ids: [], search_names: [] });
        }
        const m = merged.get(vid);
        if (!m.search_ids.includes(sid)) m.search_ids.push(sid);
        if (!m.search_names.includes(sname)) m.search_names.push(sname);
        if (!cacheMerged.has(vid)) cacheMerged.set(vid, m);
        else {
          const c = cacheMerged.get(vid);
          for (const x of m.search_ids) if (!c.search_ids.includes(x)) c.search_ids.push(x);
          for (const x of m.search_names) if (!c.search_names.includes(x)) c.search_names.push(x);
        }
      }
    }

    const fresh = [...merged.values()].filter((m) => !seen.has(String(m.id)));
    for (const m of merged.values()) seen.add(String(m.id));
    seenAll[chatId] = [...seen].slice(-5000);

    if (!fresh.length) {
      console.log(`[fetch] ${chatId}: nothing new`);
      continue;
    }
    try {
      await sendMessage(chatId, `🆕 <b>${fresh.length} новых</b> за 3 часа`);
      let sent = 0;
      for (const m of fresh.slice(0, 10)) {
        await sendMessage(chatId, formatVacancy(m, m.search_names.join(" · ")));
        sent++;
      }
      console.log(`[fetch] ${chatId}: sent ${sent}`);
    } catch (e) {
      console.log(`[fetch] ${chatId} send failed:`, e.message);
    }
  }

  await storeSet("seen", seenAll);
  const vacancies = [...cacheMerged.values()].sort((a, b) =>
    String(b.published_at || "").localeCompare(String(a.published_at || "")));
  await storeSet("cache", { generated_at: nowMSK(), vacancies });
  console.log(`[fetch] cache: ${vacancies.length} vacancies`);
  return { statusCode: 200, body: JSON.stringify({ chats: chatIds.length, vacancies: vacancies.length }) };
}
