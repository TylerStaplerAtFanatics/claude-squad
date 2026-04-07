package session

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockProcessInspector is a test double for ProcessFileInspector.
type mockProcessInspector struct {
	files []string
	err   error
}

func (m *mockProcessInspector) OpenFiles(pid int32) ([]string, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.files, nil
}

func (m *mockProcessInspector) IsAlive(pid int32, expectedCreateTimeMs int64) bool {
	return m.err == nil
}

func TestHistoryFileDetector_Detect_MatchesClaudePattern(t *testing.T) {
	homeDir, err := os.UserHomeDir()
	require.NoError(t, err)

	uuid := "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
	projectDir := "-Users-alice-myproject"
	historyPath := filepath.Join(homeDir, ".claude", "projects", projectDir, uuid+".jsonl")

	inspector := &mockProcessInspector{
		files: []string{
			"/dev/null",
			"/tmp/some-other-file.txt",
			historyPath,
		},
	}

	detector := NewHistoryFileDetector(inspector)
	info, err := detector.Detect(1234)
	require.NoError(t, err)
	require.NotNil(t, info)

	assert.Equal(t, uuid, info.ConversationUUID)
	assert.Equal(t, projectDir, info.ProjectDir)
	assert.Equal(t, historyPath, info.HistoryFilePath)
}

func TestHistoryFileDetector_Detect_NoJSONLReturnsNilNil(t *testing.T) {
	inspector := &mockProcessInspector{
		files: []string{
			"/dev/null",
			"/tmp/some-file.txt",
			"/usr/lib/libsystem.dylib",
		},
	}

	detector := NewHistoryFileDetector(inspector)
	info, err := detector.Detect(1234)
	require.NoError(t, err)
	assert.Nil(t, info)
}

func TestHistoryFileDetector_Detect_FiltersAgentJSONL(t *testing.T) {
	homeDir, err := os.UserHomeDir()
	require.NoError(t, err)

	projectDir := "-Users-alice-myproject"
	agentPath := filepath.Join(homeDir, ".claude", "projects", projectDir, "agent-abc123.jsonl")

	inspector := &mockProcessInspector{
		files: []string{agentPath},
	}

	detector := NewHistoryFileDetector(inspector)
	info, err := detector.Detect(1234)
	require.NoError(t, err)
	assert.Nil(t, info, "agent-*.jsonl files should be filtered out")
}

func TestHistoryFileDetector_ExtractsUUIDFromFilename(t *testing.T) {
	homeDir, err := os.UserHomeDir()
	require.NoError(t, err)

	testCases := []struct {
		name    string
		uuid    string
		wantNil bool
	}{
		{
			name:    "valid UUID v4",
			uuid:    "550e8400-e29b-41d4-a716-446655440000",
			wantNil: false,
		},
		{
			name:    "another valid UUID",
			uuid:    "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
			wantNil: false,
		},
		{
			name:    "not a UUID",
			uuid:    "not-a-valid-uuid-format",
			wantNil: true,
		},
		{
			name:    "agent file should be filtered",
			uuid:    "agent-550e8400-e29b-41d4-a716-446655440000",
			wantNil: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			projectDir := "-Users-alice-myproject"
			historyPath := filepath.Join(homeDir, ".claude", "projects", projectDir, tc.uuid+".jsonl")

			inspector := &mockProcessInspector{
				files: []string{historyPath},
			}

			detector := NewHistoryFileDetector(inspector)
			info, err := detector.Detect(1234)
			require.NoError(t, err)

			if tc.wantNil {
				assert.Nil(t, info)
			} else {
				require.NotNil(t, info)
				assert.Equal(t, tc.uuid, info.ConversationUUID)
			}
		})
	}
}

func TestHistoryFileDetector_ProcessDeadReturnsNilNil(t *testing.T) {
	inspector := &mockProcessInspector{
		err: fmt.Errorf("process 9999999 not found"),
	}

	detector := NewHistoryFileDetector(inspector)
	info, err := detector.Detect(9999999)
	// Dead process: no error propagated, nil info
	require.NoError(t, err)
	assert.Nil(t, info)
}

func TestHistoryFileDetector_Detect_ReturnsFirstMatch(t *testing.T) {
	homeDir, err := os.UserHomeDir()
	require.NoError(t, err)

	uuid1 := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	uuid2 := "11111111-2222-3333-4444-555555555555"
	projectDir := "-Users-alice-myproject"

	path1 := filepath.Join(homeDir, ".claude", "projects", projectDir, uuid1+".jsonl")
	path2 := filepath.Join(homeDir, ".claude", "projects", projectDir, uuid2+".jsonl")

	inspector := &mockProcessInspector{
		files: []string{path1, path2},
	}

	detector := NewHistoryFileDetector(inspector)
	info, err := detector.Detect(1234)
	require.NoError(t, err)
	require.NotNil(t, info)
	// Returns the first match
	assert.Equal(t, uuid1, info.ConversationUUID)
}
