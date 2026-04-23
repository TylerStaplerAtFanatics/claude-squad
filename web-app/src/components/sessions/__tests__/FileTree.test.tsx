/**
 * Tests for FileTree component and its helpers.
 *
 * Covers:
 *  - buildTreeData: unloaded dirs get children:[], loaded dirs get actual children
 *  - handleToggle: fires loadDirectory when onToggle receives a dir ID
 *  - handleToggle: retries on previously errored directory
 *  - handleToggle: ignores non-directory IDs
 *  - NodeRenderer onClick: dirs call node.toggle(), files call node.activate()
 *  - Root load on mount calls fetchDirectoryFiles with "."
 *  - After toggle fires, fetchDirectoryFiles is called with the dir path
 *  - childrenAccessor: returns null for files, [] for dirs (keeps isLeaf=false)
 */

import React from "react";
import { render, fireEvent, act, waitFor } from "@testing-library/react";
import { FileTree, buildTreeData } from "../FileTree";
import type { TreeNode } from "../FileTree";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Capture Tree props so tests can inspect data and manually trigger callbacks.
let capturedOnToggle: ((id: string) => void) | undefined;
let capturedChildren:
  | ((props: { node: MockNodeApi; style: React.CSSProperties; dragHandle?: unknown }) => React.ReactNode)
  | undefined;
let capturedData: TreeNode[] = [];

interface MockNodeApi {
  id: string;
  data: TreeNode;
  isOpen: boolean;
  level: number;
  toggle: jest.Mock;
  activate: jest.Mock;
}

jest.mock("react-arborist", () => ({
  Tree: jest.fn(
    (props: {
      data: TreeNode[];
      onToggle?: (id: string) => void;
      onActivate?: (node: unknown) => void;
      children: (props: { node: MockNodeApi; style: React.CSSProperties; dragHandle?: unknown }) => React.ReactNode;
      idAccessor?: (node: TreeNode) => string;
      childrenAccessor?: (node: TreeNode) => TreeNode[] | null;
      ref?: unknown;
    }) => {
      capturedOnToggle = props.onToggle;
      capturedChildren = props.children;
      capturedData = props.data;
      return <div data-testid="mock-tree" />;
    }
  ),
}));

const mockFetchDirectoryFiles = jest.fn();
const mockSearchFiles = jest.fn();

