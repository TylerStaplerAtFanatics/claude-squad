package tmux

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/tstapler/stapler-squad/log"
)

// ErrRegistryUnavailable is returned when the registry is not healthy and cannot
// serve a request that requires the registry to be up.
var ErrRegistryUnavailable = errors.New("tmux registry unavailable")

// Compile-time interface checks.
var _ SessionExistenceChecker = (*TmuxServerRegistry)(nil)
var _ SessionLister = (*TmuxServerRegistry)(nil)
var _ PaneExitSubscriber = (*TmuxServerRegistry)(nil)
var _ TmuxStatePort = (*TmuxServerRegistry)(nil)

// TmuxServerRegistry maintains a single tmux control-mode connection to a tmux
// server and pushes session-lifecycle events into an in-memory map. Callers
// query the map directly instead of forking tmux subprocesses.
type TmuxServerRegistry struct {
	serverSocket string

	mu       sync.RWMutex
	sessions map[string]bool

	// subsMu guards subscribers. CRITICAL: never close(ch) while holding subsMu.
	// Copy channels out under the lock, release the lock, then close outside.
	subsMu      sync.Mutex
	subscribers map[string][]chan struct{}

	healthMu sync.RWMutex
	healthy  bool

	ctx    context.Context
	cancel context.CancelFunc
}

// NewTmuxServerRegistry creates a new registry for the given server socket.
// Call Start(ctx) to begin listening for events.
func NewTmuxServerRegistry(serverSocket string) *TmuxServerRegistry {
	ctx, cancel := context.WithCancel(context.Background())
	return &TmuxServerRegistry{
		serverSocket: serverSocket,
		sessions:     make(map[string]bool),
		subscribers:  make(map[string][]chan struct{}),
		ctx:          ctx,
		cancel:       cancel,
	}
}

// Start launches the control-mode process and begins processing events.
// It bootstraps the session map from list-sessions before marking the registry
// healthy. The returned error is non-nil only when the initial setup fails in a
// way that makes a retry impossible.
func (r *TmuxServerRegistry) Start(ctx context.Context) error {
	// Derive a child context so Stop() can cancel without affecting the caller.
	childCtx, childCancel := context.WithCancel(ctx)
	r.healthMu.Lock()
	r.healthy = false
	r.healthMu.Unlock()

	// Replace internal ctx/cancel with the derived pair so Stop() works.
	r.cancel()
	r.ctx = childCtx
	r.cancel = childCancel

	// Bootstrap session map from list-sessions before connecting control mode.
	if err := r.syncSessions(); err != nil {
		log.WarningLog.Printf("[registry] initial list-sessions failed, continuing: %v", err)
	}

	// Launch the auto-reconnect loop; it starts the first control-mode process.
	go r.reconnectLoop()

	return nil
}

// Stop shuts down the registry and closes all pending subscriber channels.
func (r *TmuxServerRegistry) Stop() {
	r.cancel()

	// Copy all subscriber channels under the lock, then close outside.
	r.subsMu.Lock()
	var allChs []chan struct{}
	for _, chs := range r.subscribers {
		allChs = append(allChs, chs...)
	}
	r.subscribers = make(map[string][]chan struct{})
	r.subsMu.Unlock()

	for _, ch := range allChs {
		close(ch)
	}

	r.healthMu.Lock()
	r.healthy = false
	r.healthMu.Unlock()
}

// SessionExists implements SessionExistenceChecker.
func (r *TmuxServerRegistry) SessionExists(name string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.sessions[name]
}

// ListSessions implements SessionLister. Returns a copy of the live sessions map.
func (r *TmuxServerRegistry) ListSessions() map[string]bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make(map[string]bool, len(r.sessions))
	for k, v := range r.sessions {
		out[k] = v
	}
	return out
}

// IsHealthy implements SessionExistenceChecker and SessionLister.
func (r *TmuxServerRegistry) IsHealthy() bool {
	r.healthMu.RLock()
	defer r.healthMu.RUnlock()
	return r.healthy
}

