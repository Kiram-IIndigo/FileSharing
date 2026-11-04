# FileSharing Docs

Photo albums. Admin uploads. Clients get a link. Clients can only look and download.

Jump to:
1. [Run on your computer](#1-run-on-your-computer)
2. [Put on the VPS](#2-put-on-the-vps)
3. [API list](#3-api-list)
4. [Where things are saved](#4-where-things-are-saved)
5. [Problems and fixes](#5-problems-and-fixes)

---

## 1. Run on your computer

Time: 5 minutes.

1. `cd backend`
2. `cp .env.example .env`
3. `go run . hash-password` → type your password → copy the output
4. Open `.env`. Paste the output into `ADMIN_PASSWORD_HASH='...'` (keep the single quotes)
5. Run `openssl rand -base64 48` → paste it into `SESSION_SECRET='...'`
6. Start: `set -a; . ./.env; set +a; go run .`
7. Open `http://localhost:8080`

Run tests: `go test ./...`

---

## 2. Put on the VPS

Time: 30 minutes the first time.

### Build

1. On your computer: `cd backend && GOOS=linux GOARCH=amd64 go build -o filesharing .`

### Copy to server

2. Copy these to `/opt/filesharing/` on the server:
   - `filesharing` (the program)
   - `frontend/` folder
   - `.env` (make it like step 1 above)
3. In the server `.env` set:
   - `DATA_DIR=/opt/filesharing/data`
   - `FRONTEND_DIR=/opt/filesharing/frontend`
4. `chmod 600 /opt/filesharing/.env`

### Make it run forever

5. `sudo useradd --system --no-create-home filesharing`
6. `sudo mkdir -p /opt/filesharing/data && sudo chown -R filesharing: /opt/filesharing`
7. `sudo cp backend/deploy/filesharing.service /etc/systemd/system/`
8. `sudo systemctl daemon-reload && sudo systemctl enable --now filesharing`
9. Check: `sudo systemctl status filesharing` → must say `active (running)`

### CloudPanel

10. Add site → **Reverse Proxy** → URL `http://127.0.0.1:8080`
11. Turn on **Let's Encrypt** (HTTPS). Login does NOT work without HTTPS.
12. Open the site **Vhost** editor. Inside `location / { ... }` add:

```
client_max_body_size 2048m;
proxy_request_buffering off;
proxy_buffering off;
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;
```

13. Save. Open your domain. Done.

### Update to a new version

1. Build again (step 1)
2. Copy new `filesharing` to the server
3. `sudo systemctl restart filesharing`

---

## 3. API list

All answers are JSON. Errors look like `{"error": "..."}`.

### Login (admin)

| Do | Request | Body |
|---|---|---|
| Log in | `POST /api/login` | `{"password": "..."}` |
| Log out | `POST /api/logout` | none |
| Am I logged in? | `GET /api/me` | none → `204` yes, `401` no |

### Albums (admin, must be logged in)

| Do | Request | Body |
|---|---|---|
| List albums | `GET /api/admin/albums` | none |
| New album | `POST /api/admin/albums` | `{"title": "Wedding"}` |
| One album + photos | `GET /api/admin/albums/{id}` | none |
| Rename | `PATCH /api/admin/albums/{id}` | `{"title": "New name"}` |
| Delete album | `DELETE /api/admin/albums/{id}` | none |
| New link (old link dies) | `POST /api/admin/albums/{id}/link` | none |

### Photos (admin, must be logged in)

| Do | Request | Body |
|---|---|---|
| Upload | `POST /api/admin/albums/{id}/photos` | form-data, field name `files`, many files OK |
| Change order | `PUT /api/admin/albums/{id}/order` | `{"photo_ids": [3, 1, 2]}` |
| Delete photo | `DELETE /api/admin/photos/{id}` | none |

Upload rules:
- Only PNG and JPEG.
- If one file is bad, upload stops. Files before it are saved. Answer lists them in `uploaded`.

### Client (no login, only the link)

| Do | Request |
|---|---|
| Album page | `GET /a/{token}` → serves `frontend/album.html` |
| Album data | `GET /api/a/{token}` |
| Small preview | `GET /api/a/{token}/photos/{id}/thumb` |
| Download one (original) | `GET /api/a/{token}/photos/{id}` |
| Download all (ZIP) | `GET /api/a/{token}/zip` |

Client link to share = `https://your-domain/a/{token}`

### For frontend people

- Album page file must be named `frontend/album.html`.
- Get the token from the URL: `location.pathname.split("/")[2]`
- Use `/thumb` in the grid. Use the original only for the download button.
- Wrong or old token → `404`.

---

## 4. Where things are saved

| What | Where |
|---|---|
| Database (albums, photo list) | `DATA_DIR/app.db` |
| Original photos | `DATA_DIR/albums/{album id}/{photo id}.png` |
| Previews | `DATA_DIR/albums/{album id}/thumb/{photo id}.jpg` |
| Password + secret | `.env` |

**Backup = copy the whole `DATA_DIR` folder.** Stop the service first: `sudo systemctl stop filesharing`.

### Settings in `.env`

| Name | What it does | Default |
|---|---|---|
| `ADMIN_PASSWORD_HASH` | admin password (hashed) | required |
| `SESSION_SECRET` | signs the login cookie, 32+ chars | required |
| `ADDR` | where the server listens | `127.0.0.1:8080` |
| `DATA_DIR` | where photos + db go | `./data` |
| `FRONTEND_DIR` | frontend files | `../frontend` |
| `MAX_UPLOAD_MB` | max size of one upload request | `2048` |

---

## 5. Problems and fixes

| Problem | Fix |
|---|---|
| Can't log in, no error | You are on `http://`. Use `https://` (or `localhost`). |
| Server won't start: "ADMIN_PASSWORD_HASH must be set" | `.env` is missing or not loaded. Check the single quotes around the hash. |
| Upload fails at 1 MB | Add `client_max_body_size` in CloudPanel Vhost (section 2, step 12). |
| ZIP download stops halfway | Add `proxy_buffering off` and the timeouts in the Vhost. |
| Server crashes on big uploads | Not enough RAM. One big PNG needs about 200 MB to make a preview. |
| Change admin password | Run `hash-password` again → put in `.env` → `sudo systemctl restart filesharing` |
| Log out everyone everywhere | Put a new `SESSION_SECRET` in `.env` → restart |
| Client link leaked | `POST /api/admin/albums/{id}/link` → send the new link |
| See server logs | `sudo journalctl -u filesharing -f` |

---

## Not built (on purpose)

PIN codes, link expiry dates, favorites, watermarks, more than one admin. Ask if you need one.
