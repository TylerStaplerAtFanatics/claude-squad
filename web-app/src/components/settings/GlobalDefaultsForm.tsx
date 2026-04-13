"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { SessionService } from "@/gen/session/v1/session_pb";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { getApiBaseUrl } from "@/lib/config";
import { PROGRAMS } from "@/lib/constants/programs";
import styles from "./GlobalDefaultsForm.module.css";

export function GlobalDefaultsForm() {
  const [program, setProgram] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);
  const [cliFlags, setCliFlags] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const clientRef = useRef<ReturnType<typeof createClient<typeof SessionService>> | null>(null);

  useEffect(() => {
    const transport = createConnectTransport({ baseUrl: getApiBaseUrl() });
    clientRef.current = createClient(SessionService, transport);
    loadDefaults();
  }, []);

  const loadDefaults = useCallback(async () => {
    if (!clientRef.current) return;
    try {
      setLoading(true);
      setError(null);
      const response = await clientRef.current.getSessionDefaults({});
      const defaults = response.defaults;
      if (defaults) {
        setProgram(defaults.program);
        setTags([...defaults.tags]);
        setCliFlags(defaults.cliFlags);
        const vars = Object.entries(defaults.envVars).map(([key, value]) => ({
          key,
          value,
        }));
        setEnvVars(vars);
      }
    } catch (err) {
      setError(`Failed to load defaults: ${err}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSave = async () => {
    if (!clientRef.current) return;
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      const envVarsMap: { [key: string]: string } = {};
      for (const { key, value } of envVars) {
        if (key.trim()) {
          envVarsMap[key.trim()] = value;
        }
      }
      await clientRef.current.updateGlobalDefaults({
        program,
        tags,
        envVars: envVarsMap,
        cliFlags,
      });
      setSuccess("Global defaults saved.");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(`Failed to save defaults: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
    }
    setTagInput("");
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddTag();
    }
  };

  const handleAddEnvVar = () => {
    setEnvVars([...envVars, { key: "", value: "" }]);
  };

  const handleRemoveEnvVar = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index));
  };

  const handleEnvVarChange = (
    index: number,
    field: "key" | "value",
    val: string
  ) => {
    const updated = [...envVars];
    updated[index] = { ...updated[index], [field]: val };
    setEnvVars(updated);
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <h2 className={styles.heading}>Global Defaults</h2>
        <div className={styles.loadingText}>Loading...</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h2 className={styles.heading}>Global Defaults</h2>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className={styles.form}>
        {/* Program */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="global-program">
            Program
          </label>
          <select
            id="global-program"
            className={styles.select}
            value={program}
            onChange={(e) => setProgram(e.target.value)}
          >
            <option value="">Default (claude)</option>
            {PROGRAMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {/* Tags */}
        <div className={styles.field}>
          <label className={styles.label}>Tags</label>
          <div className={styles.tagList}>
            {tags.map((tag) => (
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
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
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

        {/* Env Vars */}
        <div className={styles.field}>
          <label className={styles.label}>Environment Variables</label>
          <div className={styles.envVarTable}>
            {envVars.map((envVar, i) => (
              <div key={i} className={styles.envVarRow}>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="KEY"
                  value={envVar.key}
                  onChange={(e) => handleEnvVarChange(i, "key", e.target.value)}
                />
                <input
                  type="text"
                  className={styles.input}
                  placeholder="value"
                  value={envVar.value}
                  onChange={(e) =>
                    handleEnvVarChange(i, "value", e.target.value)
                  }
                />
                <button
                  type="button"
                  className={styles.deleteBtn}
                  onClick={() => handleRemoveEnvVar(i)}
                  aria-label="Remove environment variable"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleAddEnvVar}
          >
            Add Variable
          </button>
        </div>

        {/* CLI Flags */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="global-cli-flags">
            CLI Flags
          </label>
          <input
            id="global-cli-flags"
            type="text"
            className={styles.input}
            placeholder="e.g. --verbose --no-color"
            value={cliFlags}
            onChange={(e) => setCliFlags(e.target.value)}
          />
        </div>

        {/* Save */}
        <div className={styles.actions}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
