// Плановый сбор: раз в 3 часа (schedule в netlify.toml).
// Для каждого чата: свои включённые + общие сиды → fetch → merge → новые → дайджест.
// Кэш для дашборда пишется в Blobs (cache).
// Ручной запуск — через fetch-now-background?key=ADMIN_KEY (фоновый, до 15 мин),
// т.к. синхронный вызов не укладывается в лимит времени.

import { runFetch } from "../lib/run-fetch.mjs";

export async function handler() {
  const r = await runFetch();
  return { statusCode: 200, body: JSON.stringify(r) };
}
