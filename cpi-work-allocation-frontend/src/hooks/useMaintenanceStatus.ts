import { useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  api,
  setMaintenanceActive,
  type ApiMaintenanceStatus,
} from "@/lib/apiClient";

export const MAINTENANCE_QUERY_KEY = ["maintenance", "status"] as const;

/**
 * How often every open tab re-checks the switch. 60s is the trade-off:
 * turning maintenance ON evicts active users within a minute, and turning it
 * OFF lets them back in within a minute — without any of them reloading. The
 * global API rate limit is 120 req/min per IP, so one poll a minute is noise.
 */
const POLL_INTERVAL_MS = 60_000;

/**
 * Local-mode fallback. The maintenance switch is server-owned, so in
 * localStorage mode (VITE_USE_API !== "true") there is nothing to read —
 * the gate stays open. Keeps demos and the test suite unaffected.
 */
const OFF: ApiMaintenanceStatus = {
  enabled: false,
  title: "",
  message: "",
  startsAt: null,
  endsAt: null,
  updatedAt: "",
  updatedByName: null,
};

export const isApiMode = (): boolean => import.meta.env.VITE_USE_API === "true";

/**
 * Reads the server-owned maintenance switch.
 *
 * FAILS OPEN by design: if the request errors (API down, network blip), the
 * hook reports `enabled: false` and the app renders normally. A gate that
 * closes on its own failure would lock everyone out of a working app the
 * moment one poll times out — including the admin who needs to fix it.
 */
export function useMaintenanceStatus() {
  const query = useQuery({
    queryKey: MAINTENANCE_QUERY_KEY,
    queryFn: ({ signal }) => api.maintenance.status(signal),
    enabled: isApiMode(),
    refetchInterval: POLL_INTERVAL_MS,
    // Re-check the moment a backgrounded tab comes forward — the usual way
    // someone finds out maintenance started while they were away.
    refetchOnWindowFocus: true,
    retry: false,
    throwOnError: false,
    staleTime: 30_000,
  });

  const enabled = query.data?.enabled ?? false;

  // Keep apiClient's copy in step so its 401 handler knows to stay quiet
  // while the announcement is up. See setMaintenanceActive.
  useEffect(() => {
    setMaintenanceActive(enabled);
  }, [enabled]);

  return {
    status: query.data ?? OFF,
    // Only "loading" on the very first fetch. Background polls must not put
    // the gate back into a loading state or the screen would flicker.
    isLoading: isApiMode() && query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/** Admin-only write. Pushes the response straight into the poll cache. */
export function useUpdateMaintenance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.maintenance.update,
    onSuccess: (data) => {
      qc.setQueryData(MAINTENANCE_QUERY_KEY, data);
    },
  });
}
