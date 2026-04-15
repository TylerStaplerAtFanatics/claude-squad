//go:build !windows

package terminal

import (
	"os"
	"os/signal"
	"syscall"

	"github.com/tstapler/stapler-squad/log"

	tea "github.com/charmbracelet/bubbletea"
)

// SetupResizeHandler sets up proper SIGWINCH signal handling for terminal resize events
func (sm *SignalManager) SetupResizeHandler() tea.Cmd {
	return func() tea.Msg {
		// Create a channel to receive SIGWINCH signals
		sigwinch := make(chan os.Signal, 1)
		signal.Notify(sigwinch, syscall.SIGWINCH)

		// Wait for SIGWINCH signal
		<-sigwinch

		// Get the new terminal size
		width, height, method := sm.sizeManager.GetReliableSize()
		log.InfoLog.Printf("SIGWINCH received - terminal resized to %dx%d (method: %s)", width, height, method)

		// For tiling window managers, detect if PTY size seems much larger than typical visible area
		if height > 80 || width > 200 {
			log.WarningLog.Printf("SIGWINCH: PTY reports large size (%dx%d) - may indicate tiling window manager with PTY/visible area mismatch", width, height)
		}

		return ResizeMsg{Width: width, Height: height}
	}
}
