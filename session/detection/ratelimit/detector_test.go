package ratelimit

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestDetector_ProcessOutput_AnthropicRateLimit(t *testing.T) {
	detector := NewDetector("test-session")

	output := `Usage limit reached for claude-3-opus.
Access resets at 2:53 PM PDT.
1. Keep trying
2. Stop`

	detected := detector.detectInOutput(output)
	if detected == nil {
		t.Error("expected detection, got nil")
		return
	}

	if detected.Provider != ProviderAnthropic {
		t.Errorf("expected provider %v, got %v", ProviderAnthropic, detected.Provider)
	}

	if detected.State != StateWaiting {
		t.Errorf("expected state %v, got %v", StateWaiting, detected.State)
	}
}

func TestDetector_ProcessOutput_GeminiRateLimit(t *testing.T) {
	detector := NewDetector("test-session")

	output := `│ Usage limit reached for gemini-3-flash-preview.                                                                                                                          │
│ Access resets at 2:53 PM PDT.                                                                                                                                            │
│ /stats model for usage details                                                                                                                                           │
│ /model to switch models.                                                                                                                                                 │
│ /auth to switch to API key.                                                                                                                                              │
│                                                                                                                                                                          │
│                                                                                                                                                                          │
│ ● 1. Keep trying                                                                                                                                                         │
│   2. Stop                                                                                                                                                                │`

	detected := detector.detectInOutput(output)
	if detected == nil {
		t.Error("expected detection for Gemini rate limit, got nil")
		return
	}

	if detected.Provider != ProviderGoogle && detected.Provider != ProviderAnthropic && detected.Provider != ProviderUnknown {
		t.Errorf("expected provider google, anthropic, or unknown, got %v", detected.Provider)
	}

	if detected.State != StateWaiting {
		t.Errorf("expected state %v, got %v", StateWaiting, detected.State)
	}

	if detected.ResetTime.IsZero() {
		t.Error("expected reset time to be parsed from output")
	}
}

func TestDetector_ProcessOutput_NoRateLimit(t *testing.T) {
	detector := NewDetector("test-session")

	output := `Hello, this is normal output.
No rate limit here.
Just a regular conversation.`

	var detected Detection
	detector.SetDetectionCallback(func(d Detection) {
		detected = d
	})

	detector.ProcessOutput([]byte(output))

	if detected.Provider != "" {
		t.Errorf("expected no detection, got provider %v", detected.Provider)
	}
}

func TestDetector_ProcessOutput_FalsePositive(t *testing.T) {
	detector := NewDetector("test-session")

	output := `I should check the rate limit documentation.
The limit is 100 requests per minute.
Let me try again later.`

	var detected Detection
	detector.SetDetectionCallback(func(d Detection) {
		detected = d
	})

	detector.ProcessOutput([]byte(output))

	if detected.Provider != "" {
		t.Errorf("expected no detection (false positive), got provider %v", detected.Provider)
	}
}

func TestDetector_Cooldown(t *testing.T) {
	detector := NewDetector("test-session")
	detector.SetCooldown(500 * time.Millisecond)

	output := `Usage limit reached for claude-3-opus.
Access resets at 2:53 PM PDT.
1. Keep trying
2. Stop`

	detected := detector.detectInOutput(output)
	if detected == nil {
		t.Error("expected detection")
		return
	}

	count := 0
	detector.SetDetectionCallback(func(d Detection) {
		count++
	})

	detector.SetState(StateNone)
	detector.lastDetection = time.Now()

	detector.ProcessOutput([]byte(output))
	if count != 0 {
		t.Errorf("expected 0 detection during cooldown, got %d", count)
	}
}

func TestDetector_IdentifyProvider_Anthropic(t *testing.T) {
	detector := NewDetector("test-session")

	tests := []struct {
		output   string
		expected Provider
	}{
		{`/rate-limit-options`, ProviderAnthropic},
		{`Usage limit reached for claude-3-opus`, ProviderAnthropic},
		{`Access resets at 3:00 PM`, ProviderAnthropic},
	}

	for _, tc := range tests {
		provider := detector.identifyProvider(tc.output)
		if provider != tc.expected {
			t.Errorf("for input %q, expected %v, got %v", tc.output, tc.expected, provider)
		}
	}
}

