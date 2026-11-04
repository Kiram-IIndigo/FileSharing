(async () => {
  const grid = document.getElementById('grid');
  const countEl = document.getElementById('sel-count');
  const selected = new Set();
  let photos = [], current = 0;

  const code = new URLSearchParams(location.search).get('code');
  let data;
  try {
    data = await api.getGallery(code);
  } catch (e) {
    document.getElementById('g-title').textContent = 'Gallery unavailable';
    document.getElementById('g-sub').textContent = e.message;
    return;
  }
  photos = data.photos;
  document.title = `${data.title} — Atelier`;
  document.getElementById('g-title').textContent = data.title;
  document.getElementById('g-date').textContent = data.date || '';
  document.getElementById('g-sub').textContent = data.subtitle || '';

  const updateCount = () => { countEl.textContent = selected.size; };

  photos.forEach((p, i) => {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.innerHTML = `<img loading="lazy" src="${p.url}" alt="Photograph ${i + 1}"><span class="pick" title="Select">&#10003;</span>`;
    tile.querySelector('.pick').addEventListener('click', e => {
      e.stopPropagation();
      tile.classList.toggle('selected');
      selected.has(p.id) ? selected.delete(p.id) : selected.add(p.id);
      updateCount();
    });
    tile.addEventListener('click', () => openLb(i));
    grid.appendChild(tile);
  });

  // Select all / none
  document.getElementById('btn-all').addEventListener('click', () => {
    const all = selected.size !== photos.length;
    selected.clear();
    document.querySelectorAll('.tile').forEach((t, i) => {
      t.classList.toggle('selected', all);
      if (all) selected.add(photos[i].id);
    });
    updateCount();
  });

  // Download selected (or all when nothing is selected)
  document.getElementById('btn-download').addEventListener('click', () => {
    const list = selected.size ? photos.filter(p => selected.has(p.id)) : photos;
    list.forEach((p, i) => setTimeout(() => {
      const a = document.createElement('a');
      a.href = p.full || p.url;
      a.download = `photo-${p.id}.jpg`;
      document.body.appendChild(a); a.click(); a.remove();
    }, i * 300));
  });

  // Lightbox
  const lb = document.getElementById('lb'), lbImg = document.getElementById('lb-img'), lbDl = document.getElementById('lb-dl');
  function openLb(i) {
    current = (i + photos.length) % photos.length;
    lbImg.src = photos[current].full || photos[current].url;
    lbDl.href = photos[current].full || photos[current].url;
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
