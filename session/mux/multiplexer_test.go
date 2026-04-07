package mux

import (
	"context"
	"io"
	"net"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestMultiplexer_BroadcastToClients verifies that PTY output is sent to ALL connected clients.
func TestMultiplexer_BroadcastToClients(t *testing.T) {
	m := &Multiplexer{
		clients: make(map[net.Conn]struct{}),
	}
	ctx, cancel := context.WithCancel(context.Background())
	m.ctx = ctx
	m.cancel = cancel
	defer cancel()

	// Create two client pairs.
	c1s, c1c := net.Pipe()
	c2s, c2c := net.Pipe()
	defer c1s.Close()
	defer c1c.Close()
	defer c2s.Close()
	defer c2c.Close()

	m.clientsMu.Lock()
	m.clients[c1s] = struct{}{}
	m.clients[c2s] = struct{}{}
	m.clientsMu.Unlock()

	outputData := []byte("pty output to all clients")
	msg := NewOutputMessage(outputData)

	// Read from both client sides in goroutines before broadcasting.
	var wg sync.WaitGroup
	readMsg := func(conn net.Conn) ([]byte, error) {
		conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		decoded, err := DecodeMessage(conn)
		if err != nil {
			return nil, err
		}
		return decoded.Data, nil
	}

	var c1Data, c2Data []byte
	var c1Err, c2Err error
	wg.Add(2)
	go func() { defer wg.Done(); c1Data, c1Err = readMsg(c1c) }()
	go func() { defer wg.Done(); c2Data, c2Err = readMsg(c2c) }()

	m.broadcastToClients(msg)

	wg.Wait()
	require.NoError(t, c1Err, "client 1 should receive broadcast")
	require.NoError(t, c2Err, "client 2 should receive broadcast")
	assert.Equal(t, outputData, c1Data, "client 1 data should match PTY output")
	assert.Equal(t, outputData, c2Data, "client 2 data should match PTY output")
}

// TestMultiplexer_InputIsolation verifies that input from one client goes ONLY to the
// PTY and is NOT broadcast to other connected clients.
//
// This is a regression test for the multiplexer's asymmetric routing invariant:
//   - PTY output → broadcast to all clients (read-only fan-out)
//   - Client input → written to PTY only (isolated write-path)
func TestMultiplexer_InputIsolation(t *testing.T) {
	m := &Multiplexer{
		clients: make(map[net.Conn]struct{}),
	}
	ctx, cancel := context.WithCancel(context.Background())
	m.ctx = ctx
	m.cancel = cancel
	defer cancel()

	// Mock PTY: os.Pipe lets us capture what gets written to it.
	ptyR, ptyW, err := os.Pipe()
	require.NoError(t, err)
	defer ptyR.Close()
	m.ptmx = ptyW

	// Two client pairs.
	c1s, c1c := net.Pipe()
	c2s, c2c := net.Pipe()
	defer c1s.Close()
	defer c2s.Close()

	// Only c2s is registered as a passive client (monitoring for spurious writes).
	m.clientsMu.Lock()
	m.clients[c2s] = struct{}{}
	m.clientsMu.Unlock()

	inputPayload := []byte("keyboard input from client 1 only")
	inputMsg := NewInputMessage(inputPayload)
	encodedInput, err := EncodeMessage(inputMsg)
	require.NoError(t, err)

	// Client 1 sends: Input message, then Close to terminate handleClient.
	encodedClose, err := EncodeMessage(&Message{Type: MessageTypeClose})
	require.NoError(t, err)

	// Goroutine: c1c side — handle metadata reply from handleClient, then send input+close.
	go func() {
		defer c1c.Close()
		// handleClient sends metadata first; read and discard it.
		c1c.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		DecodeMessage(c1c) // discard metadata
		// Send input, then close.
		c1c.Write(encodedInput)
		time.Sleep(20 * time.Millisecond)
		c1c.Write(encodedClose)
	}()

	// Run handleClient for c1s — exits when it reads Close message.
	m.wg.Add(1)
	m.handleClient(c1s)

	// Close PTY write end so read gets EOF.
	ptyW.Close()
	ptyData, _ := io.ReadAll(ptyR)
	assert.Contains(t, string(ptyData), string(inputPayload),
		"input should be forwarded to PTY")

	// Verify c2c (passive client) received nothing.
	c2c.SetReadDeadline(time.Now().Add(80 * time.Millisecond))
	buf := make([]byte, 512)
	n, readErr := c2c.Read(buf)
	assert.Equal(t, 0, n,
		"passive client 2 must NOT receive input from client 1 (got %d bytes: %q)", n, buf[:n])
	assert.Error(t, readErr,
		"read from client 2 should time out since no data was broadcast")
	c2c.Close()
}
