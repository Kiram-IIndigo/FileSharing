package main

import (
	"archive/zip"
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// ---- paths ----

func (a *app) albumDir(id int64) string {
	return filepath.Join(a.dataDir, "albums", strconv.FormatInt(id, 10))
}

func (a *app) photoPath(p photo) string {
	return filepath.Join(a.albumDir(p.AlbumID), strconv.FormatInt(p.ID, 10)+"."+p.Ext)
}

func (a *app) thumbPath(p photo) string {
	return filepath.Join(a.albumDir(p.AlbumID), "thumb", strconv.FormatInt(p.ID, 10)+".jpg")
}

// ---- helpers ----

func pathID(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	return id, err == nil && id > 0
}

// fail maps store errors to HTTP responses; unknown errors are logged, not leaked.
func fail(w http.ResponseWriter, err error) {
	if errors.Is(err, errNotFound) {
		httpError(w, http.StatusNotFound, "not found")
		return
	}
	log.Print(err)
	httpError(w, http.StatusInternalServerError, "internal error")
}

func readTitle(w http.ResponseWriter, r *http.Request) (string, bool) {
	var body struct {
		Title string `json:"title"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		httpError(w, http.StatusBadRequest, "invalid json")
		return "", false
	}
	t := strings.TrimSpace(body.Title)
	if t == "" || len([]rune(t)) > 200 {
		httpError(w, http.StatusBadRequest, "title must be 1-200 characters")
		return "", false
	}
	return t, true
}

// cleanName keeps the client's filename for display/download only, never for disk paths.
func cleanName(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || r == '"' || r == '/' {
			return -1
		}
		return r
	}, name)
	if r := []rune(name); len(r) > 200 {
		name = string(r[len(r)-200:])
	}
	if name == "" || name == "." {
		name = "photo"
	}
	return name
}

func attachment(w http.ResponseWriter, name string) {
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
}

// ---- admin ----

func (a *app) listAlbums(w http.ResponseWriter, r *http.Request) {
	als, err := a.albums()
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, als)
}

func (a *app) createAlbum(w http.ResponseWriter, r *http.Request) {
	title, ok := readTitle(w, r)
	if !ok {
		return
	}
	al, err := a.insertAlbum(title)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, al)
}

func (a *app) getAlbum(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		fail(w, errNotFound)
		return
	}
	al, err := a.albumBy("id", id)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, al)
}

func (a *app) renameAlbum(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		fail(w, errNotFound)
		return
	}
	title, ok := readTitle(w, r)
	if !ok {
		return
	}
	if err := a.exec(`UPDATE albums SET title = ? WHERE id = ?`, title, id); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *app) deleteAlbum(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		fail(w, errNotFound)
		return
	}
	if err := a.exec(`DELETE FROM albums WHERE id = ?`, id); err != nil {
		fail(w, err)
		return
	}
	if err := os.RemoveAll(a.albumDir(id)); err != nil {
		log.Printf("album %d deleted but files remain: %v", id, err)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *app) regenerateLink(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		fail(w, errNotFound)
		return
	}
	tok := newToken()
	if err := a.exec(`UPDATE albums SET token = ? WHERE id = ?`, tok, id); err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"token": tok})
}

func (a *app) reorderPhotos(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		fail(w, errNotFound)
		return
	}
	var body struct {
		PhotoIDs []int64 `json:"photo_ids"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil || len(body.PhotoIDs) == 0 {
		httpError(w, http.StatusBadRequest, "photo_ids required")
		return
	}
	if err := a.reorder(id, body.PhotoIDs); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *app) deletePhoto(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		fail(w, errNotFound)
		return
	}
	p, err := a.photoByID(id)
	if err == nil {
		err = a.exec(`DELETE FROM photos WHERE id = ?`, id)
	}
	if err != nil {
		fail(w, err)
		return
	}
	os.Remove(a.photoPath(p))
	os.Remove(a.thumbPath(p))
	w.WriteHeader(http.StatusNoContent)
}

var allowedTypes = map[string]string{"image/png": "png", "image/jpeg": "jpg"}

// uploadPhotos streams multipart files to disk one by one. On the first bad file it stops;
// files saved before it stay and are listed in the response.
func (a *app) uploadPhotos(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		fail(w, errNotFound)
		return
	}
	if _, err := a.albumBy("id", id); err != nil {
		fail(w, err)
		return
	}
	if err := os.MkdirAll(filepath.Join(a.albumDir(id), "thumb"), 0o750); err != nil {
		fail(w, err)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, a.maxUpload)
	mr, err := r.MultipartReader()
	if err != nil {
		httpError(w, http.StatusBadRequest, "expected multipart/form-data")
		return
	}

	uploaded := []photo{}
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "upload interrupted or too large", "uploaded": uploaded})
			return
		}
		if part.FileName() == "" {
			part.Close()
			continue
		}
		p, err := a.savePart(id, part)
		part.Close()
		if err != nil {
			status, msg := http.StatusBadRequest, err.Error()
			if !errors.As(err, new(userError)) {
				log.Printf("upload album %d: %v", id, err)
				status, msg = http.StatusInternalServerError, "internal error"
			}
			writeJSON(w, status, map[string]any{"error": part.FileName() + ": " + msg, "uploaded": uploaded})
			return
		}
		uploaded = append(uploaded, p)
	}
	writeJSON(w, http.StatusCreated, map[string]any{"uploaded": uploaded})
}

