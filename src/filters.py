"""Пост-фильтры, которых нет (или не хватает) в самом API hh.ru:
- min_employer_rating — рейтинг компании (есть только в shards-ответе)
- exclude_keywords — стоп-слова в названии
- keyword в названии/описании — дублируем локально для надёжности
"""


def apply_filters(vacancies, search):
    min_rating = float(search.get("min_employer_rating") or 0.0)
    excludes = [w.lower() for w in (search.get("exclude_keywords") or [])]
    sf = (search.get("search_field") or "everywhere").strip()
    text = (search.get("text") or "").strip().lower()
    words = [w for w in text.split() if len(w) > 2] if text else []

    out = []
    for v in vacancies:
        # 1. Рейтинг работодателя
        if min_rating and (v.get("rating") or 0.0) < min_rating:
            # вакансии без рейтинга (0.0) при включённом пороге отсекаем
            continue
        name_l = (v.get("name") or "").lower()
        # 2. Стоп-слова
        if excludes and any(w in name_l for w in excludes):
            continue
        # 3. Локальная проверка ключевого слова (если искали строго в названии)
        if sf == "name" and words:
            if not all(w in name_l for w in words):
                continue
        out.append(v)
    return out


def salary_text(v):
    f, t, c = v.get("salary_from"), v.get("salary_to"), v.get("currency") or ""
    cur = {"RUR": "₽", "RUB": "₽", "KZT": "₸", "USD": "$", "EUR": "€"}.get(c, c)
    if f and t:
        return f"{f:,}–{t:,} {cur}".replace(",", " ")
    if f:
        return f"от {f:,} {cur}".replace(",", " ")
    if t:
        return f"до {t:,} {cur}".replace(",", " ")
    return "зарплата не указана"


SCHEDULE_RU = {
    "remote": "Удалённо",
    "fullDay": "Полный день",
    "shift": "Сменный",
    "flexible": "Гибкий",
    "flyInFlyOut": "Вахта",
}