func TestDetector_IdentifyProvider_OpenAI(t *testing.T) {
	detector := NewDetector("test-session")

	tests := []struct {
		output   string
		expected Provider
	}{
		{`exceeded retry limit, last status: 429`, ProviderOpenAI},
	}

	for _, tc := range tests {
		provider := detector.identifyProvider(tc.output)
		if provider != tc.expected {
			t.Errorf("for input %q, expected %v, got %v", tc.output, tc.expected, provider)
		}
	}
}

func TestScheduler_ScheduleRecovery(t *testing.T) {
	scheduler := NewScheduler("test-session")
	scheduler.SetBuffer(1)

	var executed atomic.Bool
	scheduler.SetRecoveryCallback(func() error {
		executed.Store(true)
		return nil
	})

	futureTime := time.Now().Add(100 * time.Millisecond)
	scheduler.ScheduleRecovery(futureTime)

	if !scheduler.IsScheduled() {
		t.Error("expected scheduler to be scheduled")
	}

	time.Sleep(1500 * time.Millisecond)

	if !executed.Load() {
		t.Error("expected recovery callback to be executed")
	}
}

func TestScheduler_CancelRecovery(t *testing.T) {
	scheduler := NewScheduler("test-session")

	var executed atomic.Bool
	scheduler.SetRecoveryCallback(func() error {
		executed.Store(true)
		return nil
	})

	futureTime := time.Now().Add(10 * time.Second)
	scheduler.ScheduleRecovery(futureTime)

	scheduler.CancelRecovery()

	time.Sleep(50 * time.Millisecond)

	if executed.Load() {
		t.Error("expected recovery callback to NOT be executed after cancel")
	}
}

func TestRecoveryHandler_Execute(t *testing.T) {
	var sentInput []byte
	handler := NewRecoveryHandler("test-session", func(data []byte) error {
		sentInput = data
		return nil
	})

	input := []byte("1\n")
	err := handler.Execute(input)

	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}

	if string(sentInput) != "1\n" {
		t.Errorf("expected input '1\\n', got %q", string(sentInput))
	}
}

func TestRecoveryHandler_Execute_Error(t *testing.T) {
	handler := NewRecoveryHandler("test-session", func(data []byte) error {
		return assertErr
	})

	err := handler.Execute([]byte("1\n"))

	if err == nil {
		t.Error("expected error, got nil")
	}
}

var assertErr = assertErrT{}

type assertErrT struct{}

func (e assertErrT) Error() string {
	return "assertion failed"
}

func TestEventBus_Subscribe_Publish(t *testing.T) {
	bus := NewEventBus()

	ch := bus.Subscribe(eventDetected)

	event := RateLimitEvent{
		Type:      eventDetected,
		SessionID: "test-session",
	}

	bus.Publish(event)

	select {
	case received := <-ch:
		if received.SessionID != event.SessionID {
			t.Errorf("expected session ID %v, got %v", event.SessionID, received.SessionID)
		}
	case <-time.After(time.Second):
		t.Error("timeout waiting for event")
	}
}

func TestManager_ProcessOutput(t *testing.T) {
	manager := NewManager("test-session", nil)
	manager.SetEnabled(true)

	output := `──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮│ Usage limit reached for gemini-3-flash-preview.                                                                                                                          ││ Access resets at 2:53 PM PDT.                                                                                                                                            ││ ● 1. Keep trying                                                                                                                                                         ││   2. Stop                                                                                                                                                                │╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯`

	state := manager.GetState()
	if state != StateNone {
		t.Errorf("expected initial state StateNone, got %v", state)
	}

	manager.ProcessOutput([]byte(output))

	state = manager.GetState()
	if state != StateWaiting {
		t.Errorf("expected state StateWaiting after detection, got %v", state)
	}
}