type userError struct{ msg string }

func (e userError) Error() string { return e.msg }

func (a *app) savePart(albumID int64, part *multipart.Part) (p photo, err error) {
	br := bufio.NewReaderSize(part, 512)
	head, _ := br.Peek(512)
	ext, ok := allowedTypes[http.DetectContentType(head)]
	if !ok {
		return p, userError{"only PNG and JPEG are allowed"}
	}
	name := cleanName(part.FileName())

	p, err = a.insertPhoto(albumID, name, ext)
	if err != nil {
		return p, err
	}
	pid := p.ID
	defer func() {
		if err != nil {
			a.db.Exec(`DELETE FROM photos WHERE id = ?`, pid)
			os.Remove(a.photoPath(p))
			os.Remove(a.thumbPath(p))
		}
	}()

	f, err := os.Create(a.photoPath(p))
	if err != nil {
		return p, err
	}
	p.Size, err = io.Copy(f, br)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return p, err
	}
	if err := makeThumb(a.photoPath(p), a.thumbPath(p)); err != nil {
		return p, userError{"not a valid image"}
	}
	return p, a.exec(`UPDATE photos SET size = ? WHERE id = ?`, p.Size, pid)
}

// ---- public (share link) ----

func noIndex(w http.ResponseWriter) {
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
	w.Header().Set("Referrer-Policy", "no-referrer")
}

func (a *app) publicAlbum(w http.ResponseWriter, r *http.Request) {
	noIndex(w)
	al, err := a.albumBy("token", r.PathValue("token"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"title": al.Title, "photos": al.Photos})
}

func (a *app) servePublic(w http.ResponseWriter, r *http.Request, thumb bool) {
	noIndex(w)
	id, ok := pathID(r)
	if !ok {
		fail(w, errNotFound)
		return
	}
	p, err := a.photoInAlbum(r.PathValue("token"), id)
	if err != nil {
		fail(w, err)
		return
	}
	path := a.photoPath(p)
	if thumb {
		path = a.thumbPath(p)
		w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	} else {
		attachment(w, p.Filename)
	}
	f, err := os.Open(path)
	if err != nil {
		fail(w, err)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		fail(w, err)
		return
	}
	http.ServeContent(w, r, filepath.Base(path), st.ModTime(), f)
}

func (a *app) publicPhoto(w http.ResponseWriter, r *http.Request) { a.servePublic(w, r, false) }
func (a *app) publicThumb(w http.ResponseWriter, r *http.Request) { a.servePublic(w, r, true) }

func (a *app) publicZip(w http.ResponseWriter, r *http.Request) {
	noIndex(w)
	al, err := a.albumBy("token", r.PathValue("token"))
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	attachment(w, cleanName(al.Title)+".zip")

	zw := zip.NewWriter(w)
	seen := map[string]int{}
	for _, p := range al.Photos {
		name := p.Filename
		if n := seen[strings.ToLower(name)]; n > 0 {
			ext := filepath.Ext(name)
			name = fmt.Sprintf("%s (%d)%s", strings.TrimSuffix(name, ext), n+1, ext)
		}
		seen[strings.ToLower(p.Filename)]++

		if err := a.zipFile(zw, name, a.photoPath(p)); err != nil {
			// Headers are already sent; the client sees a truncated ZIP.
			log.Printf("zip album %d: %v", al.ID, err)
			return
		}
	}
	if err := zw.Close(); err != nil {
		log.Printf("zip album %d: %v", al.ID, err)
	}
}

func (a *app) zipFile(zw *zip.Writer, name, path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	// Store, not Deflate: PNG/JPEG are already compressed, deflating burns CPU for ~0% gain.
	dst, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Store, Modified: time.Now()})
	if err != nil {
		return err
	}
	_, err = io.Copy(dst, f)
	return err
}
