import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

type LiveAction = (value: string, key: string, signal: AbortSignal) => Promise<unknown>;

function send(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

export function localService(keyName: string, action: LiveAction): Plugin {
  async function handle(request: IncomingMessage, response: ServerResponse, next: () => void) {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/__demo/capabilities" && url.pathname !== "/__demo/live") return next();

    const host = request.headers.host ?? "";
    const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
    const localPeer = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? "");
    const key = localHost && localPeer ? process.env[keyName] : undefined;
    if (url.pathname === "/__demo/capabilities" && request.method === "GET") {
      return send(response, 200, { enabled: Boolean(key) });
    }

    if (url.pathname !== "/__demo/live" || request.method !== "POST") return send(response, 405, {});
    if (!key) return send(response, 403, {});
    if (request.headers["x-demo-action"] !== "1" || request.headers.origin !== `http://${host}`) {
      return send(response, 403, {});
    }

    const value = url.searchParams.get("value")?.trim();
    if (!value || value.length > 200) return send(response, 400, {});

    const controller = new AbortController();
    response.on("close", () => controller.abort());
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]);
    try {
      const result = await action(value, key, signal);
      if (!response.destroyed) send(response, 200, result);
    } catch {
      if (!response.destroyed) send(response, 502, {});
    }
  }

  return {
    name: "demo-local-service",
    configureServer(server) { server.middlewares.use(handle); },
    configurePreviewServer(server) { server.middlewares.use(handle); },
  };
}
