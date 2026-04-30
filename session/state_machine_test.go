package session

import (
	"errors"
	"testing"
)

// allStatuses lists every Status constant known to the transition table.
var allStatuses = []Status{Creating, Ready, Running, Loading, Paused, NeedsApproval, Stopped}

// validTransitionSet is the ground truth for TestCanTransition_ExhaustiveMatrix.
// Any pair not listed here must return false from CanTransition.
var validTransitionSet = map[[2]Status]bool{
	// Creating
	{Creating, Running}: true,
	{Creating, Stopped}: true,
	// Ready
	{Ready, Running}: true,
	{Ready, Paused}:  true,
	{Ready, Stopped}: true,
	// Running
	{Running, Ready}:         true,
	{Running, Paused}:        true,
	{Running, NeedsApproval}: true,
	{Running, Stopped}:       true,
	// Paused
	{Paused, Running}: true,
	{Paused, Stopped}: true,
	// NeedsApproval
	{NeedsApproval, Running}: true,
	{NeedsApproval, Paused}:  true,
	{NeedsApproval, Stopped}: true,
	// Loading
	{Loading, Running}: true,
	{Loading, Paused}:  true,
	{Loading, Stopped}: true,
	// Stopped — recoverable: Stopped → Running is allowed for session revival
	{Stopped, Running}: true,
}

// TestCanTransition_ExhaustiveMatrix verifies every pair of known statuses against
// the ground-truth validTransitionSet. This is the single source of truth: adding
// a new transition to allowedTransitions without also updating validTransitionSet
// (or vice-versa) will cause this test to fail.
func TestCanTransition_ExhaustiveMatrix(t *testing.T) {
	for _, from := range allStatuses {
		for _, to := range allStatuses {
			pair := [2]Status{from, to}
			wantValid := validTransitionSet[pair]
			got := CanTransition(from, to)
			if got != wantValid {
				if wantValid {
					t.Errorf("CanTransition(%s, %s) = false, want true (missing from allowedTransitions)", from, to)
				} else {
					t.Errorf("CanTransition(%s, %s) = true, want false (should be invalid)", from, to)
				}
			}
		}
	}
}

// TestCanTransition_ValidTransitions is a human-readable complement to the matrix
// test — it names each valid transition explicitly for documentation value.
func TestCanTransition_ValidTransitions(t *testing.T) {
	tests := []struct {
		name string
		from Status
		to   Status
	}{
		// Creating transitions
		{"Creating -> Running", Creating, Running},
		{"Creating -> Stopped", Creating, Stopped},
		// Ready transitions
		{"Ready -> Running", Ready, Running},
		{"Ready -> Paused", Ready, Paused},
		{"Ready -> Stopped", Ready, Stopped},
		// Running transitions
		{"Running -> Ready", Running, Ready},
		{"Running -> Paused", Running, Paused},
		{"Running -> NeedsApproval", Running, NeedsApproval},
		{"Running -> Stopped", Running, Stopped},
		// Paused transitions
		{"Paused -> Running", Paused, Running},
		{"Paused -> Stopped", Paused, Stopped},
		// NeedsApproval transitions
		{"NeedsApproval -> Running", NeedsApproval, Running},
		{"NeedsApproval -> Paused", NeedsApproval, Paused},
		{"NeedsApproval -> Stopped", NeedsApproval, Stopped},
		// Loading transitions
		{"Loading -> Running", Loading, Running},
		{"Loading -> Paused", Loading, Paused},
		{"Loading -> Stopped", Loading, Stopped},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if !CanTransition(tt.from, tt.to) {
				t.Errorf("CanTransition(%s, %s) = false, want true", tt.from, tt.to)
			}
		})
	}
}

// TestCanTransition_InvalidTransitions spot-checks transitions that must never be
// allowed. The exhaustive matrix test above already catches all of them, but having
// named cases here makes failures easier to diagnose.
func TestCanTransition_InvalidTransitions(t *testing.T) {
	tests := []struct {
		name string
		from Status
		to   Status
	}{
		// Stopped allows only Running (recovery); all other outgoing transitions are invalid
		{"Stopped -> Paused", Stopped, Paused},
		{"Stopped -> Ready", Stopped, Ready},
		{"Stopped -> NeedsApproval", Stopped, NeedsApproval},
		{"Stopped -> Loading", Stopped, Loading},
		{"Stopped -> Creating", Stopped, Creating},
		// Self-transitions are not allowed
		{"Running -> Running", Running, Running},
		{"Paused -> Paused", Paused, Paused},
		{"Ready -> Ready", Ready, Ready},
		{"Stopped -> Stopped", Stopped, Stopped},
		// Paused cannot go directly to NeedsApproval
		{"Paused -> NeedsApproval", Paused, NeedsApproval},
		// No state can transition to Creating or Loading (startup-only states)
		{"Running -> Creating", Running, Creating},
		{"Running -> Loading", Running, Loading},
		{"Paused -> Creating", Paused, Creating},
		{"Ready -> Creating", Ready, Creating},
		// Creating cannot go to Paused (no session exists yet)
		{"Creating -> Paused", Creating, Paused},
		{"Creating -> NeedsApproval", Creating, NeedsApproval},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if CanTransition(tt.from, tt.to) {
				t.Errorf("CanTransition(%s, %s) = true, want false", tt.from, tt.to)
			}
		})
	}
}

