package services

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newImageUploadHandler(t *testing.T) (*ImageUploadHandler, string) {
	t.Helper()
	dir := t.TempDir()
	return NewImageUploadHandler(dir), dir
}

func postJSON(t *testing.T, h *ImageUploadHandler, body any) *httptest.ResponseRecorder {
	t.Helper()
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/upload/image", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.HandleUpload(rr, req)
	return rr
}

func TestHandleUpload_ValidPNG(t *testing.T) {
	h, dir := newImageUploadHandler(t)

	payload := []byte("fake-png-data")
	encoded := base64.StdEncoding.EncodeToString(payload)

	rr := postJSON(t, h, map[string]string{"data": encoded, "contentType": "image/png"})

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp imageUploadResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !strings.HasSuffix(resp.Path, ".png") {
		t.Errorf("expected .png extension, got %q", resp.Path)
	}
	if _, err := os.Stat(resp.Path); err != nil {
		t.Errorf("saved file not found: %v", err)
	}

	info, _ := os.Stat(resp.Path)
	if info.Mode().Perm() != imageFileMode {
		t.Errorf("expected file mode %o, got %o", imageFileMode, info.Mode().Perm())
	}

	got, _ := os.ReadFile(resp.Path)
	if !bytes.Equal(got, payload) {
		t.Errorf("file content mismatch")
	}
	_ = dir
}

func TestHandleUpload_WrongMethod(t *testing.T) {
	h, _ := newImageUploadHandler(t)
	req := httptest.NewRequest(http.MethodGet, "/api/upload/image", nil)
	rr := httptest.NewRecorder()
	h.HandleUpload(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", rr.Code)
	}
}

func TestHandleUpload_InvalidBase64(t *testing.T) {
	h, _ := newImageUploadHandler(t)
	rr := postJSON(t, h, map[string]string{"data": "not-valid-base64!!!", "contentType": "image/png"})
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

func TestHandleUpload_InvalidJSON(t *testing.T) {
	h, _ := newImageUploadHandler(t)
	req := httptest.NewRequest(http.MethodPost, "/api/upload/image", strings.NewReader("{bad json"))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.HandleUpload(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

func TestHandleUpload_ContentTypeExtensions(t *testing.T) {
	cases := []struct {
		ct  string
		ext string
	}{
		{"image/jpeg", ".jpg"},
		{"image/jpg", ".jpg"},
		{"image/gif", ".gif"},
		{"image/webp", ".webp"},
		{"image/bmp", ".png"}, // unknown → default .png
		{"", ".png"},
	}
	for _, tc := range cases {
		t.Run(tc.ct, func(t *testing.T) {
			got := extensionFor(tc.ct)
			if got != tc.ext {
				t.Errorf("extensionFor(%q) = %q, want %q", tc.ct, got, tc.ext)
			}
		})
	}
}

func TestCleanOldPasteFiles(t *testing.T) {
	dir := t.TempDir()

	// Write an old file (mtime in the past)
	old := filepath.Join(dir, "paste-old.png")
	if err := os.WriteFile(old, []byte("old"), imageFileMode); err != nil {
		t.Fatal(err)
	}
	past := time.Now().Add(-maxPasteFileAge - time.Second)
	if err := os.Chtimes(old, past, past); err != nil {
		t.Fatal(err)
	}

	// Write a recent file
	recent := filepath.Join(dir, "paste-recent.png")
	if err := os.WriteFile(recent, []byte("new"), imageFileMode); err != nil {
		t.Fatal(err)
	}

	cleanOldPasteFiles(dir)

	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Error("expected old file to be removed")
	}
	if _, err := os.Stat(recent); err != nil {
		t.Error("expected recent file to be kept")
	}
}
