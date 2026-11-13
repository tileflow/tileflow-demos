import { useEffect, useState } from "react";

export function useLiveService() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/__demo/capabilities", { signal: controller.signal })
      .then(async (response) => {
        if (response.ok && response.headers.get("content-type")?.includes("application/json")) {
          const status = await response.json();
          if (!controller.signal.aborted) setEnabled(status.enabled === true);
        }
      })
      .catch(() => { /* A static build uses the included data. */ });

    return () => controller.abort();
  }, []);

  return enabled;
}

export async function requestLive<T>(value: string, signal: AbortSignal): Promise<T> {
  const query = new URLSearchParams({ value });
  const response = await fetch(`/__demo/live?${query}`, {
    method: "POST",
    headers: { "X-Demo-Action": "1" },
    signal,
  });
  if (!response.ok) throw new Error("Live service unavailable.");

  return response.json();
}
