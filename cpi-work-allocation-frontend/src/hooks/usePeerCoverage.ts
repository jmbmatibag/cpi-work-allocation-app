/**
 * Peer Coverage hooks — the client half of the Team Hub "peer tabs" feature.
 *
 * A manager can pin a same-team peer manager as a tab and then view / action
 * that peer's Team Submissions. These hooks are API-mode only (peer coverage
 * is persisted in Postgres); in localStorage/demo mode they resolve to empty
 * data and no-op mutations so the UI degrades gracefully.
 *
 *   usePeerManagers()      → eligible peers for the "+" popover
 *   usePeerCoverageTabs()  → persisted tabs + add/remove mutations
 *   usePeerSubmissions(id) → a peer manager's allocation records
 *
 * Peer-submission queries live under the ["allocations", …] key prefix, so
 * the AllocationsContext mutations (which invalidate ["allocations"]) refresh
 * peer tabs automatically after an approve / return / edit / flag.
 */

import { useCallback } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { api, type ApiPeerManager } from "@/lib/apiClient";
import { fromApiRecord, type AllocationRecord } from "@/contexts/AllocationsContext";
import { useAuth } from "@/contexts/AuthContext";

const isApiMode = import.meta.env.VITE_USE_API === "true";

export interface PeerManager {
  id: string;
  name: string;
  team: string;
  jobTitle: string;
}

const toPeer = (p: ApiPeerManager): PeerManager => ({
  id: p.id,
  name: `${p.firstName} ${p.lastName}`.trim(),
  team: p.team,
  jobTitle: p.jobTitle,
});

/**
 * Eligible peer managers (same team, Manager role, excluding self). Source
 * list for the "+" popover.
 */
export function usePeerManagers() {
  const { currentUser } = useAuth();
  const { data = [], isLoading } = useQuery({
    queryKey: ["peer-managers"],
    queryFn: ({ signal }) => api.managers.peers(signal),
    enabled: isApiMode && !!currentUser,
    staleTime: 60_000,
  });
  return { peers: data.map(toPeer), isLoading };
}

/**
 * The caller's persisted peer-coverage tabs plus add/remove mutations.
 * Optimism is left to React Query's invalidation — the lists are tiny and a
 * round-trip is imperceptible.
 */
export function usePeerCoverageTabs() {
  const qc = useQueryClient();
  const { currentUser } = useAuth();

  const { data = [], isLoading } = useQuery({
    queryKey: ["peer-tabs"],
    queryFn: ({ signal }) => api.managers.peerTabs(signal),
    enabled: isApiMode && !!currentUser,
    staleTime: 60_000,
  });

  const addMut = useMutation({
    mutationFn: (peerManagerId: string) => api.managers.addPeerTab(peerManagerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["peer-tabs"] }),
  });

  const removeMut = useMutation({
    mutationFn: (peerManagerId: string) => api.managers.removePeerTab(peerManagerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["peer-tabs"] }),
  });

  const addTab = useCallback(
    (peerManagerId: string) => addMut.mutateAsync(peerManagerId),
    [addMut],
  );
  const removeTab = useCallback(
    (peerManagerId: string) => removeMut.mutateAsync(peerManagerId),
    [removeMut],
  );

  return { tabs: data.map(toPeer), isLoading, addTab, removeTab };
}

/**
 * A peer manager's allocation records. Enabled only when a peer id is
 * provided (i.e. a peer tab is active). Shares the ["allocations"] key prefix
 * so context mutations refresh it after actions.
 */
export function usePeerSubmissions(peerManagerId: string | null) {
  const { currentUser } = useAuth();
  const { data = [], isLoading } = useQuery({
    queryKey: ["allocations", "peer", peerManagerId],
    queryFn: ({ signal }) =>
      api.allocations
        .list({ managerId: peerManagerId as string }, signal)
        .then((rows) => rows.map(fromApiRecord)),
    enabled: isApiMode && !!currentUser && !!peerManagerId,
    staleTime: 30_000,
  });
  return { records: data as AllocationRecord[], isLoading };
}
