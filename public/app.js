/* HH.ru Vacancy Monitor — static frontend (GitHub Pages, no backend).
   Data: vacancies.json + config.json in the same directory, written by src/main.py.
   View state (theme, seen ids) is kept in localStorage.
*/

'use strict';

// ── Labels ──
const SCHEDULE_RU = {
  remote: 'Удалённо', fullDay: 'Полный день', flexible: 'Гибкий',
  shift: 'Сменный', flyInFlyOut: 'Вахта',
};
const EXPERIENCE_RU = {
  noExperience: 'Без опыта', between1And3: '1–3 года',
  between3And6: '3–6 лет', moreThan6: '6+ лет',
};
const SEARCH_FIELD_RU = {
  everywhere: 'везде', name: 'в названии',
  company_name: 'в компании', description: 'в описании',
};

const SEEN_KEY = 'hh_seen_v1';
const THEME_KEY = 'hh_theme';
const HIDDEN_KEY = 'hh_hidden_v1';

// ── State ──
let searches = [];
let vacancies = [];
let generatedAt = '';
let notifyCount = 0;
let botUsername = 'hhedz_bot';
let isPrivate = false;
let seen = new Set();
let hidden = new Set();

function loadHidden() {
  try {
    hidden = new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]'));
  } catch (e) { hidden = new Set(); }
}
function saveHidden() {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
  } catch (e) { /* ignore */ }
}

// ── Helpers ──
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatSalary(v) {
  const cur = { RUR: '₽', RUB: '₽', KZT: '₸', USD: '$', EUR: '€' }[v.currency] || v.currency || '';
  const fmt = (n) => new Intl.NumberFormat('ru-RU').format(n);
  if (v.salary_from && v.salary_to) return `${fmt(v.salary_from)}–${fmt(v.salary_to)} ${cur}`;
  if (v.salary_from) return `от ${fmt(v.salary_from)} ${cur}`;
  if (v.salary_to) return `до ${fmt(v.salary_to)} ${cur}`;
  return '';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return String(dateStr).slice(0, 10);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function loadSeen() {
  try {
    seen = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'));
  } catch (e) { seen = new Set(); }
}
function saveSeen() {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-5000)));
  } catch (e) { /* ignore */ }
}
const vacKey = (v) => String(v.id);

// ── Toast ──
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast toast-${type}`;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3500);
}

// ── Theme (with localStorage) ──
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon = document.getElementById('theme-icon');
  icon.innerHTML = theme === 'dark'
    ? '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>'
    : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
}
function initTheme() {
  let theme = 'dark';
  try { theme = localStorage.getItem(THEME_KEY) || theme; } catch (e) { /* ignore */ }
  if (!localStorage.getItem(THEME_KEY) && window.matchMedia('(prefers-color-scheme: light)').matches) {
    theme = 'light';
  }
  applyTheme(theme);
}

// ── Render: badges / stats / cards ──
function renderBadges() {
  const el = document.getElementById('config-badges');
  if (!searches.length) {
    el.innerHTML = '<span class="badge badge-muted">Подборки не заданы</span>';
    return;
  }
  const counts = {};
  vacancies.forEach((v) => {
    for (const sid of (v.search_ids || [v.search_id])) {
      if (sid) counts[sid] = (counts[sid] || 0) + 1;
    }
  });
  el.innerHTML = searches.map((s) => {
    const n = counts[s.id] || 0;
    const off = !s.enabled;
    const hid = hidden.has(s.id);
    return `<span class="badge badge-primary${(off || hid) ? ' badge-off' : ''}" `
      + `data-sid="${esc(s.id)}" title="${off ? 'Выключена (бот не ищет). Вкл: /on' : 'Клик — скрыть/показать'}">`
      + `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 21l-4.35-4.35M11 17a6 6 0 1 1 0-12 6 6 0 0 1 0 12z"/></svg>`
      + `${off ? '⏸ ' : ''}${esc(s.name)} · ${n}</span>`;
  }).join('');
}

