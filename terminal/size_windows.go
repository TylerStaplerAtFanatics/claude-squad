//go:build windows

package terminal

// getTerminalSizeIOCTL uses direct ioctl syscall to get terminal size
// On Windows, this is a no-op as ioctl is not available.
func getTerminalSizeIOCTL() (int, int) {
	return 0, 0
}
