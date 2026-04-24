//go:build integration

package tmux_test

import (
	"context"
	"os/exec"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/tstapler/stapler-squad/session/tmux"
)

// newIsolatedSocket returns a unique tmux socket name for the test and registers
// cleanup that kills the isolated server when the test finishes.
func newIsolatedSocket(t *testing.T) string {
	t.Helper()
	socket := "integration_" + t.Name()
	// Replace characters that are invalid in tmux socket names.
	safeSocket := ""
	for _, c := range socket {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' {
			safeSocket += string(c)
		} else {
			safeSocket += "_"
		}
	}
	t.Cleanup(func() {
		exec.Command("tmux", "-L", safeSocket, "kill-server").Run() //nolint:errcheck
	})
	return safeSocket
}

// startIsolatedRegistry starts a tmux server on an isolated socket, creates the
// keepalive session (required by TmuxServerRegistry's control-mode attach), and
// returns a running registry whose context is cancelled by t.Cleanup.
func startIsolatedRegistry(t *testing.T) (*tmux.TmuxServerRegistry, string) {
	t.Helper()
	socket := newIsolatedSocket(t)

	// Create the keepalive session atomically with the server start. Using a
	// single new-session command avoids a race where the server starts with
	// exit-empty=on and then exits before the separate new-session arrives.
	// TmuxPrefix+"keepalive" is the name that TmuxServerRegistry.startControlMode
	// attaches to. "sleep 300" keeps the session alive for the test duration.
	keepaliveName := tmux.TmuxPrefix + "keepalive"
	if out, err := exec.Command("tmux", "-L", socket, "new-session", "-d", "-s", keepaliveName, "sleep 300").CombinedOutput(); err != nil {
		t.Fatalf("create keepalive session: %v (%s)", err, out)
	}

	registry := tmux.NewTmuxServerRegistry(socket)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	if err := registry.Start(ctx); err != nil {
		t.Fatalf("registry.Start: %v", err)
	}

	return registry, socket
}

// pollUntil polls fn every 5 ms until it returns true or the deadline expires.
// It calls t.Fatal with msg if the deadline is exceeded.
func pollUntil(t *testing.T, timeout time.Duration, msg string, fn func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if fn() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal(msg)
}

// Test 1: Registry starts and becomes healthy within 2 seconds.
// IsHealthy is set in the reconnectLoop goroutine for a brief window on each
// cycle. We spin-wait with runtime.Gosched() to cooperatively yield and catch
// the healthy window without a fixed sleep interval.
func TestTmuxServerRegistry_StartsHealthy(t *testing.T) {
	registry, _ := startIsolatedRegistry(t)

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if registry.IsHealthy() {
			return
		}
		runtime.Gosched()
	}
	t.Fatal("registry did not become healthy within 2 seconds")
}

// Test 2: Creating a tmux session reflects in SessionExists within 1 second.
// The registry syncs its session map on every reconnect cycle (~100ms), so even
// in headless environments where the control-mode connection is short-lived a
// new session becomes visible on the next syncSessions pass.
func TestTmuxServerRegistry_SessionCreated(t *testing.T) {
	registry, socket := startIsolatedRegistry(t)

	sessionName := "testcreated"
	if out, err := exec.Command("tmux", "-L", socket, "new-session", "-d", "-s", sessionName).CombinedOutput(); err != nil {
		t.Fatalf("new-session: %v (%s)", err, out)
	}
	t.Cleanup(func() {
		exec.Command("tmux", "-L", socket, "kill-session", "-t", sessionName).Run() //nolint:errcheck
	})

	pollUntil(t, time.Second, "session not visible in registry within 1s", func() bool {
		return registry.SessionExists(sessionName)
	})
}

