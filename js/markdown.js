/* markdown.js — dependency-free, safe Markdown renderer + code highlighter.
 * Works as a plain <script> (defines globalThis.MD) and in Node via vm.
 * All user text is HTML-escaped; raw HTML is never passed through.
 * URLs are limited to http(s), mailto, and relative/fragment links.
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Escaping & URL safety
   * ------------------------------------------------------------------ */

  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  var ESC_RE = /[&<>"']/g;

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(ESC_RE, function (c) { return ESC_MAP[c]; });
  }

  // Returns '' when the URL scheme is not allowed. Relative / fragment URLs
  // are allowed; javascript:, data:, vbscript:, file:, etc. are not.
  function sanitizeUrl(raw) {
    var url = String(raw == null ? '' : raw).replace(/[\u0000-\u0020\u007f]/g, '').trim();
    if (!url) return '';
    // Probe with backslashes removed (browsers treat "\" like "/" in URLs).
    var probe = url.replace(/\\/g, '').toLowerCase();
    var m = /^([a-z][a-z0-9+.\-]*):/.exec(probe);
    if (m && m[1] !== 'http' && m[1] !== 'https' && m[1] !== 'mailto') return '';
    return url;
  }

  /* ------------------------------------------------------------------ *
   * Small inline helpers
   * ------------------------------------------------------------------ */

  function countRun(text, i, ch) {
    var j = i;
    while (text.charAt(j) === ch) j++;
    return j - i;
  }

  function isEscaped(text, i) {
    var n = 0, j = i - 1;
    while (j >= 0 && text.charAt(j) === '\\') { n++; j--; }
    return (n & 1) === 1;
  }

  // Find an unescaped run of exactly `len` of `ch`.
  function findRun(text, from, ch, len, wordBoundary, skipCode) {
    var i = from, n = text.length;
    while (i < n) {
      if (skipCode && text.charAt(i) === '`') {
        var cr = countRun(text, i, '`');
        var cc = findRun(text, i + cr, '`', cr, false, false);
        i = cc >= 0 ? cc + cr : i + cr;
        continue;
      }
      if (text.charAt(i) !== ch) { i++; continue; }
      if (isEscaped(text, i)) { i++; continue; }
      var run = countRun(text, i, ch);
      if (run === len) {
        if (wordBoundary && /[A-Za-z0-9]/.test(text.charAt(i + len))) { i += run; continue; }
        return i;
      }
      i += run;
    }
    return -1;
  }

  function isWordChar(c) { return /[A-Za-z0-9]/.test(c); }

  /* ------------------------------------------------------------------ *
   * Inline renderer
   * ------------------------------------------------------------------ */

  var INLINE_RE = /[\\`*_~\[\]!<\n]|h(?=ttps?:\/\/)/gi;
  var URL_RE = /https?:\/\/[^\s<>"'`]+/gi;

  function countChar(s, ch) {
    var n = 0;
    for (var i = 0; i < s.length; i++) if (s.charAt(i) === ch) n++;
    return n;
  }

  function trimAutolink(url) {
    var u = url;
    while (/[.,;:!?]$/.test(u)) u = u.slice(0, -1);
    while (u.slice(-1) === ')' && countChar(u, '(') < countChar(u, ')')) u = u.slice(0, -1);
    while (u.slice(-1) === ']' && countChar(u, '[') < countChar(u, ']')) u = u.slice(0, -1);
    return u;
  }

  // Parses `[label](url "title")` / `![alt](url)` at position i.
  // Handles balanced parentheses in URLs (e.g. Wikipedia links) and angle-bracket URLs.
  function tryLink(text, i) {
    var image = false;
    var p = i;
    if (text.charAt(p) === '!') { image = true; p++; }
    if (text.charAt(p) !== '[') return null;

    var labelStart = p + 1;
    var j = labelStart, depth = 0;
    while (j < text.length) {
      if (j - labelStart > 2048) return null;
      var c = text.charAt(j);
      if (c === '\\') { j += 2; continue; }
      if (c === '\n') return null;
      if (c === '[') depth++;
      else if (c === ']') {
        if (depth === 0) break;
        depth--;
      }
      j++;
    }
    if (j >= text.length) return null;
    var label = text.slice(labelStart, j);
    j++;
    if (text.charAt(j) !== '(') return null;
    j++;
    while (text.charAt(j) === ' ' || text.charAt(j) === '\t') j++;

    var url = '';
    if (text.charAt(j) === '<') {
      var uend = j + 1;
      while (uend < text.length && text.charAt(uend) !== '>' && text.charAt(uend) !== '\n') {
        if (text.charAt(uend) === '\\') uend++;
        uend++;
      }
      if (uend >= text.length || text.charAt(uend) !== '>') return null;
      url = text.slice(j + 1, uend);
      j = uend + 1;
    } else {
      var ustart = j, parens = 0;
      while (j < text.length) {
        if (j - ustart > 4096) return null;
        var uc = text.charAt(j);
        if (uc === '\\') { j += 2; continue; }
        if (uc === '(') parens++;
        else if (uc === ')') {
          if (parens === 0) break;
          parens--;
        } else if (uc === ' ' || uc === '\t' || uc === '\n') break;
        j++;
      }
      url = text.slice(ustart, j);
      if (!url) return null;
    }

    while (text.charAt(j) === ' ' || text.charAt(j) === '\t') j++;
    var title = '';
    var q = text.charAt(j);
    if (q === '"' || q === "'") {
      var tstart = ++j;
      while (j < text.length && text.charAt(j) !== q) {
        if (text.charAt(j) === '\\') j++;
        j++;
      }
      if (j >= text.length) return null;
      title = text.slice(tstart, j);
      j++;
      while (text.charAt(j) === ' ' || text.charAt(j) === '\t') j++;
    }
    if (text.charAt(j) !== ')') return null;
    return { image: image, label: label, url: url, title: title, end: j + 1 };
  }

  function renderLink(res, depth) {
    var href = sanitizeUrl(res.url);
    if (res.image) {
      if (!href) return escapeHtml(res.label);
      return '<img loading="lazy" src="' + escapeHtml(href) + '" alt="' + escapeHtml(res.label) + '"' +
        (res.title ? ' title="' + escapeHtml(res.title) + '"' : '') + '>';
    }
    var label = inline(res.label, depth + 1);
    if (!href) return label;
    return '<a href="' + escapeHtml(href) + '"' +
      (res.title ? ' title="' + escapeHtml(res.title) + '"' : '') +
      ' target="_blank" rel="noopener noreferrer">' + label + '</a>';
  }

  function tryAutolink(text, i) {
    URL_RE.lastIndex = i;
    var m = URL_RE.exec(text);
    if (!m || m.index !== i) return null;
    var url = trimAutolink(m[0]);
    if (!url) return null;
    return { url: url, end: i + url.length };
  }

  function renderEmphasis(text, i, ch, noClose, depth) {
    var run = countRun(text, i, ch);
    var take = ch === '~' ? 2 : (run >= 3 ? 3 : run);
    if (ch === '~' && run < 2) return null;
    if (ch === '_' && i > 0 && isWordChar(text.charAt(i - 1))) return null;
    var key = ch + take;
    if (!noClose[key]) {
      var close = findRun(text, i + take, ch, take, ch === '_', true);
      if (close >= 0) {
        var content = text.slice(i + take, close);
        // Do not treat whitespace-padded runs as emphasis ("a * b * c").
        if (!/^\s|\s$/.test(content) && content) {
          var inner = inline(content, depth + 1);
          var html;
          if (ch === '~') html = '<del>' + inner + '</del>';
          else if (take === 3) html = '<em><strong>' + inner + '</strong></em>';
          else if (take === 2) html = '<strong>' + inner + '</strong>';
          else html = '<em>' + inner + '</em>';
          return { html: html, end: close + take };
        }
      } else {
        noClose[key] = true;
      }
    }
    return null;
  }

  function inline(text, depth) {
    if (!text) return '';
    depth = depth || 0;
    if (depth > 40) return escapeHtml(text);
    var out = [];
    var i = 0, n = text.length;
    var noClose = Object.create(null);
    var noLinkClose = false;
    while (i < n) {
      INLINE_RE.lastIndex = i;
      var m = INLINE_RE.exec(text);
      if (!m) { out.push(escapeHtml(text.slice(i))); break; }
      if (m.index > i) {
        out.push(escapeHtml(text.slice(i, m.index)));
        i = m.index;
      }
      var ch = text.charAt(i);

      if (ch === '\\') {
        var nx = text.charAt(i + 1);
        if (nx && '\\`*_{}[]()#+-.!>~|'.indexOf(nx) >= 0) {
          out.push(escapeHtml(nx));
          i += 2;
        } else {
          out.push('\\');
          i++;
        }
        continue;
      }
      if (ch === '\n') { out.push('<br>\n'); i++; continue; }
      if (ch === '`') {
        var run = countRun(text, i, '`');
        var close = findRun(text, i + run, '`', run, false);
        if (close >= 0) {
          out.push('<code>' + escapeHtml(text.slice(i + run, close)) + '</code>');
          i = close + run;
        } else {
          out.push(escapeHtml(text.substr(i, run)));
          i += run;
        }
        continue;
      }
      if (ch === '!' && text.charAt(i + 1) === '[') {
        if (!noLinkClose && text.indexOf(']', i + 2) < 0) noLinkClose = true;
        if (!noLinkClose) {
          var img = tryLink(text, i);
          if (img) { out.push(renderLink(img, depth)); i = img.end; continue; }
        }
      }
      if (ch === '[') {
        if (!noLinkClose && text.indexOf(']', i + 1) < 0) noLinkClose = true;
        if (!noLinkClose) {
          var lnk = tryLink(text, i);
          if (lnk) { out.push(renderLink(lnk, depth)); i = lnk.end; continue; }
        }
      }
      if (ch === '<') {
        var am = /^<((?:https?:\/\/|mailto:)[^>\s]+)>/i.exec(text.slice(i, i + 512));
        if (am) {
          var autoHref = sanitizeUrl(am[1]);
          if (autoHref) {
            out.push('<a href="' + escapeHtml(autoHref) + '" target="_blank" rel="noopener noreferrer">' +
              escapeHtml(am[1]) + '</a>');
          } else {
            out.push(escapeHtml(am[0]));
          }
          i += am[0].length;
          continue;
        }
        out.push('&lt;');
        i++;
        continue;
      }
      if (ch === '*' || ch === '_' || ch === '~') {
        var em = renderEmphasis(text, i, ch, noClose, depth);
        if (em) { out.push(em.html); i = em.end; continue; }
        var run = countRun(text, i, ch);
        out.push(escapeHtml(text.substr(i, run)));
        i += run;
        continue;
      }
      if (ch === 'h' || ch === 'H') {
        var al = tryAutolink(text, i);
        if (al) {
          out.push('<a href="' + escapeHtml(al.url) + '" target="_blank" rel="noopener noreferrer">' +
            escapeHtml(al.url) + '</a>');
          i = al.end;
          continue;
        }
      }
      out.push(escapeHtml(ch));
      i++;
    }
    return out.join('');
  }

  /* ------------------------------------------------------------------ *
   * Code highlighter
   * ------------------------------------------------------------------ */

  function wordSet(str) {
    var o = Object.create(null);
    var arr = str.split(/\s+/);
    for (var i = 0; i < arr.length; i++) if (arr[i]) o[arr[i]] = 1;
    return o;
  }

  var JS_KW = 'var let const function return if else for while do switch case break continue ' +
    'new delete typeof instanceof in of class extends super this null undefined true false ' +
    'async await yield try catch finally throw import export from default static get set with debugger';
  var JS_TY = 'Array Object String Number Boolean Promise Map Set WeakMap WeakSet Date RegExp ' +
    'Error TypeError RangeError SyntaxError ReferenceError JSON Math Symbol BigInt Infinity NaN ' +
    'Intl Proxy Reflect Uint8Array Int32Array Float64Array Buffer';
  var TS_KW = JS_KW + ' interface type enum namespace declare implements public private protected ' +
    'readonly abstract as satisfies keyof infer is asserts unknown any never void string number ' +
    'boolean object symbol bigint override module';
  var TS_TY = JS_TY + ' Partial Readonly Record Pick Omit Exclude Extract PromiseLike Iterable ' +
    'Iterator React FC';

  var PY_KW = 'def class return if elif else for while break continue pass import from as with try ' +
    'except finally raise lambda yield async await global nonlocal del assert in is not and or ' +
    'None True False match case';
  var PY_TY = 'int str float bool list dict set tuple bytes bytearray object type len range print ' +
    'enumerate zip map filter sorted open Exception ValueError TypeError KeyError IndexError ' +
    'RuntimeError AttributeError self cls super property staticmethod classmethod isinstance ' +
    'issubclass repr format abs min max sum any all getattr setattr hasattr super';

  var SH_KW = 'if then else elif fi for while until do done case esac function in select time exit ' +
    'return local export readonly declare unset shift source alias set';
  var SH_TY = 'echo cd ls pwd cat grep sed awk mkdir rm cp mv chmod chown curl wget git npm node ' +
    'python sudo apt brew docker test printf read exec trap kill sleep touch find xargs head tail ' +
    'bash sh zsh env which nohup';

  var SQL_KW = 'select from where insert into values update set delete create table alter drop index ' +
    'view join inner left right full outer on as and or not null is in between like ilike order by ' +
    'group having limit offset union all distinct case when then else end primary key foreign ' +
    'references default unique constraint begin commit rollback transaction if exists asc desc ' +
    'with returning conflict do nothing truncate grant revoke';
  var SQL_TY = 'int integer bigint smallint tinyint varchar char text boolean bool date timestamp ' +
    'time decimal numeric float double real serial json jsonb uuid blob count sum avg min max';

  var SWIFT_KW = 'func let var if else guard return for in while repeat switch case default break ' +
    'continue class struct enum protocol extension import init deinit self super nil true false ' +
    'try catch throw throws rethrows do defer where as is async await actor some any public private ' +
    'internal fileprivate open static final override mutating lazy weak unowned subscript typealias ' +
    'associatedtype inout indirect';
  var SWIFT_TY = 'Int Double Float String Bool Character Array Dictionary Set Optional Any AnyObject ' +
    'Void Result Error URL Data Date CGFloat';

  var GO_KW = 'package import func var const type struct interface map chan go defer if else for ' +
    'range switch case default break continue fallthrough return select goto';
  var GO_TY = 'string int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 float32 float64 ' +
    'complex64 complex128 byte rune bool error any make len cap new append copy delete panic recover ' +
    'print println nil true false iota';

  var RS_KW = 'fn let mut const static struct enum trait impl for while loop if else match return ' +
    'break continue use mod pub crate super self Self where as in move ref type unsafe async await ' +
    'dyn extern box yield true false None Some Ok Err';
  var RS_TY = 'i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec ' +
    'Option Result Box Rc Arc HashMap HashSet BTreeMap RefCell Cell Mutex Cow Path PathBuf io fmt usize';

  var JV_KW = 'public private protected class interface enum extends implements static final abstract ' +
    'native synchronized transient volatile strictfp void int long short byte char boolean float ' +
    'double if else for while do switch case default break continue return new this super null true ' +
    'false try catch finally throw throws import package instanceof var record sealed permits yield';
  var JV_TY = 'String Integer Long Short Byte Character Boolean Float Double Object List ArrayList ' +
    'Map HashMap Set HashSet Optional Stream Date Exception RuntimeException IOException Thread ' +
    'Runnable System Math';

  var KT_KW = 'fun val var class object interface if else when for while do return break continue try ' +
    'catch finally throw import package is in as null true false this super override open abstract ' +
    'sealed data enum companion init constructor by lazy lateinit suspend inline reified where ' +
    'typealias internal private public protected const';
  var KT_TY = 'Int Long Short Byte Char Boolean Float Double String Any Unit Nothing List MutableList ' +
    'Map MutableMap Set MutableSet Array IntArray Sequence Pair Triple';

  var C_KW = 'auto break case char const continue default do double else enum extern float for goto ' +
    'if inline int long register restrict return short signed sizeof static struct switch typedef ' +
    'union unsigned void volatile while class namespace template typename public private protected ' +
    'virtual override final new delete this nullptr true false using try catch throw constexpr ' +
    'noexcept operator friend explicit mutable static_cast dynamic_cast reinterpret_cast const_cast ' +
    'std';
  var C_TY = 'size_t int8_t uint8_t int16_t uint16_t int32_t uint32_t int64_t uint64_t FILE bool ' +
    'string vector unordered_map pair cout cin cerr endl printf malloc free';

  var LANGS = Object.create(null);

  function register(names, conf) {
    var arr = names.split(' ');
    for (var i = 0; i < arr.length; i++) LANGS[arr[i]] = conf;
  }

  var GENERIC_CONF = {
    sq: 'string', dq: true, lineComment: ['//', '#'], blockComment: [['/*', '*/']],
    keywords: wordSet(''), types: wordSet('')
  };

  var JS_CONF = {
    sq: 'string', dq: true, backtick: true,
    lineComment: ['//'], blockComment: [['/*', '*/']],
    keywords: wordSet(JS_KW), types: wordSet(JS_TY)
  };
  register('js javascript jsx node mjs cjs', JS_CONF);

  var TS_CONF = {
    sq: 'string', dq: true, backtick: true,
    lineComment: ['//'], blockComment: [['/*', '*/']],
    keywords: wordSet(TS_KW), types: wordSet(TS_TY)
  };
  register('ts typescript tsx', TS_CONF);

  var JSON_CONF = {
    sq: 'none', dq: true, keyStrings: true,
    lineComment: [], blockComment: [],
    keywords: wordSet('true false null'), types: wordSet('')
  };
  register('json jsonc', JSON_CONF);

  var PY_CONF = {
    sq: 'string', dq: true, triple: true, multiline: false,
    lineComment: ['#'], blockComment: [],
    keywords: wordSet(PY_KW), types: wordSet(PY_TY), decorator: true
  };
  register('python py python3', PY_CONF);

  var SH_CONF = {
    sq: 'string', dq: true, sqSlash: false, multiline: true, dollarVar: true,
    lineComment: ['#'], hashWordStart: true, blockComment: [],
    keywords: wordSet(SH_KW), types: wordSet(SH_TY)
  };
  register('bash sh shell zsh fish', SH_CONF);

  var HTML_CONF = { markup: true };
  register('html xml svg htm xhtml vue', HTML_CONF);

  var CSS_CONF = {
    sq: 'string', dq: true, keyColon: true,
    lineComment: [], blockComment: [['/*', '*/']],
    keywords: wordSet('media import keyframes supports font-face important from to and not only screen print root var'),
    types: wordSet('px em rem vh vw vmin vmax pt cm mm deg rad ms s')
  };
  register('css scss less sass', CSS_CONF);

  var SQL_CONF = {
    sq: 'string', dq: true, doubled: true, multiline: true, ci: true,
    lineComment: ['--'], blockComment: [['/*', '*/']],
    keywords: wordSet(SQL_KW), types: wordSet(SQL_TY)
  };
  register('sql mysql postgres postgresql sqlite plsql', SQL_CONF);

  var SWIFT_CONF = {
    sq: 'char', dq: true,
    lineComment: ['//'], blockComment: [['/*', '*/']],
    keywords: wordSet(SWIFT_KW), types: wordSet(SWIFT_TY), decorator: true
  };
  register('swift', SWIFT_CONF);

  var GO_CONF = {
    sq: 'char', dq: true, backtick: true,
    lineComment: ['//'], blockComment: [['/*', '*/']],
    keywords: wordSet(GO_KW), types: wordSet(GO_TY)
  };
  register('go golang', GO_CONF);

  var RS_CONF = {
    sq: 'char', dq: true,
    lineComment: ['//'], blockComment: [['/*', '*/']],
    keywords: wordSet(RS_KW), types: wordSet(RS_TY)
  };
  register('rust rs', RS_CONF);

  var JV_CONF = {
    sq: 'char', dq: true,
    lineComment: ['//'], blockComment: [['/*', '*/']],
    keywords: wordSet(JV_KW), types: wordSet(JV_TY), decorator: true
  };
  register('java', JV_CONF);

  var KT_CONF = {
    sq: 'char', dq: true, triple: true,
    lineComment: ['//'], blockComment: [['/*', '*/']],
    keywords: wordSet(KT_KW), types: wordSet(KT_TY), decorator: true
  };
  register('kotlin kt kts', KT_CONF);

  var C_CONF = {
    sq: 'char', dq: true,
    lineComment: ['//'], blockComment: [['/*', '*/']],
    keywords: wordSet(C_KW), types: wordSet(C_TY)
  };
  register('c cpp c++ cc h hpp cxx objc objectivec', C_CONF);

  var YAML_CONF = {
    sq: 'string', dq: true, doubled: true, multiline: true, yamlIdent: true, keyColon: true,
    lineComment: ['#'], hashWordStart: true, blockComment: [],
    keywords: wordSet('true false null yes no on off'), types: wordSet('')
  };
  register('yaml yml toml ini', YAML_CONF);

  var DIFF_CONF = { diff: true };
  register('diff patch', DIFF_CONF);

  register('generic fallback', GENERIC_CONF);

  var NUM_RE = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?[\d_]+)?))(?:[a-zA-Z%]+)?/;
  var ID_RE = /^[A-Za-z_$][A-Za-z0-9_$]*/;
  var YAML_ID_RE = /^[A-Za-z_][A-Za-z0-9_.\-]*/;
  var VAR_RE = /^\$\{[^}\n]*\}|^\$[A-Za-z_][A-Za-z0-9_]*|^\$[0-9@*#?$!-]/;

  function span(cls, text) {
    return '<span class="' + cls + '">' + escapeHtml(text) + '</span>';
  }

  function nextNonSpace(code, i) {
    while (i < code.length) {
      var c = code.charAt(i);
      if (c !== ' ' && c !== '\t') return i;
      i++;
    }
    return -1;
  }

  function scanString(code, start, quote, qlen, opts) {
    var i = start + qlen, n = code.length;
    while (i < n) {
      var c = code.charAt(i);
      if (c === '\\' && opts.slash) { i += 2; continue; }
      if (c === quote.charAt(0) && code.substr(i, qlen) === quote) {
        if (opts.doubled && code.substr(i + qlen, qlen) === quote) { i += qlen * 2; continue; }
        return { end: i + qlen };
      }
      if (!opts.multiline && c === '\n') return { end: i };
      i++;
    }
    return { end: n };
  }

  function readString(code, i, conf) {
    var ch = code.charAt(i);
    if (ch === '`' && conf.backtick) {
      return scanString(code, i, '`', 1, { multiline: true, slash: true });
    }
    if (ch === '"' && conf.dq !== false) {
      if (conf.triple && code.substr(i, 3) === '"""') {
        return scanString(code, i, '"""', 3, { multiline: true, slash: true });
      }
      return scanString(code, i, '"', 1, {
        multiline: !!conf.multiline,
        slash: conf.slash !== false,
        doubled: !!conf.doubled
      });
    }
    if (ch === "'" && conf.sq !== 'none') {
      if (conf.triple && code.substr(i, 3) === "'''") {
        return scanString(code, i, "'''", 3, { multiline: true, slash: true });
      }
      if (conf.sq === 'char') {
        var cm = /^'(?:\\[\s\S]|[^'\\\n]){1,8}'/.exec(code.slice(i, i + 16));
        return cm ? { end: i + cm[0].length } : null;
      }
      return scanString(code, i, "'", 1, {
        multiline: !!conf.multiline,
        slash: conf.sqSlash !== false,
        doubled: !!conf.doubled
      });
    }
    return null;
  }

  function findBlockEnd(code, from, close) {
    var e = code.indexOf(close, from);
    return e < 0 ? code.length : e + close.length;
  }

  function hlGeneric(code, conf) {
    var out = [];
    var i = 0, n = code.length;
    while (i < n) {
      var ch = code.charAt(i);
      if (ch === '\n') { out.push('\n'); i++; continue; }
      if (ch === ' ' || ch === '\t' || ch === '\r') { out.push(ch); i++; continue; }

      var handled = false;

      // Line comments
      if (conf.lineComment) {
        for (var lc = 0; lc < conf.lineComment.length; lc++) {
          var marker = conf.lineComment[lc];
          if (code.substr(i, marker.length) !== marker) continue;
          if (marker === '#' && conf.hashWordStart) {
            var prev = i === 0 ? '\n' : code.charAt(i - 1);
            if (!/[\s;&|()]/.test(prev)) continue;
          }
          var le = code.indexOf('\n', i);
          if (le < 0) le = n;
          out.push(span('tok-com', code.slice(i, le)));
          i = le;
          handled = true;
          break;
        }
        if (handled) continue;
      }

      // Block comments
      if (conf.blockComment) {
        for (var bc = 0; bc < conf.blockComment.length; bc++) {
          var pair = conf.blockComment[bc];
          if (code.substr(i, pair[0].length) !== pair[0]) continue;
          var be = findBlockEnd(code, i + pair[0].length, pair[1]);
          out.push(span('tok-com', code.slice(i, be)));
          i = be;
          handled = true;
          break;
        }
        if (handled) continue;
      }

      // Strings
      var str = readString(code, i, conf);
      if (str) {
        var cls = 'tok-str';
        if (conf.keyStrings) {
          var ns = nextNonSpace(code, str.end);
          if (ns >= 0 && code.charAt(ns) === ':') cls = 'tok-attr';
        }
        out.push(span(cls, code.slice(i, str.end)));
        i = str.end;
        continue;
      }

      // Bash variables / interpolation
      if (conf.dollarVar && ch === '$') {
        var vm = VAR_RE.exec(code.slice(i, i + 200));
        if (vm) {
          out.push(span('tok-var', vm[0]));
          i += vm[0].length;
          continue;
        }
      }

      // Numbers
      if (ch >= '0' && ch <= '9') {
        var nm = NUM_RE.exec(code.slice(i, i + 64));
        if (nm && nm[0]) {
          out.push(span('tok-num', nm[0]));
          i += nm[0].length;
          continue;
        }
      }

      // Identifiers / keywords / types / functions / keys
      if (/[A-Za-z_$]/.test(ch)) {
        var irm = (conf.yamlIdent ? YAML_ID_RE : ID_RE).exec(code.slice(i, i + 128));
        if (irm && irm[0]) {
          var word = irm[0];
          var low = conf.ci ? word.toLowerCase() : word;
          var after = nextNonSpace(code, i + word.length);
          var afterCh = after >= 0 ? code.charAt(after) : '';
          var wcls = '';
          if (conf.keyColon && afterCh === ':') wcls = 'tok-attr';
          else if (conf.keywords && conf.keywords[low]) wcls = 'tok-key';
          else if (conf.types && conf.types[low]) wcls = 'tok-type';
          else if (afterCh === '(') wcls = 'tok-fn';
          else if (conf.decorator && i > 0 && code.charAt(i - 1) === '@') wcls = 'tok-fn';
          if (wcls) out.push(span(wcls, word));
          else out.push(escapeHtml(word));
          i += word.length;
          continue;
        }
      }

      // Operators / punctuation
      if ('()[]{},;.'.indexOf(ch) >= 0) { out.push(span('tok-punc', ch)); i++; continue; }
      if ('+-*/%=<>!&|^~?:@\\'.indexOf(ch) >= 0) { out.push(span('tok-op', ch)); i++; continue; }

      out.push(escapeHtml(ch));
      i++;
    }
    return out.join('');
  }

  function hlMarkup(code) {
    var out = [];
    var i = 0, n = code.length;
    while (i < n) {
      var lt = code.indexOf('<', i);
      if (lt < 0) { out.push(escapeHtml(code.slice(i))); break; }
      if (lt > i) out.push(escapeHtml(code.slice(i, lt)));
      i = lt;

      if (code.substr(i, 4) === '<!--') {
        var ce = code.indexOf('-->', i + 4);
        ce = ce < 0 ? n : ce + 3;
        out.push(span('tok-com', code.slice(i, ce)));
        i = ce;
        continue;
      }
      if (code.substr(i, 2) === '<!') {
        var de = code.indexOf('>', i);
        de = de < 0 ? n : de + 1;
        out.push(span('tok-tag', code.slice(i, de)));
        i = de;
        continue;
      }
      var tm = /^<\/?[A-Za-z][A-Za-z0-9:._-]*/.exec(code.slice(i, i + 128));
      if (!tm) { out.push('&lt;'); i++; continue; }

      var tagStart = i;
      i += tm[0].length;
      out.push('<span class="tok-tag">' + escapeHtml(code.slice(tagStart, i)) + '</span>');

      while (i < n) {
        var ch = code.charAt(i);
        if (ch === '>') { out.push('<span class="tok-tag">&gt;</span>'); i++; break; }
        if (ch === '/' && code.charAt(i + 1) === '>') {
          out.push('<span class="tok-tag">/&gt;</span>'); i += 2; break;
        }
        if (ch === '\n' || ch === ' ' || ch === '\t' || ch === '\r') { out.push(ch); i++; continue; }
        if (ch === '"' || ch === "'") {
          var q = ch, j = i + 1;
          while (j < n) {
            if (code.charAt(j) === '\\') { j += 2; continue; }
            if (code.charAt(j) === q) { j++; break; }
            j++;
          }
          if (j > n) j = n;
          out.push(span('tok-str', code.slice(i, j)));
          i = j;
          continue;
        }
        if (ch === '=') { out.push(span('tok-op', '=')); i++; continue; }
        var am = /^[^\s=>\/]+/.exec(code.slice(i, i + 128));
        if (am && am[0]) {
          out.push(span('tok-attr', am[0]));
          i += am[0].length;
          continue;
        }
        out.push(escapeHtml(ch));
        i++;
      }
    }
    return out.join('');
  }

  function hlDiff(code) {
    var lines = code.split('\n');
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var cls = '';
      if (/^\+\+\+|^---|^diff |^index /.test(line)) cls = 'tok-key';
      else if (/^@@/.test(line)) cls = 'tok-attr';
      else if (/^\+/.test(line)) cls = 'tok-str';
      else if (/^-/.test(line)) cls = 'tok-com';
      out.push(cls ? span(cls, line) : escapeHtml(line));
    }
    return out.join('\n');
  }

  function highlight(code, lang) {
    code = String(code == null ? '' : code);
    var key = String(lang == null ? '' : lang).toLowerCase().trim().split(/\s+/)[0];
    if (!key) return escapeHtml(code);
    var conf = LANGS[key];
    if (!conf) return escapeHtml(code);
    if (conf.diff) return hlDiff(code);
    if (conf.markup) return hlMarkup(code);
    return hlGeneric(code, conf);
  }

  /* ------------------------------------------------------------------ *
   * Block parser
   * ------------------------------------------------------------------ */

  function isBlank(line) {
    return !line || !/[^ \t]/.test(line);
  }

  function visualIndent(str) {
    var col = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charAt(i);
      if (c === ' ') col++;
      else if (c === '\t') col += 4;
      else break;
    }
    return col;
  }

  function stripIndent(line, count) {
    var i = 0, col = 0;
    while (i < line.length && col < count) {
      var c = line.charAt(i);
      if (c === ' ') { col++; i++; }
      else if (c === '\t') { col += 4; i++; }
      else break;
    }
    return line.slice(i);
  }

  function matchFence(line) {
    var m = /^( {0,3})(`{3,}|~{3,})[ \t]*(.*)$/.exec(line);
    if (!m) return null;
    var fence = m[2];
    var info = m[3] || '';
    if (fence.charAt(0) === '`' && info.indexOf('`') >= 0) return null;
    return { indent: m[1].length, char: fence.charAt(0), len: fence.length, info: info };
  }

  function isFenceClose(line, char, len) {
    var m = /^( {0,3})(`{3,}|~{3,})[ \t]*$/.exec(line);
    return !!m && m[2].charAt(0) === char && m[2].length >= len;
  }

  function matchHeading(line) {
    var m = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
    if (!m) return null;
    var text = m[2] || '';
    text = text.replace(/[ \t]+#+[ \t]*$/, '').trim();
    return { level: m[1].length, text: text };
  }

  function isHr(line) {
    return /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line);
  }

  function matchMarker(line) {
    var m = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/.exec(line);
    if (!m) return null;
    var indent = visualIndent(m[1]);
    var marker = m[2];
    var spaces = visualIndent(m[3]);
    return {
      indent: indent,
      ordered: /\d/.test(marker),
      marker: marker,
      content: m[4],
      contentIndent: indent + marker.length + Math.min(Math.max(spaces, 1), 4)
    };
  }

  function isDelimRow(line) {
    var s = line.trim();
    if (!s || s.indexOf('-') < 0) return false;
    if (!/^[ \t|:-]+$/.test(s)) return false;
    return /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/.test(s);
  }

  function isTableStart(lines, i) {
    var head = lines[i], delim = lines[i + 1];
    if (head == null || delim == null) return false;
    if (head.indexOf('|') < 0) return false;
    return isDelimRow(delim);
  }

  function splitRow(line) {
    var s = line.trim();
    if (s.charAt(0) === '|') s = s.slice(1);
    if (s.charAt(s.length - 1) === '|' && !isEscaped(s, s.length - 1)) s = s.slice(0, -1);
    var cells = [], cur = '', inCode = 0, i;
    for (i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '\\' && s.charAt(i + 1) === '|') { cur += '|'; i++; continue; }
      if (c === '`') {
        var run = countRun(s, i, '`');
        if (inCode === 0) inCode = run;
        else if (inCode === run) inCode = 0;
        cur += s.substr(i, run);
        i += run - 1;
        continue;
      }
      if (c === '|' && inCode === 0) { cells.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    cells.push(cur.trim());
    return cells;
  }

  function unwrapFirstParagraph(html) {
    if (html.slice(0, 3) !== '<p>') return html;
    var end = html.indexOf('</p>');
    if (end < 0) return html;
    var rest = html.slice(end + 4);
    return html.slice(3, end) + (rest ? '\n' + rest.replace(/^\n+/, '') : '');
  }

  function startsBlock(lines, j) {
    var line = lines[j];
    if (isBlank(line)) return true;
    if (matchFence(line)) return true;
    if (matchHeading(line)) return true;
    if (isHr(line)) return true;
    if (/^ {0,3}>/.test(line)) return true;
    var lm = matchMarker(line);
    if (lm && lm.indent <= 3) return true;
    if (isTableStart(lines, j)) return true;
    return false;
  }

  function parseParagraph(lines, start) {
    var buf = [];
    var i = start, n = lines.length;
    while (i < n) {
      var line = lines[i];
      if (isBlank(line)) break;
      if (buf.length && startsBlock(lines, i)) break;
      buf.push(line);
      i++;
    }
    return { text: buf.join('\n'), next: i };
  }

  function parseIndentedCode(lines, start) {
    var buf = [];
    var i = start, n = lines.length;
    while (i < n) {
      var line = lines[i];
      if (isBlank(line)) { buf.push(''); i++; continue; }
      if (!/^(?: {4}|\t)/.test(line)) break;
      buf.push(stripIndent(line, 4));
      i++;
    }
    while (buf.length && buf[buf.length - 1] === '') buf.pop();
    return { html: '<pre><code>' + escapeHtml(buf.join('\n')) + '</code></pre>', next: i };
  }

  function parseFence(lines, start, fence) {
    var i = start + 1, n = lines.length, end = -1;
    while (i < n) {
      if (isFenceClose(lines[i], fence.char, fence.len)) { end = i; break; }
      i++;
    }
    var stop = end < 0 ? n : end;
    var buf = [];
    for (var j = start + 1; j < stop; j++) buf.push(stripIndent(lines[j], fence.indent));
    var code = buf.join('\n');
    var lang = (fence.info || '').trim().split(/\s+/)[0] || '';
    var normLang = lang.toLowerCase().replace(/[^a-z0-9_+#.\-]/g, '');
    var codeHtml = highlight(code, lang);
    var head = '<div class="codeblock__head"><span class="codeblock__lang">' + escapeHtml(lang || 'text') +
      '</span><button class="codeblock__copy" type="button" aria-label="Copy code">Copy</button></div>';
    var html = '<div class="codeblock">' + head + '<pre><code' +
      (normLang ? ' class="language-' + normLang + '"' : '') + '>' + codeHtml + '</code></pre></div>';
    return { html: html, next: end < 0 ? n : end + 1 };
  }

  function parseQuote(lines, start, depth) {
    var buf = [];
    var i = start, n = lines.length;
    while (i < n) {
      var line = lines[i];
      var m = /^ {0,3}>[ \t]?(.*)$/.exec(line);
      if (m) { buf.push(m[1]); i++; continue; }
      if (isBlank(line)) {
        if (i + 1 < n && /^ {0,3}>/.test(lines[i + 1])) { buf.push(''); i++; continue; }
        break;
      }
      // Lazy continuation line belongs to the quote.
      buf.push(line);
      i++;
    }
    return { html: '<blockquote>\n' + parseBlocks(buf, depth + 1) + '\n</blockquote>', next: i };
  }

  function parseList(lines, start, indent, ordered, depth) {
    var items = [];
    var loose = false;
    var i = start, n = lines.length;

    while (i < n) {
      var lm = matchMarker(lines[i]);
      if (!lm || lm.indent !== indent || lm.ordered !== ordered) break;
      var contentIndent = lm.contentIndent;
      var itemLines = [lm.content];
      i++;

      while (i < n) {
        var line = lines[i];
        if (isBlank(line)) {
          var j = i;
          while (j < n && isBlank(lines[j])) j++;
          if (j >= n) { i = j; break; }
          var nm = matchMarker(lines[j]);
          var nind = visualIndent(lines[j]);
          if (nm && nm.indent === indent && nm.ordered === ordered) {
            loose = true;
            i = j;
            break;
          }
          if ((nm && nm.indent > indent) || nind >= contentIndent) {
            itemLines.push('');
            loose = true;
            i = j;
            continue;
          }
          break;
        }
        var cm = matchMarker(line);
        if (cm && cm.indent <= indent) break;
        var ind = visualIndent(line);
        if (ind < contentIndent && !(cm && cm.indent > indent)) break;
        itemLines.push(stripIndent(line, Math.min(contentIndent, ind)));
        i++;
      }

      items.push(itemLines);

      if (i < n) {
        var nextM = matchMarker(lines[i]);
        if (!(nextM && nextM.indent === indent && nextM.ordered === ordered)) break;
      }
    }

    var firstM = matchMarker(lines[start]);
    var startNum = ordered ? parseInt(firstM.marker, 10) : 1;
    var tag = ordered ? 'ol' : 'ul';
    var open = '<' + tag + (ordered && startNum !== 1 ? ' start="' + startNum + '"' : '') + '>';
    var out = [open];

    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      var task = /^\[([ xX])\][ \t]+([\s\S]*)$/.exec(it[0] || '');
      var checked = false;
      if (task) {
        checked = task[1].toLowerCase() === 'x';
        it[0] = task[2];
      }
      var html = parseBlocks(it, depth + 1);
      if (!loose) html = unwrapFirstParagraph(html);
      var box = task ? '<input type="checkbox" disabled' + (checked ? ' checked' : '') + '> ' : '';
      out.push('<li' + (task ? ' class="task"' : '') + '>' + box + html + '</li>');
    }

    out.push('</' + tag + '>');
    return { html: out.join('\n'), next: i };
  }

  function parseTable(lines, start) {
    var header = splitRow(lines[start]);
    var delim = splitRow(lines[start + 1]);
    var cols = Math.max(header.length, delim.length);
    var aligns = [], c;
    for (c = 0; c < cols; c++) {
      var d = (delim[c] || '').trim();
      var a = '';
      if (/^:-+:$/.test(d)) a = 'center';
      else if (/^-+:$/.test(d)) a = 'right';
      else if (/^:-+$/.test(d)) a = 'left';
      aligns.push(a);
    }
    var i = start + 2, rows = [];
    while (i < lines.length) {
      var line = lines[i];
      if (isBlank(line)) break;
      if (line.indexOf('|') < 0) break;
      rows.push(splitRow(line));
      i++;
    }

    var out = ['<div class="table-wrap"><table>', '<thead>', '<tr>'];
    for (c = 0; c < cols; c++) {
      out.push('<th' + (aligns[c] ? ' style="text-align:' + aligns[c] + '"' : '') + '>' +
        inline(header[c] || '') + '</th>');
    }
    out.push('</tr>', '</thead>');
    if (rows.length) {
      out.push('<tbody>');
      for (var r = 0; r < rows.length; r++) {
        out.push('<tr>');
        for (c = 0; c < cols; c++) {
          out.push('<td' + (aligns[c] ? ' style="text-align:' + aligns[c] + '"' : '') + '>' +
            inline(rows[r][c] || '') + '</td>');
        }
        out.push('</tr>');
      }
      out.push('</tbody>');
    }
    out.push('</table></div>');
    return { html: out.join('\n'), next: i };
  }

  function parseBlocks(lines, depth) {
    depth = depth || 0;
    if (depth > 30) {
      // Defensive guard against pathological nesting in streamed input.
      return '<p>' + inline(lines.join('\n'), depth + 1) + '</p>';
    }
    var out = [];
    var i = 0, n = lines.length;
    while (i < n) {
      var line = lines[i];
      if (isBlank(line)) { i++; continue; }

      var fence = matchFence(line);
      if (fence) {
        var fb = parseFence(lines, i, fence);
        out.push(fb.html);
        i = fb.next;
        continue;
      }

      var h = matchHeading(line);
      if (h) {
        out.push('<h' + h.level + '>' + inline(h.text) + '</h' + h.level + '>');
        i++;
        continue;
      }

      if (isHr(line)) { out.push('<hr>'); i++; continue; }

      if (/^ {0,3}>/.test(line)) {
        var q = parseQuote(lines, i, depth);
        out.push(q.html);
        i = q.next;
        continue;
      }

      if (isTableStart(lines, i)) {
        var t = parseTable(lines, i);
        out.push(t.html);
        i = t.next;
        continue;
      }

      if (/^(?: {4}|\t)/.test(line)) {
        var ic = parseIndentedCode(lines, i);
        out.push(ic.html);
        i = ic.next;
        continue;
      }

      var lm = matchMarker(line);
      if (lm) {
        var lb = parseList(lines, i, lm.indent, lm.ordered, depth);
        out.push(lb.html);
        i = lb.next;
        continue;
      }

      var p = parseParagraph(lines, i);
      out.push('<p>' + inline(p.text) + '</p>');
      i = p.next;
    }
    return out.join('\n');
  }

  /* ------------------------------------------------------------------ *
   * Public render
   * ------------------------------------------------------------------ */

  function render(markdown) {
    var src = String(markdown == null ? '' : markdown)
      .replace(/\r\n?/g, '\n')
      .replace(/\u0000/g, '');
    if (!src) return '';
    return parseBlocks(src.split('\n'));
  }

  global.MD = { render: render, highlight: highlight, escapeHtml: escapeHtml };

})(typeof globalThis !== 'undefined' ? globalThis : this);
