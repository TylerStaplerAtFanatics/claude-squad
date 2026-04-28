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

// Mock the CSS module
jest.mock("../BottomNav.css", () => ({
  nav: "nav",
  navItem: "navItem",
  navItemActive: "navItemActive",
  navItemIcon: "navItemIcon",
  navItemLabel: "navItemLabel",
  newButton: "newButton",
  newButtonIcon: "newButtonIcon",
}));

import { usePathname } from "next/navigation";
import { MOBILE_NAV_PAGES } from "@/lib/nav-pages";

describe("BottomNav", () => {
  beforeEach(() => {
    mockOpenOmnibar.mockClear();
  });

  it("renders every MOBILE_NAV_PAGE and the New session button", () => {
    (usePathname as jest.Mock).mockReturnValue("/");
    render(<BottomNav />);

    const remaining = new Set(MOBILE_NAV_PAGES.map((p) => p.href));

    for (const page of MOBILE_NAV_PAGES) {
      const label = page.shortLabel ?? page.label;
      expect(screen.getByText(label)).toBeInTheDocument();
      remaining.delete(page.href);
    }

    expect(remaining.size).toBe(0);
    expect(screen.getByRole("button", { name: "New session" })).toBeInTheDocument();
  });

  it("opens omnibar when New session button is clicked", () => {
    (usePathname as jest.Mock).mockReturnValue("/");
    render(<BottomNav />);

    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(mockOpenOmnibar).toHaveBeenCalledTimes(1);
  });

  it("marks Sessions as active on home route", () => {
    (usePathname as jest.Mock).mockReturnValue("/");
    render(<BottomNav />);

    const sessionsLink = screen.getByText("Sessions").closest("a");
    expect(sessionsLink).toHaveAttribute("aria-current", "page");
  });

  it("does not mark other items as active on home route", () => {
    (usePathname as jest.Mock).mockReturnValue("/");
    render(<BottomNav />);

    const reviewPage = MOBILE_NAV_PAGES.find((p) => p.href === "/review-queue")!;
    const reviewLink = screen.getByText(reviewPage.shortLabel ?? reviewPage.label).closest("a");
    expect(reviewLink).not.toHaveAttribute("aria-current", "page");
  });

  it("marks Review as active on review-queue route", () => {
    (usePathname as jest.Mock).mockReturnValue("/review-queue");
    render(<BottomNav />);

    const reviewPage = MOBILE_NAV_PAGES.find((p) => p.href === "/review-queue")!;
    const reviewLink = screen.getByText(reviewPage.shortLabel ?? reviewPage.label).closest("a");
    expect(reviewLink).toHaveAttribute("aria-current", "page");
  });

  it("does not mark Sessions as active on review-queue route", () => {
    (usePathname as jest.Mock).mockReturnValue("/review-queue");
    render(<BottomNav />);

    const sessionsLink = screen.getByText("Sessions").closest("a");
    expect(sessionsLink).not.toHaveAttribute("aria-current", "page");
  });
});
