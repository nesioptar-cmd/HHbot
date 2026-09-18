// Источник FL.ru: парсинг RSS, matching, выбор в мастере.
import { parseRss, matchSubscription, normalize, fetchFeed } from "../netlify/lib/fl.mjs";
import { parseSpec, wizardMenu } from "../netlify/lib/bot.mjs";

const assert = (cond, label) => {
  console.log((cond ? "PASS " : "FAIL ") + label);
  if (!cond) process.exitCode = 1;
};

const XML = `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel>
<item><title><![CDATA[Написать курсовую по анатомии]]></title>
<link>https://www.fl.ru/projects/1/a.html</link>
<description><![CDATA[Нужна курсовая работа для <b>медицинского</b> колледжа]]></description>
<pubDate>Fri, 18 Sep 2026 07:00:00 GMT</pubDate></item>
<item><title>Сверстать лендинг</title><link>https://www.fl.ru/projects/2/b.html</link>
<description>HTML/CSS</description><pubDate>Fri, 18 Sep 2026 08:00:00 GMT</pubDate></item>
</channel></rss>`;

const items = parseRss(XML);
assert(items.length === 2, "RSS парсится");
assert(items[0].description.includes("медицинского") && !items[0].description.includes("<b>"),
  "HTML из описания вычищен");

const m1 = matchSubscription(items, { text: "курсовая медицина", search_field: "everywhere", exclude_keywords: [] });
assert(m1.length === 0, "все слова обязаны совпасть (медицина ≠ медицинского)");
const m2 = matchSubscription(items, { text: "курсовая", search_field: "everywhere", exclude_keywords: [] });
assert(m2.length === 1 && m2[0].title.includes("курсовую"), "по одному слову находит");
const m3 = matchSubscription(items, { text: "лендинг", search_field: "name", exclude_keywords: [] });
assert(m3.length === 1, "поиск в заголовке");
const m4 = matchSubscription(items, { text: "лендинг", search_field: "everywhere", exclude_keywords: ["лендинг"] });
assert(m4.length === 0, "стоп-слова работают");

const n = normalize(items[0]);
assert(n.id.startsWith("fl:") && n.source === "fl" && n.url.includes("fl.ru") && n.published_at.startsWith("2026"),
  "нормализация FL");

const ps = (await import("../netlify/lib/bot.mjs")).parseSpec("курсовая | фл | название");
assert(ps.source === "fl" && ps.search_field === "name" && ps.text === "курсовая", "parseSpec: источник");
const ps2 = parseSpec("python");
assert(ps2.source === "hh", "parseSpec: по умолчанию hh");

const wm = wizardMenu({ text: "x", source: "fl", search_field: "everywhere", area: [113], schedule: [], min_employer_rating: 0, salary_from: 0 });
assert(JSON.stringify(wm).includes("wiz:done") && !JSON.stringify(wm).includes("wiz:schedule"),
  "мастер FL: только место поиска + готово");

// живой смог ленты
try {
  const live = await fetchFeed();
  assert(live.length > 0, `живая лента FL: ${live.length} заказов`);
} catch (e) {
  console.log("SKIP живая лента: " + e.message);
}
