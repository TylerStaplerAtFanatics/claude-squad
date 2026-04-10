"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Tree } from "react-arborist";
import type { NodeApi, TreeApi } from "react-arborist";
import type { FileNode } from "@/gen/session/v1/types_pb";
import { fetchDirectoryFiles } from "@/lib/hooks/useFileService";
import styles from "./FileTree.module.css";

// ---- Data model ----

export interface TreeNode {
  id: string;        // full relative path (unique within worktree)
  name: string;
  isDir: boolean;
  size: bigint;
  gitStatus: string;
  isSymlink: boolean;
  symlinkTarget: string;
  isIgnored: boolean;
  children?: TreeNode[]; // undefined = not loaded, [] = empty dir
}

// Git status colors.
const GIT_STATUS_COLORS: Record<string, string> = {
  M: "#cca700",
  A: "#2ea043",
  D: "#f85149",
  "?": "#3fb950",
  R: "#58a6ff",
  U: "#f85149",
};

// ---- Props ----

interface FileTreeProps {
  sessionId: string;
  baseUrl: string;
  /** Called when a file (non-directory) is selected. */
  onFileSelect: (path: string) => void;
  /** Map of relative path → git status letter. */
  gitStatusMap?: Map<string, string>;
  /** Selected file path (for visual highlight). */
  selectedPath?: string | null;
  /** Whether to include gitignored files. */
  includeIgnored?: boolean;
  /** Search/filter term — filters tree by name/path substring. */
  searchTerm?: string;
  /** Called with a collapseAll function so parents can trigger collapse. */
  onCollapseAllRef?: (fn: () => void) => void;
}

// ---- Helpers ----

function fileNodeToTreeNode(fn: FileNode): TreeNode {
  return {
    id: fn.path || fn.name,
    name: fn.name,
    isDir: fn.isDir,
    size: fn.size,
    gitStatus: fn.gitStatus,
    isSymlink: fn.isSymlink,
    symlinkTarget: fn.symlinkTarget,
    isIgnored: fn.isIgnored,
    children: fn.isDir ? undefined : undefined,
  };
}

/**
 * Build tree data from the directory contents map.
 * Recursively attaches loaded children to each directory node.
 */
function buildTreeData(
  nodes: TreeNode[],
  dirContents: Map<string, TreeNode[]>
): TreeNode[] {
  return nodes.map((node) => {
    if (!node.isDir) return node;
    const loaded = dirContents.get(node.id);
    if (loaded === undefined) {
      // Directory not yet loaded — provide empty array so it's expandable.
      return { ...node, children: [] };
    }
    return {
      ...node,
      children: buildTreeData(loaded, dirContents),
    };
  });
}

/**
 * Compute which directories have any git-modified descendants.
 */
function computeDirStatuses(
  nodes: TreeNode[],
  gitStatusMap: Map<string, string>,
  result: Map<string, string>
): boolean {
  let anyStatus = false;
  for (const node of nodes) {
    if (!node.isDir) {
      const status = gitStatusMap.get(node.id);
      if (status) {
        anyStatus = true;
      }
    } else if (node.children) {
      const childHas = computeDirStatuses(node.children, gitStatusMap, result);
      if (childHas) {
        result.set(node.id, "●");
        anyStatus = true;
      }
    }
  }
  return anyStatus;
}

// ---- Node renderer ----

interface NodeRendererProps {
  node: NodeApi<TreeNode>;
  style: React.CSSProperties;
  dragHandle?: (el: HTMLDivElement | null) => void;
  gitStatusMap: Map<string, string>;
  dirStatusMap: Map<string, string>;
  loadingPaths: Set<string>;
  errorPaths: Map<string, string>;
  selectedPath: string | null | undefined;
  includeIgnored: boolean;
  searchTerm: string;
}

function highlightMatch(name: string, term: string): React.ReactNode {
  if (!term) return name;
  const idx = name.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return name;
  return (
    <>
      {name.slice(0, idx)}
      <mark className={styles.mark}>{name.slice(idx, idx + term.length)}</mark>
      {name.slice(idx + term.length)}
    </>
  );
}

