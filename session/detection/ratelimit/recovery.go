package ratelimit

import (
	"github.com/tstapler/stapler-squad/log"
)

type RecoveryHandler struct {
	sessionID string

	sendInput func([]byte) error
}

func NewRecoveryHandler(sessionID string, sendInput func([]byte) error) *RecoveryHandler {
	return &RecoveryHandler{
		sessionID: sessionID,
		sendInput: sendInput,
	}
}

func (h *RecoveryHandler) Execute(input []byte) error {
	log.InfoLog.Printf("[RateLimit] Sending recovery input to session %s: %q", h.sessionID, string(input))

	if err := h.sendInput(input); err != nil {
		log.WarningLog.Printf("[RateLimit] Failed to send recovery input to session %s: %v", h.sessionID, err)
		return err
	}

	log.InfoLog.Printf("[RateLimit] Successfully sent recovery input to session %s", h.sessionID)
	return nil
}
