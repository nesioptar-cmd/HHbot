"""Отправка сообщений через Telegram Bot API (только stdlib)."""

import json
import urllib.parse
import urllib.request

API = "https://api.telegram.org/bot{token}/{method}"


def _call(token, method, payload, timeout=20):
    data = urllib.parse.urlencode(payload).encode()
    req = urllib.request.Request(
        API.format(token=token, method=method), data=data, method="POST"
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def send_message(token, chat_id, text, disable_preview=False):
    try:
        r = _call(token, "sendMessage", {
            "chat_id": str(chat_id),
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": "true" if disable_preview else "false",
        })
        return bool(r.get("ok")), r
    except Exception as e:
        print(f"[tg] send to {chat_id} failed: {e}")
        return False, {"error": str(e)}


def format_vacancy(v, search_name=""):
    try:
        from filters import salary_text, SCHEDULE_RU
    except ImportError:  # запуск как пакета: python -m src.main
        from .filters import salary_text, SCHEDULE_RU
    sched = SCHEDULE_RU.get(v.get("schedule") or "", v.get("schedule") or "")
    rating = v.get("rating") or 0.0
    rating_s = f"⭐ {rating:.1f} ({v.get('reviews_count', 0)})" if rating else "без рейтинга"
    lines = [
        f"💼 <b>{_esc(v.get('name', ''))}</b>",
        f"🏢 {_esc(v.get('employer', ''))} · {rating_s}",
        f"📍 {_esc(v.get('area', ''))} · {sched}",
        f"💰 {salary_text(v)}",
    ]
    if search_name:
        lines.append(f"🔎 <i>{_esc(search_name)}</i>")
    lines.append(f"🔗 {v.get('url', '')}")
    return "\n".join(lines)


def _esc(s):
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def get_updates(token, offset=0, timeout=10):
    """Для resolve_users.py: кто нажимал /start."""
    url = API.format(token=token, method="getUpdates") + "?" + urllib.parse.urlencode(
        {"offset": offset, "timeout": timeout}
    )
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=timeout + 15) as resp:
        return json.loads(resp.read().decode())
