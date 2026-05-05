package tmux

import "context"

// SessionExistenceChecker answers "is session X alive right now?"
// Used by TmuxSession.DoesSessionExist to avoid exec.Command forks.
type SessionExistenceChecker interface {
	SessionExists(name string) bool
	IsHealthy() bool
}

// SessionExistenceWriter allows callers to proactively mark a session as
// existing in the registry. Used by start() to pre-populate the registry
// immediately after session creation, bridging the gap before the async
// %session-created control-mode event arrives.
type SessionExistenceWriter interface {
	MarkSessionExists(name string)
}

// SessionLister returns a snapshot of all live session names.
// Used by PTYDiscovery and reconciliation loops.
type SessionLister interface {
	ListSessions() map[string]bool
	IsHealthy() bool
}

// PaneExitSubscriber delivers a channel that is closed when the named pane
// exits. Caller selects on the returned channel alongside ctx.Done().
// Cancelling ctx unregisters the subscription; channel is closed immediately.
type PaneExitSubscriber interface {
	SubscribePaneExit(ctx context.Context, sessionName string) <-chan struct{}
}

// TmuxStatePort is the full registry interface.
type TmuxStatePort interface {
	SessionExistenceChecker
	SessionLister
	PaneExitSubscriber
}
