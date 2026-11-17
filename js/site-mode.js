/* Public build configuration — no secrets live in this file. */
(function (global) {
  'use strict';

  global.APP_CONFIG = {
    name: 'AI Chat',
    sub: 'чат с нейросетью',
    assistant: 'AI',
    provider: 'ИИ',
    requireKey: true,
    about: 'чат с нейросетью в стиле Material You',
    aboutText: 'Быстрый чат с современными моделями: GPT-OSS, Qwen, Llama. Ключ хранится только в вашем браузере, запросы идут напрямую к API.'
  };

  function hasSavedKey() {
    try {
      var raw = localStorage.getItem('groq-chat-state-v1');
      if (raw) {
        var st = JSON.parse(raw);
        if (st && st.settings && st.settings.apiKey) return true;
      }
      return !!sessionStorage.getItem('groq-chat-session-key');
    } catch (e) {
      return false;
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.title = 'AI Chat';
    var brand = document.querySelector('.brand-name');
    if (brand) brand.textContent = 'AI Chat';
    var sub = document.getElementById('brandSub');
    if (sub) sub.textContent = 'чат с нейросетью';

    if (!hasSavedKey()) {
      var splash = document.createElement('div');
      splash.className = 'boot-splash';
      splash.id = 'bootSplash';
      splash.innerHTML = '<div class="boot-splash__mark"><svg viewBox="0 0 24 24" width="38" height="38" fill="currentColor"><path d="M12 2.6 14.5 9.5 21.4 12 14.5 14.5 12 21.4 9.5 14.5 2.6 12 9.5 9.5Z"/></svg></div>';
      document.body.appendChild(splash);
      setTimeout(function () { if (splash.parentNode) splash.remove(); }, 7000);
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
