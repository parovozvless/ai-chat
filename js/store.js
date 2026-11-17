/* Local persistence: IndexedDB with localStorage fallback. */
(function (global) {
  'use strict';

  const KEY = 'groq-chat-state-v1';
  const DEFAULT_MODEL = 'openai/gpt-oss-120b';

  const DEFAULT_SETTINGS = {
    apiKey: '',
    persistKey: true,
    model: DEFAULT_MODEL,
    theme: 'system',            // system | light | dark
    seedColor: '#6750A4',
    temperature: 0.7,
    topP: 1,
    maxTokens: 4096,
    systemPrompt: '',
    streaming: true,
    enterToSend: true,
    showReasoning: true,
    showAllModels: false,
    favorites: [],
    fontScale: 1,
    sidebarCollapsed: false,
    baseUrl: 'https://api.groq.com/openai/v1',
  };

  const uid = () => {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  };

  const Store = {
    state: null,
    _db: null,
    _saveTimer: null,
    _dirty: false,

    defaults() {
      return { version: 1, settings: { ...DEFAULT_SETTINGS }, chats: [], activeChatId: null };
    },

    async init() {
      let loaded = null;
      // IndexedDB is unavailable/blocked on file:// in WKWebView: use localStorage there.
      if (global.indexedDB && location.protocol !== 'file:') {
        try {
          loaded = await Promise.race([
            this._readIDB(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('idb timeout')), 2500)),
          ]);
        } catch (e) { loaded = null; }
      }
      if (!loaded) {
        try { loaded = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { loaded = null; }
      }
      const base = this.defaults();
      this.state = this._normalize(loaded, base);
      if (!this.state.settings.apiKey) {
        try {
          const sk = sessionStorage.getItem('groq-chat-session-key');
          if (sk) this.state.settings.apiKey = sk;
        } catch (e) { /* ignore */ }
      }
      return this.state;
    },

    _normalize(loaded, base) {
      const st = { ...base, ...(loaded || {}) };
      st.settings = { ...base.settings, ...((loaded && loaded.settings) || {}) };
      if (!Array.isArray(st.chats)) st.chats = [];
      st.chats = st.chats.filter((c) => c && c.id).map((c) => ({
        id: c.id,
        title: c.title || 'Новый чат',
        createdAt: c.createdAt || Date.now(),
        updatedAt: c.updatedAt || c.createdAt || Date.now(),
        model: c.model || st.settings.model,
        messages: Array.isArray(c.messages) ? c.messages : [],
      }));
      if (st.activeChatId && !st.chats.some((c) => c.id === st.activeChatId)) st.activeChatId = null;
      return st;
    },

    _openIDB() {
      if (!global.indexedDB) return Promise.reject(new Error('no idb'));
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('groq-chat', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('idb blocked'));
      });
    },

    async _readIDB() {
      if (!this._db) this._db = await this._openIDB();
      return new Promise((resolve, reject) => {
        const tx = this._db.transaction('kv', 'readonly');
        const req = tx.objectStore('kv').get(KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    },

    _writeIDB(payload) {
      return new Promise((resolve, reject) => {
        const tx = this._db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(payload, KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },

    save(immediate) {
      this._dirty = true;
      if (this._saveTimer) clearTimeout(this._saveTimer);
      const run = async () => {
        this._saveTimer = null;
        if (!this.state) return;
        const payload = JSON.parse(JSON.stringify(this.state));
        if (payload.settings && payload.settings.persistKey === false) {
          payload.settings.apiKey = '';
        }
        let ok = false;
        try {
          if (global.indexedDB && location.protocol !== 'file:') {
            if (!this._db) this._db = await this._openIDB();
            await this._writeIDB(payload);
            ok = true;
          }
        } catch (e) { ok = false; }
        if (!ok) {
          try {
            localStorage.setItem(KEY, JSON.stringify(payload));
            ok = true;
          } catch (e) { ok = false; }
        }
        if (!ok) {
          try { global.dispatchEvent(new CustomEvent('store:error')); } catch (e) { /* ignore */ }
        }
        this._dirty = false;
      };
      if (immediate) { run(); } else { this._saveTimer = setTimeout(run, 350); }
    },

    /* ---- settings ---- */
    set(patch, immediate) {
      Object.assign(this.state.settings, patch);
      this.save(immediate);
    },

    /* ---- chats ---- */
    activeChat() {
      return this.state.chats.find((c) => c.id === this.state.activeChatId) || null;
    },

    createChat(model) {
      const now = Date.now();
      const chat = {
        id: uid(),
        title: 'Новый чат',
        createdAt: now,
        updatedAt: now,
        model: model || this.state.settings.model,
        messages: [],
      };
      this.state.chats.unshift(chat);
      this.state.activeChatId = chat.id;
      this.save(true);
      return chat;
    },

    ensureChat() {
      return this.activeChat() || this.createChat();
    },

    getChat(id) {
      return this.state.chats.find((c) => c.id === id) || null;
    },

    touch(chat) {
      chat.updatedAt = Date.now();
      const i = this.state.chats.indexOf(chat);
      // keep recency order, but only when browsing history (not while composing a new chat)
      if (i > 0 && this.state.chats[i - 1].updatedAt < chat.updatedAt) {
        this.state.chats.splice(i, 1);
        this.state.chats.unshift(chat);
      }
      this.save();
    },

    renameChat(id, title) {
      const c = this.getChat(id);
      if (!c) return;
      c.title = (title || '').trim().slice(0, 120) || 'Новый чат';
      c.updatedAt = Date.now();
      this.save();
    },

    deleteChat(id) {
      const i = this.state.chats.findIndex((c) => c.id === id);
      if (i < 0) return;
      this.state.chats.splice(i, 1);
      if (this.state.activeChatId === id) this.state.activeChatId = null;
      this.save(true);
    },

    clearAll() {
      this.state = this.defaults();
      this.state.settings.apiKey = this.state.settings.apiKey || DEFAULT_SETTINGS.apiKey;
      this.save(true);
    },

    exportAll() {
      return {
        app: 'groq-chat',
        version: 1,
        exportedAt: new Date().toISOString(),
        settings: { ...this.state.settings, apiKey: '' },
        chats: this.state.chats,
      };
    },

    importAll(data) {
      if (!data || !Array.isArray(data.chats)) throw new Error('Неверный формат файла');
      const settings = { ...this.state.settings };
      if (data.settings && typeof data.settings === 'object') {
        const keepKey = settings.apiKey;
        Object.assign(settings, data.settings, { apiKey: keepKey });
      }
      const chats = data.chats.filter((c) => c && c.id).map((c) => ({
        id: c.id || uid(),
        title: c.title || 'Импортированный чат',
        createdAt: c.createdAt || Date.now(),
        updatedAt: c.updatedAt || Date.now(),
        model: c.model || settings.model,
        messages: Array.isArray(c.messages) ? c.messages : [],
      }));
      // merge, overwriting same ids
      const map = new Map(this.state.chats.map((c) => [c.id, c]));
      chats.forEach((c) => map.set(c.id, c));
      this.state.chats = [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
      this.state.settings = settings;
      this.save(true);
      return chats.length;
    },
  };

  global.Store = Store;
  global.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
