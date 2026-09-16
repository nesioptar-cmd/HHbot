// Telegram Bot API helper.

const token = () => process.env.TELEGRAM_BOT_TOKEN || "";

async function call(method, payload = {}) {
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`${method}: ${JSON.stringify(data).slice(0, 200)}`);
  return data.result;
}

export const sendMessage = (chatId, text, extra = {}) =>
  call("sendMessage", {
    chat_id: String(chatId), text, parse_mode: "HTML",
    disable_web_page_preview: true, ...extra,
  });

export const editMessage = (chatId, messageId, text, replyMarkup) =>
  call("editMessageText", {
    chat_id: String(chatId), message_id: messageId, text,
    parse_mode: "HTML", disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });

export const answerCallback = (id, text = "") =>
  call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
