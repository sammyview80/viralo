import { useState, useEffect, useCallback, useRef } from "react";

interface CacheEntry<T> {
  data: T;
  at: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
const subscribers = new Map<string, Set<() => void>>();

function notify(key: string) {
  subscribers.get(key)?.forEach((cb) => cb());
}

function subscribe(key: string, cb: () => void) {
  if (!subscribers.has(key)) subscribers.set(key, new Set());
  subscribers.get(key)!.add(cb);
  return () => {
    subscribers.get(key)?.delete(cb);
    if (subscribers.get(key)?.size === 0) subscribers.delete(key);
  };
}

async function fetchAndCache<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  if (inflight.has(key)) return inflight.get(key) as Promise<T>;

  const promise = fetcher().then((data) => {
    cache.set(key, { data, at: Date.now() });
    inflight.delete(key);
    notify(key);
    return data;
  }).catch((err) => {
    inflight.delete(key);
    throw err;
  });

  inflight.set(key, promise);
  return promise;
}

export function invalidate(key: string) {
  cache.delete(key);
  notify(key);
}

export function invalidatePrefix(prefix: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) invalidate(key);
  }
}

export function clearQueryCache() {
  const keys = [...cache.keys()];
  cache.clear();
  inflight.clear();
  for (const key of keys) notify(key);
}

export function useQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: { ttl?: number; enabled?: boolean } = {},
): { data: T | null; loading: boolean; error: string | null; refetch: () => void } {
  const { ttl = 30_000, enabled = true } = options;
  const [, tick] = useState(0);
  const dataRef = useRef<T | null>(null);
  const errorRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    return subscribe(key, () => tick((n) => n + 1));
  }, [key]);

  useEffect(() => {
    if (!enabled) return;

    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < ttl) {
      dataRef.current = cached.data as T;
      return;
    }

    loadingRef.current = true;
    errorRef.current = null;
    tick((n) => n + 1);

    fetchAndCache(key, () => fetcherRef.current()).then((data) => {
      dataRef.current = data;
      loadingRef.current = false;
      errorRef.current = null;
    }).catch((err: unknown) => {
      loadingRef.current = false;
      errorRef.current = err instanceof Error ? err.message : String(err);
      tick((n) => n + 1);
    });
  }, [key, ttl, enabled]);

  // Seed from cache on first render
  if (dataRef.current === null) {
    const cached = cache.get(key);
    if (cached) dataRef.current = cached.data as T;
  }

  const refetch = useCallback(() => {
    cache.delete(key);
    loadingRef.current = true;
    errorRef.current = null;
    tick((n) => n + 1);
    fetchAndCache(key, () => fetcherRef.current()).then((data) => {
      dataRef.current = data;
      loadingRef.current = false;
    }).catch((err: unknown) => {
      loadingRef.current = false;
      errorRef.current = err instanceof Error ? err.message : String(err);
      tick((n) => n + 1);
    });
  }, [key]);

  return {
    data: dataRef.current,
    loading: loadingRef.current,
    error: errorRef.current,
    refetch,
  };
}
