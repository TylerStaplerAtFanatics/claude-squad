package session

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestDiffStatsDataSerializationExcludesContent verifies that the Content field
// is excluded from JSON serialization to reduce state file size.
// This is the fix for BUG-003: Large State File Size.
func TestDiffStatsDataSerializationExcludesContent(t *testing.T) {
	// Create DiffStatsData with content
	stats := DiffStatsData{
		Added:   10,
		Removed: 5,
		Content: "diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1,5 +1,10 @@\n+new line\n",
	}

	// Serialize to JSON
	jsonBytes, err := json.Marshal(stats)
	require.NoError(t, err)

	// Parse JSON into a map to check field presence
	var parsed map[string]interface{}
	err = json.Unmarshal(jsonBytes, &parsed)
	require.NoError(t, err)

	// Verify metadata fields are present
	assert.Contains(t, parsed, "added", "added field should be present in JSON")
	assert.Contains(t, parsed, "removed", "removed field should be present in JSON")
	assert.Equal(t, float64(10), parsed["added"], "added value should be correct")
	assert.Equal(t, float64(5), parsed["removed"], "removed value should be correct")

	// Verify content field is NOT present (excluded via json:"-" tag)
	assert.NotContains(t, parsed, "content", "content field should be excluded from JSON")
}

// TestDiffStatsDataBackwardCompatibility verifies that old state files with
// diff_stats.content field can still be loaded correctly.
// The content field will be silently ignored during deserialization.
func TestDiffStatsDataBackwardCompatibility(t *testing.T) {
	// Simulate old state file JSON with content field
	oldJSON := `{
		"added": 10,
		"removed": 5,
		"content": "diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1,5 +1,10 @@\n+new line"
	}`

	// Parse into DiffStatsData
	var stats DiffStatsData
	err := json.Unmarshal([]byte(oldJSON), &stats)
	require.NoError(t, err)

	// Verify metadata loaded correctly
	assert.Equal(t, 10, stats.Added, "added should be loaded correctly")
	assert.Equal(t, 5, stats.Removed, "removed should be loaded correctly")

	// Content field should be empty (ignored during deserialization due to json:"-" tag)
	assert.Empty(t, stats.Content, "content should be empty after deserialization (excluded field)")
}

// TestInstanceDataSaveExcludesDiffContent verifies that when an Instance
// is converted to InstanceData for serialization, the diff content is excluded.
func TestInstanceDataSaveExcludesDiffContent(t *testing.T) {
	// Create InstanceData with diff stats including content
	data := InstanceData{
		Title: "test-session",
		Path:  "/test/path",
		DiffStats: DiffStatsData{
			Added:   25,
			Removed: 10,
			Content: "large diff content that should not be persisted to reduce file size...",
		},
	}

	// Serialize to JSON
	jsonBytes, err := json.Marshal(data)
	require.NoError(t, err)

	// Parse JSON into a map to check diff_stats structure
	var parsed map[string]interface{}
	err = json.Unmarshal(jsonBytes, &parsed)
	require.NoError(t, err)

	// Verify diff_stats is present
	diffStats, ok := parsed["diff_stats"].(map[string]interface{})
	require.True(t, ok, "diff_stats should be present in JSON")

	// Verify metadata is present
	assert.Contains(t, diffStats, "added", "diff_stats.added should be present")
	assert.Contains(t, diffStats, "removed", "diff_stats.removed should be present")
	assert.Equal(t, float64(25), diffStats["added"])
	assert.Equal(t, float64(10), diffStats["removed"])

	// Verify content is NOT present
	assert.NotContains(t, diffStats, "content", "diff_stats.content should be excluded from JSON")
}

// TestInstanceDataLoadWithDiffContent verifies backward compatibility when
// loading old state files that contain diff_stats.content.
func TestInstanceDataLoadWithDiffContent(t *testing.T) {
	// Simulate old state file JSON with diff content
	oldJSON := `{
		"title": "legacy-session",
		"path": "/old/path",
		"working_dir": "",
		"branch": "main",
		"status": 0,
		"height": 0,
		"width": 0,
		"created_at": "2025-01-01T00:00:00Z",
		"updated_at": "2025-01-01T00:00:00Z",
		"auto_yes": false,
		"prompt": "",
		"program": "claude",
		"worktree": {
			"repo_path": "",
			"worktree_path": "",
			"session_name": "",
			"branch_name": "",
			"base_commit_sha": ""
		},
		"diff_stats": {
			"added": 100,
			"removed": 50,
			"content": "This is legacy diff content that should be ignored on load..."
		}
	}`

	// Parse into InstanceData
	var data InstanceData
	err := json.Unmarshal([]byte(oldJSON), &data)
	require.NoError(t, err)

	// Verify basic fields loaded correctly
	assert.Equal(t, "legacy-session", data.Title)
	assert.Equal(t, "/old/path", data.Path)
	assert.Equal(t, "claude", data.Program)

	// Verify diff stats metadata loaded correctly
	assert.Equal(t, 100, data.DiffStats.Added)
	assert.Equal(t, 50, data.DiffStats.Removed)

	// Verify content is empty (ignored due to json:"-" tag)
	assert.Empty(t, data.DiffStats.Content, "diff content should be empty after loading old state")
}

// TestDiffStatsDataRoundTrip verifies that save/load cycle preserves metadata
// but excludes content (the desired behavior for BUG-003 fix).
func TestDiffStatsDataRoundTrip(t *testing.T) {
	// Original data with content
	original := DiffStatsData{
		Added:   42,
		Removed: 17,
		Content: "This content should not survive the round trip...",
	}

	// Serialize
	jsonBytes, err := json.Marshal(original)
	require.NoError(t, err)

	// Deserialize
	var loaded DiffStatsData
	err = json.Unmarshal(jsonBytes, &loaded)
	require.NoError(t, err)

	// Metadata should be preserved
	assert.Equal(t, original.Added, loaded.Added, "added should be preserved")
	assert.Equal(t, original.Removed, loaded.Removed, "removed should be preserved")

	// Content should NOT be preserved (this is the desired behavior)
	assert.Empty(t, loaded.Content, "content should be empty after round trip")
}
