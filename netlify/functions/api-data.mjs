// Данные для дашборда: GET /.netlify/functions/api-data
// -> { generated_at, bot_username, searches, vacancies }

import { storeGet } from "../lib/store.mjs";
import { SEEDS } from "../lib/seeds.mjs";

export async function handler() {
  const subs = (await storeGet("subs", {})) || {};
  const cache = (await storeGet("cache", { generated_at: "", vacancies: [] })) || {};
  const searches = SEEDS.map((s) => ({ ...s, personal: false, owner: "" }));
  for (const [chatId, u] of Object.entries(subs)) {
    (u.searches || []).forEach((s, i) => {
      searches.push({
        ...s,
        id: s.id || `u_${u.username || chatId}_${i + 1}`,
        personal: true,
        owner: u.username || "",
      });
    });
  }
  const usersCount = Object.keys(subs).length;
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({
      generated_at: cache.generated_at || "",
      bot_username: process.env.BOT_USERNAME || "hhedz_bot",
      searches,
      notify_users_count: usersCount,
      vacancies: cache.vacancies || [],
    }),
  };
}
