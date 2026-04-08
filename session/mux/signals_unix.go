//go:build !windows

package mux

import (
	"os"
	"os/signal"
	"syscall"

	"github.com/creack/pty"
)

// notifyWinch registers ch to receive SIGWINCH (terminal resize) signals.
func notifyWinch(ch chan os.Signal) {
	signal.Notify(ch, syscall.SIGWINCH)
}

// handleSignals sets up signal handlers for terminal resize and termination.
func (m *Multiplexer) handleSignals(done chan struct{}) {
	// Handle terminal resize (SIGWINCH)
	sigwinch := make(chan os.Signal, 1)
	notifyWinch(sigwinch)

	// Handle termination signals
	sigterm := make(chan os.Signal, 1)
	signal.Notify(sigterm, syscall.SIGINT, syscall.SIGTERM)

	// Set initial window size from terminal
	if size, err := pty.GetsizeFull(os.Stdin); err == nil {
		_ = m.SetWindowSize(uint16(size.Cols), uint16(size.Rows))
	}

	go func() {
		defer signal.Stop(sigwinch)
		defer signal.Stop(sigterm)
		for {
			select {
			case <-done:
				return
			case <-sigwinch:
				if size, err := pty.GetsizeFull(os.Stdin); err == nil {
					_ = m.SetWindowSize(uint16(size.Cols), uint16(size.Rows))
				}
			case <-sigterm:
				m.Shutdown()
				return
			}
		}
	}()
}
