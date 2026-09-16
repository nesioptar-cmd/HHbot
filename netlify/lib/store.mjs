// Хранилище: Netlify Blobs в проде, файлы локально (STORE=file для тестов).
// Ключи: subs (подписки), drafts (черновики мастера), seen (виденные ID),
// cache (кэш вакансий для дашборда).

import fs from "node:fs";
import path from "node:path";

const FILE_DIR = process.env.FILE_STORE_DIR || ".tmp-store";

function fileGet(key, fallback) {
  try {
    const p = path.join(FILE_DIR, key + ".json");
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function fileSet(key, val) {
  fs.mkdirSync(FILE_DIR, { recursive: true });
  fs.writeFileSync(path.join(FILE_DIR, key + ".json"), JSON.stringify(val));
}

let blobStore = null;
async function blobs() {
  if (blobStore) return blobStore;
  const { getStore } = await import("@netlify/blobs");
  // Явная конфигурация для CLI-деплоев (автоконтекст есть не всегда).
  // Локально через `netlify dev` переменные подставит сам Netlify.
  if (process.env.BLOBS_SITE_ID && process.env.BLOBS_TOKEN) {
    blobStore = getStore({
      name: "hhbot",
      siteID: process.env.BLOBS_SITE_ID,
      token: process.env.BLOBS_TOKEN,
    });
  } else {
    blobStore = getStore("hhbot");
  }
  return blobStore;
}

export async function storeGet(key, fallback = null) {
  if (process.env.STORE === "file") return fileGet(key, fallback);
  try {
    const v = await (await blobs()).get(key, { type: "json" });
    return v ?? fallback;
  } catch (e) {
    console.log("[store] get failed, fallback:", e.message);
    return fallback;
  }
}

export async function storeSet(key, val) {
  if (process.env.STORE === "file") return fileSet(key, val);
  await (await blobs()).setJSON(key, val);
}
