"use client";

import type { PathEntry } from "@/gen/session/v1/session_pb";
import styles from "./PathCompletionDropdown.module.css";

interface PathCompletionDropdownProps {
  entries: PathEntry[];
  selectedIndex: number;
  onSelect: (entry: PathEntry) => void;
  isLoading: boolean;
  id?: string;
}

export function PathCompletionDropdown({
  entries,
  selectedIndex,
  onSelect,
  isLoading,
  id = "path-completion-listbox",
}: PathCompletionDropdownProps) {
  if (isLoading && entries.length === 0) {
    return <div className={styles.loading}>Loading completions…</div>;
  }
  if (entries.length === 0) return null;

  return (
    <ul
      id={id}
      className={styles.dropdown}
      role="listbox"
      aria-label="Path completions"
    >
      {entries.map((entry, i) => (
        <li
          key={entry.path}
          id={`${id}-option-${i}`}
          className={`${styles.item} ${
            i === selectedIndex ? styles.itemSelected : ""
          }`}
          role="option"
          aria-selected={i === selectedIndex}
          onMouseDown={(e) => {
            // Prevent input from losing focus.
            e.preventDefault();
            onSelect(entry);
          }}
        >
          <span className={styles.icon} aria-hidden="true">
            {entry.isDirectory ? "📁" : "📄"}
          </span>
          <span className={styles.name}>{entry.name}</span>
          {entry.isDirectory && (
            <span className={styles.suffix} aria-hidden="true">
              /
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
