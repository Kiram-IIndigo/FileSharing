// API layer. Endpoints are documented in /DOCS.md (section 3).
// Admin routes need the session cookie (same origin, so it is sent automatically).
const api = {
  async req(method, url, body) {
    const opt = { method, headers: {} };
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    const res = await fetch(url, opt);
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  },

  // auth
  login: password => api.req('POST', '/api/login', { password }),
  logout: () => api.req('POST', '/api/logout'),
  me: () => api.req('GET', '/api/me'),

  // admin: albums
  albums: () => api.req('GET', '/api/admin/albums'),
  album: id => api.req('GET', `/api/admin/albums/${id}`),
  createAlbum: title => api.req('POST', '/api/admin/albums', { title }),
  renameAlbum: (id, title) => api.req('PATCH', `/api/admin/albums/${id}`, { title }),
  deleteAlbum: id => api.req('DELETE', `/api/admin/albums/${id}`),
  newLink: id => api.req('POST', `/api/admin/albums/${id}/link`),

  // admin: photos
  reorder: (id, photo_ids) => api.req('PUT', `/api/admin/albums/${id}/order`, { photo_ids }),
  deletePhoto: id => api.req('DELETE', `/api/admin/photos/${id}`),
  // One multipart request, field name "files". The server stops at the first bad file.
  upload(id, files, onProgress) {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      files.forEach(f => fd.append('files', f));
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/admin/albums/${id}/photos`);
      xhr.upload.onprogress = e => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch (_) {}
        if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
        const err = new Error(data.error || `Upload failed (${xhr.status})`);
        err.status = xhr.status;
        err.uploaded = data.uploaded || [];
        reject(err);
      };
      xhr.send(fd);
    });
  },

  // client (share link, no login)
  shared: token => api.req('GET', `/api/a/${encodeURIComponent(token)}`),
  thumb: (token, id) => `/api/a/${encodeURIComponent(token)}/photos/${id}/thumb`,
  original: (token, id) => `/api/a/${encodeURIComponent(token)}/photos/${id}`,
  zip: token => `/api/a/${encodeURIComponent(token)}/zip`
};
