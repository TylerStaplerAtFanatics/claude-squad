"use client";
// +feature: ui:bottom-nav

import { AppLink } from "@/components/ui/AppLink";
import { usePathname } from "next/navigation";
import { ReviewQueueNavBadge } from "@/components/sessions/ReviewQueueNavBadge";
import { useOmnibar } from "@/lib/contexts/OmnibarContext";
import { routes } from "@/lib/routes";
import { MOBILE_NAV_PAGES } from "@/lib/nav-pages";
import * as styles from "./BottomNav.css";

// Split point: New button inserted after the first half of nav pages
const SPLIT = Math.ceil(MOBILE_NAV_PAGES.length / 2);

function NavItem({ page, pathname }: { page: typeof MOBILE_NAV_PAGES[number]; pathname: string | null }) {
  const isActive = page.href === routes.home
    ? pathname === routes.home
    : pathname?.startsWith(page.href) ?? false;

  return (
    <AppLink
      href={page.href}
      className={`${styles.navItem} ${isActive ? styles.navItemActive : ""}`}
      aria-current={isActive ? "page" : undefined}
    >
      <span className={styles.navItemIcon} aria-hidden="true">
        {page.href === routes.reviewQueue ? (
          <>{page.icon}<ReviewQueueNavBadge inline={true} /></>
        ) : (
          page.icon
        )}
      </span>
      <span className={styles.navItemLabel}>{page.shortLabel ?? page.label}</span>
    </AppLink>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const { open: openOmnibar } = useOmnibar();

  return (
    <nav className={styles.nav} aria-label="Bottom navigation">
      {MOBILE_NAV_PAGES.slice(0, SPLIT).map((page) => (
        <NavItem key={page.href} page={page} pathname={pathname} />
      ))}

      <button
        className={styles.newButton}
        onClick={openOmnibar}
        aria-label="New session"
      >
        <span className={styles.newButtonIcon} aria-hidden="true">+</span>
        <span className={styles.navItemLabel}>New</span>
      </button>

      {MOBILE_NAV_PAGES.slice(SPLIT).map((page) => (
        <NavItem key={page.href} page={page} pathname={pathname} />
      ))}
    </nav>
  );
}
