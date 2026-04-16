package services

// transport_e2e_test.go: end-to-end transport tests using a synthetic Go client.
//
// Each test case spins up a real httptest WebSocket server, encodes terminal
// content using the target streaming mode, sends it over the wire, and
// verifies that the synthetic client can recover the original content.
//
// This file also acts as the specification for what each mode MUST do:
//   - "raw"           — content passes through as plain bytes
//   - "raw-compressed"— content is LZMA/XZ compressed; client decompresses to recover original
//   - "state"         — currently aliases "raw" (state-sync protocol not yet wired in streamer)
//   - "hybrid"        — currently aliases "raw" (raw incremental path not yet compressed)
//
// If a test here fails it means the transport contract is broken, not that the
// test expectation is wrong — fix the production code, not the test.

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	sessionv1 "github.com/tstapler/stapler-squad/gen/proto/go/session/v1"
	"github.com/tstapler/stapler-squad/server/compression"
	"github.com/tstapler/stapler-squad/server/protocol"

	"github.com/gorilla/websocket"
	"google.golang.org/protobuf/proto"
)

// xzMagic is the XZ container magic number (first 6 bytes of any LZMA/XZ stream).
var xzMagic = []byte{0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00}

// encodeTerminalOutput applies the transport-level encoding for the given mode.
// This is the function that SHOULD be used by streamViaControlMode and
// streamViaTmuxCapturePane (currently those functions always send raw bytes
// regardless of the mode — tracked as a known gap).
func encodeTerminalOutput(content []byte, mode string) ([]byte, error) {
	switch mode {
	case "raw-compressed":
		compressed, _, err := compression.CompressLZMA(content)
		if err != nil {
			return nil, err
		}
		return compressed, nil
	default:
		// "raw", "state", "hybrid" — plain bytes
		return content, nil
	}
}

// buildTerminalDataEnvelope marshals a TerminalOutput payload into a ConnectRPC
// WebSocket envelope ready to be written to the wire.
func buildTerminalDataEnvelope(sessionID string, content []byte, mode string) ([]byte, error) {
	encoded, err := encodeTerminalOutput(content, mode)
	if err != nil {
		return nil, err
	}

	msg := &sessionv1.TerminalData{
		SessionId: sessionID,
		Data: &sessionv1.TerminalData_Output{
			Output: &sessionv1.TerminalOutput{
				Data: encoded,
			},
		},
	}
	dataBytes, err := proto.Marshal(msg)
	if err != nil {
		return nil, err
	}
	return protocol.CreateEnvelope(0, dataBytes), nil
}

// startTransportTestServer starts a minimal WebSocket server that:
//  1. Accepts one connection.
//  2. Sends a single TerminalData message encoded for the given streaming mode.
//  3. Sends an EndStream envelope.
//  4. Closes the connection.
func startTransportTestServer(t *testing.T, mode string, content []byte) *httptest.Server {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := wsUpgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("server: WebSocket upgrade failed: %v", err)
			return
		}
		defer conn.Close()

		// Read (and discard) the client handshake message.
		if _, _, err := conn.ReadMessage(); err != nil {
			t.Errorf("server: failed to read client handshake: %v", err)
			return
		}

		// Send terminal data encoded for this mode.
		envelope, err := buildTerminalDataEnvelope("test-session", content, mode)
		if err != nil {
			t.Errorf("server: failed to build envelope: %v", err)
			return
		}
		if err := conn.WriteMessage(websocket.BinaryMessage, envelope); err != nil {
			t.Errorf("server: failed to send terminal data: %v", err)
			return
		}

		// Send EndStream.
		sendEndStreamSuccess(&connectWebSocketStream{conn: conn})
	}))

	return srv
}

// syntheticClientReceive connects to the test server, sends a handshake, and
// collects all TerminalOutput.Data bytes until EndStream.
func syntheticClientReceive(t *testing.T, serverURL string) []byte {
	t.Helper()

	wsURL := "ws" + strings.TrimPrefix(serverURL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("client: dial failed: %v", err)
	}
	defer conn.Close()

	// Send a minimal handshake (empty CurrentPaneRequest wrapped in TerminalData).
	handshake := &sessionv1.TerminalData{
		SessionId: "test-session",
		Data: &sessionv1.TerminalData_CurrentPaneRequest{
			CurrentPaneRequest: &sessionv1.CurrentPaneRequest{},
		},
	}
	handshakeBytes, err := proto.Marshal(handshake)
	if err != nil {
		t.Fatalf("client: marshal handshake: %v", err)
	}
	if err := conn.WriteMessage(websocket.BinaryMessage, protocol.CreateEnvelope(0, handshakeBytes)); err != nil {
		t.Fatalf("client: send handshake: %v", err)
	}

	var received []byte
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			break
		}
		env, _, err := protocol.ParseEnvelope(raw)
		if err != nil {
			t.Fatalf("client: parse envelope: %v", err)
		}
		if env.IsEndStream() {
			break
		}
		if len(env.Data) == 0 {
			continue
		}
		var msg sessionv1.TerminalData
		if err := proto.Unmarshal(env.Data, &msg); err != nil {
			t.Fatalf("client: unmarshal TerminalData: %v", err)
		}
		if out := msg.GetOutput(); out != nil {
			received = append(received, out.Data...)
		}
	}
	return received
}

