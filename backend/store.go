package main

import (
	"crypto/rand"
	"database/sql"
	"errors"
	"log"
	"math/big"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS albums (
	id         INTEGER PRIMARY KEY,
	title      TEXT    NOT NULL,
	token      TEXT    NOT NULL UNIQUE,
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS photos (
	id         INTEGER PRIMARY KEY,
	album_id   INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
	filename   TEXT    NOT NULL,
	ext        TEXT    NOT NULL,
	size       INTEGER NOT NULL,
	position   INTEGER NOT NULL,
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS photos_album ON photos(album_id, position);
`

type album struct {
	ID         int64   `json:"id"`
	Title      string  `json:"title"`
	Token      string  `json:"token"`
	CreatedAt  int64   `json:"created_at"`
	PhotoCount int     `json:"photo_count"`
	CoverID    *int64  `json:"cover_id"`
	Photos     []photo `json:"photos,omitempty"`
}

type photo struct {
	ID       int64  `json:"id"`
	AlbumID  int64  `json:"-"`
	Filename string `json:"filename"`
	Ext      string `json:"-"`
	Size     int64  `json:"size"`
	Position int    `json:"position"`
}

var errNotFound = errors.New("not found")

func openDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // ponytail: one connection serializes all queries; plenty for one admin + gallery viewers
	if _, err := db.Exec(schema); err != nil {
		return nil, err
	}
	return db, nil
}

const (
	tokenLen      = 6
	tokenAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
)

// newToken returns 6 random chars from a-z0-9 (36^6 ≈ 2.2 billion links).
// ponytail: no rate limit on wrong links (owner's choice); a bot could guess a live link in days. Add per-IP 404 limit if that matters.
func newToken() string {
	b := make([]byte, tokenLen)
	for i := range b {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(tokenAlphabet))))
		if err != nil {
			panic(err) // crypto/rand never fails on Linux
		}
		b[i] = tokenAlphabet[n.Int64()]
	}
	return string(b)
}

// withToken runs fn with fresh tokens until it doesn't hit the UNIQUE constraint (short tokens can collide).
func withToken(fn func(tok string) error) (string, error) {
	for range 10 {
		tok := newToken()
		err := fn(tok)
		if err == nil || !strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return tok, err
		}
	}
	return "", errors.New("could not find a free link token")
}

// shortenTokens gives every album with an old-format token a new short one. Old links stop working.
func (a *app) shortenTokens() error {
	rows, err := a.db.Query(`SELECT id FROM albums WHERE length(token) != ?`, tokenLen)
	if err != nil {
		return err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, id := range ids {
		tok, err := withToken(func(tok string) error { return a.exec(`UPDATE albums SET token = ? WHERE id = ?`, tok, id) })
		if err != nil {
			return err
		}
		log.Printf("album %d: new short link /a/%s", id, tok)
	}
	return nil
}

const albumCols = `a.id, a.title, a.token, a.created_at,
	(SELECT COUNT(*) FROM photos p WHERE p.album_id = a.id),
	(SELECT p.id FROM photos p WHERE p.album_id = a.id ORDER BY p.position, p.id LIMIT 1)`

func scanAlbum(row interface{ Scan(...any) error }) (album, error) {
	var al album
	err := row.Scan(&al.ID, &al.Title, &al.Token, &al.CreatedAt, &al.PhotoCount, &al.CoverID)
	if errors.Is(err, sql.ErrNoRows) {
		err = errNotFound
	}
	return al, err
}

func (a *app) albums() ([]album, error) {
	rows, err := a.db.Query(`SELECT ` + albumCols + ` FROM albums a ORDER BY a.created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []album{}
	for rows.Next() {
		al, err := scanAlbum(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, al)
	}
	return out, rows.Err()
}

// albumBy loads an album with its photos by id or token column.
func (a *app) albumBy(col string, v any) (album, error) {
	al, err := scanAlbum(a.db.QueryRow(`SELECT `+albumCols+` FROM albums a WHERE a.`+col+` = ?`, v))
	if err != nil {
		return al, err
	}
	al.Photos, err = a.photos(al.ID)
	return al, err
}

func (a *app) photos(albumID int64) ([]photo, error) {
	rows, err := a.db.Query(`SELECT id, album_id, filename, ext, size, position FROM photos WHERE album_id = ? ORDER BY position, id`, albumID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []photo{}
	for rows.Next() {
		var p photo
		if err := rows.Scan(&p.ID, &p.AlbumID, &p.Filename, &p.Ext, &p.Size, &p.Position); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (a *app) photoByID(id int64) (photo, error) {
	var p photo
	err := a.db.QueryRow(`SELECT id, album_id, filename, ext, size, position FROM photos WHERE id = ?`, id).
		Scan(&p.ID, &p.AlbumID, &p.Filename, &p.Ext, &p.Size, &p.Position)
	if errors.Is(err, sql.ErrNoRows) {
		err = errNotFound
	}
	return p, err
}

func (a *app) insertAlbum(title string) (album, error) {
	now := time.Now().Unix()
	var id int64
	tok, err := withToken(func(tok string) error {
		res, err := a.db.Exec(`INSERT INTO albums(title, token, created_at) VALUES (?, ?, ?)`, title, tok, now)
		if err == nil {
			id, _ = res.LastInsertId()
		}
		return err
	})
	if err != nil {
		return album{}, err
	}
	return album{ID: id, Title: title, Token: tok, CreatedAt: now, Photos: []photo{}}, nil
}

// exec runs a write and maps "no rows changed" to errNotFound.
func (a *app) exec(q string, args ...any) error {
	res, err := a.db.Exec(q, args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return errNotFound
	}
	return nil
}

func (a *app) insertPhoto(albumID int64, filename, ext string) (photo, error) {
	p := photo{AlbumID: albumID, Filename: filename, Ext: ext}
	err := a.db.QueryRow(`INSERT INTO photos(album_id, filename, ext, size, position, created_at)
		VALUES (?, ?, ?, 0, (SELECT COALESCE(MAX(position), 0) + 1 FROM photos WHERE album_id = ?), ?)
		RETURNING id, position`,
		albumID, filename, ext, albumID, time.Now().Unix()).Scan(&p.ID, &p.Position)
	return p, err
}

func (a *app) reorder(albumID int64, ids []int64) error {
	tx, err := a.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for i, id := range ids {
		res, err := tx.Exec(`UPDATE photos SET position = ? WHERE id = ? AND album_id = ?`, i+1, id, albumID)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return errNotFound
		}
	}
	return tx.Commit()
}

// photoInAlbum loads a photo only if it belongs to the album with this share token.
func (a *app) photoInAlbum(token string, id int64) (photo, error) {
	var p photo
	err := a.db.QueryRow(`SELECT p.id, p.album_id, p.filename, p.ext, p.size, p.position
		FROM photos p JOIN albums a ON a.id = p.album_id WHERE a.token = ? AND p.id = ?`, token, id).
		Scan(&p.ID, &p.AlbumID, &p.Filename, &p.Ext, &p.Size, &p.Position)
	if errors.Is(err, sql.ErrNoRows) {
		err = errNotFound
	}
	return p, err
}
