package main

import (
	"image"
	"image/jpeg"
	_ "image/png"
	"os"

	"golang.org/x/image/draw"
)

const thumbMax = 1600

// ponytail: one decode at a time; a 30MB PNG decodes to ~200MB RAM. Raise the buffer if the VPS has RAM to spare.
var thumbSem = make(chan struct{}, 1)

func makeThumb(src, dst string) error {
	thumbSem <- struct{}{}
	defer func() { <-thumbSem }()

	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		return err
	}

	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w > thumbMax || h > thumbMax {
		if w >= h {
			w, h = thumbMax, h*thumbMax/w
		} else {
			w, h = w*thumbMax/h, thumbMax
		}
	}
	out := image.NewRGBA(image.Rect(0, 0, max(w, 1), max(h, 1)))
	// White background so transparent PNG areas don't turn black in the JPEG.
	draw.Draw(out, out.Bounds(), image.White, image.Point{}, draw.Src)
	draw.CatmullRom.Scale(out, out.Bounds(), img, b, draw.Over, nil)

	tmp := dst + ".tmp"
	t, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if err := jpeg.Encode(t, out, &jpeg.Options{Quality: 82}); err != nil {
		t.Close()
		os.Remove(tmp)
		return err
	}
	if err := t.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dst)
}
