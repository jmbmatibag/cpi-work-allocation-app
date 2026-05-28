/**
 * DataClient — the seam between context state and storage.
 *
 * Why this exists (Phase 0.5):
 * Contexts used to call `loadPersisted` / `savePersisted` directly,
 * which hard-coded localStorage as the backing store. That meant
 * the Phase 4 cutover to the API would touch every context. With
 * the DataClient seam in place, the cutover is one swap:
 *
 *   getDataClient() → localStorageAdapter   (Phase 0.5–3.x)
 *   getDataClient() → httpAdapter           (Phase 4 onwards)
 *
 * The interface is intentionally **synchronous** because the current
 * adapter is localStorage (sync) and the React contexts initialize
 * state via `useState(() => client.read(...))`. When the http adapter
 * lands, Phase 4 will introduce a hydration boundary (Suspense or a
 * load-state flag) — but that is not 0.5's problem.
 *
 * Resources are addressed by a small enum of keys, not arbitrary
 * strings. Adding a new resource means adding a `ResourceKey` and an
 * entry in the adapter's storage map — a deliberate touch point so
 * we don't end up with typo'd keys silently writing to nowhere.
 */

export type ResourceKey =
  | 'auth'
  | 'journal'
  | 'allocations'
  | 'clientsConfig'
  | 'employees'
  | 'aiConfig'
  | 'notifications';

export interface DataClient {
  /**
   * Read a resource. Returns `undefined` if not present, version
   * mismatched, or otherwise unreadable. Callers should treat
   * `undefined` as "no stored value — use seed."
   */
  read<T>(resource: ResourceKey): T | undefined;

  /**
   * Write a resource. Errors (quota, access denied) are swallowed
   * by the adapter — the app keeps working with in-memory state
   * even if persistence is broken.
   */
  write<T>(resource: ResourceKey, data: T): void;

  /**
   * Remove a single resource. Used by logout (auth) and by the
   * dev reset helper.
   */
  remove(resource: ResourceKey): void;

  /**
   * Wipe every resource. Dev-only utility for resetting to seed
   * state. Adapters that can't safely reset (e.g. http) should
   * make this a no-op.
   */
  resetAll(): void;
}
