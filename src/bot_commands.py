"""Команды боту, обрабатываемые раз в прогон (бесплатный хостинг: answers с задержкой до 30 мин).

Команды (писать боту в личку):
  /start            — регистрация + помощь
  /help             — список команд
  /add <текст>      — личная подборка, напр. /add python удалённо
  /list             — мои подборки
  /del <номер>      — удалить личную подборку
  /rating <0–5>     — мин. рейтинг работодателя для моих подборок
  /schedule <вид>   — график: remote/удалённо, fullday, flexible, shift, vahta, any
  /area <регион>    — 1/москва, 2/питер, 113/россия

Незнакомый пользователь, написавший /start, автоматически добавляется
в config/users.yaml (бот сможет слать ему вакансии).
Личные подборки хранятся в data/personal.json и коммитятся workflow.
"""

import json
import os

try:
    import telegram
except ImportError:  # запуск как пакета
    from . import telegram

DATA_DIR = None  # задаётся из main
DASHBOARD_URL = os.environ.get(
    "DASHBOARD_URL", "https://nesioptar-cmd.github.io/HHbot/")

SCHEDULE_ALIASES = {
    "remote": ["remote"], "удалённо": ["remote"], "удаленка": ["remote"],
    "fullday": ["fullDay"], "полный": ["fullDay"],
    "flexible": ["flexible"], "гибкий": ["flexible"],
    "shift": ["shift"], "сменный": ["shift"],
    "vahta": ["flyInFlyOut"], "вахта": ["flyInFlyOut"],
    "any": [], "любая": [], "любой": [],
}
AREA_ALIASES = {
    "1": [1], "москва": [1], "мск": [1],
    "2": [2], "питер": [2], "спб": [2],
    "113": [113], "россия": [113], "вся": [113],
}

HELP = (
    "🤖 <b>Команды:</b>\n"
    "/add <i>текст</i> — новая подборка (напр. /add python)\n"
    "/list — мои подборки\n"
    "/del <i>номер</i> — удалить подборку\n"
    "/rating <i>0–5</i> — мин. рейтинг работодателя\n"
    "/schedule <i>вид</i> — remote, fullday, flexible, shift, vahta, any\n"
    "/area <i>регион</i> — москва, питер, россия (или ID)\n"
    "⏱ Команды срабатывают при ближайшем обновлении (до ~30 мин)."
)

DASHBOARD_KB = {
    "inline_keyboard": [[{"text": "📊 Открыть дашборд", "url": DASHBOARD_URL}]]
}


def _load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def _reply(token, chat_id, text, kb=False):
    payload = {"chat_id": str(chat_id), "text": text, "parse_mode": "HTML",
               "disable_web_page_preview": "true"}
    if kb:
        payload["reply_markup"] = json.dumps(DASHBOARD_KB, ensure_ascii=False)
    try:
        telegram._call(token, "sendMessage", payload)
        return True
    except Exception as e:
        print(f"[cmd] reply failed: {e}")
        return False


def _describe(s, i):
    bits = [f"<b>{i}. {s.get('text', '')}</b>"]
    if s.get("schedule"):
        bits.append("график: " + ",".join(s["schedule"]))
    if s.get("area"):
        bits.append("регионы: " + ",".join(map(str, s["area"])))
    if s.get("min_employer_rating"):
        bits.append(f"рейтинг ≥ {s['min_employer_rating']}")
    return " · ".join(bits)


def new_personal_search(text):
    return {
        "id": "",  # проставит main
        "name": f"👤 {text[:40]}",
        "text": text,
        "search_field": "everywhere",
        "area": [113],
        "schedule": [],
        "employment": [],
        "experience": [],
        "salary_from": 0,
        "only_with_salary": False,
        "search_period": 7,
        "min_employer_rating": 0.0,
        "exclude_keywords": [],
        "max_results": 30,
    }


