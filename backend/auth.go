package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const (
	cookieName = "session"
	sessionTTL = 7 * 24 * time.Hour
)

func (a *app) sign(expiry string) string {
	m := hmac.New(sha256.New, a.secret)
	m.Write([]byte(expiry))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

// ponytail: stateless cookie, logout only clears the browser copy; rotate SESSION_SECRET to kill every session.
func (a *app) validSession(r *http.Request) bool {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return false
	}
	exp, sig, ok := strings.Cut(c.Value, ".")
	if !ok || !hmac.Equal([]byte(sig), []byte(a.sign(exp))) {
		return false
	}
	t, err := strconv.ParseInt(exp, 10, 64)
	return err == nil && time.Now().Unix() < t
}

func (a *app) requireAdmin(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !a.validSession(r) {
			httpError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		h(w, r)
	}
}

func (a *app) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		httpError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if bcrypt.CompareHashAndPassword(a.pwHash, []byte(body.Password)) != nil {
		time.Sleep(time.Second) // ponytail: per-request brake, add IP rate limit (or fail2ban on nginx log) if brute force shows up
		httpError(w, http.StatusUnauthorized, "wrong password")
		return
	}
	exp := time.Now().Add(sessionTTL)
	e := strconv.FormatInt(exp.Unix(), 10)
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: e + "." + a.sign(e), Path: "/", Expires: exp,
		HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode,
	})
	w.WriteHeader(http.StatusNoContent)
}

func (a *app) logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode,
	})
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func httpError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
