package session

// allowedTransitions defines the valid state machine transitions.
// Any transition not explicitly listed here is considered invalid.
//
// State machine diagram:
//
//	Creating      --> Running, Stopped
//	Ready         --> Running, Paused, Stopped
//	Running       --> Ready, Paused, NeedsApproval, Stopped
//	Paused        --> Running, Stopped
//	NeedsApproval --> Running, Paused, Stopped
//	Loading       --> Running, Paused, Stopped
//	Stopped       --> (terminal state, no outgoing transitions)
//
// Design notes:
//   - Creating is reserved for future use; new instances currently start at Ready.
//   - Ready represents both the initial state (before first Start) and the activity
//     state when Claude is idle / waiting for input.
//   - Running <-> Ready allows the detection layer to reflect Claude's activity level
//     without a separate status field.
//   - Ready → Paused and Loading → Paused are needed so the worktree-deletion recovery
//     path in FromInstanceData can use transitionTo instead of bypassing the state machine.
var allowedTransitions = map[Status][]Status{
	Creating:      {Running, Stopped},
	Ready:         {Running, Paused, Stopped},
	Running:       {Ready, Paused, NeedsApproval, Stopped},
	Paused:        {Running, Stopped},
	NeedsApproval: {Running, Paused, Stopped},
	Loading:       {Running, Paused, Stopped},
	// Stopped → Running allows recovery when a stopped session's tmux process is
	// found alive again (e.g. external restart or reconciler false-positive).
	Stopped: {Running},
}

// CanTransition returns true if transitioning from -> to is a valid state transition.
func CanTransition(from, to Status) bool {
	allowed, ok := allowedTransitions[from]
	if !ok {
		return false
	}
	for _, s := range allowed {
		if s == to {
			return true
		}
	}
	return false
}
