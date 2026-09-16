"""Сопоставление @username -> chat_id.

Telegram запрещает писать пользователям по username — нужен chat_id,
который появляется только после того, как человек сам напишет боту (/start).

Использование:
    TELEGRAM_BOT_TOKEN=xxx python src/resolve_users.py

Скрипт читает config/users.yaml, опрашивает getUpdates, находит свежие
сообщения от нужных username и дописывает chat_id. Вывод можно вставить
обратно в users.yaml.
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import telegram


def main():
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    if not token:
        print("Задайте TELEGRAM_BOT_TOKEN")
        sys.exit(1)
    import json
    cfg_path = os.path.join(os.path.dirname(HERE), "config", "users.yaml")
    wanted = []
    try:
        import yaml
        with open(cfg_path, encoding="utf-8") as f:
            wanted = (yaml.safe_load(f) or {}).get("users", []) or []
    except Exception as e:
        print(f"Не смог прочитать users.yaml: {e} (создайте его по примеру из README)")

    print("Опрашиваю getUpdates… (пусть каждый получатель сначала нажмёт /start в боте)")
    offset, found = 0, {}
    for _ in range(5):
        data = telegram.get_updates(token, offset=offset, timeout=5)
        for u in data.get("result", []):
            offset = max(offset, u.get("update_id", 0) + 1)
            msg = u.get("message") or u.get("edited_message") or {}
            frm = msg.get("from") or {}
            if frm.get("username") and msg.get("chat"):
                found[frm["username"]] = msg["chat"]["id"]
        if found:
            break
    if not found:
        print("Никого не нашёл. Проверьте: 1) пользователи нажали /start, "
              "2) токен верный, 3) боту пишут напрямую, а не в группу.")
        return
    print("\nНайдено (вставьте chat_id в config/users.yaml):")
    for uname, cid in found.items():
        mark = "  <-- есть в конфиге" if any(
            (w or {}).get("username", "").lstrip("@") == uname for w in wanted) else ""
        print(f'  - username: "{uname}"\n    chat_id: {cid}{mark}')


if __name__ == "__main__":
    main()
