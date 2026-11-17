/* First-run onboarding for the public build: the visitor brings their own Groq key. */
(function (global) {
  'use strict';

  const SESSION_KEY = 'groq-chat-session-key';
  const cfg = global.APP_CONFIG || {};
  const ic = (name, size) => global.Icons.render(name, size);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let node = null;
  let busy = false;

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function reason(phrase) {
    return phrase;
  }

  function show() {
    if (node) return;
    const st = global.Store && Store.state;
    if (!st) return;
    if ((st.settings.apiKey || '').trim()) return;

    node = el(`
      <div class="onboarding" role="dialog" aria-modal="true" aria-labelledby="onbTitle">
        <div class="onboarding__card" id="onbCard">
          <div class="onboarding__brand">
            <div class="brand-mark" aria-hidden="true">${ic('sparkles', 24)}</div>
            <div>
              <div class="onboarding__brand-name">${esc(cfg.name || 'AI Chat')}</div>
              <div class="onboarding__brand-sub">${esc(cfg.sub || 'чат с нейросетью')}</div>
            </div>
          </div>

          <h1 id="onbTitle">Подключим нейросеть</h1>
          <p class="onboarding__lead">Нужен бесплатный API-ключ Groq. Это займёт около минуты — ключ останется только в вашем браузере.</p>

          <ol class="onboarding__steps">
            <li><span>Откройте <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">console.groq.com/keys</a></span></li>
            <li><span>Войдите через <b>Google</b> — кнопка «Continue with Google». Подойдёт и GitHub, и обычная почта.</span></li>
            <li><span>Нажмите <b>Create API Key</b>, назовите как удобно и скопируйте ключ — он начинается с <code>gsk_</code>.</span></li>
          </ol>

          <div class="onboarding__field">
            <label class="onboarding__field-label" for="onbKey">Ключ API</label>
            <div class="onboarding__keyrow">
              <input class="input" id="onbKey" type="password" placeholder="gsk_..." autocomplete="off" spellcheck="false" aria-describedby="onbStatus">
              <button class="icon-btn" id="onbEye" type="button" aria-label="Показать ключ">${ic('globe', 18)}</button>
            </div>
          </div>

          <div class="onboarding__row">
            <div>
              <div class="onboarding__row-title">Запомнить на этом устройстве</div>
              <div class="onboarding__row-desc">Иначе ключ удалится при закрытии вкладки</div>
            </div>
            <button class="switch" id="onbRemember" role="switch" aria-checked="true" aria-label="Запомнить ключ"></button>
          </div>

          <div class="onboarding__actions">
            <button class="btn btn--filled" id="onbGo" type="button">Подключиться</button>
          </div>
          <div class="onboarding__status" id="onbStatus" aria-live="polite"></div>

          <div class="onboarding__note">Ключ не попадает на сервер этого сайта: браузер отправляет запросы напрямую к API. Отозвать ключ можно в любой момент в консоли Groq.</div>
          <button class="onboarding__skip" id="onbSkip" type="button">Осмотреть интерфейс без ключа</button>
        </div>
      </div>`);

    document.body.appendChild(node);
    const splash = document.getElementById('bootSplash');
    if (splash) splash.remove();

    const card = node.querySelector('#onbCard');
    const input = node.querySelector('#onbKey');
    const status = node.querySelector('#onbStatus');
    const go = node.querySelector('#onbGo');
    const remember = node.querySelector('#onbRemember');

    setTimeout(() => input.focus({ preventScroll: true }), 120);

    node.querySelector('#onbEye').addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      input.focus();
    });

    remember.addEventListener('click', () => {
      remember.setAttribute('aria-checked', remember.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
    });

    const setError = (msg) => {
      status.textContent = msg || '';
      status.classList.remove('is-ok');
      input.classList.toggle('is-error', !!msg);
      if (msg) {
        card.classList.remove('is-shake');
        void card.offsetWidth;
        card.classList.add('is-shake');
      }
    };

    const setBusy = (v) => {
      busy = v;
      go.disabled = v;
      go.textContent = v ? 'Проверяем…' : 'Подключиться';
      input.disabled = v;
    };

    async function connect() {
      if (busy) return;
      const key = input.value.trim();
      if (!key) { setError('Вставьте ключ — он начинается с gsk_'); return; }
      if (key.length < 20) { setError('Ключ выглядит слишком коротким. Скопируйте его целиком.'); return; }
      setError('');
      setBusy(true);
      status.textContent = 'Проверяем ключ…';
      status.classList.remove('is-ok');
      try {
        const res = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: 'Bearer ' + key },
        });
        if (res.status === 401) throw new Error('Ключ не подошёл. Проверьте, что скопировали его целиком.');
        if (res.status === 403) throw new Error('Доступ к API закрыт для этого ключа.');
        if (!res.ok) throw new Error('API ответил ошибкой ' + res.status + '. Попробуйте ещё раз.');
        const data = await res.json();
        const count = (data.data || []).length;
        const useRemember = remember.getAttribute('aria-checked') === 'true';

        Store.state.settings.apiKey = key;
        Store.state.settings.persistKey = useRemember;
        try {
          if (useRemember) sessionStorage.removeItem(SESSION_KEY);
          else sessionStorage.setItem(SESSION_KEY, key);
        } catch (e) { /* ignore */ }
        Store.save(true);

        status.textContent = 'Готово · ключ работает, моделей: ' + count;
        status.classList.add('is-ok');
        setTimeout(() => {
          hide();
          if (global.App) {
            App.loadModels(true);
            App.Renderer.header();
            const ta = document.querySelector('#input');
            if (ta) ta.focus();
          }
        }, 420);
      } catch (err) {
        setBusy(false);
        setError(err && err.message ? err.message : 'Не удалось проверить ключ');
        status.textContent = err && err.message ? err.message : 'Не удалось проверить ключ';
      }
    }

    go.addEventListener('click', connect);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); connect(); }
    });

    node.querySelector('#onbSkip').addEventListener('click', () => {
      hide();
      if (global.UI) global.UI.snackbar('Можно осмотреться. Для ответов понадобится ключ.');
    });
  }

  function hide() {
    if (!node) return;
    const n = node;
    node = null;
    n.classList.add('is-out');
    setTimeout(() => n.remove(), 240);
  }

  global.Onboarding = { show, hide };
})(typeof globalThis !== 'undefined' ? globalThis : this);
