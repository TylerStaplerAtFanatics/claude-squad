package cmd

import (
	"claude-squad/cmd/commands"
	"claude-squad/cmd/help"
	"claude-squad/cmd/state"
	"claude-squad/keys"
	tea "github.com/charmbracelet/bubbletea"
)

// Bridge provides compatibility between old and new command systems
type Bridge struct {
	registry    *CommandRegistry
	stateManager *state.Manager
	helpGen     *help.Generator
	
	// Legacy mappings
	legacyKeys   map[keys.KeyName]CommandID
	initialized  bool
}

// NewBridge creates a new migration bridge
func NewBridge() *Bridge {
	registry := GetGlobalRegistry()
	stateManager := state.NewManager(registry)
	helpGen := help.NewGenerator(registry)
	
	return &Bridge{
		registry:     registry,
		stateManager: stateManager,
		helpGen:      helpGen,
		legacyKeys:   createLegacyMapping(),
		initialized:  false,
	}
}

// Initialize sets up the bridge with handler callbacks
func (b *Bridge) Initialize(
	sessionHandlers *commands.SessionHandlers,
	gitHandlers *commands.GitHandlers,
	navigationHandlers *commands.NavigationHandlers,
	organizationHandlers *commands.OrganizationHandlers,
	systemHandlers *commands.SystemHandlers,
) {
	if b.initialized {
		return
	}

	// Configure command handlers
	commands.SetSessionHandlers(sessionHandlers)
	commands.SetGitHandlers(gitHandlers)
	commands.SetNavigationHandlers(navigationHandlers)
	commands.SetOrganizationHandlers(organizationHandlers)
	commands.SetSystemHandlers(systemHandlers)
	
	b.initialized = true
}

// GetStateManager returns the state manager
func (b *Bridge) GetStateManager() *state.Manager {
	return b.stateManager
}

// GetHelpGenerator returns the help generator
func (b *Bridge) GetHelpGenerator() *help.Generator {
	return b.helpGen
}

// GetRegistry returns the command registry
func (b *Bridge) GetRegistry() *CommandRegistry {
	return b.registry
}

// HandleLegacyKey maps old KeyName constants to new command system
func (b *Bridge) HandleLegacyKey(keyName keys.KeyName) (tea.Model, tea.Cmd, error) {
	if cmdID, exists := b.legacyKeys[keyName]; exists {
		// Get the actual key string for this command
		keys := b.registry.GetKeysForCommand(cmdID)
		if len(keys) > 0 {
			return b.stateManager.HandleKey(keys[0])
		}
	}
	return nil, nil, nil
}

// HandleKeyString processes a key string through the new command system
func (b *Bridge) HandleKeyString(key string) (tea.Model, tea.Cmd, error) {
	return b.stateManager.HandleKey(key)
}

// GetLegacyStatusLine generates status line compatible with old menu system
func (b *Bridge) GetLegacyStatusLine() string {
	return b.stateManager.GetStatusLine()
}

// GetContextualHelp generates help for current context
func (b *Bridge) GetContextualHelp() string {
	return b.stateManager.GetHelpContent()
}

// SetContext switches to a different application context
func (b *Bridge) SetContext(contextID ContextID) {
	// Clear stack and set new context
	for b.stateManager.GetCurrentContext() != ContextGlobal {
		b.stateManager.PopContext()
	}
	if contextID != ContextGlobal {
		b.stateManager.PushContext(contextID)
	}
}

// PushContext adds a context to the stack (for modal operations)
func (b *Bridge) PushContext(contextID ContextID) {
	b.stateManager.PushContext(contextID)
}

// PopContext removes the top context from the stack
func (b *Bridge) PopContext() ContextID {
	return b.stateManager.PopContext()
}

// GetCurrentContext returns the current context
func (b *Bridge) GetCurrentContext() ContextID {
	return b.stateManager.GetCurrentContext()
}

// ValidateSetup checks if the bridge is properly configured
func (b *Bridge) ValidateSetup() []string {
	var issues []string
	
	if !b.initialized {
		issues = append(issues, "Bridge not initialized - call Initialize() first")
	}
	
	// Add registry validation
	issues = append(issues, b.helpGen.ValidateRegistry()...)
	
	return issues
}

// GetAvailableKeys returns all keys available in the current context
func (b *Bridge) GetAvailableKeys() map[string]string {
	commands := b.stateManager.GetAvailableCommands()
	keyMap := make(map[string]string)
	
	for _, command := range commands {
		keys := b.registry.GetKeysForCommand(command.ID)
		for _, key := range keys {
			keyMap[key] = command.Description
		}
	}
	
	return keyMap
}

// IsKeyBound checks if a key is bound to any command in current context
func (b *Bridge) IsKeyBound(key string) bool {
	return b.stateManager.IsKeyAvailable(key)
}

// GetCommandForKey returns the command bound to a key
func (b *Bridge) GetCommandForKey(key string) *Command {
	return b.stateManager.GetCommandForKey(key)
}

// createLegacyMapping creates a mapping from old KeyName constants to new CommandIDs
func createLegacyMapping() map[keys.KeyName]CommandID {
	return map[keys.KeyName]CommandID{
		// Session management
		keys.KeyNew:     "session.new",
		keys.KeyKill:    "session.kill", 
		keys.KeyEnter:   "session.attach",
		keys.KeyCheckout: "session.checkout",
		keys.KeyResume:  "session.resume",
		
		// Git integration
		keys.KeyGit:     "git.status",
		keys.KeySubmit:  "git.legacy_submit",
		
		// Navigation
		keys.KeyUp:      "nav.up",
		keys.KeyDown:    "nav.down", 
		keys.KeyLeft:    "nav.left",
		keys.KeyRight:   "nav.right",
		keys.KeyShiftUp: "nav.page_up",
		keys.KeyShiftDown: "nav.page_down",
		keys.KeySearch:  "nav.search",
		
		// Organization
		keys.KeyFilterPaused: "org.filter_paused",
		keys.KeyClearFilters: "org.clear_filters",
		keys.KeyToggleGroup:  "org.toggle_group",
		
		// System
		keys.KeyHelp:   "sys.help",
		keys.KeyQuit:   "sys.quit", 
		keys.KeyEsc:    "sys.escape",
		keys.KeyTab:    "sys.tab",
	}
}

// Global bridge instance
var globalBridge *Bridge

// GetGlobalBridge returns the global bridge instance
func GetGlobalBridge() *Bridge {
	if globalBridge == nil {
		globalBridge = NewBridge()
	}
	return globalBridge
}