function NodeRenderer({
  node,
  style,
  gitStatusMap,
  dirStatusMap,
  loadingPaths,
  errorPaths,
  selectedPath,
  searchTerm,
}: NodeRendererProps) {
  const data = node.data;
  const isSelected = selectedPath === data.id;
  const isLoading = loadingPaths.has(data.id);
  const loadError = errorPaths.get(data.id);

  // Determine git status badge.
  const statusLetter = data.isDir
    ? dirStatusMap.get(data.id)
    : gitStatusMap.get(data.id) || data.gitStatus;
  const statusColor = statusLetter ? GIT_STATUS_COLORS[statusLetter] : undefined;

  const icon = data.isSymlink
    ? "⇢"
    : data.isDir
    ? node.isOpen
      ? "▾"
      : "▸"
    : getFileIcon(data.name);

  return (
    <div
      style={style}
      className={`${styles.node} ${isSelected ? styles.selected : ""} ${data.isIgnored ? styles.ignored : ""}`}
      onClick={() => node.activate()}
    >
      <div
        className={styles.nodeInner}
        style={{ paddingLeft: `${node.level * 16 + 8}px` }}
      >
        <span className={styles.icon}>{icon}</span>
        <span className={styles.name}>{highlightMatch(data.name, searchTerm)}</span>
        {data.isSymlink && (
          <span className={styles.symlinkBadge} title={`→ ${data.symlinkTarget}`}>
            symlink
          </span>
        )}
        {isLoading && <span className={styles.spinner} />}
        {loadError && (
          <span className={styles.inlineError} title={loadError}>
            ⚠
          </span>
        )}
        {statusLetter && (
          <span
            className={styles.statusBadge}
            style={{ color: statusColor }}
            title={`Git status: ${statusLetter}`}
          >
            {statusLetter}
          </span>
        )}
      </div>
    </div>
  );
}

function getFileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const icons: Record<string, string> = {
    go: "🐹",
    ts: "𝐓",
    tsx: "⚛",
    js: "𝐉",
    jsx: "⚛",
    py: "🐍",
    rs: "🦀",
    md: "📄",
    json: "{}",
    yaml: "⚙",
    yml: "⚙",
    toml: "⚙",
    sh: "💲",
    css: "🎨",
    html: "🌐",
  };
  return icons[ext] || "📄";
}

// ---- Main component ----

