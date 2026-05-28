/**
 * Public entry point for the data layer.
 *
 *   import { getDataClient } from '@/lib/dataClient';
 *   const client = getDataClient();
 *   const stored = client.read<AppUser>('auth');
 *
 * Adapter selection is currently hard-coded to localStorage. Phase 4
 * will switch this to choose `httpAdapter` when the `VITE_USE_API`
 * env flag is set (one feature-flagged flip, no context changes).
 */

import { localStorageAdapter } from './localStorageAdapter';
import type { DataClient } from './types';

export type { DataClient, ResourceKey } from './types';

let cached: DataClient | undefined;

/**
 * Returns the active DataClient singleton. Memoized so consumers
 * can call it inside lazy useState initializers without rebuilding
 * the adapter on each render.
 */
export function getDataClient(): DataClient {
  if (!cached) cached = localStorageAdapter;
  return cached;
}

/**
 * Test-only seam: swap in a fake adapter for unit tests. Throws in
 * production builds so a misuse can't ship by accident.
 */
export function __setDataClientForTests(client: DataClient): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('__setDataClientForTests is not callable in production');
  }
  cached = client;
}
