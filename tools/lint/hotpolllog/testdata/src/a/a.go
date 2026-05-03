// Package a contains test fixtures for the hotpolllog analyzer.
package a

import (
	"log"
)

// DebugLog is a package-level variable that mimics log.DebugLog.
var DebugLog = log.New(nil, "DEBUG: ", 0)

// BAD1: DebugLog.Printf called directly in a select case inside a for loop.
func bad1(ch <-chan int) {
	for {
		select {
		case <-ch:
			DebugLog.Printf("got value") // want `DebugLog call inside a select case of a for loop`
		}
	}
}

// BAD2: DebugLog.Printf (no package qualifier) in a select case inside a for loop.
func bad2(ch <-chan string) {
	for {
		select {
		case data := <-ch:
			_ = data
			DebugLog.Printf("got: %s", data) // want `DebugLog call inside a select case of a for loop`
		}
	}
}

// BAD3: Qualified pkg.DebugLog.Printf inside a range-based for loop.
type mockPkg struct {
	DebugLog *log.Logger
}

var logPkg = &mockPkg{DebugLog: log.New(nil, "DEBUG: ", 0)}

func bad3(items []int, ch <-chan int) {
	for range items {
		select {
		case <-ch:
			logPkg.DebugLog.Printf("iteration") // want `DebugLog call inside a select case of a for loop`
		}
	}
}

// BAD4: Even with a nil guard the call still fires every iteration — removing
// it is the fix, not guarding.
func bad4(ch <-chan int) {
	for {
		select {
		case <-ch:
			if DebugLog != nil {
				DebugLog.Printf("guarded but still bad") // want `DebugLog call inside a select case of a for loop`
			}
		}
	}
}

// GOOD1: DebugLog.Printf is outside the select statement (after it), so it
// does not fire on every channel receive — this is fine.
func good1(ch <-chan int) {
	for {
		select {
		case <-ch:
		}
		DebugLog.Printf("after select, not in case")
	}
}

// GOOD2: DebugLog.Printf outside any loop entirely.
func good2() {
	DebugLog.Printf("top-level call")
}

// GOOD3: InfoLog is not DebugLog — different variable name, should not fire.
var InfoLog = log.New(nil, "INFO: ", 0)

func good3(ch <-chan int) {
	for {
		select {
		case <-ch:
			InfoLog.Printf("info inside select")
		}
	}
}

// GOOD4: select without a surrounding for loop — not a hot-poll pattern.
func good4(ch <-chan int) {
	select {
	case <-ch:
		DebugLog.Printf("select without for")
	}
}