// SubscribePaneExit implements PaneExitSubscriber. The returned channel is
// closed when the named session/pane exits or when ctx is cancelled.
func (r *TmuxServerRegistry) SubscribePaneExit(ctx context.Context, sessionName string) <-chan struct{} {
	ch := make(chan struct{}, 1)

	r.subsMu.Lock()
	r.subscribers[sessionName] = append(r.subscribers[sessionName], ch)
	r.subsMu.Unlock()

	go func() {
		select {
		case <-ctx.Done():
			// Remove our channel from the subscriber list and close it.
			r.subsMu.Lock()
			existing := r.subscribers[sessionName]
			filtered := existing[:0]
			for _, c := range existing {
				if c != ch {
					filtered = append(filtered, c)
				}
			}
			if len(filtered) == 0 {
				delete(r.subscribers, sessionName)
			} else {
				r.subscribers[sessionName] = filtered
			}
			r.subsMu.Unlock()
			close(ch)
		case <-ch:
			// Closed by firePaneExit; nothing to do.
		case <-r.ctx.Done():
			// Registry is stopping; channel will be closed by Stop().
		}
	}()

	return ch
}

// firePaneExit closes all subscriber channels for sessionName. It copies the
// channels out under the lock and then closes them outside to prevent deadlock.
func (r *TmuxServerRegistry) firePaneExit(sessionName string) {
	r.subsMu.Lock()
	chs := r.subscribers[sessionName]
	delete(r.subscribers, sessionName)
	r.subsMu.Unlock()
	// Lock NOT held here — close outside the critical section.
	for _, ch := range chs {
		close(ch)
	}
}

// syncSessions runs list-sessions and replaces the in-memory map atomically.
func (r *TmuxServerRegistry) syncSessions() error {
	args := prependSocket(r.serverSocket, []string{"list-sessions", "-F", "#{session_name}"})
	cmd := exec.Command("tmux", args...)
	out, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("list-sessions: %w", err)
	}

	sessions := make(map[string]bool)
	for _, name := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if name != "" {
			sessions[name] = true
		}
	}

	r.mu.Lock()
	r.sessions = sessions
	r.mu.Unlock()
	return nil
}

// startControlMode launches "tmux [-L socket] -C attach-session -t keepalive -r"
// and returns the command along with a scanner for its stdout. It does NOT block.
func (r *TmuxServerRegistry) startControlMode() (*exec.Cmd, *bufio.Scanner, error) {
	keepaliveName := TmuxPrefix + "keepalive"
	baseArgs := []string{"-C", "attach-session", "-t", keepaliveName, "-r"}
	args := prependSocket(r.serverSocket, baseArgs)
	cmd := exec.Command("tmux", args...)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, nil, fmt.Errorf("StdoutPipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, nil, fmt.Errorf("cmd.Start: %w", err)
	}
	return cmd, bufio.NewScanner(stdout), nil
}

// reconnectLoop starts the control-mode process and reconnects with exponential
// backoff whenever it exits. It exits when the registry context is cancelled.
func (r *TmuxServerRegistry) reconnectLoop() {
	const (
		backoffBase = 100 * time.Millisecond
		backoffCap  = 30 * time.Second
	)
	backoff := backoffBase

	for {
		select {
		case <-r.ctx.Done():
			return
		default:
		}

		cmd, scanner, err := r.startControlMode()
		if err != nil {
			log.WarningLog.Printf("[registry] control-mode start failed: %v; retrying in %v", err, backoff)
			select {
			case <-r.ctx.Done():
				return
			case <-time.After(backoff):
			}
			if backoff < backoffCap {
				backoff *= 2
				if backoff > backoffCap {
					backoff = backoffCap
				}
			}
			continue
		}

		// Mark healthy now that the control-mode process is running.
		r.healthMu.Lock()
		r.healthy = true
		r.healthMu.Unlock()
		backoff = backoffBase // reset backoff on successful connect

		log.InfoLog.Printf("[registry] control-mode connected (socket=%q)", r.serverSocket)

		// readLines blocks until the process exits or the context is cancelled.
		r.readLines(scanner)

		// Clean up the process.
		_ = cmd.Process.Kill()
		_ = cmd.Wait()

		r.healthMu.Lock()
		r.healthy = false
		r.healthMu.Unlock()

		select {
		case <-r.ctx.Done():
			return
		default:
			log.InfoLog.Printf("[registry] control-mode exited; reconnecting in %v", backoff)
			select {
			case <-r.ctx.Done():
				return
			case <-time.After(backoff):
			}
			if backoff < backoffCap {
				backoff *= 2
				if backoff > backoffCap {
					backoff = backoffCap
				}
			}
		}
	}
}

