// Telegram webhook: мгновенные ответы (меню, мастер, команды).
// Состояние пользователя: Blobs (subs/drafts). POST от Telegram.

import { storeGet, storeSet } from "../lib/store.mjs";
import { answerCallback } from "../lib/tg.mjs";
import { onText, onCallback } from "../lib/bot.mjs";

async function loadState(chatId) {
  const subs = (await storeGet("subs", {})) || {};
  const drafts = (await storeGet("drafts", {})) || {};
  const cache = (await storeGet("cache", null)) || { generated_at: "", vacancies: [] };
  const u = subs[String(chatId)] || { username: "", searches: [] };
  return {
    subs, drafts,
    state: {
      username: u.username || "",
      searches: u.searches || [],
      awaiting: drafts[String(chatId)]?.awaiting || null,
      draft: drafts[String(chatId)]?.draft || null,
      cache,
    },
  };
}

async function saveState(chatId, subs, drafts, state) {
  subs[String(chatId)] = { username: state.username, searches: state.searches };
  if (state.draft || state.awaiting) {
    drafts[String(chatId)] = { draft: state.draft, awaiting: state.awaiting };
  } else delete drafts[String(chatId)];
  await storeSet("subs", subs);
  await storeSet("drafts", drafts);
}

export async function handler(event) {
  if (event.httpMethod !== "POST") return { statusCode: 200, body: "ok" };
  let update;
  try {
    update = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 200, body: "ok" };
  }
  try {
    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message?.chat?.id;
      const username = cb.from?.username || `id${cb.from?.id || "?"}`;
      if (!chatId) return { statusCode: 200, body: "ok" };
      const { subs, drafts, state } = await loadState(chatId);
      state.username = state.username || username;
      await answerCallback(cb.id).catch(() => {});
      await onCallback({ chatId, username: state.username }, cb.data || "", cb.message?.message_id, state);
      await saveState(chatId, subs, drafts, state);
    } else if (update.message) {
      const msg = update.message;
      const chatId = msg.chat?.id;
      if (!chatId || msg.chat.type !== "private" || !msg.text) {
        return { statusCode: 200, body: "ok" };
      }
      const username = msg.from?.username || `id${msg.from?.id || "?"}`;
      const { subs, drafts, state } = await loadState(chatId);
      state.username = state.username || username;
      await onText({ chatId, username: state.username }, msg.text, state);
      await saveState(chatId, subs, drafts, state);
    }
  } catch (e) {
    console.log("[webhook] error:", e.message);
  }
  return { statusCode: 200, body: "ok" };
}
