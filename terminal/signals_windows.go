//go:build windows

package terminal

import (
	tea "github.com/charmbracelet/bubbletea"
)

// SetupResizeHandler sets up terminal resize handling.
// On Windows, SIGWINCH is not available, so this is a no-op that just waits indefinitely.
// Note: monitorWindowSize should be used instead for Windows.
func (sm *SignalManager) SetupResizeHandler() tea.Cmd {
	return func() tea.Msg {
		// Just wait forever since we don't have SIGWINCH
		select {}
	}
}
