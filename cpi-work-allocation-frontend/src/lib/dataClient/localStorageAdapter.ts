/**
 * localStorageAdapter — current implementation of DataClient.
 *
 * Backed by the existing `persistence.ts` helpers (versioned envelopes
 * with seed fallback on missing/stale/corrupt). This adapter is a thin
 * mapping from `ResourceKey` → (storage key, storage version) so callers
 * never have to know either constant directly.
 *
 * Why not inline the localStorage I/O here? `persistence.ts` is exported
 * and used by the dev-reset helper (`window.__cpiReset`). Keeping it as
 * the single source of versioning rules — and having this adapter just
 * resolve resource → (key, version) — means there's exactly one place
 * to change envelope semantics if we ever revise them.
 */

import {
  clearPersisted,
  loadPersisted,
  resetAllPersistedState,
  savePersisted,
  STORAGE_KEYS,
  STORAGE_VERSIONS,
} from '@/lib/persistence';
import type { DataClient, ResourceKey } from './types';

/**
 * Resource → (storage key, storage version) lookup. Centralized here
 * so contexts pass only the resource name and the adapter resolves
 * the rest. If you add a new ResourceKey you must add it here — the
 * `satisfies Record<ResourceKey, …>` guard makes that a build error
 * rather than a silent miss.
 */
const STORAGE_MAP = {
  auth:          { key: STORAGE_KEYS.auth,          version: STORAGE_VERSIONS.auth },
  journal:       { key: STORAGE_KEYS.journal,       version: STORAGE_VERSIONS.journal },
  allocations:   { key: STORAGE_KEYS.allocations,   version: STORAGE_VERSIONS.allocations },
  clientsConfig: { key: STORAGE_KEYS.clientsConfig, version: STORAGE_VERSIONS.clientsConfig },
  employees:     { key: STORAGE_KEYS.employees,     version: STORAGE_VERSIONS.employees },
  aiConfig:      { key: STORAGE_KEYS.aiConfig,      version: STORAGE_VERSIONS.aiConfig },
  notifications: { key: STORAGE_KEYS.notifications, version: STORAGE_VERSIONS.notifications },
} satisfies Record<ResourceKey, { key: string; version: number }>;

export const localStorageAdapter: DataClient = {
  read<T>(resource: ResourceKey): T | undefined {
    const { key, version } = STORAGE_MAP[resource];
    return loadPersisted<T>(key, version);
  },

  write<T>(resource: ResourceKey, data: T): void {
    const { key, version } = STORAGE_MAP[resource];
    savePersisted<T>(key, version, data);
  },

  remove(resource: ResourceKey): void {
    const { key } = STORAGE_MAP[resource];
    clearPersisted(key);
  },

  resetAll(): void {
    resetAllPersistedState();
  },
};
