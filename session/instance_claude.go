package session

// instance_claude.go contains Claude session management methods for Instance:
// history file detection, UUID extraction, and conversation reattachment.

import (
	"fmt"
	"time"

	"github.com/tstapler/stapler-squad/log"
)

// handleClaudeSessionReattachment attempts to re-attach to stored Claude Code session.
func (i *Instance) handleClaudeSessionReattachment() error {
	if i.claudeSession == nil {
		log.InfoLog.Printf("No Claude Code session data stored for instance '%s'", i.Title)
		return nil
	}

	// Check if auto-reattachment is enabled
	if !i.claudeSession.Settings.AutoReattach {
		log.InfoLog.Printf("Auto-reattachment disabled for instance '%s'", i.Title)
		return nil
	}

	// Check if session is too old (based on timeout settings)
	timeoutMinutes := i.claudeSession.Settings.SessionTimeoutMinutes
	if timeoutMinutes > 0 {
		timeout := time.Duration(timeoutMinutes) * time.Minute
		if time.Since(i.claudeSession.LastAttached) > timeout {
			log.InfoLog.Printf("Claude Code session for '%s' has timed out (%v ago), skipping re-attachment",
				i.Title, time.Since(i.claudeSession.LastAttached))
			return nil
		}
	}

	// Initialize Claude session manager
	sessionManager := NewClaudeSessionManager()

	// Try to find and attach to the stored session
	if i.claudeSession.ConversationUUID != "" {
		log.InfoLog.Printf("Attempting to re-attach to Claude Code session '%s' for instance '%s'",
			i.claudeSession.ConversationUUID, i.Title)

		// Verify the session still exists
		session, err := sessionManager.GetSessionByID(i.claudeSession.ConversationUUID)
		if err != nil {
			if i.claudeSession.Settings.CreateNewOnMissing {
				log.InfoLog.Printf("Stored Claude session not found, will create new session for '%s'", i.Title)
				return i.createNewClaudeSession()
			}
			return fmt.Errorf("stored Claude session '%s' not found: %w", i.claudeSession.ConversationUUID, err)
		}

		// Attempt to attach to the existing session
		if err := sessionManager.AttachToSession(session.ID); err != nil {
			return fmt.Errorf("failed to attach to Claude session '%s': %w", session.ID, err)
		}

		// Update last attached timestamp
		i.claudeSession.LastAttached = time.Now()
		log.InfoLog.Printf("Successfully re-attached to Claude Code session '%s'", session.ID)
	} else {
		// No specific session ID stored, try to find matching sessions by project
		if i.gitManager.HasWorktree() {
			return i.findAndAttachToProjectSession(sessionManager)
		}
	}

	return nil
}

// createNewClaudeSession creates a new Claude Code session for this instance.
func (i *Instance) createNewClaudeSession() error {
	log.InfoLog.Printf("Creating new Claude Code session for instance '%s'", i.Title)

	// TODO: Implement actual Claude Code session creation
	// This would typically involve:
	// 1. Launching Claude Code with the project directory
	// 2. Waiting for session initialization
	// 3. Capturing the new session ID

	// For now, create placeholder session data
	// sessionManager := NewClaudeSessionManager() // TODO: Use this when implementing actual Claude session creation

	// Generate a placeholder session ID (in practice, this would come from Claude Code)
	newSessionID := fmt.Sprintf("session_%s_%d", i.Title, time.Now().Unix())

	newSession := ClaudeSession{
		ID:             newSessionID,
		ConversationID: "",
		ProjectName:    i.Title,
		LastActive:     time.Now(),
		WorkingDir:     i.GetWorkingDirectory(),
		IsActive:       true,
	}

	// Update the instance's Claude session data
	i.claudeSession = &ClaudeSessionData{
		ConversationUUID: newSession.ID,
		SquadSessionID:   newSession.ConversationID,
		ProjectName:      newSession.ProjectName,
		LastAttached:     time.Now(),
		Settings:         i.claudeSession.Settings, // Preserve existing settings
		Metadata: map[string]string{
			"working_dir": newSession.WorkingDir,
			"created_at":  time.Now().Format(time.RFC3339),
		},
	}

	log.InfoLog.Printf("Created new Claude Code session '%s' for instance '%s'",
		newSessionID, i.Title)

	return nil
}

// findAndAttachToProjectSession finds Claude sessions matching this instance's project.
func (i *Instance) findAndAttachToProjectSession(sessionManager *ClaudeSessionManager) error {
	projectPath := i.GetWorkingDirectory()
	if projectPath == "" {
		return fmt.Errorf("no working directory available for project matching")
	}

	// Find sessions that match this project
	matchingSessions, err := sessionManager.FindSessionByProject(projectPath)
	if err != nil {
		return fmt.Errorf("failed to find matching Claude sessions: %w", err)
	}

	if len(matchingSessions) == 0 {
		if i.claudeSession.Settings.CreateNewOnMissing {
			log.InfoLog.Printf("No matching Claude sessions found for project '%s', creating new session", projectPath)
			return i.createNewClaudeSession()
		}
		return fmt.Errorf("no matching Claude sessions found for project '%s'", projectPath)
	}

	// Use the most recently active session
	var selectedSession ClaudeSession
	for _, session := range matchingSessions {
		if selectedSession.ID == "" || session.LastActive.After(selectedSession.LastActive) {
			selectedSession = session
		}
	}

	// Attach to the selected session
	if err := sessionManager.AttachToSession(selectedSession.ID); err != nil {
		return fmt.Errorf("failed to attach to Claude session '%s': %w", selectedSession.ID, err)
	}

	// Update the instance's Claude session data
	if i.claudeSession == nil {
		i.claudeSession = &ClaudeSessionData{}
	}
	i.claudeSession.ConversationUUID = selectedSession.ID
	i.claudeSession.SquadSessionID = selectedSession.ConversationID
	i.claudeSession.ProjectName = selectedSession.ProjectName
	i.claudeSession.LastAttached = time.Now()
	if i.claudeSession.Metadata == nil {
		i.claudeSession.Metadata = make(map[string]string)
	}
	i.claudeSession.Metadata["working_dir"] = selectedSession.WorkingDir

	log.InfoLog.Printf("Successfully attached to Claude Code session '%s' for project '%s'",
		selectedSession.ID, projectPath)

	return nil
}

