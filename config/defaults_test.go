package config

import (
	"testing"
)

func baseConfig() *Config {
	return &Config{
		DefaultProgram: "proxy-claude",
		SessionDefaults: SessionDefaults{
			Profiles:       make(map[string]ProfileDefaults),
			EnvVars:        make(map[string]string),
			Tags:           []string{},
			DirectoryRules: []DirectoryRule{},
		},
	}
}

func TestResolveDefaults_NoRulesNoProfile(t *testing.T) {
	cfg := baseConfig()
	cfg.SessionDefaults.Program = "claude"
	cfg.SessionDefaults.Tags = []string{"global"}

	r := ResolveDefaults(cfg, "/some/dir", "")

	if r.Program != "claude" {
		t.Errorf("expected program=claude, got %q", r.Program)
	}
	if !r.UsedGlobal {
		t.Error("expected UsedGlobal=true")
	}
	if r.UsedDirectory || r.UsedProfile {
		t.Error("unexpected directory or profile usage")
	}
	if len(r.Tags) != 1 || r.Tags[0] != "global" {
		t.Errorf("expected tags=[global], got %v", r.Tags)
	}
}

func TestResolveDefaults_LegacyDefaultProgramFallback(t *testing.T) {
	cfg := baseConfig()
	// Global program is empty; legacy DefaultProgram should apply.
	cfg.SessionDefaults.Program = ""

	r := ResolveDefaults(cfg, "", "")
	if r.Program != "proxy-claude" {
		t.Errorf("expected legacy fallback program=proxy-claude, got %q", r.Program)
	}
}

func TestResolveDefaults_DirectoryRuleExactMatch(t *testing.T) {
	cfg := baseConfig()
	cfg.SessionDefaults.Program = "claude"
	cfg.SessionDefaults.DirectoryRules = []DirectoryRule{
		{
			Path:      "/projects/foo",
			Overrides: ProfileDefaults{Program: "aider", Tags: []string{"foo"}},
		},
	}

	r := ResolveDefaults(cfg, "/projects/foo", "")

	if r.Program != "aider" {
		t.Errorf("expected directory rule to override program: got %q", r.Program)
	}
	if !r.UsedDirectory {
		t.Error("expected UsedDirectory=true")
	}
	if r.MatchedDirectory != "/projects/foo" {
		t.Errorf("expected MatchedDirectory=/projects/foo, got %q", r.MatchedDirectory)
	}
}

func TestResolveDefaults_DirectoryRulePrefixMatch(t *testing.T) {
	cfg := baseConfig()
	cfg.SessionDefaults.DirectoryRules = []DirectoryRule{
		{Path: "/projects", Overrides: ProfileDefaults{Program: "base"}},
		{Path: "/projects/foo", Overrides: ProfileDefaults{Program: "specific"}},
	}

	r := ResolveDefaults(cfg, "/projects/foo/src", "")

	if r.Program != "specific" {
		t.Errorf("expected longest-prefix rule: got %q", r.Program)
	}
}

func TestResolveDefaults_ProfileWinsOverDirectory(t *testing.T) {
	cfg := baseConfig()
	cfg.SessionDefaults.DirectoryRules = []DirectoryRule{
		{Path: "/projects", Overrides: ProfileDefaults{Program: "directory-prog"}},
	}
	cfg.SessionDefaults.Profiles = map[string]ProfileDefaults{
		"Work": {Name: "Work", Program: "work-prog"},
	}

	r := ResolveDefaults(cfg, "/projects/foo", "Work")

	if r.Program != "work-prog" {
		t.Errorf("expected profile to win over directory: got %q", r.Program)
	}
	if !r.UsedProfile {
		t.Error("expected UsedProfile=true")
	}
}

func TestResolveDefaults_TagsUnion(t *testing.T) {
	cfg := baseConfig()
	cfg.SessionDefaults.Tags = []string{"global"}
	cfg.SessionDefaults.DirectoryRules = []DirectoryRule{
		{Path: "/projects", Overrides: ProfileDefaults{Tags: []string{"dir"}}},
	}
	cfg.SessionDefaults.Profiles = map[string]ProfileDefaults{
		"Work": {Name: "Work", Tags: []string{"profile", "global"}}, // "global" is a duplicate
	}

	r := ResolveDefaults(cfg, "/projects/foo", "Work")

	tagSet := make(map[string]bool)
	for _, t := range r.Tags {
		tagSet[t] = true
	}
	for _, expected := range []string{"global", "dir", "profile"} {
		if !tagSet[expected] {
			t.Errorf("expected tag %q in union result %v", expected, r.Tags)
		}
	}
	// Should not have duplicates
	if len(r.Tags) != 3 {
		t.Errorf("expected 3 unique tags, got %d: %v", len(r.Tags), r.Tags)
	}
}

func TestResolveDefaults_EnvVarsMerge(t *testing.T) {
	cfg := baseConfig()
	cfg.SessionDefaults.EnvVars = map[string]string{"BASE": "1", "SHARED": "global"}
	cfg.SessionDefaults.Profiles = map[string]ProfileDefaults{
		"Work": {Name: "Work", EnvVars: map[string]string{"WORK": "2", "SHARED": "profile"}},
	}

	r := ResolveDefaults(cfg, "", "Work")

	if r.EnvVars["BASE"] != "1" {
		t.Errorf("expected BASE=1, got %q", r.EnvVars["BASE"])
	}
	if r.EnvVars["WORK"] != "2" {
		t.Errorf("expected WORK=2, got %q", r.EnvVars["WORK"])
	}
	if r.EnvVars["SHARED"] != "profile" {
		t.Errorf("expected SHARED=profile (profile wins), got %q", r.EnvVars["SHARED"])
	}
}

func TestResolveDefaults_NoMatchReturnsGlobal(t *testing.T) {
	cfg := baseConfig()
	cfg.SessionDefaults.Program = "claude"
	cfg.SessionDefaults.DirectoryRules = []DirectoryRule{
		{Path: "/other/path", Overrides: ProfileDefaults{Program: "aider"}},
	}

	r := ResolveDefaults(cfg, "/projects/foo", "")

	if r.Program != "claude" {
		t.Errorf("expected global defaults when no rule matches: got %q", r.Program)
	}
	if r.UsedDirectory {
		t.Error("expected UsedDirectory=false when no rule matches")
	}
}

func TestResolveDefaults_DirectoryRuleReferencesProfile(t *testing.T) {
	cfg := baseConfig()
	cfg.SessionDefaults.Profiles = map[string]ProfileDefaults{
		"Backend": {Name: "Backend", Program: "aider", Tags: []string{"backend"}},
	}
	cfg.SessionDefaults.DirectoryRules = []DirectoryRule{
		{
			Path:      "/projects/api",
			Profile:   "Backend",
			Overrides: ProfileDefaults{Tags: []string{"api"}},
		},
	}

	r := ResolveDefaults(cfg, "/projects/api", "")

	if r.Program != "aider" {
		t.Errorf("expected program from directory-referenced profile: got %q", r.Program)
	}
	tagSet := make(map[string]bool)
	for _, t := range r.Tags {
		tagSet[t] = true
	}
	if !tagSet["backend"] || !tagSet["api"] {
		t.Errorf("expected tags from profile + overrides: got %v", r.Tags)
	}
}

func TestUnionTags(t *testing.T) {
	result := unionTags([]string{"a", "b"}, []string{"b", "c"})
	if len(result) != 3 {
		t.Errorf("expected 3 tags, got %d: %v", len(result), result)
	}
}
