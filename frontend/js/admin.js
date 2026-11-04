(() => {
  const $ = id => document.getElementById(id);
  const show = (el, on = true) => $(el).classList.toggle('hidden', !on);
  const shareUrl = token => `${location.origin}/a/${token}`;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  let album = null; // album currently open

  // ---------- auth ----------
  function showLogin() { show('v-app', false); show('v-login'); $('password').focus(); }
  function showApp() { show('v-login', false); show('v-app'); route(); }

  async function boot() {
    try { await api.me(); showApp(); } catch (_) { showLogin(); }
  }

  // Any 401 from an admin call means the session ended; other errors become a toast.
  function fail(err) {
    if (err.status === 401) { showLogin(); return; }
    ui.toast(err.message, 'error');
  }

  $('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    show('login-error', false);
    const btn = e.submitter; btn.disabled = true;
    try {
      await api.login($('password').value);
      $('password').value = '';
      showApp();
    } catch (err) {
      $('login-error').textContent = err.message;
      show('login-error');
    }
    btn.disabled = false;
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
    let list;
    try { list = await api.albums(); } catch (err) { fail(err); return; }

    const box = $('cards');
    box.innerHTML = '';
    list.forEach(a => {
      const card = document.createElement('a');
      card.className = 'card album-card';
      card.href = `#/album/${a.id}`;

      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      if (a.cover_id) {
        const img = document.createElement('img');
        img.alt = ''; img.loading = 'lazy';
        img.src = api.thumb(a.token, a.cover_id);
        thumb.appendChild(img);
      } else {
        thumb.innerHTML = ui.icon('image');
      }

      const body = document.createElement('div');
      body.className = 'body';
      const h = document.createElement('h3'); h.textContent = a.title;
      const badge = document.createElement('span');
      badge.className = 'badge' + (a.photo_count ? ' badge-primary' : '');
      badge.textContent = plural(a.photo_count, 'photo');
      body.append(h, badge);

      card.append(thumb, body);
      box.appendChild(card);
    });
    show('list-empty', list.length === 0);
  }

  async function newCollection() {
    const title = await ui.dialog({
      title: 'New collection',
      desc: 'You can upload photos and get the client link next.',
      ok: 'Create',
      input: { label: 'Title', value: '' }
    });
    if (!title) return;
    try {
      const a = await api.createAlbum(title);
      ui.toast(`Created "${a.title}"`);
      location.hash = `#/album/${a.id}`;
    } catch (err) { fail(err); }
  }
  $('btn-new').addEventListener('click', newCollection);
  $('btn-new-empty').addEventListener('click', newCollection);

  // ---------- album ----------
  async function openAlbum(id) {
    show('v-list', false); show('v-album');
    show('a-progress', false);
    try {
      album = await api.album(id);
    } catch (err) {
      if (err.status === 401) { showLogin(); return; }
      ui.toast('Collection not found', 'error');
      location.hash = '';
      return;
    }
    $('a-title').textContent = album.title;
    setLink(album.token);
    renderPhotos();
  }

  function setLink(token) {
    $('a-link').value = shareUrl(token);
    $('a-open').href = shareUrl(token);
  }

  function renderPhotos() {
    const box = $('a-photos');
    box.innerHTML = '';
    const photos = album.photos || [];
    $('a-count').textContent = plural(photos.length, 'photo');
    show('a-photos-head', photos.length > 0);
    photos.forEach(p => {
      const t = document.createElement('div');
      t.className = 'ph';
      t.draggable = true;
      t.dataset.id = p.id;
      const img = document.createElement('img');
      img.loading = 'lazy'; img.alt = p.filename; img.draggable = false;
      img.src = api.thumb(album.token, p.id);
      img.title = p.filename;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ph-del';
      del.title = del.ariaLabel = `Delete ${p.filename}`;
      del.innerHTML = ui.icon('x');
      del.addEventListener('click', async () => {
        const ok = await ui.dialog({
          title: 'Delete photo?',
          desc: `"${p.filename}" will be removed from this collection. This cannot be undone.`,
          ok: 'Delete', danger: true
        });
        if (!ok) return;
        try {
          await api.deletePhoto(p.id);
          album.photos = album.photos.filter(x => x.id !== p.id);
          renderPhotos();
          ui.toast('Photo deleted');
        } catch (err) { fail(err); }
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
    try {
      await api.reorder(album.id, ids);
      album.photos.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    } catch (err) { fail(err); }
  });

  // upload
  async function upload(fileList) {
    const files = [...fileList].filter(f => /^image\/(png|jpeg)$/.test(f.type));
    if (!files.length) { ui.toast('Only PNG and JPEG files can be uploaded.', 'error'); return; }
    show('a-progress'); $('a-bar').style.width = '0%';
    $('a-add').disabled = true;
    try {
      const r = await api.upload(album.id, files, f => { $('a-bar').style.width = Math.round(f * 100) + '%'; });
      ui.toast(`Uploaded ${plural(r.uploaded.length, 'photo')}`);
    } catch (err) {
      if (err.status === 401) { showLogin(); return; }
      const saved = err.uploaded && err.uploaded.length ? ` (${plural(err.uploaded.length, 'photo')} saved before it)` : '';
      ui.toast(err.message + saved, 'error');
    } finally {
      $('a-add').disabled = false;
      $('a-files').value = '';
    }
    openAlbum(album.id); // reload to show what was saved
  }

  const drop = $('a-drop');
  drop.addEventListener('click', () => $('a-files').click());
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('a-files').click(); } });
  $('a-add').addEventListener('click', () => $('a-files').click());
  $('a-files').addEventListener('change', e => upload(e.target.files));
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => upload(e.dataTransfer.files));

  // album actions
  $('a-rename').addEventListener('click', async () => {
    const t = await ui.dialog({ title: 'Rename collection', ok: 'Save', input: { label: 'Title', value: album.title } });
    if (!t || t === album.title) return;
    try {
      await api.renameAlbum(album.id, t);
      album.title = t; $('a-title').textContent = t;
      ui.toast('Collection renamed');
    } catch (err) { fail(err); }
  });

  $('a-delete').addEventListener('click', async () => {
    const ok = await ui.dialog({
      title: 'Delete collection?',
      desc: `"${album.title}" and all ${plural((album.photos || []).length, 'photo')} will be deleted. The client link stops working. This cannot be undone.`,
      ok: 'Delete collection', danger: true
    });
    if (!ok) return;
    try {
      await api.deleteAlbum(album.id);
      ui.toast('Collection deleted');
      location.hash = '';
    } catch (err) { fail(err); }
  });

  $('a-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('a-link').value);
      ui.toast('Link copied');
    } catch (_) {
      $('a-link').select();
      ui.toast('Press Ctrl+C to copy', 'error');
    }
  });

  $('a-newlink').addEventListener('click', async () => {
    const ok = await ui.dialog({
      title: 'Create a new link?',
      desc: 'The old link stops working right away. You will need to send the new link to your client.',
      ok: 'Create new link', danger: true
    });
    if (!ok) return;
    try {
      const r = await api.newLink(album.id);
      album.token = r.token;
      setLink(r.token);
      renderPhotos();
      ui.toast('New link created');
    } catch (err) { fail(err); }
  });

  boot();
})();
