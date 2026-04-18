"use client";

import { useState } from "react";
import { useApprovalRules } from "@/lib/hooks/useApprovalRules";
import { useApprovalAnalytics } from "@/lib/hooks/useApprovalAnalytics";
import { ApprovalRuleProto, AutoDecision } from "@/gen/session/v1/types_pb";
import {
  panel, header, titleRow, title, subtitle, refreshButton,
  analyticsBar, analyticsTotal, analyticsRate, rateAllow, rateManual, analyticsTopTool,
  tabs, tab, tabActive,
  error as errorClass, retryButton,
  loading as loadingClass, empty,
  tableWrapper, table, th, td, tdCenter, row, rowDisabled,
  ruleName, ruleReason, ruleAlt, matchInfo, matchChip,
  decisionBadge, decisionAllow, decisionDeny, decisionEscalate,
  sourceBadge, toggle, toggleOn, toggleOff, deleteButton,
  formSection, addButton, form as formClass, formTitle, formError as formErrorClass, formGrid, label, input, select,
  formActions, saveButton, cancelButton,
} from "./ApprovalRulesPanel.css";

// ── helpers ──────────────────────────────────────────────────────────────────

function decisionLabel(d: AutoDecision): string {
  switch (d) {
    case AutoDecision.ALLOW: return "Auto-Allow";
    case AutoDecision.DENY:  return "Auto-Deny";
    default:                 return "Escalate";
  }
}

function decisionClass(d: AutoDecision): string {
  switch (d) {
    case AutoDecision.ALLOW: return decisionAllow;
    case AutoDecision.DENY:  return decisionDeny;
    default:                 return decisionEscalate;
  }
}

function sourceLabel(s: string): string {
  switch (s) {
    case "user":            return "Custom";
    case "seed":            return "Built-in";
    case "claude-settings": return "Claude Settings";
    default:                return s;
  }
}

// ── empty form state ──────────────────────────────────────────────────────────

interface RuleFormState {
  name: string;
  toolName: string;
  toolPattern: string;
  commandPattern: string;
  filePattern: string;
  decision: AutoDecision;
  reason: string;
  alternative: string;
  priority: number;
  enabled: boolean;
}

const emptyForm: RuleFormState = {
  name: "",
  toolName: "",
  toolPattern: "",
  commandPattern: "",
  filePattern: "",
  decision: AutoDecision.ALLOW,
  reason: "",
  alternative: "",
  priority: 10,
  enabled: true,
};

// ── component ─────────────────────────────────────────────────────────────────

/**
 * ApprovalRulesPanel shows the list of auto-approval rules and lets users
 * create, toggle, and delete custom rules.
 *
 * Built-in (seed) and claude-settings rules are shown read-only.
 */
