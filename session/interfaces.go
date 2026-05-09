package session

// interfaces.go defines narrow interfaces at the server/session boundary.
// Consumers of *Instance in the server layer should depend on these interfaces
// rather than the concrete type wherever the full surface is not required.

import (
	"time"

	"github.com/tstapler/stapler-squad/session/git"
)

// InstanceReader exposes the read-only attributes of an Instance that are
// consumed by review-queue helpers (addStartupItem, syncOrphanedApprovalsToQueue)
// and other server-layer code that only needs to observe session state.
//
// *Instance satisfies this interface automatically; a lightweight fake can be
// used in unit tests without spinning up a real tmux session.
type InstanceReader interface {
	// Identity
	GetTitle() string
	GetStableID() string

	// Descriptive metadata
	GetWorkingDirectory() string

	// Status returns the current lifecycle status as int (cast to Status for display).
	GetStatus() int

	// Git / diff
	GetDiffStats() *git.DiffStats

	// Activity timestamps
	GetTimeSinceLastMeaningfulOutput() time.Duration
}
