// Общая логика планового сбора (scheduled + ручной фоновый запуск).

import { storeGet, storeSet } from "./store.mjs";
import { search } from "./hh.mjs";
import { fetchFeed, matchSubscription, normalize as normalizeFl } from "./fl.mjs";
import { applyFilters, formatVacancy } from "./filters.mjs";
import { sendMessage } from "./tg.mjs";
import { SEEDS } from "./seeds.mjs";

const nowMSK = () =>
  new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");

function mergeInto(merged, cacheMerged, s, sid, sname, items) {
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

export async function runFetch() {
  const subs = (await storeGet("subs", {})) || {};
  const seenAll = (await storeGet("seen", {})) || {};
  const chatIds = Object.keys(subs);
  console.log(`[fetch] chats: ${chatIds.length}`);

  const cacheMerged = new Map();

  // RSS FL.ru тянем один раз на прогон (общий для всех подписок).
  let flFeed = null;
  let flFailed = false;
  async function getFlFeed() {
    if (flFeed || flFailed) return flFeed;
    try {
      flFeed = await fetchFeed();
      console.log(`[fetch] FL feed: ${flFeed.length} items`);
    } catch (e) {
      flFailed = true;
      console.log("[fetch] FL feed error:", e.message);
    }
    return flFeed;
  }

  for (const chatId of chatIds) {
    const u = subs[chatId];
    const own = (u.searches || []).filter((s) => s.enabled !== false);
    const searches = [...SEEDS.filter((s) => s.enabled !== false), ...own];
    if (!searches.length) continue;
    const seen = new Set(seenAll[chatId] || []);
    const merged = new Map();

    for (const s of searches) {
      const sid = s.id || s.name;
      const sname = s.name;
      if ((s.source || "hh") === "fl") {
        const feed = await getFlFeed();
        if (!feed) continue;
        mergeInto(merged, cacheMerged, s, sid, sname,
          matchSubscription(feed, s).map(normalizeFl));
        continue;
      }
      let items = [];
      try {
        const r = await search(s, s.max_results || 50);
        console.log(`[fetch] ${chatId} '${sname}': found=${r.total} got=${r.items.length}`);
        items = applyFilters(r.items, s);
      } catch (e) {
        console.log("[fetch] search error:", e.message);
        continue;
      }
      mergeInto(merged, cacheMerged, s, sid, sname, items);
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
  return { chats: chatIds.length, vacancies: vacancies.length };
}
