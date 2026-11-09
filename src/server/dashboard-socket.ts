import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { dashboardSessionExpired, dashboardSocketPath, type DashboardMessage } from "../lib/dashboard-feed.ts";
import { dashboardFeed } from "./dashboard-feed.ts";
import { dashboardAuthConfig, dashboardSessionExpiration, sessionCookieName } from "./dashboard-session.ts";

function sameOrigin({ headers }: IncomingMessage) {
  if (!headers.origin || !URL.canParse(headers.origin)) return false;
  const origin = new URL(headers.origin);
  return (origin.protocol === "https:" || origin.protocol === "http:") && origin.host === headers.host?.toLowerCase();
}

function sessionToken({ headers }: IncomingMessage) {
  const prefix = `${sessionCookieName}=`;
  const cookie = headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return cookie?.slice(prefix.length);
}

export function attachDashboardSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const clients = new Map<WebSocket, boolean>();
  const shutdown = new AbortController();
  let snapshot: ReturnType<typeof dashboardFeed> | undefined;

  function send(ws: WebSocket, data: string) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 64 * 1024) ws.terminate();
    else ws.send(data);
  }

  function broadcast(message: DashboardMessage) {
    const data = JSON.stringify(message);
    for (const ws of clients.keys()) send(ws, data);
  }

  server.on("upgrade", (request, socket, head) => {
    if (request.url !== dashboardSocketPath) return; // Next.js handles its own development socket.
    socket.on("error", () => socket.destroy());
    if (!sameOrigin(request)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }

    const config = dashboardAuthConfig();
    const expiration = config ? dashboardSessionExpiration(sessionToken(request), config.key) : Promise.resolve(null);
    void expiration.then((expiresAt) => {
      if (socket.destroyed || !socket.writable) return;
      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.on("error", () => ws.terminate());
        if (!expiresAt) {
          ws.close(dashboardSessionExpired);
          return;
        }
        ws.on("message", () => ws.close(1008));
        const expiry = setTimeout(() => ws.close(dashboardSessionExpired), expiresAt - Date.now());
        expiry.unref();
        ws.on("close", () => {
          clearTimeout(expiry);
          clients.delete(ws);
        });
        ws.on("pong", () => clients.set(ws, true));
        clients.set(ws, true);
        snapshot ??= dashboardFeed(broadcast, shutdown.signal);
        snapshot((message) => send(ws, JSON.stringify(message)));
      });
    }).catch((error: Error) => {
      console.error("Unable to open dashboard WebSocket", error.name);
      socket.destroy();
    });
  });

  const heartbeat = setInterval(() => {
    for (const [ws, alive] of clients) {
      if (!alive) ws.terminate();
      else if (ws.readyState === WebSocket.OPEN) {
        clients.set(ws, false);
        ws.ping();
      }
    }
  }, 30_000);
  heartbeat.unref();

  server.once("close", () => {
    shutdown.abort();
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  });
}
