// Управление подписками с сайта: POST /.netlify/functions/api-subs
// { initData, action: "delete", index }
// initData — Telegram WebApp initData открытой страницы. Подпись проверяется
// токеном бота; разрешены операции только над подписками своего user id
// (в личке chat id == user id). Из обычного браузера (без initData) — отказ.

import crypto from "node:crypto";
import { storeGet, storeSet } from "../lib/store.mjs";

export function verifyInitData(initData, botToken, maxAgeSec = 86400) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = crypto.createHmac("sha256", secret).update(check).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  let user = null;
  try {
    user = JSON.parse(params.get("user") || "null");
  } catch { /* ignore */ }
  if (!user?.id) return null;
  const authDate = parseInt(params.get("auth_date") || "0", 10);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  return user;
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "method not allowed" };
  }
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: "bad json" }) };
  }
  const user = verifyInitData(body.initData, process.env.TELEGRAM_BOT_TOKEN || "");
  if (!user) {
    return { statusCode: 403,
      body: JSON.stringify({ ok: false, error: "noauth" }) };
  }
  const chatId = String(user.id);
  const subs = (await storeGet("subs", {})) || {};
  const u = subs[chatId];
  if (body.action === "delete") {
    const i = parseInt(body.index, 10);
    if (!u || !(i >= 0 && i < (u.searches || []).length)) {
      return { statusCode: 200,
        body: JSON.stringify({ ok: false, error: "Нет такой подписки" }) };
    }
    const [rm] = u.searches.splice(i, 1);
    await storeSet("subs", subs);
    return { statusCode: 200,
      body: JSON.stringify({ ok: true, removed: rm.text || "" }) };
  }
  if (body.action === "toggle") {
    const i = parseInt(body.index, 10);
    if (!u || !(i >= 0 && i < (u.searches || []).length)) {
      return { statusCode: 200,
        body: JSON.stringify({ ok: false, error: "Нет такой подписки" }) };
    }
    u.searches[i].enabled = u.searches[i].enabled === false ? true : false;
    await storeSet("subs", subs);
    return { statusCode: 200,
      body: JSON.stringify({ ok: true, enabled: u.searches[i].enabled }) };
  }
  return { statusCode: 400, body: JSON.stringify({ ok: false, error: "unknown action" }) };
}
