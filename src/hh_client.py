"""Клиент hh.ru без OAuth-токена.

Проблема: официальный API https://api.hh.ru/vacancies для анонимных запросов
после нескольких обращений возвращает 403 (требует капчу / токен).
Поэтому по умолчанию используем тот же публичный endpoint, что и сам сайт
hh.ru при поиске: https://hh.ru/shards/vacancy/search
Он отдаёт JSON, не требует капчи и — бонус — включает рейтинг работодателя
(company.employerReviews.totalRating), которого НЕТ в официальном API.

При желании можно включить официальный API, задав HH_ACCESS_TOKEN
(зарегистрируйте приложение на https://dev.hh.ru/admin):
  - официальный API поддерживает те же фильтры + search_field=name/description
  - но НЕ отдаёт рейтинг работодателя (тогда min_employer_rating пропускает все)
"""

import json
import time
import urllib.parse
import urllib.request

SHARDS_URL = "https://hh.ru/shards/vacancy/search"
OFFICIAL_URL = "https://api.hh.ru/vacancies"

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

# Все варианты графика hh.ru
SCHEDULES = ["fullDay", "shift", "flexible", "remote", "flyInFlyOut"]
# Типы занятости hh.ru
EMPLOYMENTS = ["full", "part", "project", "volunteer", "probation"]
# Опыт hh.ru
EXPERIENCES = ["noExperience", "between1And3", "between3And6", "moreThan6"]
# Где искать ключевое слово
SEARCH_FIELDS = ["everywhere", "name", "company_name", "description"]


def _get_json(url, headers=None, timeout=25):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": BROWSER_UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def build_shards_params(search):
    """Преобразует один элемент config/searches.yaml в query-параметры shards."""
    params = []
    if search.get("text"):
        params.append(("text", search["text"]))
    sf = (search.get("search_field") or "everywhere").strip()
    if sf and sf != "everywhere":
        # shards понимает search_field=name / company_name / description
        params.append(("search_field", sf))
    for a in search.get("area") or []:
        params.append(("area", str(a)))
    for s in search.get("schedule") or []:
        params.append(("schedule", s))
    # shards принимает и employment, и employment_form — шлём оба
    for e in search.get("employment") or []:
        params.append(("employment", e))
        params.append(("employment_form", e.upper() if e == "full" else e))
    for ex in search.get("experience") or []:
        params.append(("experience", ex))
    if search.get("salary_from"):
        params.append(("salary", str(int(search["salary_from"]))))
    if search.get("only_with_salary"):
        params.append(("only_with_salary", "true"))
    if search.get("search_period"):
        params.append(("search_period", str(int(search["search_period"]))))
    params.append(("items_on_page", "50"))
    return params


def normalize_shards(v):
    comp = v.get("compensation") or {}
    company = v.get("company") or {}
    reviews = company.get("employerReviews") or {}
    try:
        rating = float(str(reviews.get("totalRating") or "0").replace(",", "."))
    except ValueError:
        rating = 0.0
    try:
        reviews_count = int(reviews.get("reviewsCount") or 0)
    except (ValueError, TypeError):
        reviews_count = 0
    area = v.get("area") or {}
    links = v.get("links") or {}
    formats = []
    for wf in v.get("workFormats") or []:
        el = wf.get("workFormatsElement") or []
        formats.extend(el)
    return {
        "id": str(v.get("vacancyId")),
        "name": v.get("name") or "",
        "url": links.get("desktop") or f"https://hh.ru/vacancy/{v.get('vacancyId')}",
        "area": area.get("name") or "",
        "area_id": str(area.get("@id") or ""),
        "employer": company.get("name") or company.get("visibleName") or "",
        "employer_id": str(company.get("id") or ""),
        "rating": rating,
        "reviews_count": reviews_count,
        "salary_from": comp.get("from"),
        "salary_to": comp.get("to"),
        "currency": comp.get("currencyCode") or comp.get("currency") or "",
        "schedule": v.get("@workSchedule") or "",
        "work_formats": formats,
        "experience": v.get("workExperience") or "",
        "employment": (v.get("employment") or {}).get("@type") or v.get("employmentForm") or "",
        "published_at": ((v.get("publicationTime") or {}).get("$")) or "",
    }


