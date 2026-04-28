import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { BottomNav } from "../BottomNav";

// Mock next/navigation
jest.mock("next/navigation", () => ({
  usePathname: jest.fn(),
  useRouter: jest.fn(() => ({ push: jest.fn(), replace: jest.fn() })),
}));

// Mock next/link so it renders as a plain anchor
jest.mock("next/link", () => {
  const MockLink = React.forwardRef<
    HTMLAnchorElement,
    React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean }
  >(function MockLink({ href, children, prefetch: _prefetch, ...rest }, ref) {
    return (
      <a href={href} ref={ref} {...rest}>
        {children}
      </a>
    );
  });
  MockLink.displayName = "MockLink";
  return MockLink;
});

// Mock ReviewQueueNavBadge to avoid context dependency
jest.mock("@/components/sessions/ReviewQueueNavBadge", () => ({
  ReviewQueueNavBadge: () => null,
}));

// Mock OmnibarContext
const mockOpenOmnibar = jest.fn();
jest.mock("@/lib/contexts/OmnibarContext", () => ({
  useOmnibar: () => ({ open: mockOpenOmnibar }),
}));

// Mock AuthContext
jest.mock("@/lib/contexts/AuthContext", () => ({
  useAuth: () => ({ authenticated: false, authEnabled: false }),
}));

// Mock NotificationContext
const mockTogglePanel = jest.fn();
jest.mock("@/lib/contexts/NotificationContext", () => ({
  useNotifications: () => ({ togglePanel: mockTogglePanel, getUnreadCount: () => 0 }),
}));

// Mock the CSS module
jest.mock("../BottomNav.css", () => ({
  nav: "nav",
  navItem: "navItem",
  navItemActive: "navItemActive",
  navItemIcon: "navItemIcon",
  navItemLabel: "navItemLabel",
  newSessionButton: "newSessionButton",
  newSessionButtonInner: "newSessionButtonInner",
  notificationButton: "notificationButton",
  notificationIconWrap: "notificationIconWrap",
  notificationBadge: "notificationBadge",
  moreBackdrop: "moreBackdrop",
  moreSheet: "moreSheet",
  moreSheetOpen: "moreSheetOpen",
  moreSheetItem: "moreSheetItem",
  moreSheetItemActive: "moreSheetItemActive",
  moreSheetItemIcon: "moreSheetItemIcon",
}));

import { usePathname } from "next/navigation";

const PRIMARY_ITEMS = [
  { href: "/", label: "Sessions" },
  { href: "/unfinished", label: "Unfinished" },
  { href: "/review-queue", label: "Review" },
] as const;

describe("BottomNav", () => {
  beforeEach(() => {
    mockOpenOmnibar.mockClear();
    mockTogglePanel.mockClear();
  });

  it("renders all primary nav items and the New session button", () => {
    (usePathname as jest.Mock).mockReturnValue("/");
    render(<BottomNav />);

    const remaining = new Set(PRIMARY_ITEMS.map((p) => p.href));
    for (const item of PRIMARY_ITEMS) {
      expect(screen.getByText(item.label)).toBeInTheDocument();
      remaining.delete(item.href);
    }
    expect(remaining.size).toBe(0);
    expect(screen.getByRole("button", { name: "Create new session" })).toBeInTheDocument();
  });

  it("opens omnibar when New session button is clicked", () => {
    (usePathname as jest.Mock).mockReturnValue("/");
    render(<BottomNav />);

    fireEvent.click(screen.getByRole("button", { name: "Create new session" }));
    expect(mockOpenOmnibar).toHaveBeenCalledTimes(1);
  });

  it("marks Sessions as active on home route", () => {
    (usePathname as jest.Mock).mockReturnValue("/");
    render(<BottomNav />);

    const sessionsLink = screen.getByText("Sessions").closest("a");
    expect(sessionsLink).toHaveAttribute("aria-current", "page");
  });

  it("does not mark Review as active on home route", () => {
    (usePathname as jest.Mock).mockReturnValue("/");
    render(<BottomNav />);

    const reviewLink = screen.getByText("Review").closest("a");
    expect(reviewLink).not.toHaveAttribute("aria-current", "page");
  });

  it("marks Review as active on review-queue route", () => {
    (usePathname as jest.Mock).mockReturnValue("/review-queue");
    render(<BottomNav />);

    const reviewLink = screen.getByText("Review").closest("a");
    expect(reviewLink).toHaveAttribute("aria-current", "page");
  });

  it("does not mark Sessions as active on review-queue route", () => {
    (usePathname as jest.Mock).mockReturnValue("/review-queue");
    render(<BottomNav />);

    const sessionsLink = screen.getByText("Sessions").closest("a");
    expect(sessionsLink).not.toHaveAttribute("aria-current", "page");
  });

  it("renders the More button", () => {
    (usePathname as jest.Mock).mockReturnValue("/");
    render(<BottomNav />);

    expect(screen.getByRole("button", { name: "More navigation options" })).toBeInTheDocument();
  });
});
