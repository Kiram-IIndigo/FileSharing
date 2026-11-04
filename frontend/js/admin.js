(() => {
  const $ = id => document.getElementById(id);
  const show = (el, on = true) => $(el).classList.toggle('hidden', !on);
  const say = (el, msg) => { $(el).textContent = msg || ''; show(el, !!msg); };
  const shareUrl = token => `${location.origin}/a/${token}`;

  let album = null; // album currently open

  // ---------- auth ----------
  function showLogin() { show('v-app', false); show('v-login'); $('password').focus(); }
  function showApp() { show('v-login', false); show('v-app'); route(); }

  async function boot() {
    try { await api.me(); showApp(); } catch (_) { showLogin(); }
  }

  // Any 401 from an admin call means the session ended.
  function guard(e) {
    if (e.status === 401) { showLogin(); return true; }
    return false;
  }

  $('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    say('login-error', '');
    try {
      await api.login($('password').value);
      $('password').value = '';
      showApp();
    } catch (err) {
      say('login-error', err.message);
    }
  });

  $('btn-logout').addEventListener('click', async () => {
    await api.logout().catch(() => {});
    location.hash = '';
    showLogin();
  });

  // ---------- routing ----------
  function route() {
    const m = location.hash.match(/^#\/album\/(\d+)$/);
    if (m) openAlbum(Number(m[1])); else openList();
  }
  window.addEventListener('hashchange', () => { if (!$('v-app').classList.contains('hidden')) route(); });

  // ---------- list ----------
  async function openList() {
    show('v-album', false); show('v-list');
    say('list-error', '');
    try {
      const list = await api.albums();
      const box = $('cards');
      box.innerHTML = '';
      list.forEach(a => {
        const card = document.createElement('a');
        card.className = 'card';
        card.href = `#/album/${a.id}`;
        const img = document.createElement('img');
        img.alt = '';
        if (a.cover_id) img.src = api.thumb(a.token, a.cover_id);
        const h = document.createElement('h3'); h.textContent = a.title;
        const p = document.createElement('p'); p.textContent = `${a.photo_count} ${a.photo_count === 1 ? 'item' : 'items'}`;
        card.append(img, h, p);
        box.appendChild(card);
      });
      show('list-empty', list.length === 0);
    } catch (err) {
      if (!guard(err)) say('list-error', err.message);
    }
  }

  $('btn-new').addEventListener('click', () => { show('new-form', $('new-form').classList.contains('hidden')); $('new-title').focus(); });
  $('new-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const a = await api.createAlbum($('new-title').value);
      $('new-title').value = '';
      show('new-form', false);
      location.hash = `#/album/${a.id}`;
    } catch (err) {
      if (!guard(err)) say('list-error', err.message);
    }
  });

  // ---------- album ----------
  async function openAlbum(id) {
    show('v-list', false); show('v-album');
    say('a-error', ''); show('a-progress', false);
    try {
      album = await api.album(id);
    } catch (err) {
      if (guard(err)) return;
      location.hash = '';
      return;
    }
    $('a-title').textContent = album.title;
    $('a-link').value = shareUrl(album.token);
    renderPhotos();
  }

  function renderPhotos() {
    const box = $('a-photos');
    box.innerHTML = '';
    const photos = album.photos || [];
    show('a-hint', photos.length > 1);
    photos.forEach(p => {
      const t = document.createElement('div');
      t.className = 'ph';
      t.draggable = true;
      t.dataset.id = p.id;
      const img = document.createElement('img');
      img.loading = 'lazy'; img.alt = ''; img.draggable = false;
      img.src = api.thumb(album.token, p.id);
      img.title = p.filename;
      const del = document.createElement('button');
      del.className = 'ph-del'; del.title = 'Delete photo'; del.innerHTML = '&times;';
      del.addEventListener('click', async () => {
        if (!confirm(`Delete ${p.filename}?`)) return;
        try { await api.deletePhoto(p.id); t.remove(); album.photos = album.photos.filter(x => x.id !== p.id); }
        catch (err) { if (!guard(err)) say('a-error', err.message); }
      });
      t.append(img, del);
      box.appendChild(t);
    });
  }

  // drag to reorder
  let dragEl = null;
  const photosBox = $('a-photos');
  photosBox.addEventListener('dragstart', e => { dragEl = e.target.closest('.ph'); if (dragEl) { dragEl.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; } });
  photosBox.addEventListener('dragover', e => {
    if (!dragEl) return;
    e.preventDefault();
    const over = e.target.closest('.ph');
    if (!over || over === dragEl) return;
    const r = over.getBoundingClientRect();
    const after = (e.clientX - r.left) > r.width / 2;
    photosBox.insertBefore(dragEl, after ? over.nextSibling : over);
  });
  photosBox.addEventListener('dragend', async () => {
    if (!dragEl) return;
    dragEl.classList.remove('dragging'); dragEl = null;
    const ids = [...photosBox.children].map(c => Number(c.dataset.id));
    try { await api.reorder(album.id, ids); }
    catch (err) { if (!guard(err)) say('a-error', err.message); }
  });

  // upload
  async function upload(fileList) {
    const files = [...fileList].filter(f => /^image\/(png|jpeg)$/.test(f.type));
    if (!files.length) { say('a-error', 'Only PNG and JPEG files can be uploaded.'); return; }
    say('a-error', '');
    show('a-progress'); $('a-bar').style.width = '0%';
    try {
      await api.upload(album.id, files, f => { $('a-bar').style.width = Math.round(f * 100) + '%'; });
    } catch (err) {
      if (!guard(err)) say('a-error', err.message);
    }
    show('a-progress', false);
    $('a-files').value = '';
    openAlbum(album.id); // reload to show what was saved
  }

  const drop = $('a-drop');
  drop.addEventListener('click', () => $('a-files').click());
  $('a-add').addEventListener('click', () => $('a-files').click());
  $('a-files').addEventListener('change', e => upload(e.target.files));
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => upload(e.dataTransfer.files));

  // album actions
  $('a-rename').addEventListener('click', async () => {
    const t = prompt('New title', album.title);
    if (t === null || !t.trim()) return;
    try { await api.renameAlbum(album.id, t.trim()); album.title = t.trim(); $('a-title').textContent = album.title; }
    catch (err) { if (!guard(err)) say('a-error', err.message); }
  });
  $('a-delete').addEventListener('click', async () => {
    if (!confirm(`Delete "${album.title}" and all its photos? This cannot be undone.`)) return;
    try { await api.deleteAlbum(album.id); location.hash = ''; }
    catch (err) { if (!guard(err)) say('a-error', err.message); }
  });
  $('a-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('a-link').value); $('a-copy').textContent = 'Copied'; }
    catch (_) { $('a-link').select(); }
    setTimeout(() => { $('a-copy').textContent = 'Copy'; }, 1500);
  });
  $('a-newlink').addEventListener('click', async () => {
    if (!confirm('Create a new link? The old link stops working immediately.')) return;
    try {
      const r = await api.newLink(album.id);
      album.token = r.token;
      $('a-link').value = shareUrl(r.token);
      renderPhotos();
    } catch (err) { if (!guard(err)) say('a-error', err.message); }
  });

  boot();
})();
