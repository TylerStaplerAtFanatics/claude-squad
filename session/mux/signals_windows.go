//go:build windows

package mux

import (
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/creack/pty"
)

// handleSignals sets up signal handlers for terminal resize and termination.
func (m *Multiplexer) handleSignals(done chan struct{}) {
	// Handle termination signals (SIGWINCH not available on Windows)
	sigterm := make(chan os.Signal, 1)
	signal.Notify(sigterm, syscall.SIGINT, syscall.SIGTERM)

	// Set initial window size from terminal
	if size, err := pty.GetsizeFull(os.Stdin); err == nil {
		_ = m.SetWindowSize(uint16(size.Cols), uint16(size.Rows))
	}

	go func() {
		defer signal.Stop(sigterm)

		// On Windows, we'll just periodically check for window size changes
		// since SIGWINCH is not available
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()

		var lastCols, lastRows uint16
		if size, err := pty.GetsizeFull(os.Stdin); err == nil {
			lastCols, lastRows = uint16(size.Cols), uint16(size.Rows)
		}

		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				if size, err := pty.GetsizeFull(os.Stdin); err == nil {
					cols, rows := uint16(size.Cols), uint16(size.Rows)
					if cols != lastCols || rows != lastRows {
						lastCols, lastRows = cols, rows
						_ = m.SetWindowSize(cols, rows)
					}
				}
			case <-sigterm:
				m.Shutdown()
				return
			}
		}
	}()
}
