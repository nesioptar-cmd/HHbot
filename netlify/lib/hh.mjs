// Клиент hh.ru: публичный shards (без капчи) + официальный API с токеном.
// Порт src/hh_client.py.

const SHARDS_URL = "https://hh.ru/shards/vacancy/search";
const OFFICIAL_URL = "https://api.hh.ru/vacancies";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA, ...headers } });
  if (!res.ok) throw new Error(`hh.ru HTTP ${res.status}`);
  return res.json();
}

export function buildShardsParams(s) {
  const p = new URLSearchParams();
  if (s.text) p.append("text", s.text);
  const sf = (s.search_field || "everywhere").trim();
  if (sf && sf !== "everywhere") p.append("search_field", sf);
  for (const a of s.area || []) p.append("area", String(a));
  for (const x of s.schedule || []) p.append("schedule", x);
  for (const e of s.employment || []) {
    p.append("employment", e);
    p.append("employment_form", e === "full" ? "FULL" : e);
  }
  for (const e of s.experience || []) p.append("experience", e);
  if (s.salary_from) p.append("salary", String(s.salary_from | 0));
  if (s.only_with_salary) p.append("only_with_salary", "true");
  if (s.search_period) p.append("search_period", String(s.search_period | 0));
  p.append("items_on_page", "50");
  return p;
}

export function normalizeShards(v) {
  const comp = v.compensation || {};
  const company = v.company || {};
  const reviews = company.employerReviews || {};
  const rating = parseFloat(String(reviews.totalRating || "0").replace(",", ".")) || 0;
  const area = v.area || {};
  const links = v.links || {};
  const formats = [];
  for (const wf of v.workFormats || []) formats.push(...(wf.workFormatsElement || []));
  return {
    id: String(v.vacancyId),
    name: v.name || "",
    url: links.desktop || `https://hh.ru/vacancy/${v.vacancyId}`,
    area: area.name || "",
    area_id: String(area["@id"] || ""),
    employer: company.name || company.visibleName || "",
    employer_id: String(company.id || ""),
    rating,
    reviews_count: parseInt(reviews.reviewsCount || 0, 10) || 0,
    salary_from: comp.from ?? null,
    salary_to: comp.to ?? null,
    currency: comp.currencyCode || comp.currency || "",
    schedule: v["@workSchedule"] || "",
    work_formats: formats,
    experience: v.workExperience || "",
    employment: v.employment?.["@type"] || v.employmentForm || "",
    published_at: v.publicationTime?.["$"] || "",
  };
}

export async function searchShards(s, maxResults = 50) {
  const base = buildShardsParams(s);
  const out = [];
  let total = null;
  for (let page = 0; page < 40 && out.length < maxResults; page++) {
    const params = new URLSearchParams(base);
    params.append("page", String(page));
    let data;
    try {
      data = await getJson(`${SHARDS_URL}?${params}`);
    } catch (e) {
      console.log("[hh] shards error:", e.message);
      break;
    }
    const r = data.vacancySearchResult || {};
    if (total === null) total = r.totalResults;
    const items = r.vacancies || [];
    if (!items.length) break;
    for (const raw of items) {
      out.push(normalizeShards(raw));
      if (out.length >= maxResults) break;
    }
    const last = r.paging?.lastPage?.page;
    if (last !== undefined && page >= last) break;
    await sleep(400);
  }
  return { items: out, total };
}

function normalizeOfficial(v) {
  const emp = v.employer || {};
  const sal = v.salary || {};
  return {
    id: String(v.id),
    name: v.name || "",
    url: v.alternate_url || `https://hh.ru/vacancy/${v.id}`,
    area: v.area?.name || "",
    area_id: String(v.area?.id || ""),
    employer: emp.name || "",
    employer_id: String(emp.id || ""),
    rating: 0,
    reviews_count: 0,
    salary_from: sal.from ?? null,
    salary_to: sal.to ?? null,
    currency: sal.currency || "",
    schedule: v.schedule?.id || "",
    work_formats: v.work_format || [],
    experience: v.experience?.id || "",
    employment: v.employment?.id || "",
    published_at: v.published_at || "",
  };
}

export async function searchOfficial(s, token, userAgent, maxResults = 50) {
  const p = new URLSearchParams();
  if (s.text) p.append("text", s.text);
  const sf = (s.search_field || "everywhere").trim();
  if (sf && sf !== "everywhere") p.append("search_field", sf);
  for (const a of s.area || []) p.append("area", String(a));
  for (const x of s.schedule || []) p.append("schedule", x);
  for (const e of s.employment || []) p.append("employment", e);
  for (const e of s.experience || []) p.append("experience", e);
  if (s.salary_from) p.append("salary", String(s.salary_from | 0));
  if (s.only_with_salary) p.append("only_with_salary", "true");
  if (s.search_period) p.append("search_period", String(s.search_period | 0));
  p.append("order_by", "publication_time");
  p.append("per_page", "100");
  const out = [];
  let found = null;
  for (let page = 0; page < 20 && out.length < maxResults; page++) {
    const params = new URLSearchParams(p);
    params.append("page", String(page));
    let data;
    try {
      data = await getJson(`${OFFICIAL_URL}?${params}`, {
        "User-Agent": userAgent,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      });
    } catch (e) {
      console.log("[hh] official error:", e.message);
      break;
    }
    found = data.found ?? found;
    for (const raw of data.items || []) {
      out.push(normalizeOfficial(raw));
      if (out.length >= maxResults) break;
    }
    if (page >= (data.pages || 1) - 1) break;
    await sleep(400);
  }
  return { items: out, total: found };
}

export async function search(s, maxResults = 50) {
  const token = process.env.HH_ACCESS_TOKEN || "";
  if (token) {
    const ua = process.env.HH_USER_AGENT || "hh-vacancy-dashboard/1.0 (admin@yourdomain.ru)";
    return searchOfficial(s, token, ua, maxResults);
  }
  return searchShards(s, maxResults);
}
