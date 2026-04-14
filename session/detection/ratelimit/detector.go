package ratelimit

import (
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/tstapler/stapler-squad/log"
)

const (
	DefaultCooldown      = 30 * time.Second
	DefaultResetBuffer   = 5
	DefaultRecoveryInput = "1\n"
)

type Provider string

const (
	ProviderAnthropic Provider = "anthropic"
	ProviderOpenAI    Provider = "openai"
	ProviderGoogle    Provider = "google"
	ProviderAider     Provider = "aider"
	ProviderUnknown   Provider = "unknown"
)

type RateLimitState int

const (
	StateNone RateLimitState = iota
	StateWaiting
	StateRecovering
	StateRecovered
	StateFailed
)

type Detection struct {
	Provider    Provider
	State       RateLimitState
	ResetTime   time.Time
	InputToSend []byte
	DetectedAt  time.Time
}

type Detector struct {
	mu sync.Mutex

	sessionID string

	rateLimitPatterns []*regexp.Regexp
	continuePatterns  []*regexp.Regexp
	timestampPatterns []*regexp.Regexp
	providerPatterns  map[Provider][]*regexp.Regexp

	currentState     RateLimitState
	currentResetTime time.Time
	lastDetection    time.Time
	cooldown         time.Duration
	resetBufferSecs  int

	onDetection func(Detection)
}

var defaultRateLimitPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)/rate-limit-options`),
	regexp.MustCompile(`(?i)rate limit.*exceeded`),
	regexp.MustCompile(`(?i)429.*Too Many Requests`),
	regexp.MustCompile(`(?i)rate_limit_error`),
	regexp.MustCompile(`(?i)Usage limit reached`),
	regexp.MustCompile(`(?i)rate limit reached`),
	regexp.MustCompile(`(?i)quota exceeded`),
}

var defaultContinuePatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)1\.\s*Keep trying`),
	regexp.MustCompile(`(?i)press.*enter.*continue`),
	regexp.MustCompile(`(?i)continue.*\?.*\[y/n\]`),
	regexp.MustCompile(`(?i)\*?\s*\d+\.\s*(Keep|Try|Continue|Retry)`),
	regexp.MustCompile(`(?i)Access resets at`),
}

var defaultTimestampPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)(?:reset at|Access resets at) (.+?)(?:\s*$|PT|PDT)`),
	regexp.MustCompile(`(?i)retry\s*after\s*(\d+)\s*(second|minute|hour)s?`),
	regexp.MustCompile(`(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})`),
}

var providerSpecificPatterns = map[Provider][]*regexp.Regexp{
	ProviderAnthropic: {
		regexp.MustCompile(`(?i)/rate-limit-options`),
		regexp.MustCompile(`(?i)Usage limit reached for`),
		regexp.MustCompile(`(?i)Access resets at`),
	},
	ProviderOpenAI: {
		regexp.MustCompile(`(?i)Rate limit exceeded`),
		regexp.MustCompile(`(?i)exceeded retry limit.*429`),
		regexp.MustCompile(`(?i)openai.*rate limit`),
	},
	ProviderGoogle: {
		regexp.MustCompile(`(?i)rate limit.*gemini`),
		regexp.MustCompile(`(?i)429.*Too Many Requests`),
	},
	ProviderAider: {
		regexp.MustCompile(`(?i)RateLimitError`),
		regexp.MustCompile(`(?i)rate limit exceeded`),
	},
}

var providerRecoveryInputs = map[Provider][]byte{
	ProviderAnthropic: []byte("1\n"),
	ProviderOpenAI:    []byte("1\n"),
	ProviderGoogle:    []byte("1\n"),
	ProviderAider:     []byte("\n"),
}

func NewDetector(sessionID string) *Detector {
	return &Detector{
		sessionID:         sessionID,
		rateLimitPatterns: defaultRateLimitPatterns,
		continuePatterns:  defaultContinuePatterns,
		timestampPatterns: defaultTimestampPatterns,
		providerPatterns:  providerSpecificPatterns,
		currentState:      StateNone,
		cooldown:          DefaultCooldown,
		resetBufferSecs:   DefaultResetBuffer,
	}
}

func (d *Detector) SetDetectionCallback(callback func(Detection)) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.onDetection = callback
}

func (d *Detector) SetCooldown(cooldown time.Duration) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.cooldown = cooldown
}

func (d *Detector) SetResetBuffer(seconds int) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.resetBufferSecs = seconds
}

func (d *Detector) ProcessOutput(data []byte) {
	d.mu.Lock()
	defer d.mu.Unlock()

	output := string(data)

	if d.currentState != StateNone && d.currentState != StateWaiting {
		return
	}

	if time.Since(d.lastDetection) < d.cooldown {
		return
	}

	detection := d.detectInOutput(output)
	if detection != nil {
		d.lastDetection = time.Now()
		d.currentState = StateWaiting

		log.InfoLog.Printf("[RateLimit] Detected rate limit for session %s: provider=%s, reset at %v",
			d.sessionID, detection.Provider, detection.ResetTime)

		log.DebugLog.Printf("[RateLimit] Pattern matched in session %s: provider=%s, input=%q, detected_at=%v",
			d.sessionID, detection.Provider, string(detection.InputToSend), detection.DetectedAt)

		if d.onDetection != nil {
			go d.onDetection(*detection)
		}
	}
}

func (d *Detector) detectInOutput(output string) *Detection {
	output = stripANSI(output)

	hasRateLimitPattern := d.matchAny(d.rateLimitPatterns, output)
	if !hasRateLimitPattern {
		return nil
	}

	provider := d.identifyProvider(output)

	resetTime := d.parseResetTime(output)

	continueMatch := d.matchAny(d.continuePatterns, output)
	if !continueMatch {
		return nil
	}

	input := providerRecoveryInputs[provider]
	if len(input) == 0 {
		input = []byte("\n")
	}

	return &Detection{
		Provider:    provider,
		State:       StateWaiting,
		ResetTime:   resetTime,
		InputToSend: input,
		DetectedAt:  time.Now(),
	}
}

func (d *Detector) matchAny(patterns []*regexp.Regexp, output string) bool {
	for _, pattern := range patterns {
		if pattern.MatchString(output) {
			return true
		}
	}
	return false
}

func (d *Detector) identifyProvider(output string) Provider {
	for provider, patterns := range d.providerPatterns {
		for _, pattern := range patterns {
			if pattern.MatchString(output) {
				return provider
			}
		}
	}
	return ProviderUnknown
}

func (d *Detector) parseResetTime(output string) time.Time {
	for _, pattern := range d.timestampPatterns {
		matches := pattern.FindStringSubmatch(output)
		if len(matches) > 1 && matches[1] != "" {
			parsed := d.parseTimestamp(matches[1])
			if !parsed.IsZero() {
				return parsed
			}
		}
	}
	return time.Time{}
}

func (d *Detector) parseTimestamp(input string) time.Time {
	input = strings.TrimSpace(input)

	baseTime := time.Now()

	retryMatchNumber := regexp.MustCompile(`^(\d+)$`).FindStringSubmatch(input)
	if len(retryMatchNumber) == 2 {
		var amount int
		fmt.Sscanf(retryMatchNumber[1], "%d", &amount)
		return baseTime.Add(time.Duration(amount) * time.Second)
	}

	retryMatch := regexp.MustCompile(`(?i)^(\d+)\s*(second|minute|hour)s?$`).FindStringSubmatch(input)
	if len(retryMatch) > 2 {
		var duration time.Duration
		var amount int
		fmt.Sscanf(retryMatch[1], "%d", &amount)
		switch strings.ToLower(retryMatch[2]) {
		case "second", "seconds":
			duration = time.Duration(amount) * time.Second
		case "minute", "minutes":
			duration = time.Duration(amount) * time.Minute
		case "hour", "hours":
			duration = time.Duration(amount) * time.Hour
		}
		return baseTime.Add(duration)
	}

	retryMatchFull := regexp.MustCompile(`(?i)retry\s*after\s*(\d+)\s*(second|minute|hour)s?`).FindStringSubmatch(input)
	if len(retryMatchFull) > 2 {
		var duration time.Duration
		var amount int
		fmt.Sscanf(retryMatchFull[1], "%d", &amount)
		switch strings.ToLower(retryMatchFull[2]) {
		case "second", "seconds":
			duration = time.Duration(amount) * time.Second
		case "minute", "minutes":
			duration = time.Duration(amount) * time.Minute
		case "hour", "hours":
			duration = time.Duration(amount) * time.Hour
		}
		return baseTime.Add(duration)
	}

	timeFormats := []string{
		"3:04 PM",
		"3:04:05 PM",
		"15:04",
		"15:04:05",
		"2006-01-02T15:04:05",
	}

	for _, format := range timeFormats {
		if parsed, err := time.Parse(format, input); err == nil {
			if parsed.Year() == 0 {
				parsed = time.Date(baseTime.Year(), baseTime.Month(), baseTime.Day(),
					parsed.Hour(), parsed.Minute(), parsed.Second(), 0, baseTime.Location())
			}
			if parsed.Before(baseTime) {
				parsed = parsed.AddDate(0, 0, 1)
			}
			return parsed
		}
	}

	return time.Time{}
}

func (d *Detector) GetState() RateLimitState {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.currentState
}

func (d *Detector) SetState(state RateLimitState) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.currentState = state
}

func (d *Detector) GetResetTime() time.Time {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.currentResetTime
}

func stripANSI(input string) string {
	ansiRegex := regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]`)
	return ansiRegex.ReplaceAllString(input, "")
}

func init() {
	for _, patterns := range providerSpecificPatterns {
		for _, p := range patterns {
			_ = p.String()
		}
	}
}
