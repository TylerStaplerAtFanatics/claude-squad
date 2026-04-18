"use client";

import { AppLink } from "@/components/ui/AppLink";
import { usePathname } from "next/navigation";
import { ReviewQueueNavBadge } from "@/components/sessions/ReviewQueueNavBadge";
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

  return (
    <nav className={styles.nav} aria-label="Bottom navigation">
      {navItems.map((item) => {
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
      })}
    </nav>
  );
}
