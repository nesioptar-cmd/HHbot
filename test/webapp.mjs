// Проверка api-subs: подпись WebApp, удаление/вкл-выкл только своих.
process.env.STORE = "file";
process.env.FILE_STORE_DIR = ".tmp-webapp";
process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";

import crypto from "node:crypto";
import fs from "node:fs";

const assert = (cond, label) => {
  console.log((cond ? "PASS " : "FAIL ") + label);
  if (!cond) process.exitCode = 1;
};

const { verifyInitData, handler } = await import("../netlify/functions/api-subs.mjs");

function makeInitData(user, botToken, age = 100) {
  const p = new URLSearchParams({
    user: JSON.stringify(user),
    auth_date: String(Math.floor(Date.now() / 1000) - age),
  });
  const check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  p.set("hash", crypto.createHmac("sha256", secret).update(check).digest("hex"));
  return p.toString();
}

const me = { id: 777, username: "tester" };
const good = makeInitData(me, "test-bot-token");
assert(verifyInitData(good, "test-bot-token")?.id === 777, "валидная подпись принимается");
assert(!verifyInitData(good, "wrong-token"), "чужой токен отклоняется");
assert(!verifyInitData(good.slice(0, -4) + "ffff", "test-bot-token"), "подделанный хэш отклоняется");
assert(!verifyInitData(makeInitData(me, "test-bot-token", 100000), "test-bot-token"), "просрочка отклоняется");
assert(!verifyInitData("", "test-bot-token"), "пусто отклоняется");

fs.rmSync(".tmp-webapp", { recursive: true, force: true });
fs.mkdirSync(".tmp-webapp", { recursive: true });
fs.writeFileSync(".tmp-webapp/subs.json", JSON.stringify({
  777: { username: "tester", searches: [{ text: "a" }, { text: "b", enabled: false }] },
  888: { username: "other", searches: [{ text: "c" }] },
}));

const call = async (body) =>
  JSON.parse((await handler({ httpMethod: "POST", body: JSON.stringify(body) })).body);

// чужой пытается удалить чужое (initData юзера 999, индекс 0 юзера 888 — чужой id!)
const evil = makeInitData({ id: 999, username: "evil" }, "test-bot-token");
const r1 = await call({ initData: evil, action: "delete", index: 0 });
assert(r1.ok === false, "удаление без своих подписок отклоняется");
const subs1 = JSON.parse(fs.readFileSync(".tmp-webapp/subs.json", "utf8"));
assert(subs1["888"].searches.length === 1, "чужие подписки не тронуты");

const r2 = await call({ initData: good, action: "toggle", index: 0 });
assert(r2.ok && r2.enabled === false, "toggle свой");
const r3 = await call({ initData: good, action: "delete", index: 0 });
assert(r3.ok && r3.removed === "a", "delete свой");
const subs2 = JSON.parse(fs.readFileSync(".tmp-webapp/subs.json", "utf8"));
assert(subs2["777"].searches.length === 1 && subs2["777"].searches[0].text === "b", "осталась вторая");
assert(subs2["888"].searches.length === 1, "чужой не пострадал");

const r4 = await call({ initData: good, action: "delete", index: 9 });
assert(r4.ok === false, "несуществующий индекс отклоняется");
const r5 = await call({ initData: "x", action: "delete", index: 0 });
assert(r5.ok === false, "битый initData отклоняется");
