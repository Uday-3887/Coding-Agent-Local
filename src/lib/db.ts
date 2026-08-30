/**
 * Local persistence layer (IndexedDB) — mirrors the SQLite schema of the desktop
 * build: projects, chats, messages, tasks, agent_runs, tool_calls, file_changes,
 * checkpoints, settings, project_memory, test_runs.
 */
const DB_NAME = "localforge-ai";
const DB_VERSION = 1;

export const STORES = [
  "projects", "chats", "messages", "tasks", "agent_runs", "tool_calls",
  "file_changes", "checkpoints", "settings", "project_memory", "test_runs",
] as const;

export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;
const memoryFallback = new Map<string, Map<string, unknown>>();

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    try {
      if (typeof indexedDB === "undefined") throw new Error("no-idb");
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("idb-open-failed"));
    } catch (e) {
      reject(e);
    }
  });
  return dbPromise;
}

export async function dbPut(store: StoreName, value: { id: string } & Record<string, unknown>): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    if (!memoryFallback.has(store)) memoryFallback.set(store, new Map());
    memoryFallback.get(store)!.set(value.id, value);
  }
}

export async function dbGet<T>(store: StoreName, id: string): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T | undefined>((res, rej) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).get(id);
      req.onsuccess = () => res(req.result as T | undefined);
      req.onerror = () => rej(req.error);
    });
  } catch {
    return memoryFallback.get(store)?.get(id) as T | undefined;
  }
}

export async function dbGetAll<T>(store: StoreName): Promise<T[]> {
  try {
    const db = await open();
    return await new Promise<T[]>((res, rej) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => res((req.result as T[]) ?? []);
      req.onerror = () => rej(req.error);
    });
  } catch {
    return Array.from(memoryFallback.get(store)?.values() ?? []) as T[];
  }
}

export async function dbDel(store: StoreName, id: string): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(id);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    memoryFallback.get(store)?.delete(id);
  }
}

export async function dbClear(store: StoreName): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).clear();
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    memoryFallback.set(store, new Map());
  }
}

/** Convenience: one JSON blob per key inside the settings store. */
export async function kvGet<T>(key: string): Promise<T | undefined> {
  const row = await dbGet<{ id: string; value: T }>("settings", key);
  return row?.value;
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  await dbPut("settings", { id: key, value: value as unknown as Record<string, unknown> });
}
