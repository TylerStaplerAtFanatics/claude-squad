//go:build !windows

package terminal

import (
	"syscall"
	"unsafe"
)

// getTerminalSizeIOCTL uses direct ioctl syscall to get terminal size
func getTerminalSizeIOCTL() (int, int) {
	type winsize struct {
		Row    uint16
		Col    uint16
		Xpixel uint16
		Ypixel uint16
	}

	ws := &winsize{}
	retCode, _, _ := syscall.Syscall(syscall.SYS_IOCTL,
		uintptr(syscall.Stdin),
		uintptr(syscall.TIOCGWINSZ),
		uintptr(unsafe.Pointer(ws)))

	if int(retCode) == -1 {
		return 0, 0
	}

	return int(ws.Col), int(ws.Row)
}