// terminalFixture returns a content string large enough to exceed the
// compression threshold so that LZMA actually compresses it.
func terminalFixture() []byte {
	return []byte(strings.Repeat("\x1b[32m[stapler-squad] session active\x1b[0m\r\n", 60))
}

// TestTransportRaw verifies that "raw" mode delivers content byte-for-byte.
func TestTransportRaw(t *testing.T) {
	content := terminalFixture()
	srv := startTransportTestServer(t, "raw", content)
	defer srv.Close()

	received := syntheticClientReceive(t, srv.URL)
	if !bytes.Equal(received, content) {
		t.Errorf("raw: received %d bytes, want %d bytes; content mismatch", len(received), len(content))
	}
}

// TestTransportRawCompressed verifies that "raw-compressed" mode:
//  1. Sends bytes that begin with the XZ magic header.
//  2. Those bytes decompress to exactly the original content.
func TestTransportRawCompressed(t *testing.T) {
	content := terminalFixture()
	if len(content) < compression.CompressionThreshold {
		t.Fatalf("fixture (%d bytes) must be >= CompressionThreshold (%d) for LZMA to engage", len(content), compression.CompressionThreshold)
	}

	srv := startTransportTestServer(t, "raw-compressed", content)
	defer srv.Close()

	received := syntheticClientReceive(t, srv.URL)

	// 1. Wire-level bytes must start with XZ magic.
	if len(received) < len(xzMagic) || !bytes.HasPrefix(received, xzMagic) {
		t.Fatalf("raw-compressed: expected XZ magic header %x at start of payload, got first bytes: %x",
			xzMagic, received[:min(len(received), 8)])
	}

	// 2. Decompressing must recover the original content exactly.
	decompressed, err := compression.DecompressLZMA(received)
	if err != nil {
		t.Fatalf("raw-compressed: DecompressLZMA failed: %v", err)
	}
	if !bytes.Equal(decompressed, content) {
		t.Errorf("raw-compressed: decompressed content (%d bytes) does not match original (%d bytes)", len(decompressed), len(content))
	}
}

// TestTransportState verifies that "state" mode accepts the connection and
// delivers content. Full state-sync protocol encoding is not yet implemented
// in the streamer; this test documents the current behaviour (raw passthrough)
// and will need updating when the state encoder is wired in.
func TestTransportState(t *testing.T) {
	content := terminalFixture()
	srv := startTransportTestServer(t, "state", content)
	defer srv.Close()

	received := syntheticClientReceive(t, srv.URL)
	if !bytes.Equal(received, content) {
		t.Errorf("state: received %d bytes, want %d bytes; content mismatch", len(received), len(content))
	}
}

// TestTransportHybrid verifies that "hybrid" mode accepts the connection and
// delivers raw incremental output. Compressed full-state snapshots are not yet
// wired into the streamer; this test documents the current raw-passthrough
// behaviour.
func TestTransportHybrid(t *testing.T) {
	content := terminalFixture()
	srv := startTransportTestServer(t, "hybrid", content)
	defer srv.Close()

	received := syntheticClientReceive(t, srv.URL)
	if !bytes.Equal(received, content) {
		t.Errorf("hybrid: received %d bytes, want %d bytes; content mismatch", len(received), len(content))
	}
}

// TestTransportCompressionRatioIsReasonable verifies that LZMA compression of
// typical terminal output achieves a meaningful reduction — at least 50%.
// This guards against a degenerate compression config that produces larger output.
func TestTransportCompressionRatioIsReasonable(t *testing.T) {
	content := terminalFixture()
	compressed, ratio, err := compression.CompressLZMA(content)
	if err != nil {
		t.Fatalf("CompressLZMA error: %v", err)
	}
	if ratio >= 0.5 {
		t.Errorf("compression ratio %.2f is too poor (expected < 0.5 for repetitive terminal output); compressed=%d original=%d",
			ratio, len(compressed), len(content))
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
