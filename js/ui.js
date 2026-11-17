/* UI primitives: overlay, sheets, model picker, settings, palette, menus, snackbars. */
(function (global) {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const ic = (name, size) => global.Icons.render(name, size);

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtNum(n) {
    if (!n && n !== 0) return '';
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return String(n);
  }
  function initials(name) {
    return (name || '?').replace(/[^a-zA-Zа-яА-Я0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  }

  const UI = { $, el, esc, fmtNum, initials, ic, Icons: global.Icons };
  const CFG = Object.assign({
    name: 'Groq Chat',
    assistant: 'Groq',
    provider: 'Groq',
    requireKey: false,
    about: 'личный клиент на Groq API',
    aboutText: 'Быстрый чат с моделями Groq: GPT-OSS, Qwen, Llama. Работает офлайн-оболочкой, запросы — напрямую в api.groq.com.',
  }, global.APP_CONFIG || {});

  /* ============================ snackbar ============================ */
  UI.snackbar = function (text, opts) {
    const o = opts || {};
    const host = $('#snackbarHost');
    const node = el(`<div class="snackbar"><span>${esc(text)}</span></div>`);
    if (o.action) {
      const b = el(`<button class="snackbar__action">${esc(o.action)}</button>`);
      b.addEventListener('click', () => { if (o.onAction) o.onAction(); close(); });
      node.appendChild(b);
    }
    const x = el(`<button class="snackbar__close" aria-label="Закрыть">${ic('close', 16)}</button>`);
    x.addEventListener('click', close);
    node.appendChild(x);
    host.appendChild(node);
    let timer = setTimeout(close, o.duration || 4200);
    function close() {
      clearTimeout(timer);
      if (!node.isConnected) return;
      node.classList.add('is-out');
      setTimeout(() => node.remove(), 200);
    }
    return close;
  };

  /* ============================ overlay ============================ */
  let overlayState = null;

  UI.overlayOpen = () => !!overlayState;

  UI.openOverlay = function (node, opts) {
    const o = opts || {};
    const overlay = $('#overlay');
    const host = $('#overlayHost');
    const prevFocus = document.activeElement;
    overlay.hidden = false;
    overlay.classList.remove('is-closing');
    if (o.top) overlay.classList.add('overlay--top');
    else overlay.classList.remove('overlay--top');
    host.innerHTML = '';
    host.appendChild(node);
    overlayState = { node, onClose: o.onClose, prevFocus };
    const focusable = node.querySelector('input, textarea, button');
    if (o.autofocus !== false) setTimeout(() => { try { (focusable || node).focus({ preventScroll: true }); } catch (e) {} }, 40);
    return () => UI.closeOverlay();
  };

  UI.closeOverlay = function (immediate) {
    if (!overlayState) return;
    const st = overlayState;
    overlayState = null;
    const overlay = $('#overlay');
    if (st.onClose) { try { st.onClose(); } catch (e) {} }
    if (immediate) {
      overlay.hidden = true;
      $('#overlayHost').innerHTML = '';
    } else {
      overlay.classList.add('is-closing');
      const host = $('#overlayHost');
      setTimeout(() => {
        if (overlayState) return;
        overlay.hidden = true;
        overlay.classList.remove('is-closing');
        host.innerHTML = '';
      }, 170);
    }
    if (st.prevFocus && st.prevFocus.focus) { try { st.prevFocus.focus({ preventScroll: true }); } catch (e) {} }
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayState) {
      e.preventDefault();
      e.stopPropagation();
      UI.closeOverlay();
    }
  }, true);

  /* ============================ confirm / prompt ============================ */
  UI.confirm = function (opts) {
    return new Promise((resolve) => {
      const o = opts || {};
      const node = el(`
        <div class="dialog" style="width:min(420px,100%)">
          <div class="sheet__head">
            <div class="sheet__titles">
              <div class="sheet__title">${esc(o.title || 'Подтвердите')}</div>
              ${o.text ? `<div class="sheet__sub">${esc(o.text)}</div>` : ''}
            </div>
          </div>
          <div class="sheet__footer">
            <span class="spacer"></span>
            <button class="btn btn--text" data-act="cancel">Отмена</button>
            <button class="btn ${o.danger ? 'btn--filled' : 'btn--filled'}" data-act="ok" ${o.danger ? 'style="background:var(--error);color:var(--on-error)"' : ''}>${esc(o.confirmText || 'ОК')}</button>
          </div>
        </div>`);
      let done = false;
      UI.openOverlay(node, { onClose: () => { if (!done) resolve(false); } });
      node.querySelector('[data-act="cancel"]').addEventListener('click', () => { done = true; UI.closeOverlay(); resolve(false); });
      node.querySelector('[data-act="ok"]').addEventListener('click', () => { done = true; UI.closeOverlay(); resolve(true); });
      node.addEventListener('keydown', (e) => { if (e.key === 'Enter') { done = true; UI.closeOverlay(); resolve(true); } });
      setTimeout(() => node.querySelector('[data-act="ok"]').focus(), 30);
    });
  };

  UI.prompt = function (opts) {
    return new Promise((resolve) => {
      const o = opts || {};
      const node = el(`
        <div class="dialog" style="width:min(440px,100%)">
          <div class="sheet__head">
            <div class="sheet__titles">
              <div class="sheet__title">${esc(o.title || 'Введите значение')}</div>
            </div>
            <button class="icon-btn" data-act="cancel" aria-label="Закрыть">${ic('close', 20)}</button>
          </div>
          <div class="sheet__body">
            <div class="field">
              ${o.label ? `<label class="field__label">${esc(o.label)}</label>` : ''}
              <input class="input" id="promptInput" value="${esc(o.value || '')}" placeholder="${esc(o.placeholder || '')}" maxlength="${o.maxlength || 200}">
            </div>
          </div>
          <div class="sheet__footer">
            <span class="spacer"></span>
            <button class="btn btn--text" data-act="cancel">Отмена</button>
            <button class="btn btn--filled" data-act="ok">${esc(o.confirmText || 'Сохранить')}</button>
          </div>
        </div>`);
      let done = false;
      UI.openOverlay(node, { onClose: () => { if (!done) resolve(null); } });
      const input = node.querySelector('#promptInput');
      setTimeout(() => { input.focus(); input.select(); }, 50);
      const finish = (val) => { done = true; UI.closeOverlay(); resolve(val); };
      node.querySelectorAll('[data-act="cancel"]').forEach((b) => b.addEventListener('click', () => finish(null)));
      node.querySelector('[data-act="ok"]').addEventListener('click', () => finish(input.value.trim()));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(input.value.trim()); }
      });
    });
  };

  /* ============================ menu ============================ */
  let openMenu = null;
  UI.closeMenu = function () {
    if (!openMenu) return;
    openMenu.node.remove();
    document.removeEventListener('pointerdown', openMenu.onDoc, true);
    window.removeEventListener('scroll', openMenu.onScroll, true);
    window.removeEventListener('resize', openMenu.onScroll);
    openMenu = null;
  };

  UI.menu = function (anchor, items, opts) {
    UI.closeMenu();
    const node = el('<div class="menu" role="menu"></div>');
    items.forEach((it) => {
      if (it.sep) { node.appendChild(el('<div class="menu__sep"></div>')); return; }
      const b = el(`<button class="menu__item ${it.danger ? 'menu__item--danger' : ''}" role="menuitem">${it.icon ? ic(it.icon, 18) : ''}<span>${esc(it.label)}</span></button>`);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        UI.closeMenu();
        if (it.action) it.action();
      });
      node.appendChild(b);
    });
    document.body.appendChild(node);
    const r = anchor.getBoundingClientRect();
    const mw = node.offsetWidth;
    const mh = node.offsetHeight;
    const o = opts || {};
    let left = o.alignRight ? r.right - mw : r.left;
    let top = r.bottom + 6;
    if (o.side === 'right') { left = r.right + 6; top = r.top; }
    if (left + mw > innerWidth - 8) left = innerWidth - mw - 8;
    if (left < 8) left = 8;
    if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    node.style.left = Math.round(left) + 'px';
    node.style.top = Math.round(top) + 'px';
    const onDoc = (e) => { if (!node.contains(e.target)) UI.closeMenu(); };
    const onScroll = () => UI.closeMenu();
    setTimeout(() => document.addEventListener('pointerdown', onDoc, true), 0);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    openMenu = { node, onDoc, onScroll };
    return node;
  };

  /* ============================ lightbox ============================ */
  UI.lightbox = function (src) {
    const node = el(`<div class="lightbox"><img alt=""></div>`);
    node.querySelector('img').src = src;
    node.addEventListener('click', () => node.remove());
    document.body.appendChild(node);
  };

  /* ============================ model picker ============================ */
  UI.modelPicker = function (opts) {
    const o = opts || {};
    const node = el(`
      <div class="dialog dialog--wide">
        <div class="sheet__head">
          <div class="sheet__titles">
            <div class="sheet__title">Выбор модели</div>
            <div class="sheet__sub" id="mpSub">Загружаем список из Groq…</div>
          </div>
          <button class="icon-btn" data-act="close" aria-label="Закрыть">${ic('close', 20)}</button>
        </div>
        <div class="sheet__body">
          <div class="model-search">
            ${ic('search', 19)}
            <input id="mpSearch" placeholder="Поиск модели" autocomplete="off" spellcheck="false">
          </div>
          <div class="modellist" id="mpList"></div>
        </div>
        <div class="sheet__footer">
          <button class="btn btn--text" data-act="refresh">${ic('refresh', 18)} Обновить</button>
          <span class="spacer"></span>
          <button class="btn btn--tonal" data-act="settings">${ic('key', 18)} API-ключ</button>
        </div>
      </div>`);
    const close = UI.openOverlay(node, { onClose: o.onClose });
    const listEl = node.querySelector('#mpList');
    const searchEl = node.querySelector('#mpSearch');
    const subEl = node.querySelector('#mpSub');
    let models = [];
    let query = '';
    let selectedId = o.selectedId;

    const stars = () => new Set((Store.state.settings.favorites || []));

    function rowHTML(m, selected) {
      const fav = stars().has(m.id);
      const badges = [];
      if (m.context) badges.push(`<span class="badge">${fmtNum(m.context)} контекст</span>`);
      if (m.vision) badges.push('<span class="badge badge--accent">зрение</span>');
      if (m.tools) badges.push('<span class="badge">tools</span>');
      if (m.reasoning) badges.push('<span class="badge badge--accent">reasoning</span>');
      return `
        <button class="modelrow ${selected ? 'is-selected' : ''}" data-id="${esc(m.id)}">
          <span class="modelrow__icon">${esc(initials(m.name || m.vendor))}</span>
          <span class="modelrow__text">
            <span class="modelrow__name">${esc(m.name)}</span>
            <span class="modelrow__id">${esc(m.id)}</span>
            ${badges.length ? `<span class="modelrow__badges">${badges.join('')}</span>` : ''}
          </span>
          <span class="modelrow__star ${fav ? 'is-on' : ''}" data-star="${esc(m.id)}" title="В избранное">${ic('star', 17)}</span>
          <span class="modelrow__check">${ic('check', 19)}</span>
        </button>`;
    }

    function render() {
      const favs = stars();
      const q = query.trim().toLowerCase();
      const visible = models.filter((m) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || (m.vendor || '').toLowerCase().includes(q));
      if (!visible.length) {
        listEl.innerHTML = `<div class="model-list-empty">${q ? 'Ничего не найдено' : 'Модели не загрузились'}</div>`;
        return;
      }
      const favoriteModels = visible.filter((m) => favs.has(m.id));
      const rest = visible.filter((m) => !favs.has(m.id));
      const groups = [];
      if (favoriteModels.length) groups.push({ label: 'Избранные', items: favoriteModels });
      if (q) {
        groups.push({ label: 'Найдено', items: rest });
      } else {
        const byVendor = new Map();
        rest.forEach((m) => {
          const k = m.vendor || 'Другие';
          if (!byVendor.has(k)) byVendor.set(k, []);
          byVendor.get(k).push(m);
        });
        byVendor.forEach((items, label) => groups.push({ label, items }));
      }
      listEl.innerHTML = groups.map((g) => `
        <div class="modelgroup-label">${esc(g.label)}</div>
        ${g.items.map((m) => rowHTML(m, m.id === selectedId)).join('')}
      `).join('');
      subEl.textContent = `Доступно моделей: ${models.length} · выберите для этого чата`;
    }

    listEl.addEventListener('click', (e) => {
      const star = e.target.closest('[data-star]');
      if (star) {
        e.preventDefault();
        e.stopPropagation();
        const id = star.getAttribute('data-star');
        const favs = new Set(Store.state.settings.favorites || []);
        if (favs.has(id)) favs.delete(id); else favs.add(id);
        Store.set({ favorites: [...favs] });
        render();
        return;
      }
      const row = e.target.closest('[data-id]');
      if (!row) return;
      const m = models.find((x) => x.id === row.getAttribute('data-id'));
      if (!m) return;
      selectedId = m.id;
      if (o.onSelect) o.onSelect(m);
      close();
    });

    searchEl.addEventListener('input', () => { query = searchEl.value; render(); });

    node.querySelector('[data-act="close"]').addEventListener('click', close);
    node.querySelector('[data-act="settings"]').addEventListener('click', () => {
      close();
      setTimeout(() => UI.settingsSheet(o.settingsOpts || {}), 80);
    });
    node.querySelector('[data-act="refresh"]').addEventListener('click', () => load(true));

    async function load(force) {
      subEl.textContent = 'Загружаем список из Groq…';
      listEl.innerHTML = `<div class="model-list-empty">Загрузка…</div>`;
      try {
        models = await API.listModels(force);
        render();
      } catch (err) {
        subEl.textContent = 'Не удалось загрузить модели';
        listEl.innerHTML = `<div class="model-list-empty">${esc(err.message || 'Ошибка сети')}<br><br><button class="btn btn--tonal" data-act="retry">Повторить</button></div>`;
        const r = listEl.querySelector('[data-act="retry"]');
        if (r) r.addEventListener('click', () => load(true));
      }
    }
    load(false);
    setTimeout(() => searchEl.focus(), 60);
    return close;
  };

  /* ============================ settings ============================ */
  const SEEDS = ['#6750A4', '#006A6A', '#2E7D32', '#1A73E8', '#FF8A65', '#F2B705', '#B3261E', '#8E24AA'];

  UI.settingsSheet = function (opts) {
    const o = opts || {};
    let s = Store.state.settings;

    const node = el(`
      <div class="dialog dialog--settings">
        <div class="sheet__head">
          <div class="sheet__titles">
            <div class="sheet__title">Настройки</div>
            <div class="sheet__sub">Всё хранится локально · ключ не покидает ваш браузер</div>
          </div>
          <button class="icon-btn" data-act="close" aria-label="Закрыть">${ic('close', 20)}</button>
        </div>
        <div class="sheet__body"><div class="settings" id="setBody"></div></div>
        <div class="sheet__footer">
          <button class="btn btn--text btn--danger" data-act="reset">${ic('refresh', 18)} Сбросить</button>
          <span class="spacer"></span>
          <button class="btn btn--filled" data-act="done">Готово</button>
        </div>
      </div>`);

    const body = node.querySelector('#setBody');
    const close = UI.openOverlay(node, { onClose: o.onClose });

    function patch(p) {
      Store.set(p);
      if (global.App && App.applySettings) App.applySettings(p);
    }

    function section(title, icon, inner) {
      return `<div class="set-group"><div class="set-group__title">${icon ? ic(icon, 14) : ''}${esc(title)}</div>${inner}</div>`;
    }

    function switchRow(key, title, desc) {
      return `<div class="set-row">
        <div class="set-row__text"><span class="set-row__title">${esc(title)}</span>${desc ? `<span class="set-row__desc">${esc(desc)}</span>` : ''}</div>
        <button class="switch" role="switch" aria-checked="${s[key] ? 'true' : 'false'}" data-switch="${key}" aria-label="${esc(title)}"></button>
      </div>`;
    }

    function sliderRow(key, title, desc, min, max, step, fmt) {
      return `<div class="set-row set-row--stack">
        <div class="set-row__text"><span class="set-row__title">${esc(title)}</span>${desc ? `<span class="set-row__desc">${esc(desc)}</span>` : ''}</div>
        <div class="slider-row">
          <input class="slider" type="range" min="${min}" max="${max}" step="${step}" value="${s[key]}" data-slider="${key}" style="--fill:${fillPct(s[key], min, max)}%">
          <span class="slider-val" data-val="${key}">${fmt ? fmt(s[key]) : s[key]}</span>
        </div>
      </div>`;
    }

    function fillPct(v, min, max) { return Math.round(((v - min) / (max - min)) * 100); }

    function render() {
      const theme = s.theme;
      const models = (global.App && App.state && App.state.models && App.state.models.length) ? App.state.models : (API.modelsCache ? API.modelsCache.models : []);
      const currentModel = models.find((m) => m.id === s.model) || { name: s.model, id: s.model };
      body.innerHTML = `
        ${section('Оформление', 'palette', `
          <div class="set-row"><div class="set-row__text"><span class="set-row__title">Тема</span><span class="set-row__desc">Material You, светлая или тёмная</span></div>
            <div class="seg" id="themeSeg">
              <button data-theme-opt="system" class="${theme === 'system' ? 'is-selected' : ''}" title="Как в системе">${ic('monitor', 15)}</button>
              <button data-theme-opt="light" class="${theme === 'light' ? 'is-selected' : ''}" title="Светлая">${ic('sun', 15)}</button>
              <button data-theme-opt="dark" class="${theme === 'dark' ? 'is-selected' : ''}" title="Тёмная">${ic('moon', 15)}</button>
            </div>
          </div>
          <div class="set-row set-row--stack">
            <div class="set-row__text"><span class="set-row__title">Цвет системы</span><span class="set-row__desc">Из него строится вся палитра</span></div>
            <div class="sweep" id="seedSweep">
              ${SEEDS.map((c) => `<button class="swatch ${c.toLowerCase() === String(s.seedColor).toLowerCase() ? 'is-selected' : ''}" style="background:${c};--swatch-color:${c}" data-seed="${c}" aria-label="${c}"><span class="swatch__check">${ic('check', 17)}</span></button>`).join('')}
              <label class="swatch swatch--custom" title="Свой цвет">
                ${ic('palette', 17)}
                <input type="color" value="${esc(s.seedColor)}" id="customSeed">
              </label>
            </div>
          </div>
          ${sliderRow('fontScale', 'Размер текста', 'Масштаб сообщений', 0.9, 1.25, 0.01, (v) => Math.round(v * 100) + '%')}
        `)}
        ${section('Модель и генерация', 'tune', `
          <div class="set-row">
            <div class="set-row__text"><span class="set-row__title">Модель по умолчанию</span><span class="set-row__desc">${esc(currentModel.name)}</span></div>
            <button class="btn btn--tonal" data-act="pick-model">Сменить</button>
          </div>
          <div class="set-row set-row--stack">
            <div class="set-row__text"><span class="set-row__title">Системный промпт</span><span class="set-row__desc">Добавляется в начало каждого диалога</span></div>
            <textarea class="textarea" id="sysPrompt" placeholder="Например: отвечай кратко и по делу, без воды" rows="3">${esc(s.systemPrompt)}</textarea>
          </div>
          ${sliderRow('temperature', 'Температура', 'Выше — креативнее, ниже — точнее', 0, 2, 0.05, (v) => Number(v).toFixed(2))}
          ${sliderRow('topP', 'Top-p', 'Ядерная выборка вероятностей', 0.05, 1, 0.05, (v) => Number(v).toFixed(2))}
          <div class="set-row">
            <div class="set-row__text"><span class="set-row__title">Максимум токенов</span><span class="set-row__desc">Длина ответа</span></div>
            <input class="input" id="maxTokens" type="number" min="256" max="65536" step="256" value="${s.maxTokens}" style="width:110px;text-align:right">
          </div>
          ${switchRow('streaming', 'Потоковый ответ', 'Печатать текст по мере генерации')}
          ${switchRow('showReasoning', 'Показывать размышления', 'Скрытая цепочка мыслей reasoning-моделей')}
          ${switchRow('enterToSend', 'Enter отправляет', 'Shift+Enter — перенос строки')}
        `)}
        ${section('API', 'key', `
          <div class="set-row set-row--stack">
            <div class="set-row__text"><span class="set-row__title">Ключ Groq API</span><span class="set-row__desc">${CFG.requireKey ? 'console.groq.com/keys · хранится только в этом браузере' : 'console.groq.com/keys · хранится в этом приложении'}</span></div>
            <div class="keyfield">
              <input class="input" id="apiKey" type="password" value="${esc(s.apiKey)}" autocomplete="off" spellcheck="false" placeholder="gsk_…">
              <button class="icon-btn" data-act="toggle-key" title="Показать">${ic('globe', 18)}</button>
            </div>
          </div>
          <div class="set-row">
            <div class="set-row__text"><span class="set-row__title">Проверить подключение</span><span class="set-row__desc" id="apiStatus">${esc(o.apiStatus || (s.apiKey ? 'Ключ активен' : 'Ключ не задан'))}</span></div>
            <button class="btn btn--tonal" data-act="test-key">Проверить</button>
          </div>
          ${s.apiKey ? `<div class="set-row"><div class="set-row__text"><span class="set-row__title">Забыть ключ</span><span class="set-row__desc">Удалить ключ с этого устройства</span></div><button class="btn btn--text btn--danger" data-act="forget-key">Удалить</button></div>` : ''}
        `)}
        ${section('Данные', 'server', `
          <div class="set-row"><div class="set-row__text"><span class="set-row__title">Экспорт всех чатов</span><span class="set-row__desc">Файл JSON — можно импортировать обратно</span></div><button class="btn btn--outline" data-act="export-all">Скачать</button></div>
          <div class="set-row"><div class="set-row__text"><span class="set-row__title">Импорт</span><span class="set-row__desc">Добавит чаты из JSON-файла</span></div><button class="btn btn--outline" data-act="import-all">Выбрать</button></div>
          <div class="set-row"><div class="set-row__text"><span class="set-row__title">Удалить всё</span><span class="set-row__desc">Чаты и настройки на этом устройстве</span></div><button class="btn btn--text btn--danger" data-act="clear-all">Удалить</button></div>
        `)}
        ${section('О приложении', 'info', `
          <div class="about">
            <div><b>${esc(CFG.name)}</b> · v1.1 · ${esc(CFG.about)}</div>
            <div>${esc(CFG.aboutText)}</div>
            <div class="kbdline"><span>Новый чат</span><span><kbd>⌘</kbd><kbd>N</kbd></span></div>
            <div class="kbdline"><span>Команды</span><span><kbd>⌘</kbd><kbd>K</kbd></span></div>
            <div class="kbdline"><span>Настройки</span><span><kbd>⌘</kbd><kbd>,</kbd></span></div>
            <div class="kbdline"><span>Свернуть панель</span><span><kbd>⌘</kbd><kbd>B</kbd></span></div>
            <div class="kbdline"><span>Экспорт чата</span><span><kbd>⌘</kbd><kbd>E</kbd></span></div>
          </div>
        `)}
      `;
      bind();
    }

    function bind() {
      node.querySelectorAll('[data-switch]').forEach((b) => {
        b.addEventListener('click', () => {
          const key = b.getAttribute('data-switch');
          const next = b.getAttribute('aria-checked') !== 'true';
          b.setAttribute('aria-checked', String(next));
          s[key] = next;
          patch({ [key]: next });
        });
      });
      node.querySelectorAll('[data-slider]').forEach((inp) => {
        const key = inp.getAttribute('data-slider');
        inp.addEventListener('input', () => {
          const v = Number(inp.value);
          s[key] = v;
          inp.style.setProperty('--fill', fillPct(v, Number(inp.min), Number(inp.max)) + '%');
          const valEl = node.querySelector(`[data-val="${key}"]`);
          if (valEl) valEl.textContent = key === 'fontScale' ? Math.round(v * 100) + '%' : v.toFixed(2).replace(/\.?0+$/, '');
          patch({ [key]: v });
        });
      });
      node.querySelectorAll('[data-theme-opt]').forEach((b) => {
        b.addEventListener('click', () => {
          node.querySelectorAll('[data-theme-opt]').forEach((x) => x.classList.remove('is-selected'));
          b.classList.add('is-selected');
          s.theme = b.getAttribute('data-theme-opt');
          patch({ theme: s.theme });
        });
      });
      node.querySelectorAll('[data-seed]').forEach((b) => {
        b.addEventListener('click', () => {
          const color = b.getAttribute('data-seed');
          s.seedColor = color;
          node.querySelectorAll('.swatch').forEach((x) => x.classList.remove('is-selected'));
          b.classList.add('is-selected');
          const custom = node.querySelector('#customSeed');
          if (custom) custom.value = color;
          patch({ seedColor: color });
        });
      });
      const custom = node.querySelector('#customSeed');
      if (custom) custom.addEventListener('input', () => {
        s.seedColor = custom.value;
        node.querySelectorAll('[data-seed]').forEach((x) => x.classList.remove('is-selected'));
        patch({ seedColor: custom.value });
      });
      const sys = node.querySelector('#sysPrompt');
      sys.addEventListener('input', () => { s.systemPrompt = sys.value; patch({ systemPrompt: sys.value }); });
      const maxT = node.querySelector('#maxTokens');
      maxT.addEventListener('change', () => {
        let v = parseInt(maxT.value, 10) || 4096;
        v = Math.max(256, Math.min(65536, v));
        maxT.value = v;
        s.maxTokens = v;
        patch({ maxTokens: v });
      });
      const keyInp = node.querySelector('#apiKey');
      keyInp.addEventListener('input', () => {
        s.apiKey = keyInp.value.trim();
        s.persistKey = true;
        try { sessionStorage.removeItem('groq-chat-session-key'); } catch (e) { /* ignore */ }
        patch({ apiKey: s.apiKey, persistKey: true });
      });
      const toggleKey = node.querySelector('[data-act="toggle-key"]');
      toggleKey.addEventListener('click', () => {
        keyInp.type = keyInp.type === 'password' ? 'text' : 'password';
      });
      node.querySelector('[data-act="test-key"]').addEventListener('click', async (e) => {
        const status = node.querySelector('#apiStatus');
        const btn = e.currentTarget;
        btn.disabled = true;
        status.textContent = 'Проверяем…';
        try {
          API.modelsCache = null;
          const n = await API.testKey();
          status.textContent = `Ключ работает · моделей: ${n}`;
          if (global.App) App.refreshModels(true);
        } catch (err) {
          status.textContent = err.message || 'Ошибка';
        }
        btn.disabled = false;
      });
      const forget = node.querySelector('[data-act="forget-key"]');
      if (forget) forget.addEventListener('click', async () => {
        const ok = await UI.confirm({ title: 'Удалить ключ?', text: 'Ключ будет удалён с этого устройства. Чаты останутся.', confirmText: 'Удалить', danger: true });
        if (!ok) return;
        s.apiKey = '';
        s.persistKey = true;
        try { sessionStorage.removeItem('groq-chat-session-key'); } catch (e) { /* ignore */ }
        Store.save(true);
        UI.closeOverlay(true);
        if (global.Onboarding) global.Onboarding.show();
        else if (global.UI) global.UI.snackbar('Ключ удалён');
      });
      node.querySelector('[data-act="pick-model"]').addEventListener('click', () => {
        close();
        setTimeout(() => UI.modelPicker({
          selectedId: s.model,
          onSelect: (m) => { s.model = m.id; patch({ model: m.id }); if (global.App) App.setModel(m.id); },
        }), 90);
      });
      node.querySelector('[data-act="export-all"]').addEventListener('click', () => { if (global.App) App.exportAll(); });
      node.querySelector('[data-act="import-all"]').addEventListener('click', () => { if (global.App) App.importFile(); });
      node.querySelector('[data-act="clear-all"]').addEventListener('click', async () => {
        const ok = await UI.confirm({ title: 'Удалить всё?', text: 'Все чаты и настройки будут удалены с этого устройства. Ключ API тоже.', confirmText: 'Удалить', danger: true });
        if (!ok) return;
        Store.clearAll();
        Store.state.settings.apiKey = '';
        Store.save(true);
        UI.closeOverlay(true);
        if (global.App) App.hardReset();
      });
      node.querySelector('[data-act="reset"]').addEventListener('click', async () => {
        const ok = await UI.confirm({ title: 'Сбросить настройки?', text: 'Оформление, параметры генерации и ключ вернутся к значениям по умолчанию. Чаты останутся.', confirmText: 'Сбросить' });
        if (!ok) return;
        Store.state.settings = { ...DEFAULT_SETTINGS, apiKey: Store.state.settings.apiKey, favorites: [] };
        Store.save(true);
        s = Store.state.settings;
        render();
        if (global.App) App.applySettings(Store.state.settings);
      });
    }

    node.querySelector('[data-act="close"]').addEventListener('click', close);
    node.querySelector('[data-act="done"]').addEventListener('click', close);
    render();
    return close;
  };

  /* ============================ command palette ============================ */
  UI.palette = function (opts) {
    const o = opts || {};
    const node = el(`
      <div class="dialog dialog--palette">
        <div class="palette__input">
          ${ic('search', 20)}
          <input id="palInput" placeholder="Команда, чат или модель…" autocomplete="off" spellcheck="false">
          <kbd>Esc</kbd>
        </div>
        <div class="palette__list" id="palList"></div>
      </div>`);
    const close = UI.openOverlay(node, { top: true, onClose: o.onClose });
    const input = node.querySelector('#palInput');
    const list = node.querySelector('#palList');
    const all = o.items || [];
    let filtered = all.slice();
    let active = 0;

    function score(item, q) {
      const hay = (item.label + ' ' + (item.sub || '') + ' ' + (item.group || '')).toLowerCase();
      const label = item.label.toLowerCase();
      if (!q) return 1;
      if (label.startsWith(q)) return 4;
      if (label.includes(q)) return 3;
      if (hay.includes(q)) return 2;
      return 0;
    }

    function render() {
      const q = input.value.trim().toLowerCase();
      filtered = all
        .map((it) => ({ it, s: score(it, q) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 40)
        .map((x) => x.it);
      if (!filtered.length) {
        list.innerHTML = '<div class="palette__empty">Ничего не найдено</div>';
        return;
      }
      active = Math.min(active, filtered.length - 1);
      let html = '';
      let lastGroup = null;
      filtered.forEach((it, i) => {
        if (it.group !== lastGroup) {
          html += `<div class="palette__group">${esc(it.group || '')}</div>`;
          lastGroup = it.group;
        }
        html += `<button class="palette__item ${i === active ? 'is-active' : ''}" data-idx="${i}">
          ${ic(it.icon || 'arrow-right', 18)}
          <span>${esc(it.label)}</span>
          ${it.sub ? `<span class="p-sub">${esc(it.sub)}</span>` : ''}
        </button>`;
      });
      list.innerHTML = html;
      const act = list.querySelector('.is-active');
      if (act) act.scrollIntoView({ block: 'nearest' });
    }

    function run(i) {
      const it = filtered[i];
      if (!it) return;
      close();
      setTimeout(() => it.run(), 40);
    }

    input.addEventListener('input', () => { active = 0; render(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, filtered.length - 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); run(active); }
    });
    list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-idx]');
      if (b) run(Number(b.getAttribute('data-idx')));
    });
    list.addEventListener('mousemove', (e) => {
      const b = e.target.closest('[data-idx]');
      if (!b) return;
      const i = Number(b.getAttribute('data-idx'));
      if (i !== active) { active = i; list.querySelectorAll('.palette__item').forEach((x) => x.classList.toggle('is-active', Number(x.dataset.idx) === i)); }
    });
    render();
    setTimeout(() => input.focus(), 50);
    return close;
  };

  /* ============================ ripple ============================ */
  document.addEventListener('pointerdown', (e) => {
    const host = e.target.closest('.btn, .icon-btn, .new-chat, .send, .suggestion, .modelrow, .chatitem, .swatch, .footer-btn, .seg button, .palette__item, .menu__item');
    if (!host) return;
    const r = host.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 1.15;
    const span = document.createElement('span');
    span.className = 'ripple';
    span.style.width = span.style.height = size + 'px';
    span.style.left = (e.clientX - r.left - size / 2) + 'px';
    span.style.top = (e.clientY - r.top - size / 2) + 'px';
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(span);
    setTimeout(() => span.remove(), 600);
  }, { passive: true });

  global.UI = UI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
