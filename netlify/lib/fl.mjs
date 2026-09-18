// Источник FL.ru: официальная RSS-лента заказов (без ключей).
// https://www.fl.ru/rss/projects.xml

import { XMLParser } from "fast-xml-parser";

export const FL_RSS = "https://www.fl.ru/rss/projects.xml";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";

const parser = new XMLParser({ ignoreAttributes: false, cdataTagName: "__cdata" });

const val = (x) => {
  if (x == null) return "";
  if (typeof x === "string") return x;
  if (typeof x === "object" && "__cdata" in x) return String(x.__cdata);
  return String(x);
};

const strip = (html) =>
  String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

export function parseRss(xml) {
  const doc = parser.parse(xml);
  const items = doc?.rss?.channel?.item;
  if (!items) return [];
  return (Array.isArray(items) ? items : [items]).map((it) => ({
    title: val(it.title).trim(),
    link: val(it.link).trim(),
    description: strip(val(it.description)).slice(0, 600),
    pubDate: val(it.pubDate).trim(),
  })).filter((it) => it.title && it.link);
}

export async function fetchFeed() {
  const res = await fetch(FL_RSS, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`FL.ru RSS HTTP ${res.status}`);
  return parseRss(await res.text());
}

// Совпадение подписки: все слова запроса (>2 букв) в заголовке+описании.
export function matchSubscription(items, search) {
  const words = (search.text || "").trim().toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const sf = (search.search_field || "everywhere").trim();
  const excludes = (search.exclude_keywords || []).map((w) => w.toLowerCase());
  return items.filter((it) => {
    const title = it.title.toLowerCase();
    const desc = it.description.toLowerCase();
    const hay = sf === "name" ? title : `${title} ${desc}`;
    if (excludes.length && excludes.some((w) => hay.includes(w))) return false;
    if (!words.length) return true;
    return words.every((w) => hay.includes(w));
  });
}

export function normalize(item) {
  let published = "";
  try {
    const d = new Date(item.pubDate);
    if (!isNaN(d)) published = d.toISOString();
  } catch { /* ignore */ }
  return {
    id: "fl:" + item.link,
    source: "fl",
    name: item.title,
    url: item.link,
    area: "",
    area_id: "",
    employer: "FL.ru",
    employer_id: "",
    rating: 0,
    reviews_count: 0,
    salary_from: null,
    salary_to: null,
    currency: "",
    schedule: "",
    work_formats: [],
    experience: "",
    employment: "",
    published_at: published,
    snippet: item.description.slice(0, 220),
  };
}
