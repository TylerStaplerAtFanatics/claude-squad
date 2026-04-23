"use client";

import { AppLink } from "@/components/ui/AppLink";
import { usePathname } from "next/navigation";
import { ReviewQueueNavBadge } from "@/components/sessions/ReviewQueueNavBadge";
import { useOmnibar } from "@/lib/contexts/OmnibarContext";
import { routes } from "@/lib/routes";
import * as styles from "./BottomNav.css";

const navItems = [
  { href: routes.home, label: "Sessions", icon: "⊞" },
  { href: routes.reviewQueue, label: "Review", icon: "📋" },
  { href: routes.rules, label: "Rules", icon: "📜" },
  { href: routes.history, label: "History", icon: "🕐" },
  { href: routes.config, label: "Config", icon: "⚙" },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const { open: openOmnibar } = useOmnibar();

  const firstTwo = navItems.slice(0, 2);
  const lastThree = navItems.slice(2);

  const renderNavItem = (item: (typeof navItems)[number]) => {
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
    <nav className={styles.nav} aria-label="Bottom navigation">
      {firstTwo.map(renderNavItem)}
      <button
        className={styles.newSessionButton}
        onClick={openOmnibar}
        aria-label="Create new session"
      >
        <span className={styles.newSessionButtonInner} aria-hidden="true">+</span>
        <span className={styles.navItemLabel}>New</span>
      </button>
      {lastThree.map(renderNavItem)}
    </nav>
  );
}
