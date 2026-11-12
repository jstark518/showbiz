import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  /** Replace the local copy without a round trip, after a successful write. */
  set: (value: T) => void;
}

/**
 * Minimal data hook. The panel is a handful of screens over a local server, so
 * this covers it without pulling in a caching library.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Guards against a slow earlier request landing after a newer one.
  const generationRef = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async () => {
    const generation = ++generationRef.current;
    setLoading(true);
    try {
      const result = await loaderRef.current();
      if (generation === generationRef.current) {
        setData(result);
        setError(null);
      }
    } catch (caught) {
      if (generation === generationRef.current) {
        setError(caught instanceof Error ? caught.message : 'Something went wrong');
      }
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload, set: setData };
}