func TestCanTransition_UnknownStatus(t *testing.T) {
	unknownStatus := Status(999)
	if CanTransition(unknownStatus, Running) {
		t.Error("CanTransition with unknown from status should return false")
	}
	if CanTransition(Running, unknownStatus) {
		t.Error("CanTransition with unknown to status should return false")
	}
}

func TestErrInvalidTransition(t *testing.T) {
	err := ErrInvalidTransition{From: Paused, To: NeedsApproval}

	// Verify the error message format
	expected := "invalid transition: Paused -> NeedsApproval"
	if err.Error() != expected {
		t.Errorf("ErrInvalidTransition.Error() = %q, want %q", err.Error(), expected)
	}

	// Verify it can be detected with errors.As
	var target ErrInvalidTransition
	if !errors.As(err, &target) {
		t.Error("errors.As should match ErrInvalidTransition")
	}
	if target.From != Paused || target.To != NeedsApproval {
		t.Errorf("errors.As target = {%s, %s}, want {Paused, NeedsApproval}", target.From, target.To)
	}
}

func TestAllowedTransitions_StoppedRecovery(t *testing.T) {
	// Stopped allows exactly one outgoing transition: Running (session revival).
	// This enables the reconciler to revive sessions whose tmux process reappears.
	allowed, ok := allowedTransitions[Stopped]
	if !ok {
		t.Fatal("Stopped should be present in allowedTransitions map")
	}
	if len(allowed) != 1 || allowed[0] != Running {
		t.Errorf("Stopped should have exactly 1 transition [Running], got %d: %v", len(allowed), allowed)
	}
}

func TestAllowedTransitions_AllStatusesCovered(t *testing.T) {
	for _, s := range allStatuses {
		if _, ok := allowedTransitions[s]; !ok {
			t.Errorf("Status %s is not covered in allowedTransitions", s)
		}
	}
}

// TestAllowedTransitions_StoppedReachableFromEveryState verifies that every
// non-terminal state can reach Stopped in at most one hop. This is a safety
// property: sessions must always be stoppable.
func TestAllowedTransitions_StoppedReachableFromEveryState(t *testing.T) {
	for _, s := range allStatuses {
		if s == Stopped {
			continue
		}
		if !CanTransition(s, Stopped) {
			t.Errorf("State %s cannot transition directly to Stopped — all states must be stoppable", s)
		}
	}
}

// TestTransitionTo_ValidTransitions verifies that Instance.transitionTo updates
// Status and returns nil for every allowed transition.
func TestTransitionTo_ValidTransitions(t *testing.T) {
	for pair := range validTransitionSet {
		from, to := pair[0], pair[1]
		t.Run(from.String()+"->"+to.String(), func(t *testing.T) {
			inst := &Instance{Title: "test", Status: from}
			err := inst.transitionTo(to)
			if err != nil {
				t.Errorf("transitionTo(%s) from %s: unexpected error %v", to, from, err)
			}
			if inst.Status != to {
				t.Errorf("after transitionTo(%s): Status = %s, want %s", to, inst.Status, to)
			}
		})
	}
}

// TestTransitionTo_InvalidTransitions verifies that Instance.transitionTo returns
// ErrInvalidTransition and leaves Status unchanged for every disallowed transition.
func TestTransitionTo_InvalidTransitions(t *testing.T) {
	for _, from := range allStatuses {
		for _, to := range allStatuses {
			if validTransitionSet[[2]Status{from, to}] {
				continue // skip valid pairs
			}
			from, to := from, to // capture
			t.Run(from.String()+"->"+to.String(), func(t *testing.T) {
				inst := &Instance{Title: "test", Status: from}
				err := inst.transitionTo(to)
				if err == nil {
					t.Errorf("transitionTo(%s) from %s: expected error, got nil", to, from)
					return
				}
				var te ErrInvalidTransition
				if !errors.As(err, &te) {
					t.Errorf("transitionTo(%s) from %s: error is %T, want ErrInvalidTransition", to, from, err)
				}
				if inst.Status != from {
					t.Errorf("transitionTo(%s) from %s: Status changed to %s (must be unchanged on error)", to, from, inst.Status)
				}
			})
		}
	}
}

// TestTransitionTo_ChainedTransitions verifies common multi-hop paths through
// the state machine work as a sequence of transitionTo calls.
func TestTransitionTo_ChainedTransitions(t *testing.T) {
	type step struct{ to Status }

	chains := []struct {
		name  string
		start Status
		steps []step
	}{
		{
			name:  "new session lifecycle",
			start: Ready,
			steps: []step{{Running}, {Paused}, {Running}, {Stopped}},
		},
		{
			name:  "needs approval flow",
			start: Running,
			steps: []step{{NeedsApproval}, {Running}, {Stopped}},
		},
		{
			name:  "idle detection cycle",
			start: Running,
			steps: []step{{Ready}, {Running}, {Ready}, {Stopped}},
		},
		{
			name:  "loading to paused (worktree deleted)",
			start: Loading,
			steps: []step{{Paused}, {Running}, {Stopped}},
		},
		{
			name:  "ready to paused (worktree deleted before first start)",
			start: Ready,
			steps: []step{{Paused}, {Running}, {Stopped}},
		},
	}

	for _, chain := range chains {
		t.Run(chain.name, func(t *testing.T) {
			inst := &Instance{Title: "test-chain", Status: chain.start}
			for i, step := range chain.steps {
				if err := inst.transitionTo(step.to); err != nil {
					t.Fatalf("step %d: transitionTo(%s) from %s: %v", i, step.to, inst.Status, err)
				}
			}
		})
	}
}
