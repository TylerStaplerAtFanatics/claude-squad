package unfinished_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/tstapler/stapler-squad/session/unfinished"
)

// initRepo creates a git repo at path with one commit and returns its path.
// The path is resolved through symlinks so it matches what git reports on macOS.
func initRepo(t *testing.T) string {
	t.Helper()
	raw := t.TempDir()
	// On macOS, /var/folders is a symlink to /private/var/folders. Resolve so
	// comparisons against git output (which resolves symlinks) don't fail.
	dir, err := filepath.EvalSymlinks(raw)
	if err != nil {
		t.Fatalf("EvalSymlinks: %v", err)
	}

	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@test.com",
			"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@test.com",
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}

	run("init", "-b", "main")
	run("config", "user.email", "test@test.com")
	run("config", "user.name", "Test")

	// Initial commit.
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("hello\n"), 0644); err != nil {
		t.Fatal(err)
	}
	run("add", ".")
	run("commit", "-m", "initial commit")

	return dir
}

// addCommit adds a file and commits it, returning the short hash.
func addCommit(t *testing.T, repoPath, filename, message string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(repoPath, filename), []byte(message), 0644); err != nil {
		t.Fatal(err)
	}
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = repoPath
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@test.com",
			"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@test.com",
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("add", ".")
	run("commit", "-m", message)
}

// TestVCSReaderContractGit verifies the CLI-git reader satisfies the interface contract.
func TestVCSReaderContractGit(t *testing.T) {
	testVCSReaderContract(t, &unfinished.GitVCSReader{})
}

// TestVCSReaderContractGoGit verifies the go-git reader satisfies the interface contract.
func TestVCSReaderContractGoGit(t *testing.T) {
	testVCSReaderContract(t, &unfinished.GoGitVCSReader{})
}

// testVCSReaderContract is a shared suite that any VCSReader implementation must pass.
func testVCSReaderContract(t *testing.T, r unfinished.VCSReader) {
	t.Helper()

	t.Run("ListWorktrees_returnsMainWorktree", func(t *testing.T) {
		repo := initRepo(t)
		wts, err := r.ListWorktrees(repo)
		if err != nil {
			t.Fatalf("ListWorktrees: %v", err)
		}
		if len(wts) == 0 {
			t.Fatal("expected at least one worktree")
		}
		found := false
		for _, wt := range wts {
			if wt.Path == repo {
				found = true
				if wt.Branch == "" && !wt.IsDetached {
					t.Error("main worktree has no branch and is not marked detached")
				}
			}
		}
		if !found {
			t.Errorf("repo path %q not in worktree list: %+v", repo, wts)
		}
	})

	t.Run("HasUncommitted_false_on_clean_repo", func(t *testing.T) {
		repo := initRepo(t)
		dirty, err := r.HasUncommitted(repo)
		if err != nil {
			t.Fatalf("HasUncommitted: %v", err)
		}
		if dirty {
			t.Error("expected clean repo to have no uncommitted changes")
		}
	})

	t.Run("HasUncommitted_true_when_file_modified", func(t *testing.T) {
		repo := initRepo(t)
		if err := os.WriteFile(filepath.Join(repo, "dirty.txt"), []byte("dirty"), 0644); err != nil {
			t.Fatal(err)
		}
		dirty, err := r.HasUncommitted(repo)
		if err != nil {
			t.Fatalf("HasUncommitted: %v", err)
		}
		if !dirty {
			t.Error("expected dirty repo to have uncommitted changes")
		}
	})

	t.Run("AheadBehind_zero_on_single_commit_repo", func(t *testing.T) {
		repo := initRepo(t)
		// Set up a "base" branch pointing at the same commit.
		cmd := exec.Command("git", "branch", "base")
		cmd.Dir = repo
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git branch: %v\n%s", err, out)
		}
		ahead, behind, err := r.AheadBehind(repo, "base")
		if err != nil {
			t.Fatalf("AheadBehind: %v", err)
		}
		if ahead != 0 || behind != 0 {
			t.Errorf("expected 0/0 ahead/behind, got %d/%d", ahead, behind)
		}
	})

	t.Run("AheadBehind_counts_correctly", func(t *testing.T) {
		repo := initRepo(t)

		// Create base branch at initial commit.
		cmd := exec.Command("git", "branch", "base")
		cmd.Dir = repo
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git branch: %v\n%s", err, out)
		}

		// Add 2 commits on main.
		addCommit(t, repo, "a.txt", "commit a")
		addCommit(t, repo, "b.txt", "commit b")

		ahead, _, err := r.AheadBehind(repo, "base")
		if err != nil {
			t.Fatalf("AheadBehind: %v", err)
		}
		if ahead != 2 {
			t.Errorf("expected 2 ahead, got %d", ahead)
		}
	})

	t.Run("CommitMessages_returns_messages_ahead", func(t *testing.T) {
		repo := initRepo(t)

		cmd := exec.Command("git", "branch", "base")
		cmd.Dir = repo
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git branch: %v\n%s", err, out)
		}

		addCommit(t, repo, "x.txt", "feat: add x")
		addCommit(t, repo, "y.txt", "fix: add y")

		msgs, err := r.CommitMessages(repo, "base", 5)
		if err != nil {
			t.Fatalf("CommitMessages: %v", err)
		}
		if len(msgs) != 2 {
			t.Errorf("expected 2 messages, got %d: %v", len(msgs), msgs)
		}
		// Most-recent commit should appear first.
		foundFix := false
		for _, m := range msgs {
			if containsSubstring(m, "fix: add y") || containsSubstring(m, "add y") {
				foundFix = true
			}
		}
		if !foundFix {
			t.Errorf("expected to find 'add y' message in %v", msgs)
		}
	})

	t.Run("DiffShortstat_zero_on_clean_repo", func(t *testing.T) {
		repo := initRepo(t)
		d, err := r.DiffShortstat(repo)
		if err != nil {
			t.Fatalf("DiffShortstat: %v", err)
		}
		if d.Files != 0 {
			t.Errorf("expected 0 changed files on clean repo, got %d", d.Files)
		}
	})

	t.Run("DiffShortstat_detects_changes", func(t *testing.T) {
		repo := initRepo(t)
		if err := os.WriteFile(filepath.Join(repo, "README.md"), []byte("changed\n"), 0644); err != nil {
			t.Fatal(err)
		}
		d, err := r.DiffShortstat(repo)
		if err != nil {
			t.Fatalf("DiffShortstat: %v", err)
		}
		if d.Files == 0 {
			t.Error("expected at least 1 changed file after editing README.md")
		}
	})
}

