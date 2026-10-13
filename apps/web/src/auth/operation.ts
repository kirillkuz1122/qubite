import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./api";
export function useOperation() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const current = useRef<AbortController | null>(null),
    latest = useRef(0);
  useEffect(
    () => () => {
      ++latest.current;
      current.current?.abort();
    },
    [],
  );
  const run = useCallback(
    async (action: (signal: AbortSignal) => Promise<void>) => {
      if (current.current) return;
      const controller = new AbortController(),
        generation = ++latest.current;
      current.current = controller;
      setBusy(true);
      setError("");
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        await action(controller.signal);
      } catch (e) {
        if (latest.current === generation) setError(errorMessage(e));
      } finally {
        clearTimeout(timeout);
        if (latest.current === generation) {
          current.current = null;
          setBusy(false);
        }
      }
    },
    [],
  );
  return { busy, error, setError, run };
}
