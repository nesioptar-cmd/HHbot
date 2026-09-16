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
    "🤖 <b>Команды:</b>\n"
    "/setup <i>текст</i> — пошаговое меню настройки (кнопки)\n"
    "/add <i>текст</i> — быстрая подборка\n"
    "/add <i>текст | регион | график | …</i> — сразу с фильтрами\n"
    "/replace <i>номер | …</i> — заменить подборку целиком\n"
    "/list — мои подборки\n"
    "/show <i>[номер]</i> — подробно об одной\n"
    "/del <i>номер</i> — удалить\n"
    "/text · /field · /area · /schedule · /exp · /salary · /rating — правки\n"
    "/off <i>[номер]</i> — выключить (не ищет и не шлёт) · /on <i>[номер]</i> — включить\n"
    "(номер из /list можно опускать)\n"
    "⏱ Всё применяется при ближайшем обновлении (каждые ~5 мин)."
)


def parse_spec(spec):
    """'текст | москва | удалённо | 4.5 | 150000 | 1-3 | название' -> dict полей.

    Каждый кусок классифицируется: регион, график, рейтинг (0–5 с точкой),
    зарплата (большое число), опыт, где искать — остальное склеивается в текст.
    """
    s = new_personal_search("")
    texts = []
    for raw in spec.split("|"):
        part = raw.strip()
        if not part:
            continue
        low = part.lower()
        if low in AREA_ALIASES:
            s["area"] = AREA_ALIASES[low]
            continue
        if low in SCHEDULE_ALIASES:
            s["schedule"] = SCHEDULE_ALIASES[low]
            continue
        if low in FIELD_ALIASES:
            s["search_field"] = FIELD_ALIASES[low]
            continue
        if low in EXP_ALIASES:
            s["experience"] = [EXP_ALIASES[low]] if EXP_ALIASES[low] else []
            continue
        digits = "".join(ch for ch in part if ch.isdigit())
        if digits and low.replace(" ", "").replace("\u00a0", "") == digits:
            num = int(digits)
            if num <= 5 and s["min_employer_rating"] == 0.0:
                s["min_employer_rating"] = float(num)
            else:
                s["salary_from"] = num
            continue
        try:
            r = float(part.replace(",", "."))
            if 0 < r <= 5 and s["min_employer_rating"] == 0.0:
                s["min_employer_rating"] = r
                continue
        except ValueError:
            pass
        texts.append(part)
    text = " ".join(texts).strip()[:100]
    s["text"] = text
    s["name"] = f"👤 {text[:40]}"
    return s

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
    bits = [f"<b>{i}. {s.get('text', '')}</b>"
            + ("" if s.get("enabled", True) else " ⏸<i>выкл</i>"),
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
        "enabled": True,
    }


def _entry(personal, username):
    """Ячейка пользователя (с миграцией старого формата {user: [...]}))."""
    e = personal.get(username)
    if isinstance(e, list):
        e = {"searches": e, "draft": None, "menu": None}
        personal[username] = e
    elif not isinstance(e, dict):
        e = {"searches": [], "draft": None, "menu": None}
        personal[username] = e
    e.setdefault("searches", [])
    e.setdefault("draft", None)
    e.setdefault("menu", None)
    return e


# ── Мастер настройки (инлайн-меню) ──

WIZ_FIELDS = [
    ("field", "Где искать", [("everywhere", "Везде"), ("name", "В названии"),
                             ("description", "В описании")]),
    ("area", "Регион", [("1", "Москва"), ("2", "СПб"), ("113", "Россия")]),
    ("schedule", "График", [("any", "Любой"), ("remote", "Удалённо"),
                            ("fullDay", "Полный день")]),
    ("rating", "Рейтинг", [("0", "Любой"), ("4.0", "4.0+"), ("4.5", "4.5+")]),
]

MARK = "✅ "


