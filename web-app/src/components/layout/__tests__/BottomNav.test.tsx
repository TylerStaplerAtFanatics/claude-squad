import React from "react";
import { render, screen } from "@testing-library/react";
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

// Mock the CSS module
jest.mock("../BottomNav.css", () => ({
  nav: "nav",
  navItem: "navItem",
  navItemActive: "navItemActive",
  navItemIcon: "navItemIcon",
  navItemLabel: "navItemLabel",
}));

import { usePathname } from "next/navigation";

describe("BottomNav", () => {
  it("renders all 5 nav items", () => {
    (usePathname as jest.Mock).mockReturnValue("/");
    render(<BottomNav />);

    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("Rules")).toBeInTheDocument();
    expect(screen.getByText("History")).toBeInTheDocument();
    expect(screen.getByText("Config")).toBeInTheDocument();
  });

  it("marks Sessions as active on home route", () => {
    (usePathname as jest.Mock).mockReturnValue("/");
    render(<BottomNav />);

    // The Sessions link should have aria-current="page"
    const sessionsLink = screen.getByText("Sessions").closest("a");
    expect(sessionsLink).toHaveAttribute("aria-current", "page");
  });

  it("does not mark other items as active on home route", () => {
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
});
