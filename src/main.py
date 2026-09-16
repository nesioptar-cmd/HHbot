"""Точка входа: fetch hh.ru -> фильтры -> дедупликация -> Telegram -> дашборд.

Запуск локально:
    TELEGRAM_BOT_TOKEN=xxx python src/main.py --send
    python src/main.py --no-send   # только обновить дашборд docs/index.html

В GitHub Actions токен берётся из Secrets, см. .github/workflows/hhbot.yml
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import hh_client
import telegram
import bot_commands
from filters import apply_filters
from dashboard import build_dashboard


def load_config(path):
    """YAML если есть pyyaml, иначе JSON с тем же именем."""
    if os.path.exists(path):
        try:
            import yaml
            with open(path, encoding="utf-8") as f:
                return yaml.safe_load(f) or {}
        except ImportError:
            pass
        except Exception as e:
            print(f"[config] yaml error {path}: {e}")
    alt = os.path.splitext(path)[0] + ".json"
    if os.path.exists(alt):
        with open(alt, encoding="utf-8") as f:
            return json.load(f)
    # минимальный YAML-парсер не тянем: просим поставить pyyaml
    if path.endswith(".yaml") and os.path.exists(path):
        print("[config] Установите pyyaml (pip install pyyaml) или создайте .json рядом.")
        sys.exit(1)
    return {}


def load_seen(path):
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
            return set(d.get("seen_ids", []))
    except Exception:
        return set()


def save_seen(path, ids):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"seen_ids": sorted(ids)[-5000:]}, f, ensure_ascii=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--send", dest="send", action="store_true", default=True)
    ap.add_argument("--no-send", dest="send", action="store_false")
    ap.add_argument("--limit-per-search", type=int, default=None)
    args = ap.parse_args()

    searches = load_config(os.path.join(ROOT, "config", "searches.yaml")).get("searches", [])
    users_cfg = load_config(os.path.join(ROOT, "config", "users.yaml")).get("users", []) or []

    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    hh_token = os.environ.get("HH_ACCESS_TOKEN", "")
    hh_ua = os.environ.get("HH_USER_AGENT", "hh-vacancy-dashboard/1.0 (admin@yourdomain.ru)")

    # 0. Команды из Telegram (личные подборки + авторегистрация)
    if token:
        try:
            personal, users_changed = bot_commands.process_inbox(token, users_cfg, ROOT)
        except Exception as e:
            print(f"[main] commands error: {e}")
            personal, users_changed = {}, False
        if users_changed:
            try:
                import yaml
                with open(os.path.join(ROOT, "config", "users.yaml"), "w", encoding="utf-8") as f:
                    yaml.safe_dump({"users": users_cfg}, f, allow_unicode=True, sort_keys=False)
            except Exception as e:
                print(f"[main] users.yaml save failed: {e}")
        for owner, plist in (personal or {}).items():
            for i, p in enumerate(plist, 1):
                p = dict(p)
                p["id"] = f"u_{owner}_{i}"
                p["owner"] = owner
                p["personal"] = True
                p.setdefault("notify_users", [owner])
                searches.append(p)
    else:
        print("[main] TELEGRAM_BOT_TOKEN не задан — команды пропущены.")

    if not searches:
        print("[main] Нет подборок (ни общих, ни личных) — нечего искать.")
        return

    seen = load_seen(os.path.join(ROOT, "data", "seen.json"))
    all_vac, fresh = [], []

    for s in searches:
        sid = s.get("id") or s.get("name")
        limit = args.limit_per_search or int(s.get("max_results") or 50)
        print(f"[main] Поиск '{s.get('name')}' …")
        try:
            if hh_token:
                items, total = hh_client.search_official(s, hh_token, hh_ua, limit)
            else:
                items, total = hh_client.search_shards(s, limit)
        except Exception as e:
            print(f"[main] ошибка поиска {sid}: {e}")
            continue
        print(f"[main]   найдено API: {total}, получено: {len(items)}")
        kept = apply_filters(items, s)
        print(f"[main]   после фильтров (рейтинг≥{s.get('min_employer_rating') or 0}): {len(kept)}")
        for v in kept:
            v["search_id"] = sid
            v["search_name"] = s.get("name") or sid
            all_vac.append(v)
            key = f"{sid}:{v['id']}"
            if key not in seen:
                fresh.append((s, v))
                seen.add(key)

    # Дашборд — всегда (все отфильтрованные, не только новые)
    build_dashboard(
        all_vac, searches,
        os.path.join(ROOT, "docs"),
        notify_users_count=len([u for u in users_cfg if u.get("chat_id")]),
    )
    save_seen(os.path.join(ROOT, "data", "seen.json"), seen)

    print(f"[main] Всего: {len(all_vac)}, новых: {len(fresh)}")
    if not args.send:
        print("[main] --no-send: рассылка пропущена.")
        return
    if not token:
        print("[main] TELEGRAM_BOT_TOKEN не задан — рассылка пропущена.")
        return
    if not users_cfg:
        print("[main] config/users.yaml пуст — некому отправлять. См. README.")
        return

    by_user = {u.get("username", "").lstrip("@"): u.get("chat_id") for u in users_cfg if u.get("chat_id")}
    # группируем свежие по получателям
    per_chat = {}
    for s, v in fresh:
        targets = [u.lstrip("@") for u in (s.get("notify_users") or [])] or list(by_user.keys())
        for u in targets:
            cid = by_user.get(u)
            if cid:
                per_chat.setdefault(cid, []).append((s, v))

    if not per_chat:
        if not by_user:
            print("[main] Нет получателей с chat_id — новички должны нажать /start.")
        else:
            print("[main] Новых вакансий для рассылки нет.")
        return

    head_tpl = "🆕 <b>{n} новых</b> по подборке «{name}»"
    for chat_id, items in per_chat.items():
        # шапка по каждой подборке + карточки (макс. 10 на пользователя за запуск)
        groups = {}
        for s, v in items:
            groups.setdefault(s.get("id"), (s, []))[1].append(v)
        sent = 0
        for sid, (s, vs) in groups.items():
            if sent >= 10:
                break
            telegram.send_message(token, chat_id, head_tpl.format(n=len(vs), name=s.get("name")))
            for v in vs[:10 - sent]:
                if sent >= 10:
                    break
                ok, _ = telegram.send_message(
                    token, chat_id, telegram.format_vacancy(v, s.get("name")))
                sent += 1 if ok else 0
        print(f"[main] -> chat {chat_id}: {sent} сообщений")


if __name__ == "__main__":
    main()