function renderSearchOptions() {
  const sel = document.getElementById('f-search');
  sel.innerHTML = '<option value="">Все подборки</option>' + searches.map(
    (s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`,
  ).join('');
}

function renderStats(list) {
  document.getElementById('stat-total').textContent = list.length;
  document.getElementById('stat-new').textContent = list.filter((v) => !seen.has(vacKey(v))).length;
  document.getElementById('stat-updated').textContent = generatedAt || '—';
}

function cardHtml(v) {
  const isNew = !seen.has(vacKey(v));
  const rating = v.rating
    ? `⭐ ${Number(v.rating).toFixed(1)}${v.reviews_count ? ` (${v.reviews_count})` : ''}`
    : 'без рейтинга';
  const sal = formatSalary(v);
  const tags = [];
  if (SCHEDULE_RU[v.schedule]) tags.push(SCHEDULE_RU[v.schedule]);
  if (EXPERIENCE_RU[v.experience]) tags.push(EXPERIENCE_RU[v.experience]);
  if (v.area) tags.push(v.area);
  for (const sn of (v.search_names || (v.search_name ? [v.search_name] : []))) {
    if (sn) tags.push(sn);
  }
  return `<div class="vacancy-card ${isNew ? 'is-new' : ''}">`
    + `<div class="vacancy-logo">${esc((v.employer || '?').charAt(0).toUpperCase())}</div>`
    + `<div class="vacancy-body">`
    + `<div class="vacancy-title-row"><div class="vacancy-title">`
    + `<a href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.name || 'Без названия')}</a>`
    + `</div>${isNew ? '<span class="new-badge">NEW</span>' : ''}</div>`
    + `<div class="vacancy-employer">${esc(v.employer || 'Не указан')} · ${esc(rating)}</div>`
    + (sal ? `<div class="vacancy-salary">${esc(sal)}</div>` : '')
    + `<div class="vacancy-tags">${tags.map((t) => `<span class="vacancy-tag">${esc(t)}</span>`).join('')}</div>`
    + `<div class="vacancy-footer">`
    + (v.published_at ? `<span class="vacancy-date">Опубликовано: ${esc(formatDate(v.published_at))}</span>` : '')
    + `<a href="${esc(v.url)}" target="_blank" rel="noopener" class="vacancy-link">Открыть на hh.ru `
    + `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17L17 7M7 7h10v10"/></svg></a>`
    + `</div></div></div>`;
}

function currentFilters() {
  return {
    q: document.getElementById('f-q').value.trim().toLowerCase(),
    search: document.getElementById('f-search').value,
    sched: document.getElementById('f-sched').value,
    sort: document.getElementById('f-sort').value,
    minRate: parseFloat(document.getElementById('f-rate').value || '0') || 0,
  };
}

function renderAll() {
  renderBadges();
  const f = currentFilters();
  let list = vacancies.filter((v) => {
    const sids = v.search_ids || [v.search_id];
    return sids.some((sid) => !hidden.has(sid))
      && (!f.search || sids.includes(f.search))
      && (!f.sched || v.schedule === f.sched)
      && ((v.rating || 0) >= f.minRate)
      && (!f.q || `${v.name} ${v.employer}`.toLowerCase().includes(f.q));
  });
  if (f.sort === 'rating') list = [...list].sort((a, b) => (b.rating || 0) - (a.rating || 0));
  else if (f.sort === 'salary') {
    list = [...list].sort((a, b) => ((b.salary_from || b.salary_to || 0) - (a.salary_from || a.salary_to || 0)));
  } else {
    list = [...list].sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')));
  }
  renderStats(list);
  const el = document.getElementById('vacancies-list');
  el.innerHTML = list.length
    ? list.slice(0, 300).map(cardHtml).join('')
    : `<div class="empty-state"><p class="empty-title">Ничего не найдено</p>`
      + `<p class="empty-sub">Ослабьте фильтры или дождитесь следующего обновления</p></div>`;
}

