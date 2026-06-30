import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { getDataClient } from "@/lib/dataClient";
import { api, type ApiNotification } from "@/lib/apiClient";

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

// ── Local-storage mode provider ──────────────────────────────────────────────
// Unchanged from the original single-mode implementation. Used when the app
// runs without the API (VITE_USE_API !== "true") — a single shared browser
// store, fine for the local demo.

const LocalNotificationsProvider = ({ children }: { children: ReactNode }) => {
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

// ── API mode provider ─────────────────────────────────────────────────────────
// Notifications live in the database. The bell reads them over the API and
// markRead/markAllRead are persisted server-side. Cross-user notifications
// (manager↔employee, Finance group) are created by the backend workflow
// handlers — the client only ever creates SELF-targeted ones (login
// scheduler), which the create endpoint forces to the authenticated user.

const SCHEDULER_RUNS_KEY = "notificationSchedulerRuns";

const toAppNotification = (n: ApiNotification): AppNotification => ({
  id: n.id,
  targetUserId: n.targetUserId,
  title: n.title,
  message: n.message,
  type: n.type,
  timestamp: n.createdAt,
  isRead: n.isRead,
  ...(n.actionUrl ? { actionUrl: n.actionUrl } : {}),
});

const ApiNotificationsProvider = ({ children }: { children: ReactNode }) => {
  const qc = useQueryClient();
  const { currentUser } = useAuth();

  const { data = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: ({ signal }) => api.notifications.list(signal),
    enabled: !!currentUser,
    // Poll so server-generated events (a submission, an approval) surface in
    // the bell without a manual refresh. 60s is a gentle cadence.
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const notifications = useMemo(
    () => data.map(toAppNotification),
    [data],
  );

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications],
  );

  const inv = useCallback(
    () => qc.invalidateQueries({ queryKey: ["notifications"] }),
    [qc],
  );

  const createMut = useMutation({
    mutationFn: (body: Parameters<typeof api.notifications.createSelf>[0]) =>
      api.notifications.createSelf(body),
    onSuccess: inv,
  });

  // Optimistic mark-read: flip the row locally, reconcile on settle.
  const markReadMut = useMutation({
    mutationFn: (id: string) => api.notifications.markRead(id),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ["notifications"] });
      const prev = qc.getQueryData<ApiNotification[]>(["notifications"]);
      qc.setQueryData<ApiNotification[]>(["notifications"], (old) =>
        (old ?? []).map((n) => (n.id === id ? { ...n, isRead: true } : n)),
      );
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(["notifications"], ctx.prev);
    },
    onSettled: inv,
  });

  const markAllReadMut = useMutation({
    mutationFn: () => api.notifications.markAllRead(),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["notifications"] });
      const prev = qc.getQueryData<ApiNotification[]>(["notifications"]);
      qc.setQueryData<ApiNotification[]>(["notifications"], (old) =>
        (old ?? []).map((n) => ({ ...n, isRead: true })),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["notifications"], ctx.prev);
    },
    onSettled: inv,
  });

  const addNotification = useCallback(
    (input: NotificationInput) => {
      // The server owns cross-user notifications. The client may only create
      // a notification for itself; anything else is already produced
      // server-side, so drop it rather than misfile it as a self note.
      if (!currentUser || input.targetUserId !== currentUser.id) return;
      createMut.mutate({
        title: input.title,
        message: input.message,
        type: input.type,
        ...(input.actionUrl ? { actionUrl: input.actionUrl } : {}),
      });
    },
    [currentUser, createMut],
  );

  const markAsRead = useCallback(
    (id: string) => markReadMut.mutate(id),
    [markReadMut],
  );

  const markAllAsRead = useCallback(
    () => markAllReadMut.mutate(),
    [markAllReadMut],
  );

  // Scheduler dedup stays device-local — it's just a "did we already nudge
  // today" stamp, not durable state worth a DB round-trip.
  const hasSchedulerRunToday = useCallback((key: string): boolean => {
    const runs =
      getDataClient().read<Record<string, string>>(SCHEDULER_RUNS_KEY) ?? {};
    return runs[key] === new Date().toISOString().slice(0, 10);
  }, []);

  const recordSchedulerRun = useCallback((key: string) => {
    const client = getDataClient();
    const runs = client.read<Record<string, string>>(SCHEDULER_RUNS_KEY) ?? {};
    runs[key] = new Date().toISOString().slice(0, 10);
    client.write(SCHEDULER_RUNS_KEY, runs);
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

// ── Public export — dispatches based on VITE_USE_API ─────────────────────────

export const NotificationsProvider = ({ children }: { children: ReactNode }) => {
  const isApiMode = import.meta.env.VITE_USE_API === "true";
  if (isApiMode) return <ApiNotificationsProvider>{children}</ApiNotificationsProvider>;
  return <LocalNotificationsProvider>{children}</LocalNotificationsProvider>;
};
