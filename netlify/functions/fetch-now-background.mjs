// Ручной запуск сбора: GET /.netlify/functions/fetch-now-background?key=ADMIN_KEY
// Фоновая функция (до 15 мин): отвечает 202 сразу, сбор идёт в фоне.
// Проверка результата — по generated_at в api-data.

import { runFetch } from "../lib/run-fetch.mjs";

export async function handler(event) {
  const key = event?.queryStringParameters?.key;
  if (key !== (process.env.ADMIN_KEY || "none")) {
    return { statusCode: 403, body: "forbidden" };
  }
  try {
    const r = await runFetch();
    console.log("[fetch-now] done:", JSON.stringify(r));
  } catch (e) {
    console.log("[fetch-now] failed:", e.message);
  }
  return { statusCode: 202, body: "accepted" };
}
