/**
 * Versioned localStorage persistence for CPI contexts.
 *
 * Every context that persists state goes through this module so the
 * serialization format is consistent and schema changes can invalidate
 * stored values cleanly.
 *
 * Storage shape per key:
 *   { version: number, data: T }
 *
 * On load:
 *   - Missing key → fall back to seed
 *   - Wrong version → fall back to seed (stored value is stale)
 *   - JSON parse failure → fall back to seed (corrupted)
 *   - localStorage unavailable (SSR, private mode edge cases) → seed
 *
 * Bumping a version is how you force users off an old schema. When
 * you change a context's state shape in an incompatible way, bump
 * that context's version constant. Users with old stored data see
 * the seed on next load — no crash, no partial upgrade.
 */

interface Envelope<T> {
  version: number;
  data: T;
}

/**
 * Returns true if localStorage is usable in this environment.
 * Catches SSR, disabled storage, and quota-full edge cases.
 */
const hasLocalStorage = (): boolean => {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
};

/**
 * Read and deserialize a stored value. Returns undefined (meaning
 * "use the seed") on any failure — missing, wrong version, parse
 * error, access error.
 *
 * Dev builds log the reason; prod builds fail silently since users
 * can't act on a console message anyway.
 */
export function loadPersisted<T>(key: string, expectedVersion: number): T | undefined {
  if (!hasLocalStorage()) return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return undefined;
    const parsed = JSON.parse(raw) as Envelope<T>;
    if (!parsed || typeof parsed !== "object") return undefined;
    if (parsed.version !== expectedVersion) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.info(
          `[persistence] "${key}" version mismatch ` +
          `(stored=${parsed.version}, expected=${expectedVersion}). ` +
          `Falling back to seed.`,
        );
      }
      return undefined;
    }
    return parsed.data;
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(`[persistence] failed to load "${key}":`, err);
    }
    return undefined;
  }
}

/**
 * Serialize and store a value with its version wrapper. Swallows
 * any error (quota exceeded, access denied) — the app keeps working
 * with in-memory state even if persistence is broken.
 */
export function savePersisted<T>(
  key: string,
  version: number,
  data: T,
): void {
  if (!hasLocalStorage()) return;
  try {
    const envelope: Envelope<T> = { version, data };
    window.localStorage.setItem(key, JSON.stringify(envelope));
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(`[persistence] failed to save "${key}":`, err);
    }
  }
}

/**
 * Clear a single persisted key. Used by the dev reset helper.
 */
export function clearPersisted(key: string): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------
// Storage keys + versions — single source of truth
// ---------------------------------------------------------------------

export const STORAGE_KEYS = {
  auth:          "cpi.auth.v1",
  journal:       "cpi.journal.v1",
  allocations:   "cpi.allocations.v1",
  clientsConfig: "cpi.clientsConfig.v1",
  employees:     "cpi.employees.v1",
  aiConfig:      "cpi.aiConfig.v1",
  notifications: "cpi.notifications.v1",
} as const;

/**
 * Bump a context's VERSION when its persisted shape changes
 * incompatibly. Cosmetic changes (adding optional fields the code
 * handles gracefully) don't need a bump. Mandatory new fields,
 * renamed fields, or removed fields do.
 *
 * Guidelines for future schema changes:
 *   - New required field → bump version
 *   - New optional field with safe default → no bump
 *   - Field rename → bump version
 *   - Field removal → no bump (old data is ignored)
 *   - Type change on existing field → bump version
 */
export const STORAGE_VERSIONS = {
  auth:          1,
  journal:       1,
  allocations:   2,
  clientsConfig: 3,
  employees:     2,
  aiConfig:      1,
  notifications: 1,
} as const;

// ---------------------------------------------------------------------
// Dev-only reset helper
// ---------------------------------------------------------------------

/**
 * Clears all CPI persisted state. Exposed globally in dev as
 * `window.__cpiReset()` so testers can wipe state and see fresh
 * seed data without hunting through DevTools.
 *
 * Does NOT reload the page — you need to refresh manually. This
 * is intentional: forcing a reload would fight React HMR during
 * active development.
 */
export function resetAllPersistedState(): void {
  for (const key of Object.values(STORAGE_KEYS)) {
    clearPersisted(key);
  }
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.info(
      "[persistence] all keys cleared. Refresh the page to see seed data.",
    );
  }
}

// Install the dev-only global. Guard both the NODE_ENV and the
// window check so this is a no-op in prod bundles / SSR.
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  (window as unknown as { __cpiReset: () => void }).__cpiReset =
    resetAllPersistedState;
}
