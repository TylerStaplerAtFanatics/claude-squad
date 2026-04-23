"use client";

import { useState, useEffect } from "react";
import { AppLink } from "@/components/ui/AppLink";
import { usePathname } from "next/navigation";
import { ReviewQueueNavBadge } from "@/components/sessions/ReviewQueueNavBadge";
import { useOmnibar } from "@/lib/contexts/OmnibarContext";
import { routes } from "@/lib/routes";
import * as styles from "./BottomNav.css";

const primaryItems = [
  { href: routes.home, label: "Sessions", icon: "⊞" },
  { href: routes.reviewQueue, label: "Review", icon: "📋" },
  { href: routes.history, label: "History", icon: "🕐" },
] as const;

const moreItems = [
  { href: routes.logs, label: "Logs", icon: "📄" },
  { href: routes.rules, label: "Rules", icon: "📜" },
  { href: routes.config, label: "Config", icon: "⚙" },
  { href: routes.settings, label: "Settings", icon: "🔧" },
] as const;

type PrimaryItem = (typeof primaryItems)[number];
type MoreItem = (typeof moreItems)[number];

export function BottomNav() {
  const pathname = usePathname();
  const { open: openOmnibar } = useOmnibar();
  const [moreOpen, setMoreOpen] = useState(false);

  // Close the more menu on route change
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // Close on Escape
  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [moreOpen]);

  const isMoreActive = moreItems.some((item) => pathname?.startsWith(item.href));

  const renderPrimaryItem = (item: PrimaryItem) => {
    const isActive =
      item.href === routes.home
        ? pathname === routes.home
        : pathname?.startsWith(item.href);

    return (
      <AppLink
        key={item.href}
        href={item.href}
        className={`${styles.navItem} ${isActive ? styles.navItemActive : ""}`}
        aria-current={isActive ? "page" : undefined}
      >
        <span className={styles.navItemIcon} aria-hidden="true">
          {item.label === "Review" ? (
            <>
              {item.icon}
              <ReviewQueueNavBadge inline={true} />
            </>
          ) : (
            item.icon
          )}
        </span>
        <span className={styles.navItemLabel}>{item.label}</span>
      </AppLink>
    );
  };

  return (
    <>
      {/* Backdrop */}
      {moreOpen && (
        <div
          className={styles.moreBackdrop}
          onClick={() => setMoreOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* More sheet */}
      <div
        className={`${styles.moreSheet} ${moreOpen ? styles.moreSheetOpen : ""}`}
        aria-label="More navigation"
        role="navigation"
      >
        {moreItems.map((item: MoreItem) => {
          const isActive = pathname?.startsWith(item.href);
          return (
            <AppLink
              key={item.href}
              href={item.href}
              className={`${styles.moreSheetItem} ${isActive ? styles.moreSheetItemActive : ""}`}
              aria-current={isActive ? "page" : undefined}
            >
              <span className={styles.moreSheetItemIcon} aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </AppLink>
          );
        })}
      </div>

      {/* Bottom nav bar */}
      <nav className={styles.nav} aria-label="Bottom navigation">
        {primaryItems.map(renderPrimaryItem)}
        <button
          className={styles.newSessionButton}
          onClick={openOmnibar}
          aria-label="Create new session"
        >
          <span className={styles.newSessionButtonInner} aria-hidden="true">+</span>
          <span className={styles.navItemLabel}>New</span>
        </button>
        <button
          className={`${styles.navItem} ${isMoreActive ? styles.navItemActive : ""}`}
          onClick={() => setMoreOpen((o) => !o)}
          aria-label="More navigation options"
          aria-expanded={moreOpen}
        >
          <span className={styles.navItemIcon} aria-hidden="true">⋯</span>
          <span className={styles.navItemLabel}>More</span>
        </button>
      </nav>
    </>
  );
}
