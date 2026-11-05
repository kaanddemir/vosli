import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

type Loaded<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T };

/**
 * Reads data for a screen. A reload keeps showing the current data until the new data
 * arrives, so saving something never flashes an empty screen or moves focus.
 */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]): { state: Loaded<T>; reload: () => Promise<void> } {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' });
  const latest = useRef(0);
  const loader = useRef(load);
  loader.current = load;

  const reload = useCallback(async () => {
    const run = ++latest.current;
    try {
      const data = await loader.current();
      if (run === latest.current) setState({ status: 'ready', data });
    } catch (error) {
      console.error(error);
      if (run === latest.current) setState({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => {
      latest.current++;
    };
  }, deps);

  return { state, reload };
}
