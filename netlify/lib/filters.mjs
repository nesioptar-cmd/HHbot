// Пост-фильтры + форматирование. Порт src/filters.py.

export function applyFilters(vacancies, s) {
  const minRating = parseFloat(s.min_employer_rating || 0);
  const excludes = (s.exclude_keywords || []).map((w) => w.toLowerCase());
  const sf = (s.search_field || "everywhere").trim();
  const words = (s.text || "").trim().toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return vacancies.filter((v) => {
    if (minRating && (v.rating || 0) < minRating) return false;
    const name = (v.name || "").toLowerCase();
    if (excludes.length && excludes.some((w) => name.includes(w))) return false;
    if (sf === "name" && words.length && !words.every((w) => name.includes(w))) return false;
    return true;
  });
}

const CUR = { RUR: "₽", RUB: "₽", KZT: "₸", USD: "$", EUR: "€" };

export function salaryText(v) {
  const cur = CUR[v.currency] || v.currency || "";
  const fmt = (n) => n.toLocaleString("ru-RU");
  if (v.salary_from && v.salary_to) return `${fmt(v.salary_from)}–${fmt(v.salary_to)} ${cur}`;
  if (v.salary_from) return `от ${fmt(v.salary_from)} ${cur}`;
  if (v.salary_to) return `до ${fmt(v.salary_to)} ${cur}`;
  return "зарплата не указана";
}

export const SCHEDULE_RU = {
  remote: "Удалённо", fullDay: "Полный день", shift: "Сменный",
  flexible: "Гибкий", flyInFlyOut: "Вахта",
};

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function formatVacancy(v, searchNames = "") {
  const sched = SCHEDULE_RU[v.schedule] || v.schedule || "";
  const rating = v.rating
    ? `⭐ ${Number(v.rating).toFixed(1)} (${v.reviews_count || 0})` : "без рейтинга";
  const lines = [
    `💼 <b>${esc(v.name)}</b>`,
    `🏢 ${esc(v.employer)} · ${rating}`,
    `📍 ${esc(v.area)}${sched ? ` · ${sched}` : ""}`,
    `💰 ${salaryText(v)}`,
  ];
  if (searchNames) lines.push(`🔎 <i>${esc(searchNames)}</i>`);
  if (v.snippet) lines.push(`\n${esc(v.snippet.slice(0, 300))}`);
  lines.push(`🔗 ${v.url}`);
  return lines.join("\n");
}