jest.mock("@/lib/hooks/useFileService", () => ({
  fetchDirectoryFiles: (...args: unknown[]) => mockFetchDirectoryFiles(...args),
  searchFiles: (...args: unknown[]) => mockSearchFiles(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFileNode(path: string, isDir: boolean, children?: TreeNode[]): TreeNode {
  return {
    id: path,
    name: path.split("/").pop() ?? path,
    isDir,
    size: BigInt(0),
    gitStatus: "",
    isSymlink: false,
    symlinkTarget: "",
    isIgnored: false,
    children,
  };
}

/** Build a mock fetchDirectoryFiles response from a list of entries. */
function makeFileResponse(entries: { path: string; isDir: boolean }[]) {
  return {
    files: entries.map((e) => ({
      path: e.path,
      name: e.path.split("/").pop() ?? e.path,
      isDir: e.isDir,
      size: BigInt(0),
      gitStatus: "",
      isSymlink: false,
      symlinkTarget: "",
      isIgnored: false,
    })),
  };
}

function makeMockNode(data: TreeNode, overrides: Partial<MockNodeApi> = {}): MockNodeApi {
  return {
    id: data.id,
    data,
    isOpen: false,
    level: 0,
    toggle: jest.fn(),
    activate: jest.fn(),
    ...overrides,
  };
}

const defaultProps = {
  sessionId: "test-session-uuid",
  baseUrl: "http://localhost:8543",
  onFileSelect: jest.fn(),
};

// ---------------------------------------------------------------------------
// buildTreeData pure function
// ---------------------------------------------------------------------------

describe("buildTreeData", () => {
  it("returns non-dir nodes unchanged", () => {
    const file = makeFileNode("README.md", false);
    const result = buildTreeData([file], new Map());
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(file);
  });

  it("gives unloaded dirs children: [] so arborist isLeaf=false (toggleable)", () => {
    const dir = makeFileNode("src", true, undefined);
    const result = buildTreeData([dir], new Map());
    expect(Array.isArray(result[0].children)).toBe(true);
    expect(result[0].children).toEqual([]);
  });

  it("gives loaded empty dirs children: [] (confirmed empty)", () => {
    const dir = makeFileNode("empty-dir", true, undefined);
    const contents = new Map([["empty-dir", [] as TreeNode[]]]);
    const result = buildTreeData([dir], contents);
    expect(result[0].children).toEqual([]);
  });

  it("attaches loaded children for loaded dirs", () => {
    const dir = makeFileNode("src", true, undefined);
    const child = makeFileNode("src/main.go", false);
    const contents = new Map([["src", [child]]]);
    const result = buildTreeData([dir], contents);
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children![0].id).toBe("src/main.go");
  });

  it("recursively attaches nested loaded children", () => {
    const root = makeFileNode("src", true, undefined);
    const sub = makeFileNode("src/components", true, undefined);
    const file = makeFileNode("src/components/Button.tsx", false);
    const contents = new Map<string, TreeNode[]>([
      ["src", [sub]],
      ["src/components", [file]],
    ]);
    const result = buildTreeData([root], contents);
    const srcNode = result[0];
    expect(srcNode.children).toHaveLength(1);
    const subNode = srcNode.children![0];
    expect(subNode.id).toBe("src/components");
    expect(subNode.children).toHaveLength(1);
    expect(subNode.children![0].id).toBe("src/components/Button.tsx");
  });

  it("mixes loaded and unloaded dirs correctly", () => {
    const loaded = makeFileNode("loaded", true, undefined);
    const unloaded = makeFileNode("unloaded", true, undefined);
    const file = makeFileNode("loaded/file.go", false);
    const contents = new Map<string, TreeNode[]>([["loaded", [file]]]);

    const result = buildTreeData([loaded, unloaded], contents);
    expect(result[0].children).toHaveLength(1);
    expect(result[1].children).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// childrenAccessor contract (inline logic test — no component render needed)
// ---------------------------------------------------------------------------

describe("childrenAccessor logic", () => {
  // The actual childrenAccessor used in FileTree is:
  //   (node) => { if (!node.isDir) return null; return node.children ?? []; }
  // We test this logic directly to ensure the isLeaf contract is preserved.

  const accessor = (node: TreeNode): TreeNode[] | null => {
    if (!node.isDir) return null;
    return node.children ?? [];
  };

  it("returns null for a file node (makes it a leaf)", () => {
    expect(accessor(makeFileNode("main.go", false))).toBeNull();
  });

  it("returns [] for an unloaded directory (children: undefined)", () => {
    const result = accessor(makeFileNode("src", true, undefined));
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([]);
  });

  it("returns [] for a confirmed empty directory (children: [])", () => {
    const result = accessor(makeFileNode("empty", true, []));
    expect(result).toEqual([]);
  });

  it("returns loaded children for a dir with children", () => {
    const child = makeFileNode("src/main.go", false);
    const result = accessor(makeFileNode("src", true, [child]));
    expect(result).toHaveLength(1);
    expect(result![0].id).toBe("src/main.go");
  });

  it("[] from accessor means isLeaf=false (Array.isArray([]) is true)", () => {
    const children = accessor(makeFileNode("src", true, undefined));
    // react-arborist's isLeaf check: !Array.isArray(this.children)
    expect(Array.isArray(children)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FileTree – root loading
// ---------------------------------------------------------------------------

describe("FileTree – root loading", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnToggle = undefined;
    capturedChildren = undefined;
    capturedData = [];
  });

  it("calls fetchDirectoryFiles with '.' on mount", async () => {
    mockFetchDirectoryFiles.mockResolvedValue(
      makeFileResponse([{ path: "src", isDir: true }])
    );

    render(<FileTree {...defaultProps} />);

    await waitFor(() => {
      expect(mockFetchDirectoryFiles).toHaveBeenCalledWith(
        "test-session-uuid",
        ".",
        false,
        "http://localhost:8543"
      );
    });
  });

  it("passes root nodes to Tree after successful load", async () => {
    mockFetchDirectoryFiles.mockResolvedValue(
      makeFileResponse([
        { path: "README.md", isDir: false },
        { path: "src", isDir: true },
      ])
    );

    render(<FileTree {...defaultProps} />);

    await waitFor(() => {
      const srcNode = capturedData.find((n) => n.id === "src");
      expect(srcNode).toBeDefined();
      expect(srcNode!.isDir).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// FileTree – handleToggle loads directories
// ---------------------------------------------------------------------------

describe("FileTree – handleToggle loads directories", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnToggle = undefined;
    capturedData = [];
  });

  /** Wait for Tree to be rendered with at least one node containing the given id. */
  async function waitForTreeWithNode(id: string) {
    await waitFor(() => {
      expect(capturedOnToggle).toBeDefined();
      const node = capturedData.find((n) => n.id === id);
      expect(node).toBeDefined();
    });
  }

  it("calls fetchDirectoryFiles for a dir ID when onToggle fires", async () => {
    // Both root useEffects fire on mount; use mockImplementation to handle all calls.
    mockFetchDirectoryFiles.mockImplementation((_session: string, path: string) => {
      if (path === ".") return Promise.resolve(makeFileResponse([{ path: "src", isDir: true }]));
      if (path === "src") return Promise.resolve(makeFileResponse([{ path: "src/main.go", isDir: false }]));
      return Promise.resolve(makeFileResponse([]));
    });

    render(<FileTree {...defaultProps} />);
    await waitForTreeWithNode("src");

    // Simulate user toggling "src" directory.
    await act(async () => {
      capturedOnToggle!("src");
    });

    await waitFor(() => {
      expect(mockFetchDirectoryFiles).toHaveBeenCalledWith(
        "test-session-uuid",
        "src",
        false,
        "http://localhost:8543"
      );
    });
  });

  it("does not reload a directory that is already loaded", async () => {
    let srcLoadCount = 0;
    mockFetchDirectoryFiles.mockImplementation((_session: string, path: string) => {
      if (path === ".") return Promise.resolve(makeFileResponse([{ path: "src", isDir: true }]));
      if (path === "src") {
        srcLoadCount++;
        return Promise.resolve(makeFileResponse([{ path: "src/main.go", isDir: false }]));
      }
      return Promise.resolve(makeFileResponse([]));
    });

    render(<FileTree {...defaultProps} />);
    await waitForTreeWithNode("src");

    // First toggle loads src.
    await act(async () => { capturedOnToggle!("src"); });
    await waitFor(() => expect(srcLoadCount).toBe(1));

    // Second toggle should NOT reload (already in dirContents).
    await act(async () => { capturedOnToggle!("src"); });
    expect(srcLoadCount).toBe(1);
  });

  it("retries a directory that previously errored", async () => {
    let srcLoadCount = 0;
    mockFetchDirectoryFiles.mockImplementation((_session: string, path: string) => {
      if (path === ".") return Promise.resolve(makeFileResponse([{ path: "src", isDir: true }]));
      if (path === "src") {
        srcLoadCount++;
        if (srcLoadCount === 1) return Promise.reject(new Error("network error"));
        return Promise.resolve(makeFileResponse([{ path: "src/main.go", isDir: false }]));
      }
      return Promise.resolve(makeFileResponse([]));
    });

    render(<FileTree {...defaultProps} />);
    await waitForTreeWithNode("src");

    // First toggle — fails.
    await act(async () => { capturedOnToggle!("src"); });
    await waitFor(() => expect(srcLoadCount).toBe(1));

    // Second toggle — should retry because errorPaths contains "src".
    await act(async () => { capturedOnToggle!("src"); });
    await waitFor(() => expect(srcLoadCount).toBe(2));
  });

  it("ignores toggles for non-directory IDs", async () => {
    let nonDirLoadCount = 0;
    mockFetchDirectoryFiles.mockImplementation((_session: string, path: string) => {
      if (path === ".") return Promise.resolve(makeFileResponse([{ path: "README.md", isDir: false }]));
      nonDirLoadCount++;
      return Promise.resolve(makeFileResponse([]));
    });

    render(<FileTree {...defaultProps} />);
    await waitFor(() => expect(capturedOnToggle).toBeDefined());

    // Toggle a file node — should not trigger any directory fetch.
    await act(async () => { capturedOnToggle!("README.md"); });

    // No fetch beyond root should have happened.
    expect(nonDirLoadCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// NodeRenderer onClick – dirs call toggle, files call activate
// ---------------------------------------------------------------------------

describe("FileTree – NodeRenderer click behavior", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnToggle = undefined;
    capturedChildren = undefined;
  });

  async function setupWithRootNodes(entries: { path: string; isDir: boolean }[]) {
    mockFetchDirectoryFiles.mockResolvedValue(makeFileResponse(entries));
    render(<FileTree {...defaultProps} />);
    await waitFor(() => expect(capturedChildren).toBeDefined());
  }

  it("clicking a closed directory node calls node.toggle() not node.activate()", async () => {
    await setupWithRootNodes([{ path: "src", isDir: true }]);

    const dirData = makeFileNode("src", true, []);
    const mockNode = makeMockNode(dirData, { isOpen: false });

    const { container } = render(
      <>{capturedChildren!({ node: mockNode, style: {} })}</>
    );

    fireEvent.click(container.querySelector("div")!);

    expect(mockNode.toggle).toHaveBeenCalledTimes(1);
    expect(mockNode.activate).not.toHaveBeenCalled();
  });

  it("clicking a file node calls node.activate() not node.toggle()", async () => {
    await setupWithRootNodes([{ path: "main.go", isDir: false }]);

    const fileData = makeFileNode("main.go", false);
    const mockNode = makeMockNode(fileData);

    const { container } = render(
      <>{capturedChildren!({ node: mockNode, style: {} })}</>
    );

    fireEvent.click(container.querySelector("div")!);

    expect(mockNode.activate).toHaveBeenCalledTimes(1);
    expect(mockNode.toggle).not.toHaveBeenCalled();
  });

  it("clicking an open directory node also calls node.toggle() to collapse it", async () => {
    await setupWithRootNodes([{ path: "src", isDir: true }]);

    const dirData = makeFileNode("src", true, []);
    const mockNode = makeMockNode(dirData, { isOpen: true });

    const { container } = render(
      <>{capturedChildren!({ node: mockNode, style: {} })}</>
    );

    fireEvent.click(container.querySelector("div")!);

    expect(mockNode.toggle).toHaveBeenCalledTimes(1);
    expect(mockNode.activate).not.toHaveBeenCalled();
  });
});
