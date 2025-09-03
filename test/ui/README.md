# UI Test Renderer

This package provides utilities for testing UI components without requiring a TTY. It allows for capturing and comparing UI renders, which is particularly useful for CI/CD environments or automated tests.

## Features

- Render BubbleTea models and UI components to strings
- Save UI renders to files for later comparison
- Compare renders with saved snapshots
- Simulate user input and window resizing
- Strip ANSI color codes for more readable diffs
- Mock terminal environment for testing

## Usage Examples

### Basic Component Testing

```go
func TestConfirmationDialog(t *testing.T) {
    // Create the component to test
    confirmDialog := overlay.NewConfirmationOverlay("Confirm this action?")
    
    // Create a test renderer
    renderer := ui.NewTestRenderer().
        SetSnapshotPath("test/ui/snapshots").
        DisableColors()
    
    // Compare with existing snapshot
    renderer.CompareComponentWithSnapshot(t, confirmDialog, "confirmation_dialog.txt")
}
```

### Creating Snapshots

To create new snapshots or update existing ones:

```go
func TestCreateSnapshot(t *testing.T) {
    // Create component
    dialog := overlay.NewConfirmationOverlay("New dialog")
    
    // Create renderer with update flag
    renderer := ui.NewTestRenderer().
        SetSnapshotPath("test/ui/snapshots").
        EnableUpdateSnapshots()
    
    // Save or update snapshot
    renderer.CompareComponentWithSnapshot(t, dialog, "new_dialog.txt")
}
```

### Simulating User Input

```go
func TestUserInteraction(t *testing.T) {
    // Create component
    component := ui.NewSomeComponent()
    
    // Create test utilities
    terminal := ui.NewMockTerminal()
    renderer := ui.NewTestRenderer()
    
    // Simulate key press
    updatedModel, _ := terminal.SimulateKeyPress(component, "enter")
    
    // Render and verify
    output, err := renderer.RenderComponent(updatedModel)
    require.NoError(t, err)
    assert.Contains(t, output, "Expected content after pressing enter")
}
```

### Testing Bubble Tea Programs

```go
func TestFullProgram(t *testing.T) {
    // Create model
    model := app.InitialModel()
    
    // Create mock program
    program := ui.NewMockProgram(model).
        WithAltScreen()
    
    // Run the program
    output, err := program.Start()
    require.NoError(t, err)
    
    // Verify output
    assert.Contains(t, output, "Expected initial content")
}
```

## Snapshot Directory Structure

Snapshots are stored in the configured snapshot directory (default: `test/ui/snapshots`). Each snapshot file contains the rendered output of a component for comparison in future tests.

For example:
```
test/ui/snapshots/
  ├── confirmation_dialog.txt
  ├── session_list_empty.txt
  ├── session_list_with_instances.txt
  └── session_setup_initial.txt
```

## Running Tests

Regular test mode (compares with snapshots):
```
go test ./test/ui
```

Update snapshots mode:
```
UPDATE_SNAPSHOTS=true go test ./test/ui
```

Skip snapshot tests:
```
go test -short ./test/ui
```