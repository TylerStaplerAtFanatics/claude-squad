package services

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/tstapler/stapler-squad/log"
)

const sessionIDHeader = "X-CS-Session-ID"

// HookReceiver handles inbound Claude Code hook callbacks for non-approval events.
// These are fire-and-forget: Claude does not block on the response.
type HookReceiver struct{}

// NewHookReceiver creates a HookReceiver.
func NewHookReceiver() *HookReceiver {
	return &HookReceiver{}
}

// RegisterRoutes registers the four non-approval hook endpoints on mux.
func (h *HookReceiver) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/hooks/stop", h.HandleStop)
	mux.HandleFunc("/api/hooks/pre-tool-use", h.HandlePreToolUse)
	mux.HandleFunc("/api/hooks/post-tool-use", h.HandlePostToolUse)
	mux.HandleFunc("/api/hooks/prompt-submit", h.HandlePromptSubmit)
}

// HandleStop receives the Claude Code Stop hook.
func (h *HookReceiver) HandleStop(w http.ResponseWriter, r *http.Request) {
	sessionID := r.Header.Get(sessionIDHeader)
	payload := h.readBody(r)
	log.InfoLog.Printf("[hook/stop] session=%q payload=%s", sessionID, payload)
	w.WriteHeader(http.StatusOK)
}

// HandlePreToolUse receives the Claude Code PreToolUse hook.
// Logs the tool invocation for observability.
func (h *HookReceiver) HandlePreToolUse(w http.ResponseWriter, r *http.Request) {
	sessionID := r.Header.Get(sessionIDHeader)
	payload := h.readBody(r)
	log.InfoLog.Printf("[hook/pre-tool-use] session=%q payload=%s", sessionID, payload)
	w.WriteHeader(http.StatusOK)
}

// HandlePostToolUse receives the Claude Code PostToolUse hook.
// Logs the tool result for observability.
func (h *HookReceiver) HandlePostToolUse(w http.ResponseWriter, r *http.Request) {
	sessionID := r.Header.Get(sessionIDHeader)
	payload := h.readBody(r)
	log.InfoLog.Printf("[hook/post-tool-use] session=%q payload=%s", sessionID, payload)
	w.WriteHeader(http.StatusOK)
}

// HandlePromptSubmit receives the Claude Code UserPromptSubmit hook.
// Logs the prompt for observability.
func (h *HookReceiver) HandlePromptSubmit(w http.ResponseWriter, r *http.Request) {
	sessionID := r.Header.Get(sessionIDHeader)
	payload := h.readBody(r)
	log.InfoLog.Printf("[hook/prompt-submit] session=%q payload=%s", sessionID, payload)
	w.WriteHeader(http.StatusOK)
}

// readBody reads and returns the request body as a compact JSON string.
// Returns the raw bytes on parse failure, silently dropping read errors.
func (h *HookReceiver) readBody(r *http.Request) string {
	data, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
	if err != nil || len(data) == 0 {
		return "{}"
	}
	var compact json.RawMessage
	if err := json.Unmarshal(data, &compact); err != nil {
		return string(data)
	}
	out, _ := json.Marshal(compact)
	return string(out)
}
