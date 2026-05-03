// Package hotpolllog defines a go/analysis pass that detects calls to
// DebugLog methods (e.g. log.DebugLog.Printf) made directly inside a
// select-case clause that is itself inside a for loop.
//
// This pattern was the root cause of 26,437 goroutine block events in
// the stapler-squad streaming goroutine: every frame triggered a logging
// call that blocked on a channel write even when debug logging was a no-op.
//
// The analyzer is purely syntactic — it looks for selector expressions
// where the field name is "DebugLog" regardless of the package that owns
// the variable. This keeps the rule simple and avoids import-path
// resolution complexity while still catching the real pattern.
package hotpolllog

import (
	"go/ast"
	"go/token"

	"golang.org/x/tools/go/analysis"
	"golang.org/x/tools/go/analysis/passes/inspect"
	"golang.org/x/tools/go/ast/inspector"
)

// Analyzer is the exported analysis.Analyzer for the hotpolllog check.
var Analyzer = &analysis.Analyzer{
	Name:     "hotpolllog",
	Doc:      "detects DebugLog method calls inside select-case clauses of for loops, which cause hot-poll goroutine block events",
	Run:      run,
	Requires: []*analysis.Analyzer{inspect.Analyzer},
}

func run(pass *analysis.Pass) (interface{}, error) {
	insp := pass.ResultOf[inspect.Analyzer].(*inspector.Inspector)

	// We walk CommClause nodes (case clauses of select statements).
	// For each, we check whether:
	//   (a) it belongs to a select statement that is inside a for loop, and
	//   (b) its body contains a call where the receiver is named "DebugLog".
	nodeFilter := []ast.Node{
		(*ast.CommClause)(nil),
	}

	insp.WithStack(nodeFilter, func(n ast.Node, push bool, stack []ast.Node) bool {
		if !push {
			return true
		}

		clause := n.(*ast.CommClause)

		// Verify the immediate parent is a SelectStmt and that there is a
		// ForStmt or RangeStmt somewhere further up the stack.
		if !inSelectInsideFor(stack) {
			return true
		}

		// Walk all statements in the case body looking for DebugLog calls.
		for _, stmt := range clause.Body {
			ast.Inspect(stmt, func(inner ast.Node) bool {
				call, ok := extractCall(inner)
				if !ok {
					return true
				}
				if isDebugLogCall(call) {
					pass.Reportf(call.Pos(), "DebugLog call inside a select case of a for loop causes hot-poll goroutine block events; remove or guard with a compile-time constant")
				}
				return true
			})
		}

		return true
	})

	return nil, nil
}

// inSelectInsideFor checks the ancestor stack to ensure:
//   - the immediate enclosing statement-list owner is a SelectStmt, and
//   - there is a ForStmt or RangeStmt further up.
//
// The stack passed by inspector.WithStack has the current node at the end.
// Index len-1 is the CommClause itself; we look backwards for context.
func inSelectInsideFor(stack []ast.Node) bool {
	// Find the SelectStmt that owns this CommClause.
	selectIdx := -1
	for i := len(stack) - 2; i >= 0; i-- {
		switch stack[i].(type) {
		case *ast.SelectStmt:
			selectIdx = i
		}
		if selectIdx >= 0 {
			break
		}
	}
	if selectIdx < 0 {
		return false
	}

	// Now look for a for loop above the SelectStmt.
	for i := selectIdx - 1; i >= 0; i-- {
		switch stack[i].(type) {
		case *ast.ForStmt, *ast.RangeStmt:
			return true
		}
	}
	return false
}

// extractCall returns the *ast.CallExpr if the node is an expression
// statement or the RHS of an assignment whose first expression is a call.
func extractCall(n ast.Node) (*ast.CallExpr, bool) {
	switch s := n.(type) {
	case *ast.ExprStmt:
		if call, ok := s.X.(*ast.CallExpr); ok {
			return call, true
		}
	case *ast.AssignStmt:
		if len(s.Rhs) > 0 {
			if call, ok := s.Rhs[0].(*ast.CallExpr); ok {
				return call, true
			}
		}
	}
	return nil, false
}

// isDebugLogCall returns true when the call's function expression is a
// selector on a receiver named "DebugLog", for example:
//
//	log.DebugLog.Printf(...)   → SelectorExpr{X: SelectorExpr{X: "log", Sel: "DebugLog"}, Sel: "Printf"}
//	DebugLog.Printf(...)       → SelectorExpr{X: Ident("DebugLog"), Sel: "Printf"}
func isDebugLogCall(call *ast.CallExpr) bool {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	return receiverIsDebugLog(sel.X)
}

// receiverIsDebugLog returns true if the expression resolves to a variable
// named "DebugLog", either directly (DebugLog.Printf) or via a package
// qualifier (log.DebugLog.Printf).
func receiverIsDebugLog(expr ast.Expr) bool {
	switch x := expr.(type) {
	case *ast.Ident:
		// Direct: DebugLog.Printf(...)
		return x.Name == "DebugLog"
	case *ast.SelectorExpr:
		// Qualified: log.DebugLog.Printf(...)
		return x.Sel.Name == "DebugLog"
	}
	return false
}

// Ensure Pos is available (used for clearer diagnostics).
var _ token.Pos
