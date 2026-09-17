// Проверка подписи Telegram WebApp initData (общая для api-subs и api-data).

import crypto from "node:crypto";

export function verifyInitData(initData, botToken, maxAgeSec = 86400) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = crypto.createHmac("sha256", secret).update(check).digest("hex");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  } catch {
    return null;
  }
  let user = null;
  try {
    user = JSON.parse(params.get("user") || "null");
  } catch { /* ignore */ }
  if (!user?.id) return null;
  const authDate = parseInt(params.get("auth_date") || "0", 10);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  return user;
}
