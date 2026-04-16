package terminal

import (
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// ResizeMsg is sent when the terminal is resized
type ResizeMsg struct {
	Width  int
	Height int
}

// SignalManager handles terminal-related signal management
type SignalManager struct {
	sizeManager *Manager
}

// NewSignalManager creates a new signal manager with terminal size detection
func NewSignalManager(sizeManager *Manager) *SignalManager {
	return &SignalManager{
		sizeManager: sizeManager,
	}
}

// CreateSizeCheckCmd creates a ticker for checking terminal size changes (for IntelliJ compatibility)
func (sm *SignalManager) CreateSizeCheckCmd() tea.Cmd {
	return tea.Tick(250*time.Millisecond, func(time.Time) tea.Msg {
		return SizeCheckMsg{}
	})
}

// SizeCheckMsg is sent periodically to check terminal size for IntelliJ compatibility
type SizeCheckMsg struct{}