// GetClaudeSession returns the Claude session data for this instance.
func (i *Instance) GetClaudeSession() *ClaudeSessionData {
	return i.claudeSession
}

// SetClaudeSession sets the Claude session data for this instance.
func (i *Instance) SetClaudeSession(sessionData *ClaudeSessionData) {
	i.claudeSession = sessionData
}

// HasClaudeSession returns true if this instance has Claude session data.
func (i *Instance) HasClaudeSession() bool {
	return i.claudeSession != nil && i.claudeSession.ConversationUUID != ""
}

// ClearConversationState removes the stored Claude conversation UUID and history
// file path so that the next Resume starts a fresh conversation rather than
// attempting --resume with a potentially stale or path-mismatched UUID.
func (i *Instance) ClearConversationState() {
	i.stateMutex.Lock()
	defer i.stateMutex.Unlock()
	if i.claudeSession != nil {
		i.claudeSession.ConversationUUID = ""
	}
	i.HistoryFilePath = ""
}

// tryExtractConversationUUID attempts to detect the Claude conversation UUID
// by inspecting the open files of the tmux pane process. This uses the
// HistoryFileDetector to find JSONL files in ~/.claude/projects/.
//
// IMPORTANT: This method assumes stateMutex is already held by the caller.
// It must NOT be called without the lock (e.g., from SwitchWorkspace which
// holds stateMutex). It sets claudeSession fields directly.
//
// The tmux session must be alive for this to work, because it inspects
// the foreground process's open file descriptors via proc_pidinfo.
func (i *Instance) tryExtractConversationUUID() {
	// Skip if we already have a conversation UUID.
	if i.claudeSession != nil && i.claudeSession.ConversationUUID != "" {
		return
	}

	detector := i.historyDetector
	if detector == nil {
		detector = NewHistoryFileDetectorWithRealInspector()
	}
	var info *HistoryFileInfo

	// Fast path: inspect open files of the live tmux pane process.
	if i.tmuxManager.DoesSessionExist() {
		pid, err := i.tmuxManager.GetPanePID()
		if err != nil {
			log.DebugLog.Printf("tryExtractConversationUUID: could not get pane PID for '%s': %v", i.Title, err)
		} else {
			info, err = detector.Detect(pid)
			if err != nil {
				log.WarningLog.Printf("tryExtractConversationUUID: detect error for '%s' (pid=%d): %v", i.Title, pid, err)
			}
		}
	}

	// Fallback: scan the project directory by path (works after reboot / tmux kill).
	if info == nil && i.Path != "" {
		var err error
		info, err = detector.DetectByPath(i.Path)
		if err != nil {
			log.WarningLog.Printf("tryExtractConversationUUID: path-based detect error for '%s': %v", i.Title, err)
		}
		if info != nil {
			log.InfoLog.Printf("tryExtractConversationUUID: found conversation via path fallback for '%s'", i.Title)
		}
	}

	if info == nil {
		log.DebugLog.Printf("tryExtractConversationUUID: no JSONL file found for '%s'", i.Title)
		return
	}

	// Set the fields directly (caller holds stateMutex).
	if i.claudeSession == nil {
		i.claudeSession = &ClaudeSessionData{}
	}
	i.claudeSession.ConversationUUID = info.ConversationUUID
	i.HistoryFilePath = info.HistoryFilePath
}

// GetConversationUUID returns the Claude conversation UUID, or "" if not linked.
func (i *Instance) GetConversationUUID() string {
	if i.claudeSession == nil {
		return ""
	}
	return i.claudeSession.ConversationUUID
}

// SetHistoryInfo updates the conversation UUID and history file path.
// Thread-safe: acquires stateMutex write lock.
// No-op if the UUID is already set to the same value.
func (i *Instance) SetHistoryInfo(conversationUUID, historyFilePath string) {
	i.stateMutex.Lock()
	defer i.stateMutex.Unlock()

	currentUUID := ""
	if i.claudeSession != nil {
		currentUUID = i.claudeSession.ConversationUUID
	}
	if currentUUID == conversationUUID && i.HistoryFilePath == historyFilePath {
		return
	}

	if i.claudeSession == nil {
		i.claudeSession = &ClaudeSessionData{}
	}
	i.claudeSession.ConversationUUID = conversationUUID
	i.HistoryFilePath = historyFilePath
}
