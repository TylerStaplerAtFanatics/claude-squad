package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func newTestHandler() *TelemetryHandler {
	return NewTelemetryHandler()
}

func postTelemetry(h *TelemetryHandler, body any) *httptest.ResponseRecorder {
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/telemetry", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.HandleTelemetry(w, req)
	return w
}

func TestTelemetry_MissingEvent(t *testing.T) {
	h := newTestHandler()
	w := postTelemetry(h, map[string]any{"duration_ms": 100, "timestamp": "2026-01-01T00:00:00Z"})
	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d", w.Code)
	}
}

func TestTelemetry_MissingDuration(t *testing.T) {
	h := newTestHandler()
	w := postTelemetry(h, map[string]any{"event": "load", "timestamp": "2026-01-01T00:00:00Z"})
	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d", w.Code)
	}
}

func TestTelemetry_TooManyLabels(t *testing.T) {
	h := newTestHandler()
	labels := make(map[string]string, 101)
	for i := range 101 {
		labels[strings.Repeat("k", i+1)] = "v"
	}
	w := postTelemetry(h, map[string]any{"event": "load", "duration_ms": 50, "labels": labels})
	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d", w.Code)
	}
}

func TestTelemetry_ValidRequest(t *testing.T) {
	h := newTestHandler()
	w := postTelemetry(h, map[string]any{"event": "session_attach", "duration_ms": 123})
	if w.Code != http.StatusNoContent {
		t.Errorf("want 204, got %d", w.Code)
	}
}

func TestTelemetry_MethodNotAllowed(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodGet, "/api/telemetry", nil)
	w := httptest.NewRecorder()
	h.HandleTelemetry(w, req)
	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("want 405, got %d", w.Code)
	}
}

func TestTelemetry_RateLimit(t *testing.T) {
	h := newTestHandler()
	payload := map[string]any{"event": "load", "duration_ms": 1}
	// Exhaust the 100-request window.
	for range 100 {
		w := postTelemetry(h, payload)
		if w.Code != http.StatusNoContent {
			t.Fatalf("unexpected status on request within limit: %d", w.Code)
		}
	}
	// 101st request must be rejected.
	w := postTelemetry(h, payload)
	if w.Code != http.StatusTooManyRequests {
		t.Errorf("want 429, got %d", w.Code)
	}
}
