package main

import (
	"bufio"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

type app struct {
	db        *sql.DB
	dataDir   string
	pwHash    []byte
	secret    []byte
	maxUpload int64
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "hash-password" {
		hashPassword()
		return
	}

	a, err := newApp(
		env("DATA_DIR", "./data"),
		os.Getenv("ADMIN_PASSWORD_HASH"),
		os.Getenv("SESSION_SECRET"),
	)
	if err != nil {
		log.Fatal(err)
	}
	mb, err := strconv.ParseInt(env("MAX_UPLOAD_MB", "2048"), 10, 64)
	if err != nil {
		log.Fatal("MAX_UPLOAD_MB: ", err)
	}
	a.maxUpload = mb << 20

	addr := env("ADDR", "127.0.0.1:8080")
	log.Printf("listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, a.routes(env("FRONTEND_DIR", "../frontend"))))
}

func newApp(dataDir, pwHash, secret string) (*app, error) {
	if pwHash == "" || len(secret) < 32 {
		return nil, fmt.Errorf("ADMIN_PASSWORD_HASH must be set and SESSION_SECRET must be at least 32 chars")
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "albums"), 0o750); err != nil {
		return nil, err
	}
	db, err := openDB(filepath.Join(dataDir, "app.db"))
	if err != nil {
		return nil, err
	}
	a := &app{db: db, dataDir: dataDir, pwHash: []byte(pwHash), secret: []byte(secret), maxUpload: 2048 << 20}
	if err := a.shortenTokens(); err != nil {
		return nil, err
	}
	return a, nil
}

func (a *app) routes(frontendDir string) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("POST /api/login", a.login)
	mux.HandleFunc("POST /api/logout", a.logout)
	mux.HandleFunc("GET /api/me", a.requireAdmin(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) }))

	mux.HandleFunc("GET /api/admin/albums", a.requireAdmin(a.listAlbums))
	mux.HandleFunc("POST /api/admin/albums", a.requireAdmin(a.createAlbum))
	mux.HandleFunc("GET /api/admin/albums/{id}", a.requireAdmin(a.getAlbum))
	mux.HandleFunc("PATCH /api/admin/albums/{id}", a.requireAdmin(a.renameAlbum))
	mux.HandleFunc("DELETE /api/admin/albums/{id}", a.requireAdmin(a.deleteAlbum))
	mux.HandleFunc("POST /api/admin/albums/{id}/link", a.requireAdmin(a.regenerateLink))
	mux.HandleFunc("POST /api/admin/albums/{id}/photos", a.requireAdmin(a.uploadPhotos))
	mux.HandleFunc("PUT /api/admin/albums/{id}/order", a.requireAdmin(a.reorderPhotos))
	mux.HandleFunc("DELETE /api/admin/photos/{id}", a.requireAdmin(a.deletePhoto))

	mux.HandleFunc("GET /api/a/{token}", a.publicAlbum)
	mux.HandleFunc("GET /api/a/{token}/photos/{id}", a.publicPhoto)
	mux.HandleFunc("GET /api/a/{token}/photos/{id}/thumb", a.publicThumb)
	mux.HandleFunc("GET /api/a/{token}/zip", a.publicZip)

	// Share link page: frontend's album.html reads the token from location.pathname.
	mux.HandleFunc("GET /a/{token}", func(w http.ResponseWriter, r *http.Request) {
		noIndex(w)
		http.ServeFile(w, r, filepath.Join(frontendDir, "album.html"))
	})
	// no-cache = browser re-checks each time (304 if unchanged), so a deploy shows up without hard refresh.
	static := http.FileServer(http.Dir(frontendDir))
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		static.ServeHTTP(w, r)
	})
	return mux
}

func hashPassword() {
	fmt.Fprint(os.Stderr, "Password: ")
	pw, _ := bufio.NewReader(os.Stdin).ReadString('\n')
	pw = strings.TrimRight(pw, "\r\n")
	if pw == "" {
		log.Fatal("empty password")
	}
	h, err := bcrypt.GenerateFromPassword([]byte(pw), 12)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(string(h))
}
