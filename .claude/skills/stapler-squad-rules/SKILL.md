---
name: stapler-squad-rules
description: Use when working in the stapler-squad repo to manage Claude Code approval rules — reviewing analytics for coverage gaps, adding or retiring rules, debugging why a session generates excessive manual review requests, or editing seed rules in pkg/classifier/classifier.go.
---

# Stapler Squad Rules Engine

Guides you through reading the approval analytics, identifying coverage gaps, and adding or tuning rules in the stapler-squad rules engine.

## When to Use This Skill

- Reviewing analytics to understand what Claude is doing
- Identifying gaps (commands not covered by any rule)
- Deciding whether to add, modify, or retire an auto-approval rule
- Investigating why a session is generating lots of manual review requests

## Accessing the Analytics

Navigate to **http://localhost:8543/rules** (run `make restart-web` if the server is not running).

Two panels:
1. **Approval Rules Panel** (top) — active rules with trigger counts
2. **Approval Analytics Panel** (bottom) — time-series data, coverage gaps, program breakdowns

Use the **7 / 14 / 30 / 90 day** window selector to change the time range.

## Reading the Analytics

### Rule Coverage Gaps (most important)

Appears at the bottom of the analytics panel when decisions went unmatched.

| Metric | Meaning |
|--------|---------|
| **Gap rate** | % of decisions with no matching rule. >30% = high; <10% = good |
| **Uncovered Tools** | Tool types (Bash, Write, Edit) escalating without a rule |
| **Uncovered Bash Programs** | Executables whose commands frequently escape all rules |

For each row → click "Add rule →" to open the rules editor.

### Other Sections

- **Top Triggered Rules** — verify rules are active, find candidates for sub-rules
- **Top Tools** — if Bash is dominant with high gap rate, existing Bash rules are too narrow
- **Top Bash Programs** — appears in both "top" and "uncovered" → needs a rule
- **Top Python Imports** — `requests`/`urllib`/`httpx` = Claude making HTTP calls from Python

## Deciding What Rules to Add

```
□ What tool is unmatched? (Bash, Write, Edit, Read, etc.)
□ If Bash: what program? (git, npm, curl, docker, …)
□ Is this program safe in this workflow? (vcs=usually safe, network=review)
□ What subcommands are most common? (git commit vs git push differ in risk)
□ Is there a pattern in the command text? (regex on command field)
□ Should this be auto-allow, auto-deny, or explicit escalate?
```

**Safe to auto-allow:** read-only VCS (`git status`, `git log`), package-manager queries (`npm list`), local build/test commands (`go build`, `go test`, `pytest ./...`)

**Auto-deny:** writes to `.env`/credential files, `rm -rf` on non-tmp paths, `curl`/`wget` piped to `sh`

**Escalate:** `git push`, `npm publish`, `kubectl apply`, `terraform apply`

## Rules Engine: Criteria vs. CommandPattern

**Always prefer Criteria** (AST-based). Use `CommandPattern` regex only when Criteria cannot express the match.

### Criteria fields (AND semantics when combined)

| Field | Purpose | Example |
|-------|---------|---------|
| `Programs` | Exact program names | `["git", "jj"]` |
| `Subcommands` | Allowed first positional args | `["status", "log"]` |
| `BlockedSubcommands` | Subcommands that prevent a match | `["push"]` |
| `RequiredFlags` | At least one flag must be present | `["--hard"]` |
| `ForbiddenFlags` | Any of these → rule does not match | `["--force"]` |
| `PythonModes` | Python invocation mode | `["script", "module"]` |

Criteria correctly handles: `git -C /some/path status` → subcommand is `status`; `rtk git push` → unwraps to `git push`; `sudo npm test` → unwraps to `npm test`.

### CommandPattern (last resort)

Use only when matching a flag value, redirection target, or inline argument that Criteria cannot express:

```go
CommandPattern: regexp.MustCompile(`\bcurl\b.*\s(-[a-zA-Z]*[oO]|--(output|remote-name))\b`),
```

## Creating a Rule

### Code change (seed rules — permanent)

1. Open `pkg/classifier/classifier.go` → add to `SeedRules()`:

```go
{
    ID:       "seed-allow-bash-mytool",
    Name:     "Allow mytool read-only subcommands",
    ToolName: "Bash",
    Criteria: &CommandCriteria{
        Programs:    []string{"mytool"},
        Subcommands: []string{"list", "show", "status", "info"},
    },
    Decision:  AutoAllow,
    RiskLevel: RiskLow,
    Reason:    "Read-only mytool operations pose no risk.",
    Priority:  100,
    Enabled:   true,
    Source:    "seed",
},
```

2. Run `go test ./pkg/classifier/...` — all tests must pass.
3. New rule loads on next server restart.

### Runtime addition (no code change)

1. Go to **http://localhost:8543/rules** → **Add Custom Rule** form
2. Fill in Name, Decision, Tool Name, Command Pattern, Reason, Priority
3. Click **Save Rule** — takes effect immediately without restart.

## Keeping Rules Evergreen

Review weekly or after major workflow changes:

1. Check top uncovered programs — new tools needing rules
2. Check stale rules — haven't triggered recently, may be too specific
3. Check manual review rate trend — rising = new patterns to cover
4. After adding a new Claude skill — Claude may start using new programs; check analytics a day later

## Backend Files

| File | Purpose |
|------|---------|
| `pkg/classifier/classifier.go` | `SeedRules()`, `CommandCriteria`, `AuditCommand` |
| `pkg/classifier/command_parser.go` | Bash AST parser, `ExtractAllCommands`, Python import extractor |
| `server/services/rules_service.go` | RPC handlers + proto mapping |
| `server/services/analytics_store.go` | JSONL analytics storage + aggregation |
| `server/services/approval_handler.go` | HTTP hook handler + secret scanner + domain checker |
| `server/services/secret_scanner.go` | Regex patterns for plaintext secret detection |
| `server/services/domain_checker.go` | RDAP-based new-domain escalation |
| `proto/session/v1/types.proto` | Proto definitions (run `make proto-gen` after changes) |
| `web-app/src/components/sessions/ApprovalAnalyticsPanel.tsx` | Analytics UI |
| `web-app/src/components/sessions/ApprovalRulesPanel.tsx` | Rules management UI |
