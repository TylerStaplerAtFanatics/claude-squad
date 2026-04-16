"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  SessionService,
  type DirectoryRuleProto,
  type ProfileDefaultsProto,
} from "@/gen/session/v1/session_pb";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { getApiBaseUrl } from "@/lib/config";
import { PROGRAMS } from "@/lib/constants/programs";
import styles from "./DirectoryRulesManager.module.css";

interface RuleFormData {
  path: string;
  profile: string;
  showOverrides: boolean;
  overrideProgram: string;
  overrideAutoYes: boolean;
  overrideTags: string[];
  tagInput: string;
}

const emptyForm: RuleFormData = {
  path: "",
  profile: "",
  showOverrides: false,
  overrideProgram: "",
  overrideAutoYes: false,
  overrideTags: [],
  tagInput: "",
};

export function DirectoryRulesManager() {
  const [rules, setRules] = useState<DirectoryRuleProto[]>([]);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [form, setForm] = useState<RuleFormData>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);

  const clientRef = useRef<ReturnType<
    typeof createClient<typeof SessionService>
  > | null>(null);

  useEffect(() => {
    const transport = createConnectTransport({ baseUrl: getApiBaseUrl() });
    clientRef.current = createClient(SessionService, transport);
    loadRules();
  }, []);

  const loadRules = useCallback(async () => {
    if (!clientRef.current) return;
    try {
      setLoading(true);
      setError(null);
      const response = await clientRef.current.getSessionDefaults({});
      const defaults = response.defaults;
      if (defaults) {
        setRules([...defaults.directoryRules]);
        setProfiles(Object.keys(defaults.profiles));
      }
    } catch (err) {
      setError(`Failed to load directory rules: ${err}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleEdit = (rule: DirectoryRuleProto) => {
    setEditingPath(rule.path);
    setForm({
      path: rule.path,
      profile: rule.profile,
      showOverrides: !!rule.overrides,
      overrideProgram: rule.overrides?.program ?? "",
      overrideAutoYes: rule.overrides?.autoYes ?? false,
      overrideTags: [...(rule.overrides?.tags ?? [])],
      tagInput: "",
    });
    setPathError(null);
    setShowForm(true);
  };

  const handleNewRule = () => {
    setEditingPath(null);
    setForm({ ...emptyForm });
    setPathError(null);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingPath(null);
    setForm({ ...emptyForm });
    setPathError(null);
  };

  const validatePath = (path: string): string | null => {
    if (!path.trim()) return "Path is required.";
    if (!path.startsWith("/")) return "Path must be an absolute path (start with /).";
    return null;
  };

  const handleSave = async () => {
    if (!clientRef.current) return;
    const pathErr = validatePath(form.path);
    if (pathErr) {
      setPathError(pathErr);
      return;
    }
    setPathError(null);

    const overrides: Partial<ProfileDefaultsProto> | undefined = form.showOverrides
      ? {
          program: form.overrideProgram,
          autoYes: form.overrideAutoYes,
          tags: form.overrideTags,
          name: "",
          description: "",
          envVars: {},
          cliFlags: "",
        } as unknown as ProfileDefaultsProto
      : undefined;

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      await clientRef.current.upsertDirectoryRule({
        rule: {
          path: form.path.trim(),
          profile: form.profile,
          overrides,
        } as unknown as DirectoryRuleProto,
      });
      setSuccess(`Rule for "${form.path.trim()}" saved.`);
      setTimeout(() => setSuccess(null), 3000);
      setShowForm(false);
      setEditingPath(null);
      setForm({ ...emptyForm });
      await loadRules();
    } catch (err) {
      setError(`Failed to save rule: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (path: string) => {
    if (!clientRef.current) return;
    if (!confirm(`Delete rule for "${path}"?`)) return;
    try {
      setError(null);
      setSuccess(null);
      await clientRef.current.deleteDirectoryRule({ path });
      setSuccess(`Rule for "${path}" deleted.`);
      setTimeout(() => setSuccess(null), 3000);
      await loadRules();
    } catch (err) {
      setError(`Failed to delete rule: ${err}`);
    }
  };

  const handleAddTag = () => {
    const trimmed = form.tagInput.trim();
    if (trimmed && !form.overrideTags.includes(trimmed)) {
      setForm({ ...form, overrideTags: [...form.overrideTags, trimmed], tagInput: "" });
    } else {
      setForm({ ...form, tagInput: "" });
    }
  };

  const handleRemoveTag = (tag: string) => {
    setForm({ ...form, overrideTags: form.overrideTags.filter((t) => t !== tag) });
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddTag();
    }
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <h2 className={styles.heading}>Directory Rules</h2>
        <div className={styles.loadingText}>Loading...</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <h2 className={styles.heading}>Directory Rules</h2>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleNewRule}
        >
          New Rule
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {rules.length === 0 && !showForm && (
        <div className={styles.emptyText}>
          No directory rules configured. Rules auto-populate form fields based on working directory.
        </div>
      )}
      {rules.map((rule) => (
        <div key={rule.path} className={styles.ruleRow}>
          <div className={styles.ruleInfo}>
            <span className={styles.rulePath}>{rule.path}</span>
            {rule.profile && (
              <span className={styles.ruleMeta}>Profile: {rule.profile}</span>
            )}
            {rule.overrides?.program && (
              <span className={styles.ruleMeta}>Program: {rule.overrides.program}</span>
            )}
            {rule.overrides?.autoYes && (
              <span className={styles.ruleMeta}>Auto-yes: on</span>
            )}
            {(rule.overrides?.tags?.length ?? 0) > 0 && (
              <span className={styles.ruleMeta}>Tags: {rule.overrides!.tags.join(", ")}</span>
            )}
          </div>
          <div className={styles.ruleActions}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleEdit(rule)}
            >
              Edit
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => handleDelete(rule.path)}
            >
              Delete
            </button>
          </div>
        </div>
      ))}

      {showForm && (
        <div className={styles.formCard}>
          <h3 className={styles.formTitle}>
            {editingPath ? `Edit Rule: ${editingPath}` : "New Directory Rule"}
          </h3>
          <div className={styles.formFields}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="rule-path">
                Directory Path *
              </label>
              <input
                id="rule-path"
                type="text"
                className={`${styles.input}${pathError ? ` ${styles.inputError}` : ""}`}
                placeholder="/Users/you/projects/myrepo"
                value={form.path}
                onChange={(e) => {
                  setForm({ ...form, path: e.target.value });
                  if (pathError) setPathError(validatePath(e.target.value));
                }}
                disabled={!!editingPath}
              />
              {pathError && <span className={styles.fieldError}>{pathError}</span>}
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="rule-profile">
                Profile (optional)
              </label>
              <select
                id="rule-profile"
                className={styles.select}
                value={form.profile}
                onChange={(e) => setForm({ ...form, profile: e.target.value })}
              >
                <option value="">None</option>
                {profiles.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={form.showOverrides}
                  onChange={(e) => setForm({ ...form, showOverrides: e.target.checked })}
                />
                Add field overrides
              </label>
            </div>
            {form.showOverrides && (
              <div className={styles.overridesSection}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="rule-program">
                    Override Program
                  </label>
                  <select
                    id="rule-program"
                    className={styles.select}
                    value={form.overrideProgram}
                    onChange={(e) => setForm({ ...form, overrideProgram: e.target.value })}
                  >
                    <option value="">Default</option>
                    {PROGRAMS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={form.overrideAutoYes}
                      onChange={(e) => setForm({ ...form, overrideAutoYes: e.target.checked })}
                    />
                    Auto-yes
                  </label>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Override Tags</label>
                  <div className={styles.tagList}>
                    {form.overrideTags.map((tag) => (
                      <span key={tag} className={styles.tag}>
                        {tag}
                        <button
                          type="button"
                          className={styles.tagRemove}
                          onClick={() => handleRemoveTag(tag)}
                          aria-label={`Remove tag ${tag}`}
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className={styles.tagInputRow}>
                    <input
                      type="text"
                      className={styles.input}
                      placeholder="Add a tag..."
                      value={form.tagInput}
                      onChange={(e) => setForm({ ...form, tagInput: e.target.value })}
                      onKeyDown={handleTagKeyDown}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleAddTag}
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className={styles.formActions}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
