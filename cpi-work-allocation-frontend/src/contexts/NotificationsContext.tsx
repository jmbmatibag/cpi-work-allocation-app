import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getDataClient } from "@/lib/dataClient";

export interface AppNotification {
  id: string;
  targetUserId: string;
  title: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  timestamp: string;
  isRead: boolean;
  actionUrl?: string;
}

export type NotificationInput = Omit<AppNotification, "id" | "timestamp" | "isRead">;

interface NotificationsStorage {
  notifications: AppNotification[];
  /** Maps scheduler dedup key → ISO date (YYYY-MM-DD) of last fire. */
  schedulerRuns: Record<string, string>;
}

interface NotificationsContextType {
  /** All notifications for the current user, newest first. */
  notifications: AppNotification[];
  unreadCount: number;
  addNotification: (input: NotificationInput) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  hasSchedulerRunToday: (key: string) => boolean;
  recordSchedulerRun: (key: string) => void;
}

const NotificationsContext = createContext<NotificationsContextType>({
  notifications: [],
  unreadCount: 0,
  addNotification: () => {},
  markAsRead: () => {},
  markAllAsRead: () => {},
  hasSchedulerRunToday: () => false,
  recordSchedulerRun: () => {},
});

export const useNotifications = () => useContext(NotificationsContext);

const EMPTY_STORAGE: NotificationsStorage = {
  notifications: [],
  schedulerRuns: {},
};

export const NotificationsProvider = ({ children }: { children: ReactNode }) => {
  const { currentUser } = useAuth();

  const [storage, setStorage] = useState<NotificationsStorage>(() => {
    return (
      getDataClient().read<NotificationsStorage>("notifications") ??
      EMPTY_STORAGE
    );
  });

  useEffect(() => {
    getDataClient().write("notifications", storage);
  }, [storage]);

  const notifications = useMemo(
    () =>
      storage.notifications
        .filter((n) => n.targetUserId === currentUser?.id)
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        ),
    [storage.notifications, currentUser?.id],
  );

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications],
  );

  const addNotification = useCallback((input: NotificationInput) => {
    const notification: AppNotification = {
      ...input,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      isRead: false,
    };

    setStorage((prev) => ({
      ...prev,
      notifications: [...prev.notifications, notification],
    }));
  }, []);

  const markAsRead = useCallback((id: string) => {
    setStorage((prev) => ({
      ...prev,
      notifications: prev.notifications.map((n) =>
        n.id === id ? { ...n, isRead: true } : n,
      ),
    }));
  }, []);

  const markAllAsRead = useCallback(() => {
    if (!currentUser) return;
    setStorage((prev) => ({
      ...prev,
      notifications: prev.notifications.map((n) =>
        n.targetUserId === currentUser.id ? { ...n, isRead: true } : n,
      ),
    }));
  }, [currentUser]);

  const hasSchedulerRunToday = useCallback(
    (key: string): boolean => {
      const today = new Date().toISOString().slice(0, 10);
      return storage.schedulerRuns[key] === today;
    },
    [storage.schedulerRuns],
  );

  const recordSchedulerRun = useCallback((key: string) => {
    const today = new Date().toISOString().slice(0, 10);
    setStorage((prev) => ({
      ...prev,
      schedulerRuns: { ...prev.schedulerRuns, [key]: today },
    }));
  }, []);

  return (
    <NotificationsContext.Provider
      value={{
        notifications,
        unreadCount,
        addNotification,
        markAsRead,
        markAllAsRead,
        hasSchedulerRunToday,
        recordSchedulerRun,
      }}
    >
      {children}
    </NotificationsContext.Provider>
  );
};
