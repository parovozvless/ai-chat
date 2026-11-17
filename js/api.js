/* Groq API client (OpenAI-compatible), streaming + model discovery. */
(function (global) {
  'use strict';

  const CACHE_KEY = 'groq-chat-models-v1';
  const CACHE_TTL = 10 * 60 * 1000;
  const EXCLUDE = /(whisper|tts|orpheus|prompt-guard|embed|rerank|guard)/i;

  class ApiError extends Error {
    constructor(message, status, code, retryAfter) {
      super(message);
      this.name = 'ApiError';
      this.status = status || 0;
      this.code = code || '';
      this.retryAfter = retryAfter || 0;
    }
  }

  const API = {
    modelsCache: null,

    base() {
      const b = (global.Store && Store.state.settings.baseUrl) || 'https://api.groq.com/openai/v1';
      return b.replace(/\/+$/, '');
    },

    key() {
      return ((global.Store && Store.state.settings.apiKey) || '').trim();
    },

    headers(extra) {
      const h = { 'Content-Type': 'application/json' };
      if (this.key()) h.Authorization = 'Bearer ' + this.key();
      return Object.assign(h, extra || {});
    },

    async _readError(res) {
      let text = '';
      try { text = await res.text(); } catch (e) { /* ignore */ }
      let msg = text;
      let code = '';
      try {
        const j = JSON.parse(text);
        msg = (j.error && (j.error.message || j.error.code)) || text;
        code = (j.error && j.error.code) || '';
      } catch (e) { /* plain text */ }
      if (res.status === 401) msg = 'Ключ API не подошёл. Проверьте его в настройках.';
      else if (res.status === 403) msg = 'Доступ к этой модели закрыт для вашего ключа.';
      else if (res.status === 429) msg = 'Слишком много запросов. Подождите немного и попробуйте снова.';
      else if (res.status >= 500) msg = 'Сервер API временно недоступен. Попробуйте ещё раз.';
      const ra = parseInt(res.headers.get('retry-after') || '0', 10);
      return new ApiError(msg || ('Ошибка ' + res.status), res.status, code, ra);
    },

    /* ---------- models ---------- */
    formatName(m) {
      if (m.name && m.name.trim() && m.name.trim().toLowerCase() !== m.id.toLowerCase()) return m.name.trim();
      const id = m.id.split('/').pop();
      return id
        .replace(/[-_]/g, ' ')
        .replace(/\b(\w)/g, (c) => c.toUpperCase())
        .replace(/\bGpt\b/g, 'GPT').replace(/\bOss\b/g, 'OSS').replace(/\bLlm\b/g, 'LLM');
    },

    normalizeModel(m) {
      const input = m.input_modalities || [];
      const feats = m.supported_features || [];
      return {
        id: m.id,
        name: this.formatName(m),
        vendor: m.owned_by || (m.id.includes('/') ? m.id.split('/')[0] : 'Groq'),
        context: m.context_window || m.context_length || 0,
        maxOut: m.max_completion_tokens || m.max_output_length || 0,
        vision: input.includes('image'),
        audio: input.includes('audio'),
        tools: feats.includes('tools'),
        reasoning: feats.includes('reasoning'),
        json: feats.includes('json_mode'),
        pricing: m.pricing || null,
        active: m.active !== false,
      };
    },

    isChatModel(m) {
      if (!m.active) return false;
      if (EXCLUDE.test(m.id)) return false;
      if (!m.inputMods || m.id.includes('whisper')) return false;
      if (m.context && m.context < 2000) return false;
      return true;
    },

    async listModels(force) {
      const now = Date.now();
      if (!force && this.modelsCache && now - this.modelsCache.at < CACHE_TTL) return this.modelsCache.models;
      if (!force) {
        try {
          const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
          if (cached && cached.at && now - cached.at < CACHE_TTL && Array.isArray(cached.models) && cached.models.length) {
            this.modelsCache = cached;
            return cached.models;
          }
        } catch (e) { /* ignore */ }
      }
      if (!this.key()) throw new ApiError('Добавьте ключ Groq API в настройках.', 401);
      let res;
      try {
        res = await fetch(this.base() + '/models', { headers: this.headers() });
      } catch (e) {
        throw new ApiError('Нет связи с api.groq.com. Проверьте интернет.', 0, 'network');
      }
      if (!res.ok) throw await this._readError(res);
      const data = await res.json();
      const models = (data.data || [])
        .map((raw) => Object.assign(this.normalizeModel(raw), { inputMods: raw.input_modalities || [] }))
        .filter((m) => this.isChatModel(m))
        .sort((a, b) => {
          if (a.vendor !== b.vendor) return a.vendor.localeCompare(b.vendor);
          return b.context - a.context;
        });
      this.modelsCache = { at: now, models };
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(this.modelsCache)); } catch (e) { /* ignore */ }
      return models;
    },

    /* ---------- chat ---------- */
    buildMessages(history, systemPrompt) {
      const out = [];
      if (systemPrompt && systemPrompt.trim()) out.push({ role: 'system', content: systemPrompt.trim() });
      history.forEach((m) => {
        if (m.role === 'assistant' && (!m.content || m.error)) return;
        if (m.role === 'user') {
          if (m.attachments && m.attachments.length) {
            const parts = [];
            if (m.content) parts.push({ type: 'text', text: m.content });
            m.attachments.forEach((a) => parts.push({ type: 'image_url', image_url: { url: a.dataUrl } }));
            out.push({ role: 'user', content: parts });
          } else {
            out.push({ role: 'user', content: m.content || '' });
          }
        } else if (m.role === 'assistant') {
          out.push({ role: 'assistant', content: m.content || '' });
        }
      });
      return out;
    },

    /**
     * Streams a completion. Returns final { content, reasoning, usage, model, aborted }.
     * onDelta(text), onReasoning(text), onUsage(usage), onFirstToken(ms)
     */
    async chat(opts) {
      const s = Store.state.settings;
      const body = {
        model: opts.model,
        messages: opts.messages,
        temperature: typeof opts.temperature === 'number' ? opts.temperature : s.temperature,
        top_p: typeof opts.topP === 'number' ? opts.topP : s.topP,
        max_completion_tokens: opts.maxTokens || s.maxTokens || 4096,
        stream: opts.stream !== false,
      };
      if (body.stream) body.stream_options = { include_usage: true };

      const started = performance.now();
      let res;
      try {
        res = await fetch(this.base() + '/chat/completions', {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(body),
          signal: opts.signal,
        });
      } catch (e) {
        if (e && e.name === 'AbortError') return { content: opts._content || '', reasoning: '', aborted: true, usage: opts._usage || null };
        throw new ApiError('Нет связи с api.groq.com. Проверьте интернет.', 0, 'network');
      }
      if (!res.ok) throw await this._readError(res);
      if (!body.stream) {
        const j = await res.json();
        const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
        return {
          content: msg.content || '',
          reasoning: msg.reasoning || '',
          usage: j.usage || (j.x_groq && j.x_groq.usage) || null,
          model: j.model || opts.model,
          elapsed: performance.now() - started,
        };
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let content = '';
      let reasoning = '';
      let usage = null;
      let model = opts.model;
      let firstTokenAt = 0;
      let finished = false;

      const handleChunk = (json) => {
        if (!json) return;
        if (json.model) model = json.model;
        if (json.usage) usage = json.usage;
        if (json.x_groq && json.x_groq.usage) usage = json.x_groq.usage;
        const choice = json.choices && json.choices[0];
        if (!choice) return;
        const d = choice.delta || {};
        const r = d.reasoning || d.reasoning_content || '';
        const c = d.content || '';
        if (r) {
          if (!firstTokenAt) firstTokenAt = performance.now();
          reasoning += r;
          if (opts.onReasoning) opts.onReasoning(r, reasoning);
        }
        if (c) {
          if (!firstTokenAt) { firstTokenAt = performance.now(); if (opts.onFirstToken) opts.onFirstToken(firstTokenAt - started); }
          content += c;
          if (opts.onDelta) opts.onDelta(c, content);
        }
        if (choice.finish_reason) finished = true;
      };

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).replace(/\r$/, '').trim();
            buffer = buffer.slice(nl + 1);
            if (!line || line.startsWith(':')) continue;
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') { finished = true; continue; }
            try { handleChunk(JSON.parse(payload)); } catch (e) { /* partial json, ignore */ }
          }
        }
        // flush trailing buffer
        const tail = buffer.trim();
        if (tail.startsWith('data:')) {
          const payload = tail.slice(5).trim();
          if (payload && payload !== '[DONE]') { try { handleChunk(JSON.parse(payload)); } catch (e) { /* ignore */ } }
        }
      } catch (e) {
        if (e && e.name === 'AbortError') {
          return { content, reasoning, usage, model, aborted: true, elapsed: performance.now() - started };
        }
        throw e;
      }

      return {
        content,
        reasoning,
        usage,
        model,
        finished,
        elapsed: performance.now() - started,
        ttft: firstTokenAt ? firstTokenAt - started : 0,
      };
    },

    async testKey() {
      const models = await this.listModels(true);
      return models.length;
    },
  };

  global.API = API;
  global.ApiError = ApiError;
})(typeof globalThis !== 'undefined' ? globalThis : this);
