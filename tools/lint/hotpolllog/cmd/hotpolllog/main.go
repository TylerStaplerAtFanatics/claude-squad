// Command hotpolllog runs the hotpolllog static analysis pass as a
// standalone tool.
//
// Usage:
//
//	go run ./tools/lint/hotpolllog/cmd/hotpolllog ./...
//
// The tool reports any call to a variable named DebugLog (e.g.
// log.DebugLog.Printf) found inside a select-case clause that is itself
// inside a for or range loop. These calls cause a goroutine block event
// on every loop iteration even when the log output is discarded, which
// shows up as thousands of entries in pprof block profiles.
package main

import (
	"golang.org/x/tools/go/analysis/singlechecker"

	"github.com/tstapler/stapler-squad/tools/lint/hotpolllog"
)

func main() {
	singlechecker.Main(hotpolllog.Analyzer)
}