func TestManager_Disable(t *testing.T) {
	manager := NewManager("test-session", nil)
	manager.SetEnabled(false)

	output := `──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮│ Usage limit reached for gemini-3-flash-preview.                                                                                                                          ││ Access resets at 2:53 PM PDT.                                                                                                                                            ││ ● 1. Keep trying                                                                                                                                                         ││   2. Stop                                                                                                                                                                │╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯`

	manager.ProcessOutput([]byte(output))

	state := manager.GetState()
	if state != StateNone {
		t.Errorf("expected state StateNone when disabled, got %v", state)
	}
}

func TestStripANSI(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"\x1b[31mred\x1b[0m", "red"},
		{"\x1b[1;32mgreen\x1b[0m", "green"},
		{"no escape codes", "no escape codes"},
		{"\x1b[0m\x1b[1m\x1b[4m\x1b[7m\x1b[9m\x1b[0m", ""},
	}

	for _, tc := range tests {
		result := stripANSI(tc.input)
		if result != tc.expected {
			t.Errorf("stripANSI(%q) = %q, want %q", tc.input, result, tc.expected)
		}
	}
}

func TestDetector_StateTransitions(t *testing.T) {
	detector := NewDetector("test-session")

	if state := detector.GetState(); state != StateNone {
		t.Errorf("initial state should be StateNone, got %v", state)
	}

	detector.SetState(StateWaiting)
	if state := detector.GetState(); state != StateWaiting {
		t.Errorf("after SetState(StateWaiting), expected StateWaiting, got %v", state)
	}

	detector.SetState(StateRecovered)
	if state := detector.GetState(); state != StateRecovered {
		t.Errorf("after SetState(StateRecovered), expected StateRecovered, got %v", state)
	}

	detector.SetState(StateFailed)
	if state := detector.GetState(); state != StateFailed {
		t.Errorf("after SetState(StateFailed), expected StateFailed, got %v", state)
	}
}

func TestParseTimestamp_RetryAfter(t *testing.T) {
	detector := NewDetector("test-session")

	output := "Please retry after 60 second"
	resetTime := detector.parseResetTime(output)

	t.Logf("Output: %q", output)
	t.Logf("Reset time: %v", resetTime)

	for _, p := range detector.timestampPatterns {
		m := p.FindStringSubmatch(output)
		if len(m) > 1 {
			t.Logf("Pattern %q matches: %v, capture group 1: %q", p.String(), m, m[1])
			parsed := detector.parseTimestamp(m[1])
			t.Logf("  parseTimestamp(%q) = %v", m[1], parsed)
		}
	}

	if resetTime.IsZero() {
		t.Error("expected non-zero reset time for 'retry after 60 second'")
		return
	}

	expectedWait := 60 * time.Second
	actualWait := time.Until(resetTime)
	if actualWait < expectedWait-5*time.Second || actualWait > expectedWait+5*time.Second {
		t.Errorf("expected wait time around 60s, got %v", actualWait)
	}
}

func TestParseTimestamp_SpecificTime(t *testing.T) {
	detector := NewDetector("test-session")

	output := "Access resets at 3:00 PM"
	resetTime := detector.parseResetTime(output)

	if resetTime.IsZero() {
		t.Error("expected non-zero reset time for 'Access resets at 3:00 PM'")
		return
	}

	hour := resetTime.Hour()
	if hour != 15 && hour != 3 {
		t.Errorf("expected hour 15 (3 PM) or 3, got %d", hour)
	}
}

func TestDetector_ConcurrentProcessOutput(t *testing.T) {
	detector := NewDetector("test-session")

	var wg sync.WaitGroup
	numGoroutines := 10
	numIterations := 100

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < numIterations; j++ {
				detector.ProcessOutput([]byte("normal output"))
			}
		}()
	}

	wg.Wait()

	state := detector.GetState()
	if state != StateNone {
		t.Errorf("expected state StateNone after concurrent processing, got %v", state)
	}
}
