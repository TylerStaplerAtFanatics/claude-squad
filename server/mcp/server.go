// Package mcp implements the MCP (Model Context Protocol) server for Stapler Squad.
// Activated by the --mcp flag; communicates over stdio transport.
package mcp

import (
	"context"
	"os"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
	"github.com/tstapler/stapler-squad/log"
	"github.com/tstapler/stapler-squad/server/services"
	"github.com/tstapler/stapler-squad/session"
	"github.com/tstapler/stapler-squad/session/scrollback"
)

// RunServer initializes and starts the MCP stdio server.
// It blocks until the context is cancelled or stdin is closed.
// store is used for read-only discovery tools. svc provides lifecycle operations.
// sbMgr provides read access to terminal scrollback data persisted on disk.
func RunServer(ctx context.Context, store session.InstanceStore, svc *services.SessionService, sbMgr *scrollback.ScrollbackManager) error {
	s := mcpserver.NewMCPServer(
		"stapler-squad",
		"1.0.0",
		mcpserver.WithToolCapabilities(false),
	)

	d := &discoveryHandlers{store: store}
	registerDiscoveryTools(s, d)

	lh := &lifecycleHandlers{store: store, svc: svc}
	registerLifecycleTools(s, lh)

	th := &terminalHandlers{
		store:      store,
		scrollback: sbMgr,
		writeLim:   newTokenBucket(writeRateLimitPerSec, writeRateLimitPerSec),
	}
	registerTerminalTools(s, th)

	vh := &vcsHandlers{store: store}
	registerVCSTools(s, vh)

	log.InfoLog.Printf("[mcp] server starting on stdio transport")

	stdio := mcpserver.NewStdioServer(s)
	return stdio.Listen(ctx, os.Stdin, os.Stdout)
}

func registerDiscoveryTools(s *mcpserver.MCPServer, d *discoveryHandlers) {
	s.AddTool(
		mcpgo.NewTool("list_sessions",
			mcpgo.WithDescription("List Stapler Squad sessions. Returns a page of sessions with summary info. Prefer search_sessions when looking for a specific session — it is faster and returns less context. Default limit is 10 to avoid filling LLM context."),
			mcpgo.WithString("status_filter",
				mcpgo.Description("Filter by status: running, paused, ready, loading, needs_approval"),
				mcpgo.Enum("running", "paused", "ready", "loading", "needs_approval"),
			),
			mcpgo.WithNumber("limit",
				mcpgo.Description("Max sessions per page (default 10, max 100)"),
				mcpgo.DefaultNumber(10),
				mcpgo.Min(1),
				mcpgo.Max(100),
			),
			mcpgo.WithString("cursor",
				mcpgo.Description("Opaque pagination cursor from a previous list_sessions response"),
			),
		),
		d.listSessions,
	)

	s.AddTool(
		mcpgo.NewTool("get_session",
			mcpgo.WithDescription("Get full details for a single Stapler Squad session by ID. Does not include terminal output — use read_session_output for that."),
			mcpgo.WithString("session_id",
				mcpgo.Description("Session ID (title) of the session to retrieve"),
				mcpgo.Required(),
			),
		),
		d.getSession,
	)

	s.AddTool(
		mcpgo.NewTool("search_sessions",
			mcpgo.WithDescription("Search sessions by text query or tags. Prefer this over list_sessions when looking for a specific session. Matches against title, path, branch, and tags."),
			mcpgo.WithString("query",
				mcpgo.Description("Search query matched against title, path, branch, and tags"),
				mcpgo.Required(),
			),
			mcpgo.WithArray("tag_filter",
				mcpgo.Description("Filter to sessions that have all of these tags"),
			),
			mcpgo.WithNumber("limit",
				mcpgo.Description("Max results (default 10, max 50)"),
				mcpgo.DefaultNumber(10),
				mcpgo.Min(1),
				mcpgo.Max(50),
			),
		),
		d.searchSessions,
	)
}
