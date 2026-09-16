"""Публикация статичного дашборда в docs/ (для GitHub Pages).

Дизайн — frontend/ (перенесён из внешнего бандла и адаптирован под статику:
без бэкенда, данные подтягиваются из vacancies.json + config.json).
Сюда копируются index.html / app.js / style.css как есть,
а vacancies.json и config.json генерируются из свежих данных.
"""

import json
import os
import shutil
from datetime import datetime, timezone, timedelta

MSK = timezone(timedelta(hours=3))
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")


def build_dashboard(vacancies, searches, docs_dir, notify_users_count=0):
    os.makedirs(docs_dir, exist_ok=True)
    for fname in ("index.html", "app.js", "style.css"):
        src = os.path.join(FRONTEND_DIR, fname)
        if os.path.exists(src):
            shutil.copyfile(src, os.path.join(docs_dir, fname))
    with open(os.path.join(docs_dir, "vacancies.json"), "w", encoding="utf-8") as f:
        json.dump(vacancies, f, ensure_ascii=False, indent=2)
    # Не публикуем секреты и chat_id — только snapshot фильтров для модалки
    # «Настройки» и счётчик получателей.
    public_searches = []
    for s in searches:
        public_searches.append({
            "id": s.get("id"),
            "name": s.get("name"),
            "text": s.get("text"),
            "search_field": s.get("search_field"),
            "area": s.get("area") or [],
            "schedule": s.get("schedule") or [],
            "employment": s.get("employment") or [],
            "experience": s.get("experience") or [],
            "salary_from": s.get("salary_from") or 0,
            "only_with_salary": bool(s.get("only_with_salary")),
            "search_period": s.get("search_period"),
            "min_employer_rating": s.get("min_employer_rating") or 0,
            "owner": s.get("owner") or "",
            "personal": bool(s.get("personal")),
            "enabled": bool(s.get("enabled", True)),
        })
    with open(os.path.join(docs_dir, "config.json"), "w", encoding="utf-8") as f:
        json.dump({
            "generated_at": datetime.now(MSK).strftime("%d.%m.%Y %H:%M"),
            "bot_username": os.environ.get("BOT_USERNAME", "hhedz_bot"),
            "searches": public_searches,
            "notify_users_count": int(notify_users_count or 0),
        }, f, ensure_ascii=False, indent=2)
    # Pages: отключаем Jekyll, чтобы не игнорировались файлы с подчёркиванием
    open(os.path.join(docs_dir, ".nojekyll"), "a").close()
    print(f"[dashboard] {docs_dir}: {len(vacancies)} вакансий, {len(public_searches)} подборок")