export function FileTree({
  sessionId,
  baseUrl,
  onFileSelect,
  gitStatusMap = new Map(),
  selectedPath,
  includeIgnored = false,
  searchTerm = "",
  onCollapseAllRef,
}: FileTreeProps) {
  // Map of directory path → loaded TreeNode children.
  const [dirContents, setDirContents] = useState<Map<string, TreeNode[]>>(new Map());
  // Tracks which paths are currently loading.
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  // Tracks which paths have load errors.
  const [errorPaths, setErrorPaths] = useState<Map<string, string>>(new Map());
  // Root loading/error state.
  const [rootLoading, setRootLoading] = useState(true);
  const [rootError, setRootError] = useState<string | null>(null);

  const treeRef = useRef<TreeApi<TreeNode> | undefined>(undefined);

  // Register collapseAll callback with parent when treeRef or onCollapseAllRef changes.
  useEffect(() => {
    if (onCollapseAllRef) {
      onCollapseAllRef(() => {
        treeRef.current?.closeAll();
      });
    }
  }, [onCollapseAllRef]);

  // Load a directory's children.
  const loadDirectory = useCallback(
    async (dirPath: string) => {
      if (loadingPaths.has(dirPath)) return;

      setLoadingPaths((prev) => new Set(prev).add(dirPath));
      setErrorPaths((prev) => {
        const next = new Map(prev);
        next.delete(dirPath);
        return next;
      });

      try {
        const response = await fetchDirectoryFiles(
          sessionId,
          dirPath === "." ? "." : dirPath,
          includeIgnored,
          baseUrl
        );
        const nodes = (response.files || []).map(fileNodeToTreeNode);

        setDirContents((prev) => {
          const next = new Map(prev);
          next.set(dirPath, nodes);
          return next;
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load directory";
        setErrorPaths((prev) => new Map(prev).set(dirPath, msg));
      } finally {
        setLoadingPaths((prev) => {
          const next = new Set(prev);
          next.delete(dirPath);
          return next;
        });
      }
    },
    [sessionId, baseUrl, includeIgnored]
  );

  // Load root on mount / when session changes.
  useEffect(() => {
    setDirContents(new Map());
    setRootLoading(true);
    setRootError(null);

    fetchDirectoryFiles(sessionId, ".", includeIgnored, baseUrl)
      .then((response) => {
        const nodes = (response.files || []).map(fileNodeToTreeNode);
        setDirContents(new Map([[".", nodes]]));
      })
      .catch((err) => {
        setRootError(err instanceof Error ? err.message : "Failed to load files");
      })
      .finally(() => {
        setRootLoading(false);
      });
  }, [sessionId, baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload when includeIgnored changes.
  useEffect(() => {
    setDirContents(new Map());
    setRootLoading(true);
    setRootError(null);

    fetchDirectoryFiles(sessionId, ".", includeIgnored, baseUrl)
      .then((response) => {
        const nodes = (response.files || []).map(fileNodeToTreeNode);
        setDirContents(new Map([[".", nodes]]));
      })
      .catch((err) => {
        setRootError(err instanceof Error ? err.message : "Failed to load files");
      })
      .finally(() => {
        setRootLoading(false);
      });
  }, [includeIgnored]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build dirStatusMap for directory-level git status propagation.
  const rootNodes = dirContents.get(".") ?? [];
  const treeData = buildTreeData(rootNodes, dirContents);
  const dirStatusMap = new Map<string, string>();
  computeDirStatuses(treeData, gitStatusMap, dirStatusMap);

  const handleActivate = useCallback(
    (node: NodeApi<TreeNode>) => {
      const data = node.data;
      if (!data.isDir && !data.isSymlink) {
        onFileSelect(data.id);
      }
    },
    [onFileSelect]
  );

  const handleToggle = useCallback(
    (id: string) => {
      // Find the node and load its children if it's a directory not yet loaded.
      const findNode = (nodes: TreeNode[]): TreeNode | undefined => {
        for (const n of nodes) {
          if (n.id === id) return n;
          if (n.children) {
            const found = findNode(n.children);
            if (found) return found;
          }
        }
        return undefined;
      };

      const allNodes = buildTreeData(rootNodes, dirContents);
      const node = findNode(allNodes);
      if (node?.isDir && !dirContents.has(id)) {
        loadDirectory(id);
      }
    },
    [rootNodes, dirContents, loadDirectory]
  );

  if (rootLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <span className={styles.spinner} />
          Loading files…
        </div>
      </div>
    );
  }

  if (rootError) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <span>⚠ {rootError}</span>
          <button
            className={styles.retryButton}
            onClick={() => {
              setRootLoading(true);
              setRootError(null);
              fetchDirectoryFiles(sessionId, ".", includeIgnored, baseUrl)
                .then((response) => {
                  const nodes = (response.files || []).map(fileNodeToTreeNode);
                  setDirContents(new Map([[".", nodes]]));
                })
                .catch((err) => {
                  setRootError(err instanceof Error ? err.message : "Failed to load files");
                })
                .finally(() => setRootLoading(false));
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (treeData.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>This directory is empty.</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <Tree<TreeNode>
        ref={treeRef}
        data={treeData}
        idAccessor={(node) => node.id}
        childrenAccessor={(node) => {
          if (!node.isDir) return null;
          return node.children ?? [];
        }}
        disableDrag={true}
        disableDrop={true}
        onActivate={handleActivate}
        onToggle={handleToggle}
        rowHeight={28}
        openByDefault={false}
        width="100%"
        height={600}
        searchTerm={searchTerm || undefined}
        searchMatch={(node, term) => {
          const t = term.toLowerCase();
          return (
            node.data.name.toLowerCase().includes(t) ||
            node.data.id.toLowerCase().includes(t)
          );
        }}
      >
        {({ node, style, dragHandle }) => (
          <NodeRenderer
            node={node}
            style={style}
            dragHandle={dragHandle}
            gitStatusMap={gitStatusMap}
            dirStatusMap={dirStatusMap}
            loadingPaths={loadingPaths}
            errorPaths={errorPaths}
            selectedPath={selectedPath}
            includeIgnored={includeIgnored}
            searchTerm={searchTerm}
          />
        )}
      </Tree>
    </div>
  );
}
