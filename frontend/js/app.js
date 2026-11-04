// Shared config + API layer.
// Set USE_MOCK = false and point API_BASE at your colleague's backend.
// Expected endpoints (adjust to match the backend):
//   GET  {API_BASE}/galleries/:code  -> { title, date, subtitle, photos: [{ id, url, full }] }
//   POST {API_BASE}/galleries        -> multipart: title, client, files[]  => { code, link }
const CONFIG = { API_BASE: '/api', USE_MOCK: true };

const api = {
  async getGallery(code) {
    if (CONFIG.USE_MOCK) {
      if (!code) throw new Error('No access code provided');
      const photos = Array.from({ length: 18 }, (_, i) => {
        const h = [800, 1000, 600, 900][i % 4];
        return {
          id: i + 1,
          url: `https://picsum.photos/seed/atelier${i}/700/${h}`,
          full: `https://picsum.photos/seed/atelier${i}/2000/${h * 3}`
        };
      });
      return { title: 'Sample Gallery', date: 'Demo', subtitle: `${photos.length} photographs`, photos };
    }
    const res = await fetch(`${CONFIG.API_BASE}/galleries/${encodeURIComponent(code)}`);
    if (!res.ok) throw new Error('Gallery not found');
    return res.json();
  },

  async createGallery(title, client, files) {
    if (CONFIG.USE_MOCK) {
      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      return { code, link: `${location.origin}${location.pathname.replace('admin.html', '')}gallery.html?code=${code}` };
    }
    const fd = new FormData();
    fd.append('title', title);
    fd.append('client', client);
    files.forEach(f => fd.append('files', f));
    const res = await fetch(`${CONFIG.API_BASE}/galleries`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
  }
};

const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();
