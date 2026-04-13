import React from "react";
import { renderHook, act } from "@testing-library/react";
import { NotificationProvider, useNotifications } from "@/lib/contexts/NotificationContext";
import { TOAST_STALE_MS, ACTIONABLE_TOAST_STALE_MS } from "@/lib/notification-policy";
import type { NotificationData } from "@/lib/types/notification";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockMarkAsRead = jest.fn().mockResolvedValue(undefined);
const mockMarkAllAsRead = jest.fn().mockResolvedValue(undefined);
const mockClearHistory = jest.fn().mockResolvedValue(undefined);

jest.mock("@/lib/hooks/useNotificationHistory", () => ({
  useNotificationHistory: () => ({
    notifications: [],
    unreadCount: 0,
    loading: false,
    error: null,
    hasMore: false,
    markAsRead: mockMarkAsRead,
    markAllAsRead: mockMarkAllAsRead,
    clearHistory: mockClearHistory,
    loadMore: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock("@/lib/hooks/useAuditLog", () => ({
  useAuditLog: () => ({
    logNotificationDismissed: jest.fn(),
    logNotificationMarkedRead: jest.fn(),
    logNotificationPanelOpened: jest.fn(),
    logNotificationPanelClosed: jest.fn(),
    logNotificationMarkedAllRead: jest.fn(),
    logNotificationRemoved: jest.fn(),
    logNotificationHistoryCleared: jest.fn(),
    logNotificationSessionViewed: jest.fn(),
    logNotificationViewed: jest.fn(),
  }),
}));

jest.mock("@/lib/utils/notificationGrouping", () => ({
  groupNotifications: (items: any[]) =>
    items.map((item) => ({ notification: item, count: 1, allIds: [item.id] })),
}));

// Prevent toast component timers from interfering with context tests
jest.mock("@/components/ui/NotificationToast", () => ({
  NotificationToast: () => null,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: React.ReactNode }) {
  return <NotificationProvider>{children}</NotificationProvider>;
}

function makeNotification(
  overrides: Partial<Omit<NotificationData, "id" | "timestamp">> = {}
): Omit<NotificationData, "id" | "timestamp"> {
  return {
    sessionId: "session-1",
    sessionName: "Test Session",
    message: "Something needs your attention",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NotificationContext", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("addNotification", () => {
    it("adds to active toasts", () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification(makeNotification());
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].sessionId).toBe("session-1");
    });

    it("adds to notification history", () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification(makeNotification());
      });

      expect(result.current.notificationHistory).toHaveLength(1);
      expect(result.current.notificationHistory[0].isRead).toBe(false);
    });

    it("replaces existing toast from the same session (no stacking)", () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification(makeNotification({ message: "first" }));
      });
      act(() => {
        result.current.addNotification(makeNotification({ message: "second" }));
      });

      // Only one toast visible
      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].message).toBe("second");

      // Both in history
      expect(result.current.notificationHistory).toHaveLength(2);
    });

    it("allows simultaneous toasts from different sessions", () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification(makeNotification({ sessionId: "s1" }));
        result.current.addNotification(makeNotification({ sessionId: "s2" }));
      });

      expect(result.current.notifications).toHaveLength(2);
    });

    it("assigns id and timestamp automatically", () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification(makeNotification());
      });

      const n = result.current.notifications[0];
      expect(n.id).toBeTruthy();
      expect(n.timestamp).toBeGreaterThan(0);
    });
  });

  describe("addToHistoryOnly", () => {
    it("does not add an active toast", () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addToHistoryOnly(makeNotification());
      });

      expect(result.current.notifications).toHaveLength(0);
    });

    it("does add to notification history", () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addToHistoryOnly(makeNotification());
      });

      expect(result.current.notificationHistory).toHaveLength(1);
    });
  });

  describe("removeNotification", () => {
    it("removes the toast from active list", () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification(makeNotification());
      });
      const id = result.current.notifications[0].id;

      act(() => {
        result.current.removeNotification(id);
      });

      expect(result.current.notifications).toHaveLength(0);
    });

    it("leaves the notification in history (not an acknowledge)", () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification(makeNotification());
      });
      const id = result.current.notifications[0].id;

      act(() => {
        result.current.removeNotification(id);
      });

      expect(result.current.notificationHistory).toHaveLength(1);
      expect(result.current.notificationHistory[0].isRead).toBe(false);
    });

    it("does not call backend markAsRead", () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification(makeNotification());
      });
      const id = result.current.notifications[0].id;

      act(() => {
        result.current.removeNotification(id);
      });

      expect(mockMarkAsRead).not.toHaveBeenCalled();
    });
  });

  describe("acknowledgeNotification", () => {
    it("removes the toast from active list", () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification(makeNotification());
      });
      const id = result.current.notifications[0].id;

      act(() => {
        result.current.acknowledgeNotification(id);
      });

      expect(result.current.notifications).toHaveLength(0);
    });

    it("marks the notification as read in history", () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification(makeNotification());
      });
      const id = result.current.notifications[0].id;

      act(() => {
        result.current.acknowledgeNotification(id);
      });

      expect(result.current.notificationHistory[0].isRead).toBe(true);
    });

    it("persists the read state to the backend", () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification(makeNotification());
      });
      const id = result.current.notifications[0].id;

      act(() => {
        result.current.acknowledgeNotification(id);
      });

      expect(mockMarkAsRead).toHaveBeenCalledWith([id]);
    });

    it("leaves notification in history (does not delete the record)", () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification(makeNotification());
      });
      const id = result.current.notifications[0].id;

      act(() => {
        result.current.acknowledgeNotification(id);
      });

      expect(result.current.notificationHistory).toHaveLength(1);
    });

    it("accepts an array of ids and acknowledges all", () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification(makeNotification({ sessionId: "s1" }));
        result.current.addNotification(makeNotification({ sessionId: "s2" }));
      });
      const ids = result.current.notifications.map((n) => n.id);

      act(() => {
        result.current.acknowledgeNotification(ids);
      });

      expect(result.current.notifications).toHaveLength(0);
      expect(result.current.notificationHistory.every((n) => n.isRead)).toBe(true);
      expect(mockMarkAsRead).toHaveBeenCalledWith(ids);
    });

    it("is idempotent — acknowledging an already-closed id is a no-op", () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification(makeNotification());
      });
      const id = result.current.notifications[0].id;

      act(() => {
        result.current.acknowledgeNotification(id);
        result.current.acknowledgeNotification(id);
      });

      expect(result.current.notifications).toHaveLength(0);
      expect(result.current.notificationHistory).toHaveLength(1);
    });
  });

  describe("stale sweep", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("removes non-actionable toast after TOAST_STALE_MS", () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification(makeNotification({ notificationType: "info" }));
      });
      expect(result.current.notifications).toHaveLength(1);

      act(() => {
        jest.advanceTimersByTime(TOAST_STALE_MS);
      });

      expect(result.current.notifications).toHaveLength(0);
    });

    it("keeps non-actionable toast before TOAST_STALE_MS", () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification(makeNotification({ notificationType: "info" }));
      });

      act(() => {
        jest.advanceTimersByTime(TOAST_STALE_MS - 60_001); // just before the sweep would remove it
      });

      expect(result.current.notifications).toHaveLength(1);
    });

    it("keeps approval_needed toast past TOAST_STALE_MS", () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification(makeNotification({ notificationType: "approval_needed" }));
      });

      act(() => {
        jest.advanceTimersByTime(TOAST_STALE_MS); // non-actionable would be gone by now
      });

      expect(result.current.notifications).toHaveLength(1);
    });

    it("removes approval_needed toast after ACTIONABLE_TOAST_STALE_MS", () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification(makeNotification({ notificationType: "approval_needed" }));
      });

      act(() => {
        jest.advanceTimersByTime(ACTIONABLE_TOAST_STALE_MS);
      });

      expect(result.current.notifications).toHaveLength(0);
    });

    it("removes question toast after ACTIONABLE_TOAST_STALE_MS", () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification(makeNotification({ notificationType: "question" }));
      });

      act(() => {
        jest.advanceTimersByTime(ACTIONABLE_TOAST_STALE_MS);
      });

      expect(result.current.notifications).toHaveLength(0);
    });

    it("stale sweep leaves history untouched", () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification(makeNotification({ notificationType: "info" }));
      });

      act(() => {
        jest.advanceTimersByTime(TOAST_STALE_MS);
      });

      expect(result.current.notifications).toHaveLength(0);
      expect(result.current.notificationHistory).toHaveLength(1);
    });

    it("preserves actionable toasts while sweeping non-actionable ones", () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification(makeNotification({ sessionId: "s1", notificationType: "info" }));
        result.current.addNotification(makeNotification({ sessionId: "s2", notificationType: "approval_needed" }));
      });

      act(() => {
        jest.advanceTimersByTime(TOAST_STALE_MS);
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].notificationType).toBe("approval_needed");
    });
  });
});
