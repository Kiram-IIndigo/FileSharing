// Small shadcn-style UI helpers for the admin dashboard: icons, dialog, toasts, theme.
const ui = (() => {
  // Lucide icons (ISC license), inner SVG markup only.
  const paths = {
    images: '<path d="M18 22H4a2 2 0 0 1-2-2V6"/><path d="m22 13-1.296-1.296a2.41 2.41 0 0 0-3.408 0L11 18"/><circle cx="12" cy="8" r="2"/><rect width="16" height="16" x="6" y="2" rx="2"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
    pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    'external-link': '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3"/>',
    'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    alert: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>'
  };

  const icon = name =>
    `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ''}</svg>`;

  // Replace every <i data-icon="name"> inside root with the SVG.
  function icons(root = document) {
    root.querySelectorAll('i[data-icon]').forEach(i => { i.outerHTML = icon(i.dataset.icon); });
  }

  // ---------- dialog ----------
  // dialog({title, desc, ok, danger, input: {label, value}}) -> Promise<true | string | null>
  // Resolves the input value (or true) on OK, null on cancel / Esc / backdrop click.
  const $ = id => document.getElementById(id);
  let resolveDialog = null;

  function dialog({ title, desc = '', ok = 'Continue', danger = false, input = null }) {
    $('dialog-title').textContent = title;
    $('dialog-desc').textContent = desc;
    $('dialog-desc').classList.toggle('hidden', !desc);
    $('dialog-ok').textContent = ok;
    $('dialog-ok').className = 'btn ' + (danger ? 'btn-destructive' : 'btn-primary');
    $('dialog-field').classList.toggle('hidden', !input);
    $('dialog-input').required = !!input;
    if (input) {
      $('dialog-label').textContent = input.label;
      $('dialog-input').value = input.value || '';
    }
    $('dialog').showModal();
    if (input) { $('dialog-input').focus(); $('dialog-input').select(); }
    return new Promise(res => { resolveDialog = res; });
  }

  function closeDialog(value) {
    if (!resolveDialog) return;
    const r = resolveDialog; resolveDialog = null;
    $('dialog').close();
    r(value);
  }

  function initDialog() {
    $('dialog-form').addEventListener('submit', e => {
      e.preventDefault();
      const field = !$('dialog-field').classList.contains('hidden');
      const v = $('dialog-input').value.trim();
      if (field && !v) return;
      closeDialog(field ? v : true);
    });
    $('dialog-cancel').addEventListener('click', () => closeDialog(null));
    $('dialog').addEventListener('cancel', e => { e.preventDefault(); closeDialog(null); }); // Esc
    $('dialog').addEventListener('click', e => { if (e.target === $('dialog')) closeDialog(null); }); // backdrop
  }

  // ---------- toasts ----------
  function toast(msg, type = 'success') {
    const t = document.createElement('div');
    t.className = 'toast' + (type === 'error' ? ' error' : '');
    t.setAttribute('role', type === 'error' ? 'alert' : 'status');
    t.innerHTML = icon(type === 'error' ? 'alert' : 'check');
    const span = document.createElement('span');
    span.textContent = msg;
    t.appendChild(span);
    $('toasts').appendChild(t);
    setTimeout(() => {
      t.classList.add('leaving');
      setTimeout(() => t.remove(), 200);
    }, type === 'error' ? 6000 : 3000);
  }

  // ---------- theme ----------
  // The <head> script already set data-theme. The button saves an explicit choice.
  function initTheme() {
    const btn = $('btn-theme');
    const paint = () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      btn.innerHTML = icon(dark ? 'sun' : 'moon') + `<span>${dark ? 'Light mode' : 'Dark mode'}</span>`;
    };
    btn.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch (_) {}
      paint();
    });
    // Follow OS changes until the user picks a theme.
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      let saved = null;
      try { saved = localStorage.getItem('theme'); } catch (_) {}
      if (saved) return;
      document.documentElement.dataset.theme = e.matches ? 'dark' : 'light';
      paint();
    });
    paint();
  }

  document.addEventListener('DOMContentLoaded', () => { icons(); initDialog(); initTheme(); });

  return { icon, icons, dialog, toast };
})();