// ── Settings modal (read-only snapshot of repo config) ──
function fmtSearchLine(s) {
  const parts = [];
  if (s.text) parts.push(`«${s.text}» (${SEARCH_FIELD_RU[s.search_field] || s.search_field || 'везде'})`);
  if (s.area && s.area.length) parts.push(`регионы: ${s.area.join(', ')}`);
  if (s.schedule && s.schedule.length) parts.push(`график: ${s.schedule.join(', ')}`);
  if (s.employment && s.employment.length) {
    const er = { full: 'полная', part: 'частичная', project: 'проектная' };
    parts.push(`занятость: ${s.employment.map((e) => er[e] || e).join(', ')}`);
  }
  if (s.experience && s.experience.length) parts.push(`опыт: ${s.experience.join(', ')}`);
  if (s.salary_from) parts.push(`от ${Number(s.salary_from).toLocaleString('ru-RU')} ₽`);
  if (s.min_employer_rating) parts.push(`рейтинг ≥ ${s.min_employer_rating}`);
  if (s.search_period) parts.push(`за ${s.search_period} дн.`);
  return parts.join(' · ') || 'без ограничений';
}

function openSettings() {
  const box = document.getElementById('settings-searches');
  const wa = window.Telegram && window.Telegram.WebApp;
  const me = (wa && wa.initDataUnsafe && wa.initDataUnsafe.user) || null;
  if (wa) { try { wa.ready(); wa.expand(); } catch (e) { /* ignore */ } }
  // порядковый номер среди своих (совпадает с индексом в боте)
  let myIdx = -1;
  const rows = searches.map((s) => {
    let ctl = '';
    if (s.mine) {
      myIdx += 1;
      const idx = myIdx;
      ctl = ` <button class="btn btn-ghost btn-sm" data-sub="toggle" data-idx="${idx}" title="Вкл/выкл">`
        + `${s.enabled === false ? '▶' : '⏸'}</button>`
        + ` <button class="btn btn-ghost btn-sm" data-sub="delete" data-idx="${idx}" title="Удалить">🗑</button>`;
    }
    return `<p style="margin-bottom:.6rem"><b>${esc(s.name)}</b>`
      + (s.mine ? ` <span class="form-hint">моя</span>` : '')
      + (s.enabled === false ? ` <span class="form-hint">⏸ выключена</span>` : '')
      + ctl
      + `<br><span class="form-hint">${esc(fmtSearchLine(s))}</span></p>`;
  }).join('');
  box.innerHTML = (searches.length ? rows : '<p class="form-hint">Подборки не заданы.</p>')
    + (me ? '' : '<p class="form-hint" style="margin-top:.5rem">Это общий вид. '
      + 'Свои подписки и управление ими — если открыть дашборд через кнопку 📊 в боте.</p>');
  document.getElementById('settings-telegram').innerHTML =
    `<p class="form-hint">Получателей: <b>${notifyCount}</b>. Рассылку отправляет GitHub Actions, `
    + `бот пишет только тем, кто нажал /start и добавлен в <code>config/users.yaml</code>.</p>`;
  document.getElementById('settings-modal').hidden = false;
}
function closeSettings() {
  document.getElementById('settings-modal').hidden = true;
}

// ── Command builder: dashboard form -> ready-to-send bot command ──
function buildCommand() {
  const num = document.getElementById('b-num').value.trim();
  const text = document.getElementById('b-text').value.trim();
  const parts = [text];
  const push = (id) => {
    const v = document.getElementById(id).value.trim();
    if (v) parts.push(v);
  };
  push('b-area'); push('b-sched'); push('b-emp'); push('b-rating'); push('b-salary');
  push('b-exp'); push('b-field');
  const spec = parts.filter(Boolean).join(' | ');
  const cmd = num ? `/replace ${num} | ${spec}` : `/add ${spec}`;
  document.getElementById('b-cmd').value = text ? cmd : '';
  document.getElementById('b-send').href = text
    ? `https://t.me/${botUsername}?text=${encodeURIComponent(cmd)}`
    : '#';
}