def _draft_val(draft, key):
    if key == "field":
        return draft.get("search_field") or "everywhere"
    if key == "area":
        return str((draft.get("area") or [113])[0])
    if key == "schedule":
        return (draft.get("schedule") or ["any"])[0]
    if key == "rating":
        r = draft.get("min_employer_rating") or 0
        return "4.5" if r >= 4.5 else ("4.0" if r >= 4.0 else "0")
    return ""


def build_menu(entry):
    draft = entry.get("draft") or {}
    kb = []
    for key, _title, opts in WIZ_FIELDS:
        cur = _draft_val(draft, key)
        kb.append([{"text": f"{MARK if v == cur else ''}{label}",
                    "callback_data": f"w:{key}:{v}"} for v, label in opts])
    kb.append([{"text": "✅ Готово", "callback_data": "w:done"},
               {"text": "🗑 Отмена", "callback_data": "w:cancel"}])
    text = (f"⚙️ <b>Настройка подборки «{draft.get('text', '')}»</b>\n"
            f"Сейчас: {_describe_short(draft)}\n"
            "Нажимайте кнопки, затем «Готово».\n"
            "Зарплату и опыт — командами: /salary 150000 · /exp 1-3\n"
            "(применятся к готовой подборке).")
    return text, {"inline_keyboard": kb}


def _describe_short(s):
    bits = [f"ищем {FIELD_RU.get(s.get('search_field'), 'везде')}"]
    bits.append("регион: " + {1: "Москва", 2: "СПб"}.get(
        (s.get("area") or [113])[0], "Россия"))
    sched = (s.get("schedule") or [])
    bits.append("график: " + ({"remote": "удалённо"}.get(sched[0], "любой") if sched else "любой"))
    bits.append(f"рейтинг ≥ {s.get('min_employer_rating') or 'любой'}")
    return " · ".join(bits)


def apply_wiz(entry, key, val):
    draft = entry.get("draft")
    if not draft:
        return False
    if key == "field" and val in FIELD_ALIASES.values():
        draft["search_field"] = val
    elif key == "area" and val in ("1", "2", "113"):
        draft["area"] = [int(val)]
    elif key == "schedule" and val in ("any", "remote", "fullDay"):
        draft["schedule"] = [] if val == "any" else [val]
    elif key == "rating" and val in ("0", "4.0", "4.5"):
        draft["min_employer_rating"] = float(val)
    else:
        return False
    return True


def handle_command(cmd, arg, username, personal):
    """Возвращает текст ответа. personal — dict пользователя (mutates)."""
    mine = _entry(personal, username)["searches"]
    if cmd == "setup":
        if not arg:
            return ("Использование: /setup <i>ключевые слова</i>, напр. /setup врач терапевт", False)
        return ("__SETUP__:" + arg[:100], False)
    if cmd == "start":
        return (f"Привет, @{username}! Я присылаю новые вакансии hh.ru "
                f"и обновляю дашборд каждые ~30 мин.\n\n{HELP}", True)
    if cmd == "help":
        return (HELP, False)
    if cmd == "add":
        if not arg:
            return ("Использование: /add <i>текст</i> или /add <i>текст | регион | график | "
                    "рейтинг | зарплата | опыт | где</i>", False)
        if "|" in arg:
            s = parse_spec(arg)
            if not s["text"]:
                return ("Не понял запрос. Пример: /add <i>врач терапевт | москва | 4.5</i>", False)
            mine.append(s)
        else:
            mine.append(new_personal_search(arg[:100]))
        return (f"✅ Подборка №{len(mine)} добавлена: {_describe(mine[-1], len(mine))}", False)
    if cmd == "replace":
        err = _need(mine)
        if err:
            return (err, False)
        head, _, spec = arg.partition("|")
        head = head.strip()
        if not head.isdigit() or not spec.strip():
            return ("Использование: /replace <i>номер | текст | регион | …</i> "
                    "(собирается формой в дашборде)", False)
        n = int(head)
        if not 1 <= n <= len(mine):
            return (f"Подборки №{n} нет. Смотрите /list.", False)
        s = parse_spec(spec)
        if not s["text"]:
            return ("Не понял запрос. Пример: /replace <i>1 | врач терапевт | москва</i>", False)
        mine[n - 1] = s
        return (f"✅ Подборка №{n} заменена: {_describe(s, n)}", False)
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
    if cmd in ("off", "on"):
        err = _need(mine)
        if err:
            return (err, False)
        targets, _, pick_err = _pick(mine, arg)
        if pick_err:
            return (pick_err, False)
        for s in targets:
            s["enabled"] = (cmd == "on")
        state = "включены" if cmd == "on" else "выключены (не ищутся, не рассылаются)"
        return (f"✅ {len(targets)} шт. {state}.", False)
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


