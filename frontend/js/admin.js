(() => {
  const drop = document.getElementById('drop');
  const input = document.getElementById('files');
  const previews = document.getElementById('previews');
  const result = document.getElementById('result');
  let files = [];

  function addFiles(list) {
    files = files.concat([...list].filter(f => f.type.startsWith('image/')));
    previews.innerHTML = '';
    files.forEach(f => {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(f);
      img.alt = f.name;
      previews.appendChild(img);
    });
  }

  drop.addEventListener('click', () => input.click());
  input.addEventListener('change', () => addFiles(input.files));
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));

  document.getElementById('upload-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!files.length) { alert('Please add at least one photograph.'); return; }
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Uploading…';
    try {
      const out = await api.createGallery(
        document.getElementById('title').value,
        document.getElementById('client').value,
        files
      );
      result.classList.remove('hidden');
      result.innerHTML = `Gallery created. Access code: <strong>${out.code}</strong><br>Link: <a href="${out.link}">${out.link}</a>`;
    } catch (err) {
      result.classList.remove('hidden');
      result.textContent = err.message;
    } finally {
      btn.disabled = false; btn.textContent = 'Create & share gallery';
    }
  });
})();
