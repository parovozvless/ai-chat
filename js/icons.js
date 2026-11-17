/* Stroke icon set, 24x24 grid. Icons.render(name, size) -> svg string */
(function (global) {
  'use strict';

  const P = {
    'menu': '<path d="M4 7h16M4 12h16M4 17h16"/>',
    'plus': '<path d="M12 5v14M5 12h14"/>',
    'edit': '<path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3Z"/><path d="M13.5 6.5l4 4"/>',
    'search': '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    'close': '<path d="M6 6l12 12M18 6 6 18"/>',
    'panel-left': '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M9.5 4.5v15"/>',
    'chevron-up-down': '<path d="M8 9l4-4 4 4M8 15l4 4 4-4"/>',
    'expand-more': '<path d="M6 9.5 12 15l6-5.5"/>',
    'chevron-right': '<path d="M9.5 6 15 12l-5.5 6"/>',
    'chevron-left': '<path d="M14.5 6 9 12l5.5 6"/>',
    'bolt': '<path d="M13.2 3 6.3 12.2c-.5.7 0 1.6.8 1.6h3.6l-1 5.8c-.1.8.9 1.3 1.5.6l6.9-9.3c.4-.7 0-1.5-.8-1.5h-3.7l1-5.7c.1-.8-.9-1.3-1.4-.7Z"/>',
    'tune': '<path d="M4 7h6M14 7h6M4 17h10M18 17h2"/><circle cx="12" cy="7" r="2.2"/><circle cx="16" cy="17" r="2.2"/>',
    'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"/>',
    'moon': '<path d="M20 13.5A8 8 0 0 1 10.5 4 8.2 8.2 0 1 0 20 13.5Z"/>',
    'monitor': '<rect x="3" y="4.5" width="18" height="12" rx="2.5"/><path d="M9 20h6M12 16.5V20"/>',
    'command': '<path d="M8.5 8.5h7v7h-7z"/><path d="M8.5 8.5a2 2 0 1 0-2-2 2 2 0 0 0 2 2ZM15.5 8.5a2 2 0 1 1 2-2 2 2 0 0 1-2 2ZM8.5 15.5a2 2 0 1 0-2 2 2 2 0 0 0 2-2ZM15.5 15.5a2 2 0 1 1 2 2 2 2 0 0 1-2-2Z"/>',
    'download': '<path d="M12 3v11M8 10.5l4 4 4-4"/><path d="M4 16.5v1A3.5 3.5 0 0 0 7.5 21h9a3.5 3.5 0 0 0 3.5-3.5v-1"/>',
    'upload': '<path d="M12 15V4M8 7.5l4-4 4 4"/><path d="M4 16.5v1A3.5 3.5 0 0 0 7.5 21h9a3.5 3.5 0 0 0 3.5-3.5v-1"/>',
    'arrow-up': '<path d="M12 19.5V4.5M5.5 11 12 4.5l6.5 6.5"/>',
    'arrow-down': '<path d="M12 4.5v15M5.5 13l6.5 6.5 6.5-6.5"/>',
    'arrow-right': '<path d="M4.5 12h15M13 5.5l6.5 6.5-6.5 6.5"/>',
    'stop': '<rect x="7" y="7" width="10" height="10" rx="2.6"/>',
    'copy': '<rect x="8.5" y="8.5" width="11" height="11" rx="2.6"/><path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
    'refresh': '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 3.5V8h-4.5"/>',
    'trash': '<path d="M4.5 7h15M9.5 7V5.2A1.7 1.7 0 0 1 11.2 3.5h1.6a1.7 1.7 0 0 1 1.7 1.7V7"/><path d="M6.5 7l.8 12.1a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9L17.5 7"/><path d="M10 11v6M14 11v6"/>',
    'pencil': '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z"/>',
    'more': '<circle cx="12" cy="5.5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="18.5" r="1.4" fill="currentColor"/>',
    'check': '<path d="M4.5 12.5 9.5 17.5 20 6.5"/>',
    'star': '<path d="m12 3.6 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 17l-5.3 2.8 1.1-5.9L3.5 9.8l5.9-.8L12 3.6Z"/>',
    'sparkles': '<path d="M12 3.5 13.8 9l5.5 1.8-5.5 1.8L12 18l-1.8-5.4L4.7 10.8 10.2 9 12 3.5Z"/><path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" fill="currentColor" stroke="none"/>',
    'kitchen': '<path d="M12 3.5 13.8 9l5.5 1.8-5.5 1.8L12 18l-1.8-5.4L4.7 10.8 10.2 9 12 3.5Z"/>',
    'image': '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m4.5 17 4.8-4.5a2 2 0 0 1 2.7 0l6.5 6"/>',
    'file': '<path d="M13 3.5H8A2.5 2.5 0 0 0 5.5 6v12A2.5 2.5 0 0 0 8 20.5h8a2.5 2.5 0 0 0 2.5-2.5V9L13 3.5Z"/><path d="M13 3.5V9h5.5"/>',
    'key': '<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H21M17.5 12v3M20.5 12v2"/>',
    'info': '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.7v.1"/>',
    'alert': '<path d="M12 3.8 21 20H3L12 3.8Z"/><path d="M12 9.5v4.5M12 17.2v.1"/>',
    'keyboard': '<rect x="2.5" y="6" width="19" height="12" rx="3"/><path d="M6.5 10h.1M10 10h.1M13.5 10h.1M17 10h.1M8 14h8"/>',
    'globe': '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.2 2.3 3.4 5.2 3.4 8.5S14.2 18.2 12 20.5c-2.2-2.3-3.4-5.2-3.4-8.5S9.8 5.8 12 3.5Z"/>',
    'zap-off': '<path d="M4 4l16 16"/><path d="M12.6 3.5 10 8.3M13.7 13.2l-3.4 7.1c-.3.7-1.4.6-1.6-.2l-.9-5.5H5.6c-.8 0-1.2-1-.6-1.5l2-2"/>',
    'clipboard': '<rect x="6" y="5" width="12" height="15.5" rx="2.5"/><path d="M9.5 5V4a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 4v1"/>',
    'pin': '<path d="M9 3.5h6l-.7 5.2 3 3.1c.5.5.1 1.2-.6 1.2H13v6l-1 2.5-1-2.5v-6H7.3c-.7 0-1.1-.7-.6-1.2l3-3.1L9 3.5Z"/>',
    'archive': '<rect x="3.5" y="4.5" width="17" height="5" rx="2"/><path d="M5 9.5v8.5a2.5 2.5 0 0 0 2.5 2.5h9a2.5 2.5 0 0 0 2.5-2.5V9.5M10 13h4"/>',
    'external': '<path d="M14 4.5h5.5V10M19 5l-8 8"/><path d="M18 14v4.5a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2H10"/>',
    'sliders': '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h9M17 18h3"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="18" r="2"/>',
    'server': '<rect x="3.5" y="4" width="17" height="7" rx="2.5"/><rect x="3.5" y="13" width="17" height="7" rx="2.5"/><path d="M7 7.5h.1M7 16.5h.1"/>',
    'cpu': '<rect x="6.5" y="6.5" width="11" height="11" rx="3"/><path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21"/>',
    'message': '<path d="M20.5 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-4.5 2.5V11.5a7.5 7.5 0 0 1 7.5-7.5h2a7.5 7.5 0 0 1 7.5 7.5Z"/>',
    'book': '<path d="M4 4.5h6a3 3 0 0 1 3 3V20a2.4 2.4 0 0 0-2.4-2.4H4V4.5ZM20 4.5h-2.5a4.5 4.5 0 0 0-4.5 4.5V20a2.4 2.4 0 0 1 2.4-2.4H20V4.5Z"/>',
    'inbox': '<path d="M3.5 13.5h4l1.5 3h6l1.5-3h4"/><path d="M5.7 5.2 3.5 13.5v4A2.5 2.5 0 0 0 6 20h12a2.5 2.5 0 0 0 2.5-2.5v-4l-2.2-8.3A2.5 2.5 0 0 0 15.9 3.5H8.1a2.5 2.5 0 0 0-2.4 1.7Z"/>',
    'clock': '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    'palette': '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2.1-.8 2.1-1.9 0-.6-.3-1-.6-1.4-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h1.6c1.9 0 3.4-1.5 3.4-3.4 0-3.9-3.6-7-8-7Z"/><circle cx="7.6" cy="10.4" r="1.15" fill="currentColor" stroke="none"/><circle cx="11" cy="7.4" r="1.15" fill="currentColor" stroke="none"/><circle cx="15.2" cy="8.4" r="1.15" fill="currentColor" stroke="none"/><circle cx="7.8" cy="15" r="1.15" fill="currentColor" stroke="none"/>',
    'code': '<path d="M8.7 8.2 4.4 12l4.3 3.8M15.3 8.2 19.6 12l-4.3 3.8M13.7 5.4 10.3 18.6"/>',
    'shield': '<path d="M12 3.5 5 6v6c0 4.2 3 7.6 7 8.5 4-.9 7-4.3 7-8.5V6l-7-2.5Z"/><path d="m9 12 2.2 2.2L15.4 10"/>',
  };

  function render(name, size) {
    const body = P[name] || P['sparkles'];
    const s = size || 24;
    return `<svg class="icon" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  /* Replace every [data-icon] placeholder in a root with its svg. */
  function hydrate(root) {
    (root || document).querySelectorAll('[data-icon]').forEach((el) => {
      const name = el.getAttribute('data-icon');
      if (el.firstElementChild && el.firstElementChild.classList.contains('icon')) return;
      el.innerHTML = render(name);
    });
  }

  global.Icons = { render, hydrate, map: P };
})(typeof globalThis !== 'undefined' ? globalThis : this);
