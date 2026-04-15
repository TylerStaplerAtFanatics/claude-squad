"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  SessionService,
  type ProfileDefaultsProto,
} from "@/gen/session/v1/session_pb";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { getApiBaseUrl } from "@/lib/config";
import { PROGRAMS } from "@/lib/constants/programs";
import styles from "./ProfilesManager.module.css";

interface ProfileFormData {
  name: string;
  description: string;
  program: string;
  autoYes: boolean;
  tags: string[];
  tagInput: string;
}

const emptyForm: ProfileFormData = {
  name: "",
  description: "",
  program: "",
  autoYes: false,
  tags: [],
  tagInput: "",
};

export function ProfilesManager() {
  const [profiles, setProfiles] = useState<
    { key: string; profile: ProfileDefaultsProto }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileFormData>({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const clientRef = useRef<ReturnType<
    typeof createClient<typeof SessionService>
  > | null>(null);

  useEffect(() => {
    const transport = createConnectTransport({ baseUrl: getApiBaseUrl() });
    clientRef.current = createClient(SessionService, transport);
    loadProfiles();
  }, []);

  const loadProfiles = useCallback(async () => {
    if (!clientRef.current) return;
    try {
      setLoading(true);
      setError(null);
      const response = await clientRef.current.getSessionDefaults({});
      const defaults = response.defaults;
      if (defaults) {
        const list = Object.entries(defaults.profiles).map(
          ([key, profile]) => ({
            key,
            profile,
          })
        );
        setProfiles(list);
      }
    } catch (err) {
      setError(`Failed to load profiles: ${err}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleEdit = (key: string, profile: ProfileDefaultsProto) => {
    setEditingKey(key);
    setForm({
      name: profile.name,
      description: profile.description,
      program: profile.program,
      autoYes: profile.autoYes,
      tags: [...profile.tags],
      tagInput: "",
    });
    setShowForm(true);
  };

  const handleNewProfile = () => {
    setEditingKey(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingKey(null);
    setForm({ ...emptyForm });
  };

  const handleSave = async () => {
    if (!clientRef.current) return;
    if (!form.name.trim()) {
      setError("Profile name is required.");
      return;
    }
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      await clientRef.current.upsertProfile({
        profile: {
          name: form.name.trim(),
          description: form.description,
          program: form.program,
          autoYes: form.autoYes,
          tags: form.tags,
          envVars: {},
          cliFlags: "",
        } as unknown as ProfileDefaultsProto,
      });
      setSuccess(`Profile "${form.name.trim()}" saved.`);
      setTimeout(() => setSuccess(null), 3000);
      setShowForm(false);
      setEditingKey(null);
      setForm({ ...emptyForm });
      await loadProfiles();
    } catch (err) {
      setError(`Failed to save profile: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (key: string) => {
    if (!clientRef.current) return;
    if (!confirm(`Delete profile "${key}"?`)) return;
    try {
      setError(null);
      setSuccess(null);
      await clientRef.current.deleteProfile({ name: key });
      setSuccess(`Profile "${key}" deleted.`);
      setTimeout(() => setSuccess(null), 3000);
      await loadProfiles();
    } catch (err) {
      setError(`Failed to delete profile: ${err}`);
    }
  };

  const handleAddTag = () => {
    const trimmed = form.tagInput.trim();
    if (trimmed && !form.tags.includes(trimmed)) {
      setForm({ ...form, tags: [...form.tags, trimmed], tagInput: "" });
    } else {
      setForm({ ...form, tagInput: "" });
    }
  };

  const handleRemoveTag = (tag: string) => {
    setForm({ ...form, tags: form.tags.filter((t) => t !== tag) });
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
        <h2 className={styles.heading}>Profiles</h2>
        <div className={styles.loadingText}>Loading...</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <h2 className={styles.heading}>Profiles</h2>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleNewProfile}
        >
          New Profile
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* Profile list */}
      {profiles.length === 0 && !showForm && (
        <div className={styles.emptyText}>No profiles configured.</div>
      )}
      {profiles.map(({ key, profile }) => (
        <div key={key} className={styles.profileRow}>
          <div className={styles.profileInfo}>
            <span className={styles.profileName}>{profile.name}</span>
            {profile.description && (
              <span className={styles.profileDesc}>{profile.description}</span>
            )}
            {profile.program && (
              <span className={styles.profileMeta}>
                Program: {profile.program}
              </span>
            )}
            {profile.autoYes && (
              <span className={styles.profileMeta}>Auto-yes: on</span>
            )}
            {profile.tags.length > 0 && (
              <span className={styles.profileMeta}>
                Tags: {profile.tags.join(", ")}
              </span>
            )}
          </div>
          <div className={styles.profileActions}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleEdit(key, profile)}
            >
              Edit
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => handleDelete(key)}
            >
              Delete
            </button>
          </div>
        </div>
      ))}

      {/* Inline form */}
      {showForm && (
        <div className={styles.formCard}>
          <h3 className={styles.formTitle}>
            {editingKey ? `Edit Profile: ${editingKey}` : "New Profile"}
          </h3>
          <div className={styles.formFields}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="profile-name">
                Name *
              </label>
              <input
                id="profile-name"
                type="text"
                className={styles.input}
                placeholder="e.g. fast-mode"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={!!editingKey}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="profile-desc">
                Description
              </label>
              <input
                id="profile-desc"
                type="text"
                className={styles.input}
                placeholder="Short description"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="profile-program">
                Program
              </label>
              <select
                id="profile-program"
                className={styles.select}
                value={form.program}
                onChange={(e) => setForm({ ...form, program: e.target.value })}
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
                  checked={form.autoYes}
                  onChange={(e) =>
                    setForm({ ...form, autoYes: e.target.checked })
                  }
                />
                Auto-yes
              </label>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Tags</label>
              <div className={styles.tagList}>
                {form.tags.map((tag) => (
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
                  onChange={(e) =>
                    setForm({ ...form, tagInput: e.target.value })
                  }
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
