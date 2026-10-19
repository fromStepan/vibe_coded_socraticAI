import { useCallback, useEffect, useState } from 'react';

export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(loader, deps);

  const reload = useCallback(() => {
    setLoading(true);
    return load()
      .then((d) => { setData(d); setError(null); })
      .catch((e: Error) => setError(e))
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(() => { reload(); }, [reload]);

  return { data, setData, error, loading, reload };
}
