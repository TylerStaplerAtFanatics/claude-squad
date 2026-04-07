package ratelimit

import (
	"sync"
	"time"

	"github.com/tstapler/stapler-squad/log"
)

type SessionStatus int

const (
	SessionStatusRunning SessionStatus = iota
	SessionStatusReady
	SessionStatusPaused
	SessionStatusStopped
)

type SessionAccessor interface {
	WriteToPTY(data []byte) (int, error)
	GetStatus() int
}

func StatusToSessionStatus(s int) SessionStatus {
	switch s {
	case 1: // session.Running
		return SessionStatusRunning
	case 2: // session.Ready
		return SessionStatusReady
	case 4: // session.Paused
		return SessionStatusPaused
	case 6: // session.Stopped
		return SessionStatusStopped
	default:
		return SessionStatusRunning
	}
}

type eventType string

const (
	eventDetected      eventType = "detected"
	eventRecoveryStart eventType = "recovery_start"
	eventRecoveryDone  eventType = "recovery_done"
	eventRecoveryFail  eventType = "recovery_fail"
)

type RateLimitEvent struct {
	Type      eventType
	SessionID string
	Provider  Provider
	Timestamp time.Time
	Error     error
}

type EventBus struct {
	mu          sync.RWMutex
	subscribers map[eventType][]chan RateLimitEvent
}

func NewEventBus() *EventBus {
	return &EventBus{
		subscribers: make(map[eventType][]chan RateLimitEvent),
	}
}

func (eb *EventBus) Subscribe(eventType eventType) <-chan RateLimitEvent {
	eb.mu.Lock()
	defer eb.mu.Unlock()

	ch := make(chan RateLimitEvent, 10)
	eb.subscribers[eventType] = append(eb.subscribers[eventType], ch)
	return ch
}

func (eb *EventBus) Publish(event RateLimitEvent) {
	eb.mu.RLock()
	defer eb.mu.RUnlock()

	subscribers := eb.subscribers[event.Type]
	for _, ch := range subscribers {
		select {
		case ch <- event:
		default:
		}
	}
}

type Manager struct {
	mu sync.Mutex

	sessionID    string
	instance     SessionAccessor
	detector     *Detector
	scheduler    *Scheduler
	recovery     *RecoveryHandler
	eventBus     *EventBus
	enabled      bool
	cooldown     time.Duration
	currentInput []byte
}

func NewManager(sessionID string, instance SessionAccessor) *Manager {
	m := &Manager{
		sessionID: sessionID,
		instance:  instance,
		eventBus:  NewEventBus(),
		enabled:   true,
		cooldown:  DefaultCooldown,
	}

	m.detector = NewDetector(sessionID)
	m.scheduler = NewScheduler(sessionID)
	m.recovery = NewRecoveryHandler(sessionID, m.sendRecoveryInput)

	m.detector.SetDetectionCallback(m.handleDetection)
	m.scheduler.SetRecoveryCallback(m.executeRecovery)
	m.scheduler.SetSessionStatusCheck(m.isSessionRunning)

	return m
}

func (m *Manager) SetEnabled(enabled bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.enabled = enabled
}

func (m *Manager) IsEnabled() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.enabled
}

func (m *Manager) SetCooldown(cooldown time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cooldown = cooldown
	if m.detector != nil {
		m.detector.SetCooldown(cooldown)
	}
}

func (m *Manager) SetResetBuffer(seconds int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.detector != nil {
		m.detector.SetResetBuffer(seconds)
	}
	if m.scheduler != nil {
		m.scheduler.SetBuffer(seconds)
	}
}

func (m *Manager) Start() {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.enabled {
		log.InfoLog.Printf("[RateLimit] Manager disabled for session %s", m.sessionID)
		return
	}

	log.InfoLog.Printf("[RateLimit] Manager started for session %s", m.sessionID)
}

func (m *Manager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.scheduler != nil {
		m.scheduler.CancelRecovery()
	}

	log.InfoLog.Printf("[RateLimit] Manager stopped for session %s", m.sessionID)
}

func (m *Manager) ProcessOutput(data []byte) {
	m.mu.Lock()
	enabled := m.enabled
	detector := m.detector
	m.mu.Unlock()

	if !enabled || detector == nil {
		return
	}

	detector.ProcessOutput(data)
}

func (m *Manager) handleDetection(det Detection) {
	m.mu.Lock()
	m.currentInput = det.InputToSend
	if len(m.currentInput) == 0 {
		m.currentInput = []byte(DefaultRecoveryInput)
	}
	m.eventBus.Publish(RateLimitEvent{
		Type:      eventDetected,
		SessionID: m.sessionID,
		Provider:  det.Provider,
		Timestamp: time.Now(),
	})
	m.mu.Unlock()

	m.scheduler.ScheduleRecovery(det.ResetTime)
}

func (m *Manager) executeRecovery() error {
	m.mu.Lock()
	recovery := m.recovery
	detector := m.detector
	currentInput := m.currentInput
	m.eventBus.Publish(RateLimitEvent{
		Type:      eventRecoveryStart,
		SessionID: m.sessionID,
		Timestamp: time.Now(),
	})
	m.mu.Unlock()

	input := currentInput
	if len(input) == 0 {
		input = []byte(DefaultRecoveryInput)
	}

	err := recovery.Execute(input)

	m.mu.Lock()
	if err != nil {
		if detector != nil {
			detector.SetState(StateFailed)
		}
		m.eventBus.Publish(RateLimitEvent{
			Type:      eventRecoveryFail,
			SessionID: m.sessionID,
			Timestamp: time.Now(),
			Error:     err,
		})
	} else {
		if detector != nil {
			detector.SetState(StateRecovered)
		}
		m.eventBus.Publish(RateLimitEvent{
			Type:      eventRecoveryDone,
			SessionID: m.sessionID,
			Timestamp: time.Now(),
		})
	}
	m.mu.Unlock()

	return err
}

func (m *Manager) sendRecoveryInput(data []byte) error {
	if m.instance == nil {
		return nil
	}
	_, err := m.instance.WriteToPTY(data)
	return err
}

func (m *Manager) isSessionRunning() bool {
	if m.instance == nil {
		return false
	}
	status := m.instance.GetStatus()
	return status == int(SessionStatusRunning) || status == int(SessionStatusReady)
}

func (m *Manager) GetDetector() *Detector {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.detector
}

func (m *Manager) GetScheduler() *Scheduler {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.scheduler
}

func (m *Manager) GetEventBus() *EventBus {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.eventBus
}

func (m *Manager) GetState() RateLimitState {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.detector != nil {
		return m.detector.GetState()
	}
	return StateNone
}