def search_shards(search, max_results=50):
    """Один поиск через shards. Возвращает (vacancies, total_found)."""
    base_params = build_shards_params(search)
    out, total, page = [], None, 0
    per_page = 50
    while len(out) < max_results and page < 40:  # лимит глубины hh ~2000
        params = list(base_params) + [("page", str(page))]
        url = SHARDS_URL + "?" + urllib.parse.urlencode(params, doseq=True)
        try:
            data = _get_json(url)
        except Exception as e:
            print(f"[hh] shards page={page} error: {e}")
            break
        result = data.get("vacancySearchResult") or {}
        if total is None:
            total = result.get("totalResults")
        items = result.get("vacancies") or []
        if not items:
            break
        for raw in items:
            out.append(normalize_shards(raw))
            if len(out) >= max_results:
                break
        # следующая страница есть?
        paging = result.get("paging") or {}
        last = (paging.get("lastPage") or {}).get("page")
        if last is not None and page >= last:
            break
        page += 1
        time.sleep(0.4)  # вежливо к hh.ru
    return out, total


# --- Официальный API (опционально, при наличии HH_ACCESS_TOKEN) ---

def normalize_official(v):
    emp = v.get("employer") or {}
    sal = v.get("salary") or {}
    return {
        "id": str(v.get("id")),
        "name": v.get("name") or "",
        "url": v.get("alternate_url") or f"https://hh.ru/vacancy/{v.get('id')}",
        "area": (v.get("area") or {}).get("name") or "",
        "area_id": str((v.get("area") or {}).get("id") or ""),
        "employer": emp.get("name") or "",
        "employer_id": str(emp.get("id") or ""),
        "rating": 0.0,  # официальный API рейтинг не отдаёт
        "reviews_count": 0,
        "salary_from": sal.get("from"),
        "salary_to": sal.get("to"),
        "currency": sal.get("currency") or "",
        "schedule": (v.get("schedule") or {}).get("id") or "",
        "work_formats": v.get("work_format") or [],
        "experience": (v.get("experience") or {}).get("id") or "",
        "employment": (v.get("employment") or {}).get("id") or "",
        "published_at": v.get("published_at") or "",
    }


def search_official(search, token, user_agent, max_results=50):
    params = []
    if search.get("text"):
        params.append(("text", search["text"]))
    sf = (search.get("search_field") or "everywhere").strip()
    if sf and sf != "everywhere":
        params.append(("search_field", sf))
    for a in search.get("area") or []:
        params.append(("area", str(a)))
    for s in search.get("schedule") or []:
        params.append(("schedule", s))
    for e in search.get("employment") or []:
        params.append(("employment", e))
    for ex in search.get("experience") or []:
        params.append(("experience", ex))
    if search.get("salary_from"):
        params.append(("salary", str(int(search["salary_from"]))))
    if search.get("only_with_salary"):
        params.append(("only_with_salary", "true"))
    if search.get("search_period"):
        params.append(("search_period", str(int(search["search_period"]))))
    params.append(("order_by", "publication_time"))
    params.append(("per_page", "100"))

    out, page = [], 0
    headers = {
        "User-Agent": user_agent,
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    while len(out) < max_results and page < 20:
        url = OFFICIAL_URL + "?" + urllib.parse.urlencode(
            params + [("page", str(page))], doseq=True
        )
        try:
            data = _get_json(url, headers=headers)
        except Exception as e:
            print(f"[hh] official API error: {e}")
            break
        for raw in data.get("items") or []:
            out.append(normalize_official(raw))
            if len(out) >= max_results:
                break
        if page >= (data.get("pages") or 1) - 1:
            break
        page += 1
        time.sleep(0.4)
    return out, data.get("found") if "data" in dir() else None
