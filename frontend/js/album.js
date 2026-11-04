(async () => {
  const $ = id => document.getElementById(id);
  const token = location.pathname.split('/')[2];
  const selected = new Set();
  let photos = [], current = 0;

  let data;
  try {
    data = await api.shared(token);
  } catch (e) {
    $('g-title').textContent = e.status === 404 ? 'Link not found' : 'Something went wrong';
    $('g-msg').textContent = e.status === 404 ? 'This link is wrong or has been replaced.' : e.message;
    $('g-msg').classList.remove('hidden');
    return;
  }

  photos = data.photos || [];
  document.title = data.title;
  $('g-title').textContent = data.title;
  $('bar-title').textContent = data.title;

  if (!photos.length) {
    $('g-msg').textContent = 'No photos yet.';
    $('g-msg').classList.remove('hidden');
    return;
  }

  $('cover').style.backgroundImage = `url(${api.thumb(token, photos[0].id)})`;
  $('btn-view').classList.remove('hidden');
  $('btn-view').addEventListener('click', () => $('bar').scrollIntoView({ behavior: 'smooth' }));
  $('bar').classList.remove('hidden');
  $('gfoot').classList.remove('hidden');

  const grid = $('grid');
  photos.forEach((p, i) => {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.innerHTML = '<img loading="lazy" alt=""><button class="pick" title="Select">&#10003;</button>';
    tile.querySelector('img').src = api.thumb(token, p.id);
    tile.querySelector('.pick').addEventListener('click', e => {
      e.stopPropagation();
      selected.has(p.id) ? selected.delete(p.id) : selected.add(p.id);
      tile.classList.toggle('selected', selected.has(p.id));
      refresh();
    });
    tile.addEventListener('click', () => openLb(i));
    grid.appendChild(tile);
  });

  function refresh() {
    $('sel-count').textContent = selected.size;
    $('count').classList.toggle('hidden', !selected.size);
    $('btn-download').textContent = selected.size ? `Download selected (${selected.size})` : 'Download all';
    $('btn-all').textContent = selected.size === photos.length ? 'Select none' : 'Select all';
  }

  $('btn-all').addEventListener('click', () => {
    const all = selected.size !== photos.length;
    selected.clear();
    document.querySelectorAll('.tile').forEach((t, i) => {
      t.classList.toggle('selected', all);
      if (all) selected.add(photos[i].id);
    });
    refresh();
  });

  $('btn-download').addEventListener('click', () => {
    if (!selected.size) { location.href = api.zip(token); return; }
    photos.filter(p => selected.has(p.id)).forEach((p, i) => setTimeout(() => {
      const a = document.createElement('a');
      a.href = api.original(token, p.id);
      document.body.appendChild(a); a.click(); a.remove();
    }, i * 400));
  });

  // Lightbox: 1600px preview to view, original to download
  const lb = $('lb');
  function openLb(i) {
    current = (i + photos.length) % photos.length;
    $('lb-img').src = api.thumb(token, photos[current].id);
    $('lb-dl').href = api.original(token, photos[current].id);
    lb.classList.add('open');
  }
  const closeLb = () => lb.classList.remove('open');
  lb.querySelector('.lb-close').addEventListener('click', closeLb);
  lb.querySelector('.lb-prev').addEventListener('click', () => openLb(current - 1));
  lb.querySelector('.lb-next').addEventListener('click', () => openLb(current + 1));
  lb.addEventListener('click', e => { if (e.target === lb) closeLb(); });
  document.addEventListener('keydown', e => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') closeLb();
    if (e.key === 'ArrowLeft') openLb(current - 1);
    if (e.key === 'ArrowRight') openLb(current + 1);
  });
})();