export function ApprovalRulesPanel() {
  const { rules, loading, error, upsertRule, deleteRule, refresh } = useApprovalRules();
  const { summary, loading: analyticsLoading } = useApprovalAnalytics({ windowDays: 7 });

  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<RuleFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ── filter ────────────────────────────────────────────────────────────────

  const visibleRules = sourceFilter === "all"
    ? rules
    : rules.filter((r) => r.source === sourceFilter);

  // ── save handler ──────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!form.name.trim()) {
      setFormError("Name is required.");
      return;
    }
    if (!form.toolName && !form.toolPattern && !form.commandPattern && !form.filePattern) {
      setFormError("At least one of Tool Name, Tool Pattern, Command Pattern, or File Pattern is required.");
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const id = `user-${Date.now()}`;
      await upsertRule({ id, ...form, riskLevel: "" });
      setForm(emptyForm);
      setShowForm(false);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to save rule.");
    } finally {
      setSaving(false);
    }
  };

  // ── toggle enabled ────────────────────────────────────────────────────────

  const handleToggle = async (rule: ApprovalRuleProto) => {
    if (rule.source !== "user") return;
    try {
      await upsertRule({
        id: rule.id,
        name: rule.name,
        toolName: rule.toolName,
        toolPattern: rule.toolPattern,
        commandPattern: rule.commandPattern,
        filePattern: rule.filePattern,
        decision: rule.decision,
        riskLevel: rule.riskLevel,
        reason: rule.reason,
        alternative: rule.alternative,
        priority: rule.priority,
        enabled: !rule.enabled,
      });
    } catch (e) {
      console.error("Failed to toggle rule:", e);
    }
  };

  // ── analytics summary bar ─────────────────────────────────────────────────

  const autoAllowRate = summary ? Math.round(summary.autoApproveRate * 100) : null;
  const manualRate    = summary ? Math.round(summary.manualReviewRate * 100) : null;
  const total         = summary ? summary.totalDecisions : null;

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className={panel}>
      {/* ── Header ── */}
      <div className={header}>
        <div className={titleRow}>
          <h2 className={title}>Approval Rules</h2>
          <button
            onClick={refresh}
            className={refreshButton}
            disabled={loading}
            aria-label="Refresh rules"
          >
            {loading ? "⟳" : "↻"}
          </button>
        </div>
        <p className={subtitle}>
          Rules are evaluated in priority order before requests reach the manual review queue.
        </p>
      </div>

      {/* ── 7-day analytics summary ── */}
      {!analyticsLoading && summary && total !== null && total > 0 && (
        <div className={analyticsBar}>
          <span className={analyticsTotal}>{total} decisions (last 7 days)</span>
          <span className={`${analyticsRate} ${rateAllow}`}>
            {autoAllowRate}% auto-allowed
          </span>
          <span className={`${analyticsRate} ${rateManual}`}>
            {manualRate}% manual review
          </span>
          {summary.topTools.length > 0 && (
            <span className={analyticsTopTool}>
              Top tool: {summary.topTools[0].toolName}
            </span>
          )}
        </div>
      )}

      {/* ── Source filter tabs ── */}
      <div className={tabs}>
        {["all", "user", "seed", "claude-settings"].map((src) => {
          const count = src === "all" ? rules.length : rules.filter((r) => r.source === src).length;
          return (
            <button
              key={src}
              className={`${tab} ${sourceFilter === src ? tabActive : ""}`}
              onClick={() => setSourceFilter(src)}
            >
              {src === "all" ? "All" : sourceLabel(src)}
              {" "}({count})
            </button>
          );
        })}
      </div>

      {/* ── Error ── */}
      {error && (
        <div className={errorClass}>
          Failed to load rules: {error.message}
          <button onClick={refresh} className={retryButton}>Retry</button>
        </div>
      )}

      {/* ── Rules table ── */}
      <div className={tableWrapper}>
        {loading && visibleRules.length === 0 ? (
          <div className={loadingClass}>Loading rules…</div>
        ) : visibleRules.length === 0 ? (
          <div className={empty}>
            No rules found.{" "}
            {sourceFilter === "all" || sourceFilter === "user"
              ? "Add a custom rule below."
              : ""}
          </div>
        ) : (
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>Name</th>
                <th className={th}>Match</th>
                <th className={th}>Decision</th>
                <th className={th}>Source</th>
                <th className={th}>Priority</th>
                <th className={th}>Enabled</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {visibleRules.map((rule) => (
                <tr key={rule.id} className={`${row} ${!rule.enabled ? rowDisabled : ""}`}>
                  <td className={td}>
                    <span className={ruleName}>{rule.name || rule.id}</span>
                    {rule.reason && (
                      <span className={ruleReason}>{rule.reason}</span>
                    )}
                    {rule.alternative && (
                      <span className={ruleAlt}>Alt: {rule.alternative}</span>
                    )}
                  </td>
                  <td className={td}>
                    <div className={matchInfo}>
                      {rule.toolName && <code className={matchChip}>{rule.toolName}</code>}
                      {rule.commandPattern && <code className={matchChip}>{rule.commandPattern}</code>}
                      {rule.toolPattern && <code className={matchChip}>{rule.toolPattern}</code>}
                      {rule.filePattern && <code className={matchChip}>{rule.filePattern}</code>}
                    </div>
                  </td>
                  <td className={td}>
                    <span className={`${decisionBadge} ${decisionClass(rule.decision)}`}>
                      {decisionLabel(rule.decision)}
                    </span>
                  </td>
                  <td className={td}>
                    <span className={sourceBadge}>{sourceLabel(rule.source)}</span>
                  </td>
                  <td className={`${td} ${tdCenter}`}>{rule.priority}</td>
                  <td className={`${td} ${tdCenter}`}>
                    <button
                      className={`${toggle} ${rule.enabled ? toggleOn : toggleOff}`}
                      onClick={() => handleToggle(rule)}
                      disabled={rule.source !== "user"}
                      aria-label={rule.enabled ? "Disable rule" : "Enable rule"}
                      title={rule.source !== "user" ? "Built-in rules cannot be toggled" : undefined}
                    >
                      {rule.enabled ? "ON" : "OFF"}
                    </button>
                  </td>
                  <td className={`${td} ${tdCenter}`}>
                    {rule.source === "user" && (
                      <button
                        className={deleteButton}
                        onClick={() => deleteRule(rule.id)}
                        aria-label={`Delete rule ${rule.name}`}
                        title="Delete rule"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Add rule form ── */}
      <div className={formSection}>
        {!showForm ? (
          <button className={addButton} onClick={() => setShowForm(true)}>
            + Add Custom Rule
          </button>
        ) : (
          <div className={formClass}>
            <h3 className={formTitle}>New Rule</h3>

            {formError && <div className={formErrorClass}>{formError}</div>}

            <div className={formGrid}>
              <label className={label}>
                Name *
                <input
                  className={input}
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Allow git log"
                />
              </label>

              <label className={label}>
                Decision *
                <select
                  className={select}
                  value={form.decision}
                  onChange={(e) => setForm((f) => ({ ...f, decision: Number(e.target.value) as AutoDecision }))}
                >
                  <option value={AutoDecision.ALLOW}>Auto-Allow</option>
                  <option value={AutoDecision.DENY}>Auto-Deny</option>
                  <option value={AutoDecision.ESCALATE}>Escalate (manual)</option>
                </select>
              </label>

              <label className={label}>
                Tool Name
                <input
                  className={input}
                  value={form.toolName}
                  onChange={(e) => setForm((f) => ({ ...f, toolName: e.target.value }))}
                  placeholder="e.g. Bash"
                />
              </label>

              <label className={label}>
                Command Pattern (regex)
                <input
                  className={input}
                  value={form.commandPattern}
                  onChange={(e) => setForm((f) => ({ ...f, commandPattern: e.target.value }))}
                  placeholder="e.g. ^git log"
                />
              </label>

              <label className={label}>
                Tool Pattern (regex)
                <input
                  className={input}
                  value={form.toolPattern}
                  onChange={(e) => setForm((f) => ({ ...f, toolPattern: e.target.value }))}
                  placeholder="e.g. Read|Glob"
                />
              </label>

              <label className={label}>
                File Pattern (regex)
                <input
                  className={input}
                  value={form.filePattern}
                  onChange={(e) => setForm((f) => ({ ...f, filePattern: e.target.value }))}
                  placeholder="e.g. \.md$"
                />
              </label>

              <label className={label}>
                Reason
                <input
                  className={input}
                  value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                  placeholder="Shown to Claude when denied"
                />
              </label>

              <label className={label}>
                Alternative
                <input
                  className={input}
                  value={form.alternative}
                  onChange={(e) => setForm((f) => ({ ...f, alternative: e.target.value }))}
                  placeholder="Safer command suggestion"
                />
              </label>

              <label className={label}>
                Priority
                <input
                  className={input}
                  type="number"
                  min={1}
                  max={999}
                  value={form.priority}
                  onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) }))}
                />
              </label>
            </div>

            <div className={formActions}>
              <button
                className={saveButton}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save Rule"}
              </button>
              <button
                className={cancelButton}
                onClick={() => { setShowForm(false); setForm(emptyForm); setFormError(null); }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