def handle_command(cmd, arg, username, personal):
    """Возвращает текст ответа. personal — список подборок пользователя (mutates)."""
    mine = personal.setdefault(username, [])
    if cmd == "start":
        return (f"Привет, @{username}! Я присылаю новые вакансии hh.ru "
                f"и обновляю дашборд каждые ~30 мин.\n\n{HELP}", True)
    if cmd == "help":
        return (HELP, False)
    if cmd == "add":
        if not arg:
            return ("Использование: /add <i>ключевые слова</i>, напр. /add python", False)
        mine.append(new_personal_search(arg[:100]))
        return (f"✅ Подборка №{len(mine)} добавлена: «{arg[:100]}».\n"
                f"Уточните: /schedule удалённо · /area москва · /rating 4.5", False)
    if cmd == "list":
        if not mine:
            return ("У вас пока нет личных подборок. Добавьте: /add <i>текст</i>", False)
        return ("📋 <b>Мои подборки:</b>\n" + "\n".join(
            _describe(s, i + 1) for i, s in enumerate(mine)), False)
    if cmd == "del":
        try:
            n = int(arg)
            removed = mine.pop(n - 1)
        except (ValueError, IndexError):
            return ("Использование: /del <i>номер из /list</i>", False)
        return (f"🗑 Удалена: «{removed.get('text', '')}»", False)
    if cmd == "rating":
        try:
            r = float(arg.replace(",", "."))
            assert 0 <= r <= 5
        except (ValueError, AssertionError):
            return ("Использование: /rating <i>0–5</i>, напр. /rating 4.5", False)
        if not mine:
            return ("Сначала добавьте подборку: /add <i>текст</i>", False)
        for s in mine:
            s["min_employer_rating"] = r
        return (f"✅ Мин. рейтинг {r} применён к {len(mine)} подборкам.", False)
    if cmd == "schedule":
        key = (arg or "").lower()
        if key not in SCHEDULE_ALIASES:
            return ("Виды: remote, fullday, flexible, shift, vahta, any", False)
        if not mine:
            return ("Сначала добавьте подборку: /add <i>текст</i>", False)
        for s in mine:
            s["schedule"] = SCHEDULE_ALIASES[key]
        return (f"✅ График «{arg}» применён к {len(mine)} подборкам.", False)
    if cmd == "area":
        key = (arg or "").lower()
        if key not in AREA_ALIASES:
            return ("Регионы: москва, питер, россия (или ID: 1, 2, 113…)", False)
        if not mine:
            return ("Сначала добавьте подборку: /add <i>текст</i>", False)
        for s in mine:
            s["area"] = AREA_ALIASES[key]
        return (f"✅ Регион «{arg}» применён к {len(mine)} подборкам.", False)
    return (f"Не знаю «/{cmd}».\n\n{HELP}", False)


def process_inbox(token, users_cfg, root):
    """Опрашивает getUpdates, исполняет команды.

    Возвращает (personal, users_changed). Пишет data/personal.json,
    data/tg_offset.json; users_cfg дополняется in-place.
    """
    data_dir = os.path.join(root, "data")
    personal = _load_json(os.path.join(data_dir, "personal.json"), {})
    offset = _load_json(os.path.join(data_dir, "tg_offset.json"), {}).get("offset", 0)
    users_changed = False
    try:
        updates = telegram.get_updates(token, offset=offset, timeout=0)
    except Exception as e:
        print(f"[cmd] getUpdates failed: {e}")
        return personal, False

    known = {u.get("username", "").lstrip("@") for u in users_cfg}
    for u in updates.get("result", []):
        offset = max(offset, u.get("update_id", 0) + 1)
        msg = u.get("message") or {}
        text = (msg.get("text") or "").strip()
        frm = msg.get("from") or {}
        username = frm.get("username") or ""
        chat = msg.get("chat") or {}
        if not text.startswith("/") or not username or chat.get("type") != "private":
            continue
        parts = text[1:].split(None, 1)
        cmd = parts[0].split("@")[0].lower()
        arg = parts[1].strip() if len(parts) > 1 else ""
        # авторегистрация по /start
        if username not in known:
            if cmd == "start":
                users_cfg.append({"username": username, "chat_id": chat.get("id")})
                known.add(username)
                users_changed = True
                print(f"[cmd] auto-registered @{username}")
            else:
                _reply(token, chat.get("id"),
                       "Нажмите /start, чтобы зарегистрироваться.")
                continue
        answer, with_kb = handle_command(cmd, arg, username, personal)
        _reply(token, chat.get("id"), answer, kb=with_kb)

    _save_json(os.path.join(data_dir, "personal.json"), personal)
    _save_json(os.path.join(data_dir, "tg_offset.json"), {"offset": offset})
    return personal, users_changed
