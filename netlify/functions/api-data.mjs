// Данные для дашборда.
// GET  — публичный вид (только общие подборки, без личных).
// POST { initData } — приватный вид: только свои подписки + вакансии по ним.
// Чужие названия подборок из карточек вырезаются.

import { storeGet } from "../lib/store.mjs";
import { verifyInitData } from "../lib/webapp.mjs";
import { SEEDS } from "../lib/seeds.mjs";

export async function handler(event) {
  let viewerId = null;
  if (event.httpMethod === "POST") {
    try {
      const body = JSON.parse(event.body || "{}");
      const user = verifyInitData(body.initData, process.env.TELEGRAM_BOT_TOKEN || "");
      if (user) viewerId = String(user.id);
    } catch { /* ignore -> публичный вид */ }
  }
  const subs = (await storeGet("subs", {})) || {};
  const cache = (await storeGet("cache", { generated_at: "", vacancies: [] })) || {};

  const searches = SEEDS.map((s) => ({ ...s, personal: false }));
  let mine = [];
  if (viewerId && subs[viewerId]) {
    const u = subs[viewerId];
    mine = (u.searches || []).map((s) => ({ ...s, personal: true, mine: true }));
    searches.push(...mine);
  }
  const usersCount = Object.keys(subs).length;

  // Видимые подборки: общие включённые + свои (включая выключенные — для управления).
  const visibleIds = new Set(
    searches.filter((s) => s.enabled !== false || (viewerId && s.personal)).map((s) => s.id));
  const vacancies = (cache.vacancies || [])
    .map((v) => {
      const hits = (v.search_ids || []).filter((id) => visibleIds.has(id));
      if (!hits.length) return null;
      // показываем только свои теги подборок
      const names = (v.search_names || []).filter((_, i) =>
        visibleIds.has((v.search_ids || [])[i]));
      return { ...v, search_names: names.length ? names : v.search_names.slice(0, 1) };
    })
    .filter(Boolean);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({
      generated_at: cache.generated_at || "",
      bot_username: process.env.BOT_USERNAME || "hhedz_bot",
      searches: searches.map(({ owner, ...s }) => s),
      notify_users_count: usersCount,
      vacancies,
      private: Boolean(viewerId),
    }),
  };
}
