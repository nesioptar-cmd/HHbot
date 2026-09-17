// Приватность дашборда: каждый видит только своё.
process.env.STORE = "file";
process.env.FILE_STORE_DIR = ".tmp-privacy";
process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";

import crypto from "node:crypto";
import fs from "node:fs";

const assert = (cond, label) => {
  console.log((cond ? "PASS " : "FAIL ") + label);
  if (!cond) process.exitCode = 1;
};

const initData = (user) => {
  const p = new URLSearchParams({
    user: JSON.stringify(user),
    auth_date: String(Math.floor(Date.now() / 1000) - 10),
  });
  const check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update("test-bot-token").digest();
  p.set("hash", crypto.createHmac("sha256", secret).update(check).digest("hex"));
  return p.toString();
};

fs.rmSync(".tmp-privacy", { recursive: true, force: true });
fs.mkdirSync(".tmp-privacy", { recursive: true });
fs.writeFileSync(".tmp-privacy/subs.json", JSON.stringify({
  111: { username: "anna", searches: [{ id: "a1", name: "👤 врач", text: "врач" }] },
  222: { username: "boris", searches: [{ id: "b1", name: "👤 юрист", text: "юрист" }] },
}));
fs.writeFileSync(".tmp-privacy/cache.json", JSON.stringify({ generated_at: "x", vacancies: [
  { id: "1", name: "Врач", search_ids: ["a1"], search_names: ["👤 врач"] },
  { id: "2", name: "Юрист", search_ids: ["b1"], search_names: ["👤 юрист"] },
  { id: "3", name: "Врач-юрист", search_ids: ["a1", "b1"], search_names: ["👤 врач", "👤 юрист"] },
]}));

const { handler } = await import("../netlify/functions/api-data.mjs");
const get = () => handler({ httpMethod: "GET" });
const post = (u) => handler({ httpMethod: "POST",
  body: JSON.stringify({ initData: initData(u) }) });

const pub = JSON.parse((await get()).body);
assert(pub.searches.length === 0 && pub.vacancies.length === 0 && !pub.private,
  "аноним: ничего личного");

const anna = JSON.parse((await post({ id: 111, username: "anna" })).body);
assert(anna.private === true, "anna: приватный режим");
assert(anna.searches.length === 1 && anna.searches[0].mine === true, "anna: только своя подборка");
assert(anna.vacancies.length === 2, "anna: свои 2 вакансии");
assert(!anna.searches.some((s) => JSON.stringify(s).includes("юрист")), "anna: чужих подборок нет");
assert(anna.vacancies.every((v) => !(v.search_names || []).some((n) => n.includes("юрист"))),
  "anna: чужих тегов нет");
const mixed = anna.vacancies.find((v) => v.id === "3");
assert(mixed && mixed.search_names.length === 1 && mixed.search_names[0] === "👤 врач",
  "общая вакансия: только свой тег");

const boris = JSON.parse((await post({ id: 222, username: "boris" })).body);
assert(boris.vacancies.length === 2, "boris: свои 2 вакансии");
assert(boris.vacancies.every((v) => !(v.search_names || []).some((n) => n.includes("врач"))),
  "boris: чужих тегов нет");

const fake = JSON.parse((await post({ id: 111, username: "anna" })).body);
// подмена username при чужом id невозможна: id — из подписи
assert(fake.searches.length === 1, "подпись решает, не username");
const evil = await handler({ httpMethod: "POST", body: JSON.stringify({ initData: "x" }) });
const evilBody = JSON.parse(evil.body);
assert(evilBody.private !== true && evilBody.vacancies.length === 0, "битая подпись → публичный пустой вид");