// debounce state for %sessions-changed handling.
var (
	debounceTimer   *time.Timer
	debounceMu      sync.Mutex
	debounceDelay   = 50 * time.Millisecond
)

// readLines processes control-mode event lines from scanner until the scanner
// returns false (process exited) or the registry context is cancelled.
func (r *TmuxServerRegistry) readLines(scanner *bufio.Scanner) {
	for scanner.Scan() {
		select {
		case <-r.ctx.Done():
			return
		default:
		}
		line := scanner.Text()
		r.handleEvent(line)
	}
}

// handleEvent parses a single control-mode notification line and updates state.
func (r *TmuxServerRegistry) handleEvent(line string) {
	switch {
	case strings.HasPrefix(line, "%session-created "):
		// %session-created $ID <name>
		parts := strings.Fields(line)
		if len(parts) >= 3 {
			name := parts[2]
			r.mu.Lock()
			r.sessions[name] = true
			r.mu.Unlock()
			log.InfoLog.Printf("[registry] session created: %q", name)
		}

	case strings.HasPrefix(line, "%session-closed "):
		// %session-closed $ID <name>
		parts := strings.Fields(line)
		if len(parts) >= 3 {
			name := parts[2]
			r.mu.Lock()
			delete(r.sessions, name)
			r.mu.Unlock()
			log.InfoLog.Printf("[registry] session closed: %q", name)
			r.firePaneExit(name)
		}

	case strings.HasPrefix(line, "%sessions-changed"):
		// Debounce: wait 50ms then sync from list-sessions.
		debounceMu.Lock()
		if debounceTimer != nil {
			debounceTimer.Stop()
		}
		debounceTimer = time.AfterFunc(debounceDelay, func() {
			if err := r.syncSessions(); err != nil {
				log.WarningLog.Printf("[registry] sync after sessions-changed failed: %v", err)
			}
		})
		debounceMu.Unlock()

	case strings.HasPrefix(line, "%pane-exited "):
		// %pane-exited ... -t <session-name>
		// Parse the target from the line; look for the token after "-t".
		parts := strings.Fields(line)
		for i, part := range parts {
			if part == "-t" && i+1 < len(parts) {
				target := parts[i+1]
				// Target may be "session:window.pane" — extract session name.
				if idx := strings.Index(target, ":"); idx >= 0 {
					target = target[:idx]
				}
				r.firePaneExit(target)
				break
			}
		}

	case strings.HasPrefix(line, "%exit"):
		// Server is going away.
		r.healthMu.Lock()
		r.healthy = false
		r.healthMu.Unlock()

	case strings.HasPrefix(line, "%output"):
		// Per-session output events — handled by per-session control mode; drop here.

	default:
		// Unknown event — ignore, no panic.
	}
}

// GetServerRegistry returns the singleton TmuxServerRegistry for the given
// socket. Creates and starts the registry on first call for each socket.
// Never call from init().
func GetServerRegistry(socket string) *TmuxServerRegistry {
	globalRegistryMu.Lock()
	defer globalRegistryMu.Unlock()

	if r, ok := globalRegistries[socket]; ok {
		return r
	}

	r := NewTmuxServerRegistry(socket)
	_ = r.Start(context.Background())
	globalRegistries[socket] = r
	return r
}

// globalRegistryMu guards globalRegistries.
var globalRegistryMu sync.Mutex

// globalRegistries holds one registry per socket string.
var globalRegistries = make(map[string]*TmuxServerRegistry)