// Test 3: Killing a tmux session closes SubscribePaneExit channel within 1 second.
// In headless mode the registry detects the disappearance via syncSessions on
// the next reconnect cycle and fires firePaneExit for gone sessions.
func TestTmuxServerRegistry_PaneExitChannel(t *testing.T) {
	registry, socket := startIsolatedRegistry(t)

	sessionName := "testpaneexit"
	if out, err := exec.Command("tmux", "-L", socket, "new-session", "-d", "-s", sessionName).CombinedOutput(); err != nil {
		t.Fatalf("new-session: %v (%s)", err, out)
	}

	// Wait until the registry knows about the session so it can detect its removal.
	pollUntil(t, time.Second, "session not visible in registry before subscribing", func() bool {
		return registry.SessionExists(sessionName)
	})

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	exitCh := registry.SubscribePaneExit(ctx, sessionName)

	if out, err := exec.Command("tmux", "-L", socket, "kill-session", "-t", sessionName).CombinedOutput(); err != nil {
		t.Fatalf("kill-session: %v (%s)", err, out)
	}

	select {
	case <-exitCh:
		// channel closed as expected
	case <-time.After(time.Second):
		t.Fatal("SubscribePaneExit channel not closed within 1s after kill-session")
	}
}

// Test 4: ListSessions returns the correct set after create/destroy cycles.
func TestTmuxServerRegistry_ListSessions(t *testing.T) {
	registry, socket := startIsolatedRegistry(t)

	for _, name := range []string{"foo", "bar"} {
		if out, err := exec.Command("tmux", "-L", socket, "new-session", "-d", "-s", name).CombinedOutput(); err != nil {
			t.Fatalf("new-session %s: %v (%s)", name, err, out)
		}
	}
	t.Cleanup(func() {
		exec.Command("tmux", "-L", socket, "kill-session", "-t", "bar").Run() //nolint:errcheck
	})

	// Wait for both sessions to appear.
	pollUntil(t, time.Second, "sessions 'foo' and 'bar' not both visible within 1s", func() bool {
		sessions := registry.ListSessions()
		return sessions["foo"] && sessions["bar"]
	})

	// Kill "foo" and verify only "bar" remains.
	if out, err := exec.Command("tmux", "-L", socket, "kill-session", "-t", "foo").CombinedOutput(); err != nil {
		t.Fatalf("kill-session foo: %v (%s)", err, out)
	}

	pollUntil(t, time.Second, "'foo' still visible in ListSessions after kill", func() bool {
		sessions := registry.ListSessions()
		return !sessions["foo"] && sessions["bar"]
	})
}

// Test 5: Concurrent subscription stress test — passes under the race detector.
func TestTmuxServerRegistry_ConcurrentSubscriptions(t *testing.T) {
	registry, socket := startIsolatedRegistry(t)

	sessionName := "concurrent-test"
	if out, err := exec.Command("tmux", "-L", socket, "new-session", "-d", "-s", sessionName).CombinedOutput(); err != nil {
		t.Fatalf("new-session: %v (%s)", err, out)
	}

	// Wait until the registry sees the session.
	pollUntil(t, time.Second, "session not visible before concurrent subscriptions", func() bool {
		return registry.SessionExists(sessionName)
	})

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	const numGoroutines = 10
	channels := make([]<-chan struct{}, numGoroutines)
	var wg sync.WaitGroup

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			channels[idx] = registry.SubscribePaneExit(ctx, sessionName)
		}(i)
	}
	wg.Wait()

	// Kill the session; all subscriber channels must close.
	if out, err := exec.Command("tmux", "-L", socket, "kill-session", "-t", sessionName).CombinedOutput(); err != nil {
		t.Fatalf("kill-session: %v (%s)", err, out)
	}

	timeout := time.After(time.Second)
	for i, ch := range channels {
		if ch == nil {
			t.Errorf("goroutine %d: channel is nil", i)
			continue
		}
		select {
		case <-ch:
			// closed as expected
		case <-timeout:
			t.Fatalf("goroutine %d: channel not closed within 1s after kill-session", i)
		}
	}
}
