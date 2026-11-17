/* Groq Chat — app logic */
(function (global) {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = UI.esc;
  const ic = UI.ic;
  const fmt = UI.fmtNum;
  const settings = () => Store.state.settings;
  const CFG = Object.assign({
    name: 'Groq Chat',
    sub: 'личный клиент',
    assistant: 'Groq',
    provider: 'Groq',
    requireKey: false,
    about: 'личный клиент на Groq API',
  }, global.APP_CONFIG || {});

  function mdHTML(src) {
    return MD.render(src || '').replace(
      /(<button class="codeblock__copy"[^>]*>)Copy(<\/button>)/g,
      '$1Копировать$2'
    );
  }

  const FALLBACK_MODELS = [
    { id: 'openai/gpt-oss-120b', name: 'GPT OSS 120B', vendor: 'OpenAI', context: 131072, vision: false, tools: true, reasoning: true, active: true },
    { id: 'openai/gpt-oss-20b', name: 'GPT OSS 20B', vendor: 'OpenAI', context: 131072, vision: false, tools: true, reasoning: true, active: true },
    { id: 'qwen/qwen3.8-27b', name: 'Qwen 3.8 27B', vendor: 'Qwen', context: 131072, vision: true, tools: true, reasoning: true, active: true },
  ];

  const SUGGESTIONS = [
    { icon: 'sparkles', title: 'Придумай идеи', desc: '10 идей для пет-проекта на выходные', prompt: 'Придумай 10 идей для пет-проекта, который можно сделать за выходные. Разные по сложности, с кратким описанием стека и фишкой каждой идеи.' },
    { icon: 'code', title: 'Разбери код', desc: 'баги, запахи и улучшения', prompt: 'Выступи в роли строгого код-ревьюера. Найди баги, слабые места и предложи конкретные улучшения. Вот код:\n\n```\n\n```' },
    { icon: 'book', title: 'Объясни сложное', desc: 'как будто мне двенадцать', prompt: 'Объясни, как работает HTTPS, так, чтобы понял двенадцатилетний. С примерами, без лишнего жаргона.' },
    { icon: 'file', title: 'Перепиши текст', desc: 'короче, яснее, без воды', prompt: 'Перепиши текст короче и яснее, сохранив смысл. Убери канцелярит и воду:\n\n' },
  ];

  const state = {
    models: [],
    modelsLoaded: false,
    modelError: null,
    loadingModels: false,
    streaming: false,
    controller: null,
    attachments: [],
    search: '',
    stick: true,
    current: null,
    paintQueued: false,
    visibleCount: 40,
  };

  const native = (() => {
    try {
      return global.webkit && global.webkit.messageHandlers && global.webkit.messageHandlers.native
        ? global.webkit.messageHandlers.native
        : null;
    } catch (e) { return null; }
  })();

  const uid = () => (global.crypto && crypto.randomUUID ? crypto.randomUUID() : 'm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));

  /* ============================================================
     Theme
     ============================================================ */
  const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

  function isDark() {
    const t = settings().theme;
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return global.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function applyTheme() {
    const dark = isDark();
    const root = document.documentElement;
    root.dataset.theme = dark ? 'dark' : 'light';
    let scheme;
    try {
      scheme = Palette.scheme(settings().seedColor, dark);
    } catch (e) { scheme = null; }
    if (scheme) {
      Object.keys(scheme).forEach((k) => {
        if (k === 'scrim' || k === 'shadow') return;
        root.style.setProperty('--' + kebab(k), scheme[k]);
      });
    }
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
    if (scheme) meta.content = scheme.surface;
    if (native) { try { native.postMessage({ type: 'appearance', dark: dark, background: scheme ? scheme.surface : '#141218' }); } catch (e) {} }
  }

  function cycleTheme() {
    const dark = isDark();
    const next = dark ? 'light' : 'dark';
    settings().theme = next;
    Store.save();
    applyTheme();
    UI.snackbar(next === 'dark' ? 'Тёмная тема' : 'Светлая тема');
    Renderer.settingsRefresh();
  }

  /* ============================================================
     Models
     ============================================================ */
  function modelById(id) {
    return state.models.find((m) => m.id === id) || null;
  }

  function prettyName(id) {
    if (!id) return 'Модель';
    const base = id.split('/').pop();
    return base.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      .replace(/\bGpt\b/g, 'GPT').replace(/\bOss\b/g, 'OSS').replace(/\bLlm\b/g, 'LLM');
  }

  function modelName(id) {
    const m = modelById(id);
    return m ? m.name : prettyName(id);
  }

  function currentModelId() {
    const chat = Store.activeChat();
    return (chat && chat.model) || settings().model;
  }

  async function loadModels(force) {
    if (state.loadingModels) return;
    state.loadingModels = true;
    try {
      const models = await API.listModels(force);
      state.models = models.length ? models : FALLBACK_MODELS.slice();
      state.modelsLoaded = true;
      state.modelError = null;
      if (!modelById(settings().model)) {
        const first = state.models[0];
        if (first) {
          settings().model = first.id;
          Store.save();
        }
      }
      Renderer.header();
      Renderer.composerMeta();
    } catch (err) {
      state.modelError = err;
      if (!state.models.length) state.models = FALLBACK_MODELS.slice();
      Renderer.header();
      if (err.status === 401) {
        UI.snackbar('Groq не принял ключ API', { action: 'Настройки', onAction: openSettings });
      }
    } finally {
      state.loadingModels = false;
    }
  }

  function setModel(id) {
    const chat = Store.activeChat();
    if (chat) { chat.model = id; Store.save(); }
    settings().model = id;
    Store.save();
    Renderer.header();
    Renderer.composerMeta();
    const active = Store.activeChat();
    if (!active || !active.messages.length) Renderer.thread();
  }

  /* ============================================================
     Header / sidebar / composer rendering
     ============================================================ */
  const Renderer = {
    all() {
      this.sidebar();
      this.header();
      this.thread();
      this.composerMeta();
      this.sendButton();
      UI.Icons.hydrate(document);
    },

    sidebar() {
      const q = state.search.trim().toLowerCase();
      const chats = Store.state.chats
        .filter((c) => !q || c.title.toLowerCase().includes(q) || c.messages.some((m) => (m.content || '').toLowerCase().includes(q)))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      const list = $('#chatlist');
      $('#chatCount').textContent = chats.length ? String(chats.length) : '';
      const clearBtn = $('.search__clear');
      if (clearBtn) clearBtn.hidden = !state.search;
      if (!chats.length) {
        list.innerHTML = `<div class="chatlist__empty">${q ? 'Ничего не нашлось. Попробуйте другое слово.' : 'Пока пусто. Задайте первый вопрос — чат появится здесь.'}</div>`;
        return;
      }
      const groups = new Map();
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      chats.forEach((c) => {
        const t = c.updatedAt;
        let label = 'Раньше';
        if (t >= startOfToday) label = 'Сегодня';
        else if (t >= startOfToday - 86400000) label = 'Вчера';
        else if (t >= startOfToday - 6 * 86400000) label = 'На этой неделе';
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(c);
      });
      let html = '';
      groups.forEach((items, label) => {
        html += `<div class="chatgroup-label">${esc(label)}</div>`;
        items.forEach((c) => {
          const active = c.id === Store.state.activeChatId;
          html += `<div class="chatitem ${active ? 'is-active' : ''}" data-chat-id="${esc(c.id)}" role="button" tabindex="0">
            <span class="chatitem__icon">${ic(active ? 'message' : 'message', 17)}</span>
            <span class="chatitem__title">${esc(c.title)}</span>
            <button class="chatitem__more" data-chat-more="${esc(c.id)}" aria-label="Действия с чатом">${ic('more', 17)}</button>
          </div>`;
        });
      });
      list.innerHTML = html;
    },

    header() {
      const chat = Store.activeChat();
      const titleInput = $('#chatTitle');
      titleInput.value = chat ? chat.title : 'Новый чат';
      titleInput.readOnly = !chat;
      const modelId = currentModelId();
      const sub = $('#chatSub');
      if (state.streaming && chat) {
        sub.innerHTML = `<span class="dot"></span>печатает…`;
      } else if (chat && chat.messages.length) {
        const n = chat.messages.length;
        sub.textContent = `${n} ${plural(n, 'сообщение', 'сообщения', 'сообщений')} · ${modelName(modelId)}`;
      } else {
        sub.innerHTML = `<span class="dot"></span>новая беседа · ${esc(modelName(modelId))}`;
      }
      $('#modelChipName').textContent = modelName(modelId);
      $('#modelPillName').textContent = modelName(modelId);
      $('#modelCardValue').textContent = modelName(modelId);
      $('#themeBtn').innerHTML = ic(isDark() ? 'sun' : 'moon');
      document.title = (chat && chat.messages.length ? chat.title + ' — ' : '') + CFG.name;
      const bn = $('.brand-name');
      if (bn) bn.textContent = CFG.name;
      const bs = $('#brandSub');
      if (bs) bs.textContent = CFG.sub;
    },

    thread() {
      const chat = Store.activeChat();
      const thread = $('#thread');
      if (!chat || !chat.messages.length) {
        thread.innerHTML = this.hero();
        return;
      }
      thread.innerHTML = chat.messages.map((m) => messageHTML(m)).join('');
      queueMicrotask(() => scrollToBottom(false, true));
    },

    hero() {
      const modelId = currentModelId();
      const m = modelById(modelId);
      const vision = m && m.vision;
      return `<div class="hero">
        <div class="hero__orb">${ic('sparkles', 46)}</div>
        <h2 class="hero__title">Чем займёмся сегодня?</h2>
        <p class="hero__sub">${esc(CFG.heroLine || `Спросите что угодно — ${CFG.provider} отвечает почти мгновенно${vision ? ', а ещё понимает картинки' : ''}.`)} История хранится только на этом устройстве.</p>
        <button class="hero__model" data-action="open-models">
          Модель: <strong>${esc(modelName(modelId))}</strong>
          <span class="icon-btn">${ic('chevron-up-down', 16)}</span>
        </button>
        <div class="suggestions">
          ${SUGGESTIONS.map((s) => `<button class="suggestion" data-suggestion="${esc(s.prompt)}" title="${esc(s.prompt.slice(0, 90))}">
            <span class="suggestion__icon">${ic(s.icon, 19)}</span>
            <span class="suggestion__text">
              <span class="suggestion__title">${esc(s.title)}</span>
              <span class="suggestion__desc">${esc(s.desc)}</span>
            </span>
          </button>`).join('')}
        </div>
      </div>`;
    },

    composerMeta() {
      $('#modelPillName').textContent = modelName(currentModelId());
      const hint = $('#composerHint');
      if (!hint) return;
      if (state.streaming) hint.textContent = 'Генерация… Esc — остановить';
      else hint.textContent = settings().enterToSend ? 'Enter — отправить · Shift+Enter — строка' : '⌘ или Ctrl + Enter — отправить';
      const ta = $('#input');
      const count = $('#counter');
      const len = ta.value.length;
      count.textContent = len ? `${len} симв.` : '';
    },

    sendButton() {
      const btn = $('#sendBtn');
      if (!btn) return;
      if (state.streaming) {
        btn.dataset.action = 'stop';
        btn.classList.add('is-stop');
        btn.disabled = false;
        btn.innerHTML = ic('stop', 20);
        btn.setAttribute('aria-label', 'Остановить');
      } else {
        btn.dataset.action = 'send';
        btn.classList.remove('is-stop');
        btn.disabled = !canSend();
        btn.innerHTML = ic('arrow-up', 22);
        btn.setAttribute('aria-label', 'Отправить');
      }
    },

    settingsRefresh() {
      if (UI.overlayOpen()) {
        const body = $('#setBody');
        if (body) { /* settings sheet has its own live bindings; theme only affects colors */ }
      }
    },

    scrollShadow() {
      const sc = $('#scroll');
      const bar = $('.appbar');
      if (sc && bar) bar.classList.toggle('is-scrolled', sc.scrollTop > 6);
    },
  };

  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  function timeOf(ts) {
    try { return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }

  /* ============================================================
     Message markup
     ============================================================ */
  function reasoningHTML(msg, live) {
    const words = (msg.reasoning || '').trim().split(/\s+/).filter(Boolean).length;
    return `<div class="reasoning ${live ? 'is-live is-open' : ''}" data-reasoning>
      <button class="reasoning__head" data-action="toggle-reasoning" type="button">
        <span class="reasoning__spark">${ic('sparkles', 16)}</span>
        <span class="reasoning__label">${live ? 'Размышляет' : 'Размышления'}</span>
        <span class="reasoning__meta">${words ? '· ' + words + ' ' + plural(words, 'слово', 'слова', 'слов') : ''}</span>
        <span class="reasoning__chev">${ic('expand-more', 17)}</span>
      </button>
      <div class="reasoning__body"><div class="md">${mdHTML(msg.reasoning || '')}</div></div>
    </div>`;
  }

  function statsHTML(msg) {
    const bits = [];
    if (msg.elapsed) bits.push(`<span class="stat">${ic('clock', 13)} ${(msg.elapsed / 1000).toFixed(msg.elapsed < 10000 ? 1 : 0)} с</span>`);
    const u = msg.usage || {};
    if (u.completion_tokens && u.completion_time) {
      bits.push(`<span class="stat">${ic('bolt', 13)} ${Math.round(u.completion_tokens / u.completion_time)} tok/s</span>`);
    }
    if (u.total_tokens) bits.push(`<span class="stat">${ic('cpu', 13)} ${fmt(u.total_tokens)} токенов</span>`);
    if (msg.aborted) bits.push('<span class="stat">остановлено</span>');
    return bits.length ? `<div class="msg__stats">${bits.join('')}</div>` : '';
  }

  function messageHTML(msg, opts) {
    const o = opts || {};
    if (msg.role === 'user') {
      const atts = (msg.attachments || []).map((a) => `<img src="${esc(a.dataUrl)}" alt="${esc(a.name || 'изображение')}" data-action="open-image">`).join('');
      return `<article class="msg msg--user" data-msg="${esc(msg.id)}">
        <div class="msg__head"><span class="msg__meta">Вы · ${timeOf(msg.createdAt)}</span></div>
        <div class="msg__body">
          ${msg.content ? `<div class="msg__bubble">${esc(msg.content)}</div>` : ''}
          ${atts ? `<div class="msg__attachments">${atts}</div>` : ''}
        </div>
        <div class="msg__actions">
          <button class="icon-btn" data-action="copy-msg" title="Копировать">${ic('copy', 18)}</button>
          <button class="icon-btn" data-action="edit-msg" title="Изменить">${ic('pencil', 18)}</button>
          <button class="icon-btn" data-action="delete-msg" title="Удалить">${ic('trash', 18)}</button>
        </div>
      </article>`;
    }

    const model = msg.model || currentModelId();
    const body = [];
    if (msg.reasoning && settings().showReasoning) body.push(reasoningHTML(msg, !!msg.streaming));
    if (msg.error) {
      body.push(`<div class="msg__error">${ic('alert', 20)}<div><strong>Не получилось</strong>${esc(msg.error)}${msg.status === 401 ? `<br><button data-action="open-settings">${ic('key', 15)} Открыть настройки</button>` : ''}<br><button data-action="regenerate">${ic('refresh', 15)} Попробовать снова</button></div></div>`);
    }
    if (msg.content) body.push(`<div class="md">${mdHTML(msg.content)}${msg.streaming ? '<span class="caret"></span>' : ''}</div>`);
    if (msg.streaming && !msg.content) {
      body.push(`<div class="thinking"><span class="thinking__dots"><i></i><i></i><i></i></span>${msg.reasoning ? 'Думает…' : 'Готовит ответ…'}</div>`);
    }
    if (!msg.streaming) body.push(statsHTML(msg));
    const actions = msg.streaming ? '' : `<div class="msg__actions">
        <button class="icon-btn" data-action="copy-msg" title="Копировать">${ic('copy', 18)}</button>
        <button class="icon-btn" data-action="regenerate" title="Перегенерировать">${ic('refresh', 18)}</button>
        <button class="icon-btn" data-action="delete-msg" title="Удалить">${ic('trash', 18)}</button>
      </div>`;
    return `<article class="msg msg--assistant" data-msg="${esc(msg.id)}">
      <div class="msg__head">
        <span class="msg__avatar">${ic('sparkles', 15)}</span>
        <span class="msg__name">${esc(CFG.assistant)}</span>
        <span class="msg__meta"><span class="sep"></span>${esc(modelName(model))}</span>
        <span class="msg__meta" style="margin-left:auto">${o.streaming ? '' : timeOf(msg.createdAt)}</span>
      </div>
      <div class="msg__body">${body.join('')}</div>
      ${actions}
    </article>`;
  }

  /* ============================================================
     Scrolling
     ============================================================ */
  function nearBottom() {
    const sc = $('#scroll');
    return sc.scrollHeight - sc.scrollTop - sc.clientHeight < 120;
  }
  function scrollToBottom(smooth, force) {
    const sc = $('#scroll');
    if (!sc) return;
    if (force || state.stick) {
      sc.scrollTo({ top: sc.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
      state.stick = true;
    }
  }
  function updateScrollButton() {
    const sc = $('#scroll');
    const btn = $('#scrollBottom');
    if (!sc || !btn) return;
    const show = sc.scrollHeight - sc.scrollTop - sc.clientHeight > 240;
    btn.classList.toggle('is-visible', show);
  }

  /* ============================================================
     Composer
     ============================================================ */
  function autoGrow() {
    const ta = $('#input');
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 216) + 'px';
  }

  function canSend() {
    const text = $('#input').value.trim();
    return !!(text || state.attachments.length);
  }

  function renderAttachments() {
    const host = $('#attachments');
    if (!state.attachments.length) { host.hidden = true; host.innerHTML = ''; return; }
    host.hidden = false;
    host.innerHTML = state.attachments.map((a) => `<div class="attachment" data-att="${esc(a.id)}">
      <img src="${esc(a.dataUrl)}" alt="${esc(a.name || '')}">
      <button class="attachment__remove" data-action="remove-attachment" data-att-id="${esc(a.id)}" aria-label="Убрать">${ic('close', 12)}</button>
    </div>`).join('');
  }

  function addAttachment(file) {
    const m = modelById(currentModelId());
    if (m && !m.vision) {
      UI.snackbar(`Модель ${m.name} не понимает изображения`, { action: 'Выбрать', onAction: openModelPicker });
      return;
    }
    compressImage(file).then((dataUrl) => {
      state.attachments.push({ id: uid(), name: file.name || 'image', type: 'image/jpeg', dataUrl });
      renderAttachments();
      Renderer.sendButton();
      autoGrow();
    }).catch(() => UI.snackbar('Не удалось прочитать изображение'));
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) { reject(new Error('not an image')); return; }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const max = 1400;
          let w = img.naturalWidth, h = img.naturalHeight;
          if (w > max || h > max) {
            const k = max / Math.max(w, h);
            w = Math.round(w * k); h = Math.round(h * k);
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.87));
        } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  function resetComposer() {
    const ta = $('#input');
    ta.value = '';
    autoGrow();
    state.attachments = [];
    renderAttachments();
    Renderer.sendButton();
    Renderer.composerMeta();
  }

  /* ============================================================
     Sending / streaming
     ============================================================ */
  function titleFromChat(chat) {
    const firstUser = chat.messages.find((m) => m.role === 'user');
    if (!firstUser) return 'Новый чат';
    let text = (firstUser.content || '').replace(/\s+/g, ' ').trim();
    if (!text && firstUser.attachments && firstUser.attachments.length) text = 'Изображение';
    if (!text) return 'Новый чат';
    const raw = text;
    text = text.replace(/^(привет|здравствуй|хай|hello|hi)[,!\s]*/i, '').trim();
    if (!text) text = raw;
    if (text.length > 44) {
      text = text.slice(0, 44);
      const cut = text.lastIndexOf(' ');
      if (cut > 20) text = text.slice(0, cut);
      text += '…';
    }
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  async function send() {
    if (state.streaming) return;
    if (CFG.requireKey && !settings().apiKey.trim()) {
      if (global.Onboarding) global.Onboarding.show();
      else UI.snackbar('Сначала добавьте API-ключ');
      return;
    }
    const ta = $('#input');
    const text = ta.value.trim();
    if (!text && !state.attachments.length) return;
    const chat = Store.ensureChat();
    if (!chat.model) chat.model = settings().model;
    const promptText = text || (state.attachments.length ? 'Опиши, что на изображении.' : '');
    const model = modelById(currentModelId());
    if (state.attachments.length && model && !model.vision) {
      UI.snackbar(`Выберите модель с поддержкой изображений`, { action: 'Модели', onAction: openModelPicker });
      return;
    }
    const msg = {
      id: uid(),
      role: 'user',
      content: promptText,
      createdAt: Date.now(),
      model: currentModelId(),
      attachments: state.attachments.slice(),
    };
    chat.messages.push(msg);
    if (!chat.messages.some((m) => m.role === 'assistant' && chat.messages.indexOf(m) < chat.messages.length - 1) && chat.title === 'Новый чат') {
      chat.title = titleFromChat(chat);
    }
    chat.updatedAt = Date.now();
    resetComposer();
    state.stick = true;
    Renderer.thread();
    Renderer.sidebar();
    Renderer.header();
    Store.save();
    await generate(chat);
  }

  function appendOrUpdateStreaming(msg, chat) {
    const thread = $('#thread');
    const existing = thread.querySelector(`[data-msg="${cssEsc(msg.id)}"]`);
    if (existing) { existing.outerHTML = messageHTML(msg, { streaming: true }); return thread.querySelector(`[data-msg="${cssEsc(msg.id)}"]`); }
    const tmp = document.createElement('div');
    tmp.innerHTML = messageHTML(msg, { streaming: true });
    const node = tmp.firstElementChild;
    thread.appendChild(node);
    return node;
  }

  function cssEsc(s) {
    if (global.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/"/g, '\\"');
  }

  function patchStreaming() {
    const cur = state.current;
    if (!cur || !cur.el || !cur.el.isConnected) return;
    const msg = cur.msg;
    const body = cur.el.querySelector('.msg__body');
    if (!body) return;
    let mdEl = body.querySelector('.md');
    let reasoning = body.querySelector('.reasoning');
    const thinking = body.querySelector('.thinking');

    if (msg.reasoning && settings().showReasoning && !reasoning) {
      const wrap = document.createElement('div');
      wrap.innerHTML = reasoningHTML(msg, true);
      reasoning = wrap.firstElementChild;
      body.insertBefore(reasoning, mdEl || body.firstChild);
    }
    if (reasoning) {
      const rmd = reasoning.querySelector('.reasoning__body .md');
      if (rmd && msg.reasoning !== rmd.__src) { rmd.innerHTML = mdHTML(msg.reasoning); rmd.__src = msg.reasoning; }
      const words = (msg.reasoning || '').trim().split(/\s+/).filter(Boolean).length;
      const meta = reasoning.querySelector('.reasoning__meta');
      if (meta) meta.textContent = words ? '· ' + words + ' ' + plural(words, 'слово', 'слова', 'слов') : '';
    }
    if (msg.content) {
      if (thinking) thinking.remove();
      if (!mdEl) {
        mdEl = document.createElement('div');
        mdEl.className = 'md';
        body.appendChild(mdEl);
      }
      mdEl.innerHTML = mdHTML(msg.content) + '<span class="caret"></span>';
    } else if (!thinking && !msg.reasoning) {
      body.insertAdjacentHTML('beforeend', `<div class="thinking"><span class="thinking__dots"><i></i><i></i><i></i></span>Готовит ответ…</div>`);
    }
    if (state.stick) scrollToBottom(false);
    updateScrollButton();
  }

  function schedulePaint() {
    if (state.paintQueued) return;
    state.paintQueued = true;
    requestAnimationFrame(() => { state.paintQueued = false; patchStreaming(); });
  }

  async function generate(chat) {
    if (state.streaming) return;
    const modelId = chat.model || settings().model;
    const placeholder = {
      id: uid(),
      role: 'assistant',
      content: '',
      reasoning: '',
      model: modelId,
      createdAt: Date.now(),
      streaming: true,
    };
    chat.messages.push(placeholder);
    state.streaming = true;
    state.controller = new AbortController();
    state.current = { msg: placeholder, el: null };
    state.stick = true;
    $('#thread').querySelector('.hero')?.remove();
    const el = appendOrUpdateStreaming(placeholder, chat);
    state.current.el = el;
    Renderer.sendButton();
    Renderer.header();
    Renderer.composerMeta();
    scrollToBottom(false);
    const history = chat.messages.slice(0, -1);
    const messages = API.buildMessages(history, settings().systemPrompt);

    try {
      const res = await API.chat({
        model: modelId,
        messages,
        signal: state.controller.signal,
        onDelta: (d) => { placeholder.content += d; schedulePaint(); },
        onReasoning: (d) => { placeholder.reasoning += d; schedulePaint(); },
        onUsage: (u) => { placeholder.usage = u; },
      });
      placeholder.streaming = false;
      placeholder.content = res.content != null ? res.content : placeholder.content;
      placeholder.reasoning = res.reasoning || placeholder.reasoning;
      placeholder.usage = res.usage || placeholder.usage;
      placeholder.elapsed = res.elapsed || 0;
      placeholder.ttft = res.ttft || 0;
      placeholder.aborted = !!res.aborted;
      if (!placeholder.content && !placeholder.reasoning) {
        if (placeholder.aborted) {
          chat.messages = chat.messages.filter((m) => m !== placeholder);
          el.remove();
          UI.snackbar('Генерация остановлена');
        } else {
          placeholder.error = 'Модель вернула пустой ответ. Попробуйте другую модель или переформулируйте запрос.';
        }
      }
      if (placeholder.aborted && (placeholder.content || placeholder.reasoning)) {
        placeholder.error = null;
      }
    } catch (err) {
      placeholder.streaming = false;
      placeholder.error = err && err.message ? err.message : 'Неизвестная ошибка';
      placeholder.status = err && err.status;
      if (err && err.status === 429) placeholder.error = 'Лимит запросов Groq. Подождите пару секунд и попробуйте снова.';
    } finally {
      if (state.current && state.current.msg === placeholder) {
        if (el.isConnected) {
          const finalHTML = messageHTML(placeholder, { streaming: false });
          const tmp = document.createElement('div');
          tmp.innerHTML = finalHTML;
          el.replaceWith(tmp.firstElementChild);
        }
      }
      state.current = null;
      state.streaming = false;
      state.controller = null;
      Renderer.sendButton();
      Renderer.composerMeta();
      Renderer.sidebar();
      Renderer.header();
      Store.save(true);
      if (placeholder.error) scrollToBottom(false, true);
    }
  }

  function stopGeneration() {
    if (state.controller) {
      try { state.controller.abort(); } catch (e) {}
    }
  }

  /* ============================================================
     Message actions
     ============================================================ */
  function msgById(id) {
    const chat = Store.activeChat();
    if (!chat) return null;
    return chat.messages.find((m) => m.id === id) || null;
  }

  async function copyText(text) {
    if (!text) return;
    if (native) {
      try { native.postMessage({ type: 'copy', text: text }); UI.snackbar('Скопировано'); return; } catch (e) { /* fallback */ }
    }
    try {
      await navigator.clipboard.writeText(text);
      UI.snackbar('Скопировано');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); UI.snackbar('Скопировано'); } catch (err) { UI.snackbar('Не удалось скопировать'); }
      ta.remove();
    }
  }

  async function regenerate(msgId) {
    if (state.streaming) { UI.snackbar('Сначала остановите генерацию'); return; }
    const chat = Store.activeChat();
    if (!chat) return;
    let idx = msgId ? chat.messages.findIndex((m) => m.id === msgId) : -1;
    if (idx < 0) {
      // last assistant
      for (let i = chat.messages.length - 1; i >= 0; i--) {
        if (chat.messages[i].role === 'assistant') { idx = i; break; }
      }
    }
    if (idx < 0) return;
    if (chat.messages[idx].role === 'assistant') chat.messages.splice(idx, 1);
    else return;
    // drop anything after (usually nothing)
    chat.messages.splice(idx);
    Renderer.thread();
    Store.save();
    await generate(chat);
  }

  async function editMessage(msgId) {
    if (state.streaming) return;
    const chat = Store.activeChat();
    if (!chat) return;
    const idx = chat.messages.findIndex((m) => m.id === msgId);
    if (idx < 0) return;
    const msg = chat.messages[idx];
    const ta = $('#input');
    ta.value = msg.content || '';
    state.attachments = (msg.attachments || []).slice();
    renderAttachments();
    autoGrow();
    Renderer.sendButton();
    Renderer.composerMeta();
    chat.messages.splice(idx);
    Renderer.thread();
    Store.save();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    scrollToBottom(false, true);
  }

  function deleteMessage(msgId) {
    const chat = Store.activeChat();
    if (!chat) return;
    const idx = chat.messages.findIndex((m) => m.id === msgId);
    if (idx < 0) return;
    const backup = chat.messages[idx];
    chat.messages.splice(idx, 1);
    Renderer.thread();
    Store.save();
    UI.snackbar('Сообщение удалено', {
      action: 'Отменить',
      onAction: () => {
        chat.messages.splice(Math.min(idx, chat.messages.length), 0, backup);
        Renderer.thread();
        Store.save();
      },
    });
  }

  function toggleReasoning(btn) {
    const card = btn.closest('.reasoning');
    if (!card) return;
    card.classList.toggle('is-open');
    card.dataset.userToggled = '1';
  }

  /* ============================================================
     Chat management
     ============================================================ */
  function newChat() {
    if (state.streaming) stopGeneration();
    const chat = Store.activeChat();
    if (chat && !chat.messages.length) {
      $('#input').focus();
      return;
    }
    Store.state.activeChatId = null;
    Store.save();
    Renderer.all();
    closeDrawer();
    setTimeout(() => $('#input').focus(), 60);
  }

  function selectChat(id) {
    if (state.streaming) stopGeneration();
    const chat = Store.getChat(id);
    if (!chat) return;
    Store.state.activeChatId = id;
    Store.save();
    state.search = '';
    const s = $('#search');
    if (s) s.value = '';
    Renderer.all();
    closeDrawer();
  }

  async function deleteChat(id) {
    const chat = Store.getChat(id);
    if (!chat) return;
    const ok = await UI.confirm({ title: 'Удалить чат?', text: `«${chat.title}» будет удалён без возможности восстановить.`, confirmText: 'Удалить', danger: true });
    if (!ok) return;
    Store.deleteChat(id);
    Renderer.all();
    UI.snackbar('Чат удалён');
  }

  async function renameChat(id) {
    const chat = Store.getChat(id);
    if (!chat) return;
    const val = await UI.prompt({ title: 'Название чата', label: 'Заголовок', value: chat.title, confirmText: 'Сохранить' });
    if (val == null) return;
    Store.renameChat(id, val);
    Renderer.all();
  }

  function clearChat(id) {
    const chat = Store.getChat(id);
    if (!chat) return;
    chat.messages = [];
    chat.title = 'Новый чат';
    Store.save();
    Renderer.all();
    UI.snackbar('Чат очищен');
  }

  function chatMenu(anchor, id) {
    const chat = Store.getChat(id);
    if (!chat) return;
    UI.menu(anchor, [
      { label: 'Переименовать', icon: 'pencil', action: () => renameChat(id) },
      { label: 'Экспорт в Markdown', icon: 'download', action: () => exportChat(chat) },
      { label: 'Очистить', icon: 'refresh', action: () => clearChat(id) },
      { sep: true },
      { label: 'Удалить', icon: 'trash', danger: true, action: () => deleteChat(id) },
    ], { alignRight: true });
  }

  /* ============================================================
     Export / import
     ============================================================ */
  function downloadFile(name, content, mime) {
    if (native) {
      try { native.postMessage({ type: 'saveFile', name: name, content: content, mime: mime || 'text/plain' }); return; } catch (e) {}
    }
    const blob = new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function chatToMarkdown(chat) {
    const lines = [`# ${chat.title}`, ''];
    const model = chat.model || settings().model;
    lines.push(`_${modelName(model)} · ${new Date(chat.createdAt).toLocaleString('ru-RU')}_`, '');
    chat.messages.forEach((m) => {
      if (m.role === 'user') {
        lines.push('## Вы', '', m.content || '', '');
        (m.attachments || []).forEach((a) => lines.push(`![${a.name || 'изображение'}](вложение)`, ''));
      } else {
        lines.push(`## ${CFG.assistant} · ${modelName(m.model)}`, '');
        if (m.reasoning) lines.push('<details><summary>Размышления</summary>', '', m.reasoning, '', '</details>', '');
        lines.push(m.content || (m.error ? `> Ошибка: ${m.error}` : ''), '');
      }
    });
    lines.push('---', '', `_Создано в ${CFG.name}_`);
    return lines.join('\n');
  }

  function exportChat(chat) {
    const c = chat || Store.activeChat();
    if (!c || !c.messages.length) { UI.snackbar('В чате пока нечего экспортировать'); return; }
    const safe = (c.title || 'chat').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60);
    downloadFile(`${safe}.md`, chatToMarkdown(c), 'text/markdown');
    UI.snackbar('Markdown сохранён');
  }

  function exportMenu(anchor) {
    UI.menu(anchor, [
      { label: 'Чат в Markdown', icon: 'file', action: () => exportChat() },
      { label: 'Чат в JSON', icon: 'code', action: () => {
        const c = Store.activeChat();
        if (!c) { UI.snackbar('Нет активного чата'); return; }
        downloadFile(`${(c.title || 'chat').slice(0, 50)}.json`, JSON.stringify(c, null, 2), 'application/json');
      } },
      { label: 'Скопировать чат', icon: 'clipboard', action: () => {
        const c = Store.activeChat();
        if (c) copyText(chatToMarkdown(c));
      } },
      { sep: true },
      { label: 'Скачать все чаты', icon: 'download', action: exportAll },
      { label: 'Импортировать…', icon: 'upload', action: importFile },
    ], { alignRight: true });
  }

  function exportAll() {
    downloadFile('groq-chat-export.json', JSON.stringify(Store.exportAll(), null, 2), 'application/json');
    UI.snackbar('Экспорт готов');
  }

  function importFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result));
          const n = Store.importAll(data);
          Renderer.all();
          UI.snackbar(`Импортировано чатов: ${n}`);
        } catch (e) {
          UI.snackbar('Не удалось прочитать файл');
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  /* ============================================================
     Dialogs
     ============================================================ */
  function openModelPicker() {
    UI.modelPicker({
      selectedId: currentModelId(),
      onSelect: (m) => {
        setModel(m.id);
        const m2 = modelById(m.id);
        if (m2) UI.snackbar(`Модель: ${m2.name}`);
      },
    });
  }

  function openSettings() {
    UI.settingsSheet({});
  }

  function openPalette() {
    const items = [];
    items.push({ group: 'Действия', label: 'Новый чат', icon: 'edit', sub: '⌘N', run: newChat });
    items.push({ group: 'Действия', label: 'Выбрать модель', icon: 'bolt', sub: modelName(currentModelId()), run: openModelPicker });
    items.push({ group: 'Действия', label: 'Настройки', icon: 'tune', sub: '⌘,', run: openSettings });
    items.push({ group: 'Действия', label: isDark() ? 'Светлая тема' : 'Тёмная тема', icon: isDark() ? 'sun' : 'moon', run: cycleTheme });
    items.push({ group: 'Действия', label: 'Свернуть / показать панель', icon: 'panel-left', sub: '⌘B', run: toggleSidebar });
    items.push({ group: 'Действия', label: 'Экспорт чата в Markdown', icon: 'download', sub: '⌘E', run: () => exportChat() });
    items.push({ group: 'Действия', label: 'Скачать все чаты', icon: 'download', run: exportAll });
    Store.state.chats.slice(0, 8).forEach((c) => {
      items.push({ group: 'Чаты', label: c.title, icon: 'message', sub: new Date(c.updatedAt).toLocaleDateString('ru-RU'), run: () => selectChat(c.id) });
    });
    state.models.slice(0, 20).forEach((m) => {
      items.push({
        group: 'Модели',
        label: m.name,
        icon: 'cpu',
        sub: m.id === currentModelId() ? 'выбрана' : (m.context ? fmt(m.context) + ' контекст' : ''),
        run: () => setModel(m.id),
      });
    });
    UI.palette({ items });
  }

  /* ============================================================
     Sidebar / drawer
     ============================================================ */
  function isMobile() { return global.innerWidth <= 860; }

  function toggleSidebar() {
    if (isMobile()) {
      $('#app').classList.toggle('drawer-open');
      return;
    }
    const next = !$('#app').classList.contains('sidebar-collapsed');
    $('#app').classList.toggle('sidebar-collapsed', next);
    Store.set({ sidebarCollapsed: next });
  }
  function openDrawer() { $('#app').classList.add('drawer-open'); }
  function closeDrawer() { $('#app').classList.remove('drawer-open'); }

  /* ============================================================
     Event wiring
     ============================================================ */
  function bind() {
    document.addEventListener('click', (e) => {
      const actionEl = e.target.closest('[data-action]');
      const chatItem = e.target.closest('[data-chat-id]');
      const moreBtn = e.target.closest('[data-chat-more]');
      if (moreBtn) {
        e.preventDefault();
        e.stopPropagation();
        chatMenu(moreBtn, moreBtn.getAttribute('data-chat-more'));
        return;
      }
      if (chatItem && !actionEl) {
        selectChat(chatItem.getAttribute('data-chat-id'));
        return;
      }
      if (!actionEl) return;
      const act = actionEl.dataset.action;
      const msgId = actionEl.closest('[data-msg]')?.dataset.msg;
      switch (act) {
        case 'new-chat': newChat(); break;
        case 'open-models': openModelPicker(); break;
        case 'open-settings': openSettings(); break;
        case 'open-palette': openPalette(); break;
        case 'toggle-theme': cycleTheme(); break;
        case 'toggle-sidebar': toggleSidebar(); break;
        case 'open-drawer': openDrawer(); break;
        case 'close-drawer': closeDrawer(); break;
        case 'export-menu': exportMenu(actionEl); break;
        case 'clear-search': {
          state.search = '';
          $('#search').value = '';
          Renderer.sidebar();
          break;
        }
        case 'attach': $('#fileInput').click(); break;
        case 'send': send(); break;
        case 'stop': stopGeneration(); break;
        case 'scroll-bottom': state.stick = true; scrollToBottom(true, true); break;
        case 'copy-msg': {
          const m = msgById(msgId);
          if (m) copyText(m.content || '');
          break;
        }
        case 'regenerate': regenerate(msgId); break;
        case 'edit-msg': editMessage(msgId); break;
        case 'delete-msg': deleteMessage(msgId); break;
        case 'toggle-reasoning': toggleReasoning(actionEl); break;
        case 'open-image': {
          const src = actionEl.dataset.src || actionEl.querySelector('img')?.src;
          if (src) UI.lightbox(src);
          break;
        }
        case 'remove-attachment': {
          state.attachments = state.attachments.filter((a) => a.id !== actionEl.dataset.attId);
          renderAttachments();
          Renderer.sendButton();
          break;
        }
        default: break;
      }
    });

    // suggestion chips
    document.addEventListener('click', (e) => {
      const sug = e.target.closest('[data-suggestion]');
      if (!sug) return;
      const ta = $('#input');
      ta.value = sug.getAttribute('data-suggestion');
      autoGrow();
      Renderer.sendButton();
      Renderer.composerMeta();
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      scrollToBottom(false, true);
    });

    // chat list keyboard
    $('#chatlist').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const item = e.target.closest('[data-chat-id]');
      if (!item) return;
      e.preventDefault();
      selectChat(item.getAttribute('data-chat-id'));
    });

    // code blocks copy (delegated)
    $('#thread').addEventListener('click', (e) => {
      const copyBtn = e.target.closest('.codeblock__copy');
      if (!copyBtn) return;
      const code = copyBtn.closest('.codeblock').querySelector('code');
      if (code) {
        copyText(code.textContent).then(() => {
          const prev = copyBtn.innerHTML;
          copyBtn.innerHTML = `${ic('check', 13)} Готово`;
          setTimeout(() => { copyBtn.innerHTML = prev; }, 1400);
        });
      }
    });

    // links open externally
    $('#thread').addEventListener('click', (e) => {
      const a = e.target.closest('.md a');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href) return;
      e.preventDefault();
      if (native) {
        try { native.postMessage({ type: 'openExternal', url: new URL(href, location.href).href }); return; } catch (err) {}
      }
      global.open(href, '_blank', 'noopener');
    });

    // title editing
    const title = $('#chatTitle');
    title.addEventListener('change', () => {
      const chat = Store.activeChat();
      if (!chat) return;
      Store.renameChat(chat.id, title.value);
      Renderer.sidebar();
      document.title = (chat.title || CFG.name) + ' — ' + CFG.name;
    });
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); title.blur(); }
      if (e.key === 'Escape') { title.value = Store.activeChat()?.title || 'Новый чат'; title.blur(); }
    });

    // search
    $('#search').addEventListener('input', (e) => {
      state.search = e.target.value;
      Renderer.sidebar();
    });
    $('#search').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.target.value = ''; state.search = ''; Renderer.sidebar(); e.target.blur(); }
    });

    // composer
    const ta = $('#input');
    ta.addEventListener('input', () => { autoGrow(); Renderer.sendButton(); Renderer.composerMeta(); });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        const sendWithEnter = settings().enterToSend || e.metaKey || e.ctrlKey;
        if (sendWithEnter) {
          e.preventDefault();
          if (!state.streaming && canSend()) send();
        }
      }
      if (e.key === 'Escape') { if (state.streaming) stopGeneration(); else ta.blur(); }
    });
    ta.addEventListener('paste', (e) => {
      const items = Array.from((e.clipboardData && e.clipboardData.items) || []);
      const files = items.filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile()).filter(Boolean);
      if (!files.length) return;
      e.preventDefault();
      files.forEach(addAttachment);
    });

    $('#fileInput').addEventListener('change', (e) => {
      Array.from(e.target.files || []).forEach(addAttachment);
      e.target.value = '';
    });

    // drag & drop
    let dragDepth = 0;
    const dz = $('#dropzone');
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    document.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      dz.hidden = false;
      document.body.classList.add('dragging');
    });
    document.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    document.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) { dz.hidden = true; document.body.classList.remove('dragging'); }
    });
    document.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      dz.hidden = true;
      document.body.classList.remove('dragging');
      Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith('image/')).forEach(addAttachment);
    });

    // scroll
    $('#scroll').addEventListener('scroll', () => {
      state.stick = nearBottom();
      Renderer.scrollShadow();
      updateScrollButton();
    }, { passive: true });

    // overlay scrim / drawer scrim
    document.querySelectorAll('[data-action="close-overlay"]').forEach((b) => b.addEventListener('click', () => UI.closeOverlay()));

    // global shortcuts
    document.addEventListener('keydown', (e) => {
      const meta = e.metaKey || e.ctrlKey;
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '').toUpperCase());
      if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
      if (meta && e.key.toLowerCase() === 'n' && !e.shiftKey) { e.preventDefault(); newChat(); return; }
      if (meta && e.key === ',') { e.preventDefault(); openSettings(); return; }
      if (meta && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleSidebar(); return; }
      if (meta && e.key.toLowerCase() === 'e' && !inField) { e.preventDefault(); exportChat(); return; }
      if (meta && e.key === 'Enter') { e.preventDefault(); if (!state.streaming && canSend()) send(); return; }
      if (e.key === 'Escape') {
        if (UI.overlayOpen()) return;
        if (state.streaming) { e.preventDefault(); stopGeneration(); return; }
        if ($('#app').classList.contains('drawer-open')) { closeDrawer(); return; }
        UI.closeMenu();
      }
    });

    // theme follows system
    if (global.matchMedia) {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => { if (settings().theme === 'system') { applyTheme(); Renderer.header(); } };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }

    // mobile: hide drawer when resizing up
    global.addEventListener('resize', () => {
      if (!isMobile()) closeDrawer();
      Renderer.scrollShadow();
    });

    global.addEventListener('store:error', () => UI.snackbar('Не удалось сохранить историю: на устройстве мало места'));
    global.addEventListener('beforeunload', () => Store.save(true));
    document.addEventListener('visibilitychange', () => { if (document.hidden) Store.save(true); });

    // keep scroll button fresh on content changes
    if (global.ResizeObserver) {
      const ro = new ResizeObserver(() => updateScrollButton());
      ro.observe($('#thread'));
    }
  }

  /* ============================================================
     Settings reaction
     ============================================================ */
  function applySettings(patch) {
    if (patch) Object.assign(settings(), patch);
    applyTheme();
    const root = document.documentElement;
    root.style.setProperty('--chat-size', (15.5 * (settings().fontScale || 1)).toFixed(2) + 'px');
    $('#app').classList.toggle('sidebar-collapsed', !!settings().sidebarCollapsed && !isMobile());
    Renderer.header();
    Renderer.composerMeta();
    Renderer.sendButton();
    if (patch && patch.model) {
      const chat = Store.activeChat();
      if (chat && !chat.messages.length) chat.model = patch.model;
      if (!chat || !chat.messages.length) Renderer.thread();
    }
    if (patch && patch.theme) Renderer.header();
  }

  function hardReset() {
    state.attachments = [];
    Store.state.activeChatId = null;
    applySettings({});
    Renderer.all();
    resetComposer();
    UI.snackbar('Всё удалено');
    if (CFG.requireKey && global.Onboarding && !settings().apiKey.trim()) setTimeout(() => global.Onboarding.show(), 320);
    else loadModels(true);
  }

  /* ============================================================
     Boot
     ============================================================ */
  async function init() {
    try {
    global.__INIT_STEPS__ = 'hydrate';
    UI.Icons.hydrate(document);
    global.__INIT_STEPS__ = 'store';
    await Store.init();
    global.__INIT_STEPS__ = 'store-ok:' + !!Store.state;
    if (global.__GROQ_NATIVE__) document.body.classList.add('is-native');
    applySettings({});
    Renderer.all();
    bind();
    const ta = $('#input');
    autoGrow();
    Renderer.sendButton();
    Renderer.composerMeta();
    setTimeout(() => { if (!isMobile()) ta.focus(); }, 120);
    if (settings().apiKey.trim()) loadModels(false);
    else {
      state.models = FALLBACK_MODELS.slice();
      Renderer.header();
      if (CFG.requireKey && global.Onboarding) setTimeout(() => global.Onboarding.show(), 220);
    }

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    } catch (e) {
      global.__INIT_ERROR__ = String((e && e.message) || '') + ' || ' + String((e && e.stack) || e);
      console.error('INIT FAIL', global.__INIT_ERROR__);
      throw e;
    }
  }

  /* Developer helper used by the screenshot harness */
  function seedDemo() {
    const chat = Store.createChat('openai/gpt-oss-120b');
    chat.title = 'Material You и быстрый чат';
    chat.messages = [
      {
        id: uid(), role: 'user', createdAt: Date.now() - 120000,
        content: 'Привет! Помоги придумать, как оформить личный чат-клиент в стиле Material You. Нужны конкретные идеи по палитре и типографике.',
      },
      {
        id: uid(), role: 'assistant', createdAt: Date.now() - 110000, elapsed: 1450,
        model: 'openai/gpt-oss-120b',
        usage: { total_tokens: 842, completion_tokens: 512, completion_time: 1.42 },
        reasoning: 'Пользователь просит идеи по Material You. Нужно дать конкретные рекомендации: динамическая палитра из seed-цвета, тональные поверхности, крупные скругления, акцент на типографике. Лучше структурировать ответ списком и добавить пример кода для генерации токенов.',
        content: `Отличная задача. Вот как я бы собрал **Material You**-клиент, чтобы он не выглядел как обычный веб-чат.\n\n### 1. Цвет\nБерите **один seed-цвет** и генерируйте из него тональные палитры в OKLCH — так получается настоящая динамическая тема, а не просто «фиолетовый акцент».\n\n- \`primary\` — для главных действий\n- \`secondaryContainer\` — для выбранных элементов\n- \`surfaceContainerLow/High\` — для слоёв интерфейса\n- \`tertiary\` — для редких акцентов (как «изюминка»)\n\n\`\`\`js\nconst scheme = Palette.scheme('#6750A4', dark);\nfor (const [token, hex] of Object.entries(scheme)) {\n  root.style.setProperty('--' + kebab(token), hex);\n}\n\`\`\`\n\n### 2. Формы\nКрупные радиусы — 24–28 px у карточек, полностью круглые кнопки. Плавающее поле ввода с мягкой тенью и подсветкой при фокусе.\n\n### 3. Типографика\n| Роль | Размер | Начертание |\n| --- | --- | --- |\n| Заголовок | 30–42 px | 800, rounded |\n| Текст | 15.5 px | 400 |\n| Подписи | 11–12 px | 600 |\n\n> Главное — сдержанность: один акцент, много воздуха и ритм отступов 8 px.\n\nЕсли хотите, могу набросать токены для тёмной темы.`,
      },
      {
        id: uid(), role: 'user', createdAt: Date.now() - 30000,
        content: 'А как сделать так, чтобы приложение не жрало ресурсы в фоне?',
      },
    ];
    Store.state.activeChatId = chat.id;
    Store.save(true);
    Renderer.all();
  }

  function sendText(text) {
    const ta = $('#input');
    ta.value = text;
    autoGrow();
    Renderer.sendButton();
    return send();
  }

  const App = {
    init, applySettings, setModel, loadModels, newChat, openModelPicker, openSettings, openPalette,
    exportAll, importFile, hardReset, seedDemo, applyTheme, state, Renderer, sendText, send,
    exportActiveChat: () => exportChat(),
    toggleSidebar,
    refreshModels: (force) => loadModels(force),
  };
  global.App = App;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof globalThis !== 'undefined' ? globalThis : this);
