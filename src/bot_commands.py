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
FIELD_ALIASES = {
    "везде": "everywhere", "everywhere": "everywhere",
    "название": "name", "name": "name", "в названии": "name",
    "описание": "description", "description": "description", "в описании": "description",
    "компания": "company_name", "company": "company_name", "company_name": "company_name",
}
FIELD_RU = {"everywhere": "везде", "name": "в названии",
            "description": "в описании", "company_name": "в компании"}
EXP_ALIASES = {
    "any": "", "не важно": "", "любой": "",
    "без опыта": "noExperience", "noexperience": "noExperience", "нет опыта": "noExperience",
    "1-3": "between1And3", "1–3": "between1And3", "between1and3": "between1And3",
    "3-6": "between3And6", "3–6": "between3And6", "between3and6": "between3And6",
    "6+": "moreThan6", "morethan6": "moreThan6", "более 6": "moreThan6",
}
EXP_RU = {"noExperience": "без опыта", "between1And3": "1–3 года",
          "between3And6": "3–6 лет", "moreThan6": "6+ лет"}

HELP = (
    "🤖 <b>Команды</b> (номер — из /list, можно опускать):\n"
    "/add <i>текст</i> — новая подборка\n"
    "/list — мои подборки\n"
    "/show <i>[номер]</i> — подробно об одной\n"
    "/del <i>номер</i> — удалить\n"
    "/text <i>[номер] новый текст</i> — сменить запрос\n"
    "/field <i>[номер] где</i> — везде, название, описание, компания\n"
    "/area <i>[номер] регион</i> — москва, питер, россия\n"
    "/schedule <i>[номер] вид</i> — remote, fullday, flexible, shift, vahta, any\n"
    "/exp <i>[номер] опыт</i> — без опыта, 1-3, 3-6, 6+, any\n"
    "/salary <i>[номер] сумма</i> — зарплата от (0 — убрать)\n"
    "/rating <i>[номер] 0–5</i> — мин. рейтинг работодателя\n"
    "⏱ Срабатывают при ближайшем обновлении (до ~30 мин)."
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
    bits = [f"<b>{i}. {s.get('text', '')}</b>",
            f"ищем {FIELD_RU.get(s.get('search_field'), s.get('search_field') or 'везде')}"]
    if s.get("area"):
        bits.append("регионы: " + ",".join(map(str, s["area"])))
    if s.get("schedule"):
        bits.append("график: " + ",".join(s["schedule"]))
    if s.get("experience"):
        bits.append("опыт: " + ",".join(EXP_RU.get(e, e) for e in s["experience"]))
    if s.get("salary_from"):
        bits.append(f"от {int(s['salary_from']):,} ₽".replace(",", " "))
    if s.get("min_employer_rating"):
        bits.append(f"рейтинг ≥ {s['min_employer_rating']}")
    return " · ".join(bits)


def _pick(mine, arg):
    """(targets, value, err): 'N остальное' — одна подборка, иначе все."""
    parts = (arg or "").split(None, 1)
    if parts and parts[0].isdigit():
        n = int(parts[0])
        if 1 <= n <= len(mine):
            return [mine[n - 1]], (parts[1] if len(parts) > 1 else ""), None
        return None, "", f"Подборки №{n} нет. Смотрите /list."
    return mine, arg, None


def _need(mine):
    if not mine:
        return "Сначала добавьте подборку: /add <i>текст</i>, напр. /add врач терапевт"
    return None


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
        return ("📋 <b>Мои подборки</b> (+ общие из дашборда):\n" + "\n".join(
            _describe(s, i + 1) for i, s in enumerate(mine)), False)
    if cmd == "show":
        err = _need(mine)
        if err:
            return (err, False)
        targets, _, pick_err = _pick(mine, arg or "1")
        if pick_err:
            return (pick_err, False)
        s = targets[0]
        n = mine.index(s) + 1
        return (f"🔎 <b>№{n}:</b> {_describe(s, n)}\n"
                f"Правки: /text {n} … · /field {n} … · /area {n} … · "
                f"/schedule {n} … · /exp {n} … · /salary {n} … · /rating {n} …", False)
    if cmd == "text":
        err = _need(mine)
        if err:
            return (err, False)
        targets, value, pick_err = _pick(mine, arg)
        if pick_err:
            return (pick_err, False)
        if not value:
            return ("Использование: /text <i>[номер] новый запрос</i>", False)
        for s in targets:
            s["text"] = value[:100]
            s["name"] = f"👤 {value[:40]}"
        return (f"✅ Запрос обновлён у {len(targets)} подборок: «{value[:100]}»", False)
    if cmd == "field":
        err = _need(mine)
        if err:
            return (err, False)
        targets, value, pick_err = _pick(mine, arg)
        if pick_err:
            return (pick_err, False)
        key = (value or "").lower()
        if key not in FIELD_ALIASES:
            return ("Где искать: везде, название, описание, компания", False)
        for s in targets:
            s["search_field"] = FIELD_ALIASES[key]
        return (f"✅ Ищем {FIELD_RU[FIELD_ALIASES[key]]} ({len(targets)} шт.)", False)
    if cmd == "exp":
        err = _need(mine)
        if err:
            return (err, False)
        targets, value, pick_err = _pick(mine, arg)
        if pick_err:
            return (pick_err, False)
        key = (value or "").lower()
        if key not in EXP_ALIASES:
            return ("Опыт: без опыта, 1-3, 3-6, 6+, any", False)
        for s in targets:
            s["experience"] = [EXP_ALIASES[key]] if EXP_ALIASES[key] else []
        return (f"✅ Опыт обновлён ({len(targets)} шт.)", False)
    if cmd == "salary":
        err = _need(mine)
        if err:
            return (err, False)
        targets, value, pick_err = _pick(mine, arg)
        if pick_err:
            return (pick_err, False)
        try:
            sal = int("".join(ch for ch in value if ch.isdigit()) or "x")
            assert sal >= 0
        except (ValueError, AssertionError):
            return ("Использование: /salary <i>[номер] сумма</i>, 0 — убрать", False)
        for s in targets:
            s["salary_from"] = sal
        return (f"✅ Зарплата от {sal:,} ₽ ({len(targets)} шт.)".replace(",", " "), False)
    if cmd == "del":
        try:
            n = int(arg)
            removed = mine.pop(n - 1)
        except (ValueError, IndexError):
            return ("Использование: /del <i>номер из /list</i>", False)
        return (f"🗑 Удалена: «{removed.get('text', '')}»", False)
    if cmd == "rating":
        err = _need(mine)
        if err:
            return (err, False)
        targets, value, pick_err = _pick(mine, arg)
        if pick_err:
            return (pick_err, False)
        try:
            r = float(value.replace(",", "."))
            assert 0 <= r <= 5
        except (ValueError, AssertionError):
            return ("Использование: /rating <i>[номер] 0–5</i>, напр. /rating 4.5", False)
        for s in targets:
            s["min_employer_rating"] = r
        return (f"✅ Мин. рейтинг {r} ({len(targets)} шт.)", False)
    if cmd == "schedule":
        err = _need(mine)
        if err:
            return (err, False)
        targets, value, pick_err = _pick(mine, arg)
        if pick_err:
            return (pick_err, False)
        key = (value or "").lower()
        if key not in SCHEDULE_ALIASES:
            return ("Виды: remote, fullday, flexible, shift, vahta, any", False)
        for s in targets:
            s["schedule"] = SCHEDULE_ALIASES[key]
        return (f"✅ График «{value}» ({len(targets)} шт.)", False)
    if cmd == "area":
        err = _need(mine)
        if err:
            return (err, False)
        targets, value, pick_err = _pick(mine, arg)
        if pick_err:
            return (pick_err, False)
        key = (value or "").lower()
        if key not in AREA_ALIASES:
            return ("Регионы: москва, питер, россия (или ID: 1, 2, 113…)", False)
        for s in targets:
            s["area"] = AREA_ALIASES[key]
        return (f"✅ Регион «{value}» ({len(targets)} шт.)", False)
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
