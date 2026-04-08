# ADR-007: Kahn's Algorithm for Dependency Cycle Detection

**Status**: Accepted
**Date**: 2026-04-07
**Project**: backlog-pipeline

## Context

Work items can declare dependencies on other work items. If a user's plan.md contains a cycle (A depends on B, B depends on A), the scheduler will deadlock — neither item can ever become "ready." Cycle detection is required at import time.

Two algorithms were evaluated:

1. **DFS with 3-color marking**: Detect cycles via gray/white/black node coloring; returns the cycle path
2. **Kahn's topological sort**: BFS-based algorithm that produces execution order AND detects cycles in a single pass

## Decision

**Use Kahn's algorithm inline (~60 lines). No external graph library.**

```go
func topologicalSort(tasks []WorkItem) ([]WorkItem, error) {
    inDegree := make(map[string]int)
    adj := make(map[string][]string)
    for _, t := range tasks {
        if _, ok := inDegree[t.ID]; !ok { inDegree[t.ID] = 0 }
        for _, dep := range t.DependsOn {
            adj[dep] = append(adj[dep], t.ID)
            inDegree[t.ID]++
        }
    }
    // BFS from all zero-in-degree nodes
    queue := []string{}
    for id, deg := range inDegree { if deg == 0 { queue = append(queue, id) } }
    var sorted []WorkItem
    taskByID := make(map[string]WorkItem)
    for _, t := range tasks { taskByID[t.ID] = t }
    for len(queue) > 0 {
        curr := queue[0]; queue = queue[1:]
        sorted = append(sorted, taskByID[curr])
        for _, neighbor := range adj[curr] {
            inDegree[neighbor]--
            if inDegree[neighbor] == 0 { queue = append(queue, neighbor) }
        }
    }
    if len(sorted) != len(tasks) {
        var cycleNodes []string
        for id, deg := range inDegree { if deg > 0 { cycleNodes = append(cycleNodes, id) } }
        return nil, fmt.Errorf("dependency cycle detected: %v", cycleNodes)
    }
    return sorted, nil
}
```

## Rationale

1. **Dual output**: Kahn's both detects cycles AND produces the correct execution order in one pass. DFS only detects cycles — a separate topological sort pass would be needed anyway.

2. **No new dependencies**: `gonum.org/v1/gonum/graph/topo` is mature but adds a dependency. 60 lines of inline Kahn's is sufficient for work item graphs (typically 10–200 nodes).

3. **Error reporting**: Items remaining with `inDegree > 0` after the BFS are exactly the cycle participants. The error message surfaces all cycle node IDs, enabling the UI to highlight them.

4. **Called at import time**: `MarkdownSource.Fetch()` calls `topologicalSort` before writing any items to the database. If a cycle is found, no items are inserted and a structured error is returned to the UI.

## Cycle Handling Policy

Per the pitfalls research:
- **Reject at import**: Surface the cycle as a validation error in the UI; block the pipeline from dispatching any work
- **Do NOT silently break cycles**: Arbitrarily removing edges causes data loss and trust collapse
- **Mark items as `invalid`**: Items involved in a cycle should show `status=invalid` with the cycle description as metadata
- **Unblock by user action only**: Users must edit the plan.md to resolve the cycle and re-import

## Fuzzy Match Cycle Risk

The dependency resolver may create spurious edges via fuzzy title matching (e.g., "Setup DB" matches "Setup Database"). Mitigations (implemented in `MarkdownSource`):
- Normalize both titles: lowercase, strip punctuation, collapse whitespace
- On ambiguous match (>1 candidate): surface a warning, do NOT create the edge
- Prefer exact match over normalized match

## Consequences

**Positive:**
- Single algorithm provides both cycle detection and execution order
- Zero new dependencies
- Clear error messages naming cycle participants
- Fast: O(V + E) time complexity

**Negative:**
- Cycle node reporting names IDs, not human-readable titles (mitigated by including title in error message)
- Does not trace the full cycle path (Kahn's identifies participants, not the exact path — acceptable for v1)

## Patterns Applied

- **Fail Fast**: Validate the dependency graph before writing anything to the database
- **Guard Clause**: Import function returns early with a structured error on cycle detection
- **Self-Documenting Error**: Error message includes cycle participant IDs for direct user action
