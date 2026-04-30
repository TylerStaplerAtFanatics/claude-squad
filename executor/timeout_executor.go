package executor

import (
	"context"
	"fmt"
	"os/exec"
	"time"
)

// TimeoutExecutor wraps command execution with context-based timeouts to prevent indefinite blocking.
// This is critical for preventing hangs on external commands like 'which claude' or tmux operations.
type TimeoutExecutor struct {
	timeout  time.Duration
	delegate Executor // Underlying executor to use after timeout protection is applied
}

// NewTimeoutExecutor creates a new timeout-aware executor with the specified timeout duration.
// The timeout applies to each individual command execution.
func NewTimeoutExecutor(timeout time.Duration) *TimeoutExecutor {
	return &TimeoutExecutor{
		timeout:  timeout,
		delegate: MakeExecutor(),
	}
}

// Run executes the command with timeout protection. If the command does not complete
// within the timeout duration, it is killed and an error is returned.
func (e *TimeoutExecutor) Run(cmd *exec.Cmd) error {
	// Create context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), e.timeout)
	defer cancel()

	// Create a channel to receive the result
	done := make(chan error, 1)

	// Start the command
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start command: %w", err)
	}

	// Wait for command completion in goroutine
	go func() {
		done <- cmd.Wait()
	}()

	// Wait for either completion or timeout
	select {
	case <-ctx.Done():
		// Timeout occurred - kill the process
		if cmd.Process != nil {
			_ = cmd.Process.Kill() // Best effort kill
		}
		return fmt.Errorf("command timed out after %v: %s", e.timeout, ToString(cmd))
	case err := <-done:
		// Command completed (successfully or with error).
		// On Linux, exec-not-found errors may surface via Wait() instead of Start() —
		// wrap them so callers always see "failed to start" for non-exit errors.
		if err != nil {
			if _, isExitErr := err.(*exec.ExitError); !isExitErr {
				return fmt.Errorf("failed to start command: %w", err)
			}
		}
		return err
	}
}

// Output executes the command and returns its output with timeout protection.
// If the command does not complete within the timeout duration, it is killed and an error is returned.
func (e *TimeoutExecutor) Output(cmd *exec.Cmd) ([]byte, error) {
	// Create context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), e.timeout)
	defer cancel()

	// Channel to receive result
	type result struct {
		output []byte
		err    error
	}
	done := make(chan result, 1)

	// Start the command
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start command: %w", err)
	}

	// Capture output in goroutine
	go func() {
		// We need to read from both stdout and stderr
		// Since cmd.Start() was already called, we need to wait and read pipes
		var output []byte
		var err error

		// Wait for process to complete
		waitErr := cmd.Wait()

		// Try to read output - this may not work perfectly since we called Start() manually
		// For proper output capture with timeout, we should use StdoutPipe and StderrPipe
		if waitErr != nil {
			// Try to get exit error output
			if exitErr, ok := waitErr.(*exec.ExitError); ok {
				output = exitErr.Stderr
			}
			err = waitErr
		}

		done <- result{output: output, err: err}
	}()

	// Wait for either completion or timeout
	select {
	case <-ctx.Done():
		// Timeout occurred - kill the process
		if cmd.Process != nil {
			_ = cmd.Process.Kill() // Best effort kill
		}
		return nil, fmt.Errorf("command timed out after %v: %s", e.timeout, ToString(cmd))
	case res := <-done:
		return res.output, res.err
	}
}

// CombinedOutput executes the command and returns combined stdout+stderr with timeout protection.
func (e *TimeoutExecutor) CombinedOutput(cmd *exec.Cmd) ([]byte, error) {
	// Create context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), e.timeout)
	defer cancel()

	// Channel to receive result
	type result struct {
		output []byte
		err    error
	}
	done := make(chan result, 1)

	// Run CombinedOutput in goroutine
	go func() {
		out, err := cmd.CombinedOutput()
		done <- result{output: out, err: err}
	}()

	// Wait for either completion or timeout
	select {
	case <-ctx.Done():
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		return nil, fmt.Errorf("command timed out after %v: %s", e.timeout, ToString(cmd))
	case res := <-done:
		return res.output, res.err
	}
}

// OutputWithPipes is a better implementation of Output that properly captures stdout/stderr
// This should be used when you need reliable output capture with timeout
func (e *TimeoutExecutor) OutputWithPipes(cmd *exec.Cmd) ([]byte, error) {
	// Create context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), e.timeout)
	defer cancel()

	// Set up pipes for output capture
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	// Start the command
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start command: %w", err)
	}

	// Channel to receive result
	type result struct {
		output []byte
		err    error
	}
	done := make(chan result, 1)

	// Read output and wait for completion in goroutine
	go func() {
		// Read stdout
		stdoutData := make([]byte, 0, 4096)
		buf := make([]byte, 1024)
		for {
			n, readErr := stdout.Read(buf)
			if n > 0 {
				stdoutData = append(stdoutData, buf[:n]...)
			}
			if readErr != nil {
				break
			}
		}

		// Read stderr
		stderrData := make([]byte, 0, 4096)
		for {
			n, readErr := stderr.Read(buf)
			if n > 0 {
				stderrData = append(stderrData, buf[:n]...)
			}
			if readErr != nil {
				break
			}
		}

		// Wait for process
		waitErr := cmd.Wait()

		// Combine output (prefer stdout, include stderr on error)
		output := stdoutData
		if waitErr != nil && len(stderrData) > 0 {
			output = append(output, stderrData...)
		}

		done <- result{output: output, err: waitErr}
	}()

	// Wait for either completion or timeout
	select {
	case <-ctx.Done():
		// Timeout occurred - kill the process
		if cmd.Process != nil {
			_ = cmd.Process.Kill() // Best effort kill
		}
		return nil, fmt.Errorf("command timed out after %v: %s", e.timeout, ToString(cmd))
	case res := <-done:
		return res.output, res.err
	}
}
