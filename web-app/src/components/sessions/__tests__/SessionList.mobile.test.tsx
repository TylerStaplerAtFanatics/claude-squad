import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionList } from "../SessionList";
import type { Session } from "@/gen/session/v1/types_pb";

// Heavy dependency mocks for SessionList

jest.mock("@connectrpc/connect", () => ({
  createClient: jest.fn(() => ({})),
}));

jest.mock("@connectrpc/connect-web", () => ({
  createConnectTransport: jest.fn(() => ({ unary: jest.fn(), stream: jest.fn() })),
}));

jest.mock("@/lib/contexts/ReviewQueueContext", () => ({
  useReviewQueueContext: () => ({ items: [] }),
}));

jest.mock("@/lib/store", () => ({
  useAppSelector: jest.fn(() => ({})),
}));

jest.mock("@/lib/store/sessionsSlice", () => ({
  selectDetectedStatusMap: jest.fn(),
}));

jest.mock("../SessionCard", () => ({
  SessionCard: ({ session }: { session: { title: string } }) => (
    <div data-testid="session-card">{session.title}</div>
  ),
}));

jest.mock("../BulkActions", () => ({
  BulkActions: () => null,
}));

jest.mock("../TagEditor", () => ({
  TagEditor: () => null,
}));

jest.mock("@/components/ui/ActionBar", () => ({
  ActionBar: () => null,
}));

jest.mock("@/components/ui/Modal", () => ({
  Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ModalContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ModalTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ModalFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock("@/components/ui/AppLink", () => ({
  AppLink: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const makeSession = (id: string, title: string): Partial<Session> => ({
  id,
  title,
  status: 1 as Session["status"],
  tags: [],
  category: "",
  path: "/tmp/session",
  branch: "",
  program: "claude",
});

describe("SessionList — mobile new session flow", () => {
  it("renders the + button in the header when sessions exist", () => {
    render(
      <SessionList
        sessions={[makeSession("s1", "My Session") as Session]}
        onNewSession={jest.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Create new session (Ctrl+K)" })).toBeInTheDocument();
  });

  it("calls onNewSession when the header + button is clicked", () => {
    const onNewSession = jest.fn();
    render(
      <SessionList
        sessions={[makeSession("s1", "My Session") as Session]}
        onNewSession={onNewSession}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Create new session (Ctrl+K)" }));
    expect(onNewSession).toHaveBeenCalledTimes(1);
  });

  it("shows the + button even when session list is empty", () => {
    render(<SessionList sessions={[]} onNewSession={jest.fn()} />);
    expect(screen.getByRole("button", { name: "Create new session (Ctrl+K)" })).toBeInTheDocument();
  });

  it("does not crash when onNewSession is not provided", () => {
    expect(() =>
      render(<SessionList sessions={[makeSession("s1", "My Session") as Session]} />)
    ).not.toThrow();
  });
});
