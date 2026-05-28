import {
  loadPersisted,
  savePersisted,
  clearPersisted,
  STORAGE_KEYS,
  STORAGE_VERSIONS,
} from './persistence';

export type StorageKey = keyof typeof STORAGE_KEYS;

export interface DataClient {
  read<T>(key: StorageKey): T | null;
  write<T>(key: StorageKey, value: T): void;
  remove(key: StorageKey): void;
}

const localStorageAdapter: DataClient = {
  read<T>(key: StorageKey): T | null {
    return (
      loadPersisted<T>(STORAGE_KEYS[key], STORAGE_VERSIONS[key]) ?? null
    );
  },
  write<T>(key: StorageKey, value: T): void {
    savePersisted(STORAGE_KEYS[key], STORAGE_VERSIONS[key], value);
  },
  remove(key: StorageKey): void {
    clearPersisted(STORAGE_KEYS[key]);
  },
};

export function getDataClient(): DataClient {
  return localStorageAdapter;
}