def _send_menu(token, chat_id, entry, message_id=None):
    """Отправка/обновление меню мастера. Возвращает message_id."""
    text, kb = build_menu(entry)
    payload = {"chat_id": str(chat_id), "text": text, "parse_mode": "HTML",
               "disable_web_page_preview": "true",
               "reply_markup": json.dumps(kb, ensure_ascii=False)}
    try:
        if message_id:
            payload["message_id"] = message_id
            telegram._call(token, "editMessageText", payload)
            return message_id
        res = telegram._call(token, "sendMessage", payload)
        return (res.get("result") or {}).get("message_id")
    except Exception as e:
        print(f"[cmd] menu send/edit failed: {e}")
        return message_id


def _close_menu(token, chat_id, message_id, text):
    try:
        telegram._call(token, "editMessageText", {
            "chat_id": str(chat_id), "message_id": message_id,
            "text": text, "parse_mode": "HTML", "disable_web_page_preview": "true"})
    except Exception as e:
        print(f"[cmd] menu close failed: {e}")


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
    dirty_menus = set()

    for u in updates.get("result", []):
        offset = max(offset, u.get("update_id", 0) + 1)

        # — кнопки мастера —
        cb = u.get("callback_query")
        if cb:
            frm = cb.get("from") or {}
            username = frm.get("username") or ""
            msg = cb.get("message") or {}
            chat = msg.get("chat") or {}
            data = cb.get("data") or ""
            if not username or not data.startswith("w:"):
                continue
            if username not in known:
                users_cfg.append({"username": username, "chat_id": chat.get("id")})
                known.add(username)
                users_changed = True
            entry = _entry(personal, username)
            if data == "w:done":
                if entry.get("draft"):
                    entry["searches"].append(entry["draft"])
                    n = len(entry["searches"])
                    entry["draft"] = None
                    menu = entry.get("menu") or {}
                    _close_menu(token, chat.get("id"), menu.get("message_id"),
                                f"✅ Подборка №{n} готова и уже ищет. /list — проверить.")
                    entry["menu"] = None
            elif data == "w:cancel":
                entry["draft"] = None
                menu = entry.get("menu") or {}
                _close_menu(token, chat.get("id"), menu.get("message_id"),
                            "🗑 Настройка отменена.")
                entry["menu"] = None
            else:
                parts = data.split(":", 2)  # w:key:val
                if len(parts) == 3 and apply_wiz(entry, parts[1], parts[2]):
                    dirty_menus.add(username)
            continue

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
        if answer.startswith("__SETUP__:"):
            entry = _entry(personal, username)
            entry["draft"] = new_personal_search(answer[len("__SETUP__:"):])
            mid = _send_menu(token, chat.get("id"), entry,
                             (entry.get("menu") or {}).get("message_id"))
            entry["menu"] = {"chat_id": chat.get("id"), "message_id": mid}
            dirty_menus.discard(username)
            continue
        _reply(token, chat.get("id"), answer, kb=with_kb)

    # перерисовать меню с учётом всех нажатий за прогон
    for username in dirty_menus:
        entry = _entry(personal, username)
        menu = entry.get("menu") or {}
        if entry.get("draft") and menu.get("message_id"):
            _send_menu(token, menu.get("chat_id"), entry, menu.get("message_id"))

    _save_json(os.path.join(data_dir, "personal.json"), personal)
    _save_json(os.path.join(data_dir, "tg_offset.json"), {"offset": offset})
    return personal, users_changed
