package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestFlow(t *testing.T) {
	hash, _ := bcrypt.GenerateFromPassword([]byte("pw"), bcrypt.MinCost)
	dir := t.TempDir()
	a, err := newApp(dir, string(hash), strings.Repeat("s", 32))
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewTLSServer(a.routes(t.TempDir()))
	defer ts.Close()
	c := ts.Client()
	c.Jar, _ = cookiejar.New(nil)

	do := func(method, path, ctype string, body io.Reader, want int) []byte {
		t.Helper()
		req, _ := http.NewRequest(method, ts.URL+path, body)
		if ctype != "" {
			req.Header.Set("Content-Type", ctype)
		}
		res, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		if res.StatusCode != want {
			t.Fatalf("%s %s: got %d want %d: %s", method, path, res.StatusCode, want, b)
		}
		return b
	}
	js := func(s string) io.Reader { return strings.NewReader(s) }

	// auth
	do("GET", "/api/admin/albums", "", nil, 401)
	do("POST", "/api/login", "application/json", js(`{"password":"nope"}`), 401)
	do("POST", "/api/login", "application/json", js(`{"password":"pw"}`), 204)
	do("GET", "/api/me", "", nil, 204)

	// create album
	var al album
	json.Unmarshal(do("POST", "/api/admin/albums", "application/json", js(`{"title":"Wedding"}`), 201), &al)
	do("POST", "/api/admin/albums", "application/json", js(`{"title":"  "}`), 400)

	// upload: big PNG, JPEG with traversal name, duplicate name
	var pngBuf, jpgBuf bytes.Buffer
	img := image.NewNRGBA(image.Rect(0, 0, 3200, 1000))
	img.Set(5, 5, color.NRGBA{255, 0, 0, 255})
	png.Encode(&pngBuf, img)
	jpeg.Encode(&jpgBuf, image.NewRGBA(image.Rect(0, 0, 10, 10)), nil)

	upload := func(want int, files map[string][]byte) []photo {
		var body bytes.Buffer
		mw := multipart.NewWriter(&body)
		for name, data := range files {
			fw, _ := mw.CreateFormFile("files", name)
			fw.Write(data)
		}
		mw.Close()
		var res struct{ Uploaded []photo }
		json.Unmarshal(do("POST", fmt.Sprintf("/api/admin/albums/%d/photos", al.ID), mw.FormDataContentType(), &body, want), &res)
		return res.Uploaded
	}
	ups := upload(201, map[string][]byte{"a.png": pngBuf.Bytes(), "../../evil.jpg": jpgBuf.Bytes()})
	ups = append(ups, upload(201, map[string][]byte{"a.png": pngBuf.Bytes()})...)
	upload(400, map[string][]byte{"x.png": []byte("not an image at all")})
	if len(ups) != 3 {
		t.Fatalf("uploaded %d", len(ups))
	}
	if _, err := os.Stat(filepath.Join(dir, "evil.jpg")); err == nil {
		t.Fatal("path traversal")
	}

	// thumbnail is resized JPEG
	tok := al.Token
	th, _, err := image.Decode(bytes.NewReader(do("GET", fmt.Sprintf("/api/a/%s/photos/%d/thumb", tok, ups[0].ID), "", nil, 200)))
	if err != nil || th.Bounds().Dx() != 1600 || th.Bounds().Dy() != 500 {
		t.Fatalf("thumb %v %v", th.Bounds(), err)
	}

	// public album + original download
	var pub struct {
		Title  string
		Photos []photo
	}
	json.Unmarshal(do("GET", "/api/a/"+tok, "", nil, 200), &pub)
	if pub.Title != "Wedding" || len(pub.Photos) != 3 {
		t.Fatalf("public %+v", pub)
	}
	if got := do("GET", fmt.Sprintf("/api/a/%s/photos/%d", tok, ups[0].ID), "", nil, 200); !bytes.Equal(got, pngBuf.Bytes()) {
		t.Fatal("original mismatch")
	}
	do("GET", "/api/a/wrongtoken", "", nil, 404)

	// zip: all files, duplicate names made unique
	z := do("GET", "/api/a/"+tok+"/zip", "", nil, 200)
	zr, err := zip.NewReader(bytes.NewReader(z), int64(len(z)))
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	for _, f := range zr.File {
		names[f.Name] = true
	}
	if len(names) != 3 || !names["a.png"] || !names["a (2).png"] || !names["evil.jpg"] {
		t.Fatalf("zip names %v", names)
	}

	// reorder, rename
	do("PUT", fmt.Sprintf("/api/admin/albums/%d/order", al.ID), "application/json",
		js(fmt.Sprintf(`{"photo_ids":[%d,%d,%d]}`, ups[2].ID, ups[1].ID, ups[0].ID)), 204)
	do("PATCH", fmt.Sprintf("/api/admin/albums/%d", al.ID), "application/json", js(`{"title":"Renamed"}`), 204)
	json.Unmarshal(do("GET", "/api/a/"+tok, "", nil, 200), &pub)
	if pub.Title != "Renamed" || pub.Photos[0].ID != ups[2].ID {
		t.Fatalf("after reorder %+v", pub)
	}

	// regenerate link: old one dies
	var nl struct{ Token string }
	json.Unmarshal(do("POST", fmt.Sprintf("/api/admin/albums/%d/link", al.ID), "", nil, 200), &nl)
	do("GET", "/api/a/"+tok, "", nil, 404)
	do("GET", "/api/a/"+nl.Token, "", nil, 200)

	// delete photo, then album: files gone
	p0 := a.photoPath(photo{ID: ups[0].ID, AlbumID: al.ID, Ext: "png"})
	do("DELETE", fmt.Sprintf("/api/admin/photos/%d", ups[0].ID), "", nil, 204)
	if _, err := os.Stat(p0); err == nil {
		t.Fatal("photo file not deleted")
	}
	do("DELETE", fmt.Sprintf("/api/admin/albums/%d", al.ID), "", nil, 204)
	if _, err := os.Stat(a.albumDir(al.ID)); err == nil {
		t.Fatal("album dir not deleted")
	}

	// logout
	do("POST", "/api/logout", "", nil, 204)
	do("GET", "/api/admin/albums", "", nil, 401)
}
