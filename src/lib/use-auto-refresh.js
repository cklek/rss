import { useEffect, useRef } from "react";

export function useAutoRefresh(
  refresh,
  { enabled = true, intervalMs = 60000, minFocusIntervalMs = 5000 } = {},
) {
  const refreshRef = useRef(refresh);
  const lastRunRef = useRef(0);
  const runningRef = useRef(false);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;
    async function run(reason) {
      if (runningRef.current || document.hidden) return;
      runningRef.current = true;
      lastRunRef.current = Date.now();
      try {
        await refreshRef.current?.({ reason });
      } catch {
      } finally {
        runningRef.current = false;
      }
    }
    const afterFocus = (reason) => () => {
      if (Date.now() - lastRunRef.current >= minFocusIntervalMs)
        void run(reason);
    };
    const timer =
      intervalMs > 0
        ? window.setInterval(() => void run("interval"), intervalMs)
        : null;
    const onFocus = afterFocus("focus");
    const onVisible = afterFocus("visibility");
    const onOnline = afterFocus("online");
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      if (timer) window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [enabled, intervalMs, minFocusIntervalMs]);
}
