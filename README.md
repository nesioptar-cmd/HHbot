# HHbot v2 — вакансии hh.ru → Telegram-бот с меню + дашборд (Netlify)

[![Netlify Status](https://api.netlify.com/api/v1/badges/61a11d3b-8074-4b38-8ec8-7fef8018f18c/deploy-status)](https://app.netlify.com/projects/hhbot-vacancies/deploys)

Telegram-бот с **нативным меню кнопками**: мастер подборки
(ключевые слова → где искать → регион → график → зарплата → рейтинг),
подписка на обновления **каждые 3 часа**, дашборд с фильтрами.
Хостинг полностью на Netlify (сайт + функции + планировщик + хранилище),
GitHub — только код. Всё бесплатно.

```
Telegram ──webhook──▶ Netlify Function tg-webhook ──▶ Blobs (подписки)
                              ▲ мгновенные ответы (< 2 сек)
Netlify Scheduled fetch (0 */3 * * *) ──▶ hh.ru ──▶ Telegram-дайджесты + Blobs-кэш
                                                              ▲
Дашборд (public/) ──▶ Function api-data ──▶ Blobs ──▶┘
```

## Запуск (15 минут)

### 1. Netlify: создать сайт
1. https://app.netlify.com → Add new site → Import an existing project →
   GitHub → `nesioptar-cmd/HHbot`, branch `main`.
2. Build settings подхватятся из `netlify.toml` сами
   (publish `public`, functions `netlify/functions`). Deploy.

### 2. Переменные окружения (Site settings → Environment variables)
- `TELEGRAM_BOT_TOKEN` — токен @hhedz_bot (тот же)
- `BOT_USERNAME` — `hhedz_bot` (для ссылок в дашборде)
- `DASHBOARD_URL` — URL сайта, напр. `https://hhbot.netlify.app`
- `HH_ACCESS_TOKEN` — **рекомендуется**: токен приложения с https://dev.hh.ru/admin
  (с ним официальный API hh.ru работает с любых IP без капчи; без него — публичный
  поиск сайта, может упираться в регион)
- `HH_USER_AGENT` — напр. `hh-vacancy-dashboard/1.0 (you@domain.ru)`

Blobs-хранилище заводится само, ничего настраивать не надо.

### 3. Webhook бота (после первого деплоя)
```bash
curl "https://api.telegram.org/bot<ТОКЕН>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://<ваш-сайт>/.netlify/functions/tg-webhook"}'
```
Проверка: напишите боту `/start` — меню должно прийти за пару секунд.

### 4. Готово
- Пользователи жмут `/start`, создают подборки кнопками — всё без кода.
- Каждые 3 часа `fetch-vacancies` рассылает новое и обновляет дашборд.
- Старый конвейер GitHub Actions удалён (дублей рассылки не будет);
  GitHub Pages больше не используется (каталог `docs/` оставлен пустым).

## Меню бота

- **🔍 Новая подборка** → спрашивает ключевые слова → меню кнопками:
  где искать, регион (Москва/СПб/Россия), график, занятость, опыт,
  зарплата (пороги + своя сумма), рейтинг → **✅ Подписаться**.
- **📋 Мои подборки** → вкл/выкл одной кнопкой, изменить (мастер), удалить.
- **🆕 Что нового** → последние вакансии по вашим подпискам прямо сейчас
  (команда `/new`, без ожидания планового сбора).
- **📊 Дашборд** → ссылка (плюс WebApp-кнопка в чате).
- Быстрые команды: `/new`, `/list`, `/del 1`, `/on 1`, `/off 1`,
  `/add текст`, `/add текст | москва | удалённо | 4.5` (и `/replace N | …`).

## Управление подписками с сайта

Бейджи подборок в дашборде кликабельны (скрыть/показать, только вид).

**Приватность:** дашборд, открытый через кнопку 📊 в боте, показывает
**только свои** подписки и вакансии по ним (проверка подписи Telegram WebApp
на сервере). Чужие названия подборок из карточек вырезаются, кнопки 🗑 ⏸ —
только у своих. Из обычного браузера — пустой общий вид. Управление:
удалить/выключить свои — кнопками в Настройках; дублирующий путь —
`/del`, `/on`, `/off` в чате.

## Локальная проверка

```bash
npm install
node test/local.mjs   # webhook-диалоги (мок Telegram) + живой fetch hh.ru + api-data
```
Тесты ходят в настоящий hh.ru, токены не нужны. Локальное хранилище — файлы
(`STORE=file`), в проде — Netlify Blobs.

## Структура

```
netlify/functions/tg-webhook.mjs    приём webhook, мгновенные ответы
netlify/functions/fetch-vacancies.mjs  сбор раз в 3 часа (schedule в netlify.toml)
netlify/functions/api-data.mjs      данные для дашборда (приватные по WebApp-подписи)
netlify/functions/api-subs.mjs      удаление/вкл-выкл подписок с сайта (подпись WebApp)
netlify/lib/webapp.mjs              проверка подписи Telegram WebApp
netlify/lib/bot.mjs                 меню, мастер, команды, подписки
netlify/lib/hh.mjs                  hh.ru: shards + официальный API
netlify/lib/filters.mjs             фильтры, рейтинг, оформление сообщений
netlify/lib/tg.mjs                  Telegram Bot API
netlify/lib/seeds.mjs               общие подборки (врач-терапевт, телемедицина)
netlify/lib/store.mjs               Blobs / файлы
public/                             дашборд (тёмная/светлая тема, фильтры, конструктор)
test/local.mjs                      стенд (диалоги, fetch, api)
test/webapp.mjs                     стенд подписи WebApp и api-subs
test/privacy.mjs                    стенд приватности дашборда
src/                                старая Python-версия v1 (не используется, на удаление)
config/                             старые yaml v1 (не используются, на удаление)
```