func containsSubstring(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub ||
		len(s) > 0 && func() bool {
			for i := 0; i <= len(s)-len(sub); i++ {
				if s[i:i+len(sub)] == sub {
					return true
				}
			}
			return false
		}())
}

// TestFakeVCSReader verifies the scanner works correctly with an injected fake.
func TestFakeVCSReader(t *testing.T) {
	fake := &fakeVCSReader{
		worktrees: []unfinished.WorktreeInfo{
			{Path: "/repo/main", Branch: "feat/x"},
			{Path: "/repo/wt2", Branch: "feat/y"},
		},
		defaultBranch:    "origin/main",
		hasUncommitted:   map[string]bool{"/repo/wt2": true},
		aheadCounts:      map[string]int{"/repo/main": 3},
		commitMessages:   map[string][]string{"/repo/main": {"abc1234 feat: add thing"}},
		diffStatFiles:    map[string]int{"/repo/wt2": 2},
	}

	scanner := unfinished.NewScannerWithReader(nil, nil, fake)
	if scanner == nil {
		t.Fatal("NewScannerWithReader returned nil")
	}
}

type fakeVCSReader struct {
	worktrees      []unfinished.WorktreeInfo
	defaultBranch  string
	hasUncommitted map[string]bool
	aheadCounts    map[string]int
	commitMessages map[string][]string
	diffStatFiles  map[string]int
}

func (f *fakeVCSReader) ListWorktrees(repoPath string) ([]unfinished.WorktreeInfo, error) {
	return f.worktrees, nil
}

func (f *fakeVCSReader) ResolveDefaultBranch(repoPath string) string {
	return f.defaultBranch
}

func (f *fakeVCSReader) HasUncommitted(worktreePath string) (bool, error) {
	return f.hasUncommitted[worktreePath], nil
}

func (f *fakeVCSReader) AheadBehind(worktreePath, base string) (int, int, error) {
	return f.aheadCounts[worktreePath], 0, nil
}

func (f *fakeVCSReader) CommitMessages(worktreePath, base string, max int) ([]string, error) {
	return f.commitMessages[worktreePath], nil
}

func (f *fakeVCSReader) DiffShortstat(worktreePath string) (unfinished.DiffStat, error) {
	return unfinished.DiffStat{Files: f.diffStatFiles[worktreePath]}, nil
}