// ── Load ──
async function loadJson(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function refresh(showToast) {
  const listEl = document.getElementById('vacancies-list');
  try {
    const wa0 = window.Telegram && window.Telegram.WebApp;
    let data;
    if (wa0 && wa0.initData) {
      const res = await fetch('/.netlify/functions/api-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: wa0.initData }),
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } else {
      data = await loadJson('/.netlify/functions/api-data');
    }
    isPrivate = Boolean(data.private);
    searches = data.searches || [];
    generatedAt = data.generated_at || '';
    notifyCount = data.notify_users_count || 0;
    botUsername = data.bot_username || botUsername;
    vacancies = Array.isArray(data.vacancies) ? data.vacancies : [];
    renderSearchOptions();
    buildCommand();
    renderAll();
    if (showToast) toast(`Загружено вакансий: ${vacancies.length}`, 'info');
  } catch (e) {
    listEl.innerHTML = `<div class="empty-state"><p class="empty-title">Не удалось загрузить данные</p>`
      + `<p class="empty-sub">${esc(e.message)}. Дашборд обновляется автоматически каждые 30 минут.</p></div>`;
    if (showToast) toast('Ошибка загрузки: ' + e.message, 'error');
  }
}

// ── Управление своими подписками с сайта (только внутри Telegram WebApp) ──
async function subAction(action, idx) {
  const wa = window.Telegram && window.Telegram.WebApp;
  if (!wa || !wa.initData) { toast('Откройте дашборд через кнопку 📊 в боте', 'error'); return; }
  if (action === 'delete' && !confirm('Удалить эту подписку?')) return;
  try {
    const res = await fetch('/.netlify/functions/api-subs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: wa.initData, action, index: idx }),
    });
    const data = await res.json();
    if (data.ok) {
      toast(action === 'delete' ? `Удалена: ${data.removed}` : 'Готово', 'success');
      await refresh(false);
      openSettings();
    } else {
      toast(data.error === 'noauth'
        ? 'Не удалось подтвердить Telegram. Переоткройте дашборд из бота.'
        : (data.error || 'Ошибка'), 'error');
    }
  } catch (e) {
    toast('Ошибка сети: ' + e.message, 'error');
  }
}

// ── Init ──
function init() {
  initTheme();
  loadSeen();
  loadHidden();
  document.getElementById('config-badges').addEventListener('click', (e) => {
    const badge = e.target.closest('[data-sid]');
    if (!badge) return;
    const sid = badge.getAttribute('data-sid');
    const s = searches.find((x) => String(x.id) === sid);
    if (!s || !s.enabled) return;  // выключенные ботом — только для вида
    if (hidden.has(sid)) hidden.delete(sid);
    else hidden.add(sid);
    saveHidden();
    renderAll();
  });
  document.getElementById('btn-theme').onclick = () => {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  };
  document.getElementById('btn-refresh').onclick = () => refresh(true);
  document.getElementById('btn-settings').onclick = openSettings;
  document.getElementById('btn-close-modal').onclick = closeSettings;
  document.getElementById('btn-close-settings').onclick = closeSettings;
  document.getElementById('btn-mark-seen').onclick = () => {
    vacancies.forEach((v) => seen.add(vacKey(v)));
    saveSeen();
    renderAll();
    toast('Все вакансии отмечены просмотренными', 'success');
  };
  document.getElementById('settings-modal').addEventListener('click', (e) => {
    if (e.target.id === 'settings-modal') closeSettings();
  });
  document.getElementById('settings-searches').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sub]');
    if (!b) return;
    subAction(b.getAttribute('data-sub'), parseInt(b.getAttribute('data-idx'), 10));
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });
  ['f-q', 'f-search', 'f-sched', 'f-sort', 'f-rate'].forEach((id) => {
    document.getElementById(id).addEventListener('input', renderAll);
  });
  ['b-num', 'b-text', 'b-field', 'b-area', 'b-sched', 'b-emp', 'b-exp', 'b-salary', 'b-rating'].forEach((id) => {
    document.getElementById(id).addEventListener('input', buildCommand);
  });
  refresh(false);
}

init();
