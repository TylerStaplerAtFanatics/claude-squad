package unfinished

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/tstapler/stapler-squad/executor"
)

// GitVCSReader implements VCSReader using CLI git subprocesses.
// --no-optional-locks is injected by gitCmd so no call site needs to remember it.
type GitVCSReader struct{}

var _ VCSReader = (*GitVCSReader)(nil)

func (g *GitVCSReader) ListWorktrees(repoPath string) ([]WorktreeInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := gitCmd(ctx, repoPath, "worktree", "list", "--porcelain")
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	return ParseAllWorktrees(string(out)), nil
}

func (g *GitVCSReader) ResolveDefaultBranch(repoPath string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	cmd := gitCmd(ctx, repoPath, "symbolic-ref", "refs/remotes/origin/HEAD", "--short")
	if out, err := cmd.Output(); err == nil {
		if ref := strings.TrimSpace(string(out)); ref != "" {
			return ref
		}
	}

	for _, candidate := range []string{
		"origin/main", "origin/master", "origin/develop", "origin/trunk",
		"main", "master", "develop", "trunk",
	} {
		ctx2, cancel2 := context.WithTimeout(context.Background(), 2*time.Second)
		err := gitCmd(ctx2, repoPath, "rev-parse", "--verify", candidate).Run()
		cancel2()
		if err == nil {
			return candidate
		}
	}
	return ""
}

func (g *GitVCSReader) HasUncommitted(worktreePath string) (bool, error) {
	exec5s := executor.MakeTimeoutExecutor(5 * time.Second)
	cmd := gitCmd(context.Background(), worktreePath, "status", "--porcelain")
	out, err := exec5s.CombinedOutput(cmd)
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(string(out)) != "", nil
}

func (g *GitVCSReader) AheadBehind(worktreePath, base string) (int, int, error) {
	exec3s := executor.MakeTimeoutExecutor(3 * time.Second)
	cmd := gitCmd(context.Background(), worktreePath, "rev-list", "--left-right", "--count", "HEAD..."+base)
	out, err := exec3s.CombinedOutput(cmd)
	if err != nil {
		return 0, 0, err
	}
	parts := strings.Fields(strings.TrimSpace(string(out)))
	if len(parts) != 2 {
		return 0, 0, nil
	}
	ahead, _ := strconv.Atoi(parts[0])
	behind, _ := strconv.Atoi(parts[1])
	return ahead, behind, nil
}

func (g *GitVCSReader) CommitMessages(worktreePath, base string, max int) ([]string, error) {
	exec3s := executor.MakeTimeoutExecutor(3 * time.Second)
	cmd := gitCmd(context.Background(), worktreePath, "log", base+"..HEAD",
		"--oneline", "--max-count="+strconv.Itoa(max))
	out, err := exec3s.CombinedOutput(cmd)
	if err != nil {
		return nil, err
	}
	var msgs []string
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line != "" {
			msgs = append(msgs, line)
		}
	}
	return msgs, nil
}

func (g *GitVCSReader) DiffShortstat(worktreePath string) (DiffStat, error) {
	exec3s := executor.MakeTimeoutExecutor(3 * time.Second)
	cmd := gitCmd(context.Background(), worktreePath, "diff", "--shortstat", "HEAD")
	out, err := exec3s.CombinedOutput(cmd)
	if err != nil {
		return DiffStat{}, err
	}
	return parseDiffShortstat(strings.TrimSpace(string(out))), nil
}
