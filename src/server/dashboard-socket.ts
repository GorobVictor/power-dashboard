import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { dashboardSessionExpired, dashboardSocketPath, type DashboardMessage, type DashboardRequest } from "../lib/dashboard-feed.ts";
import { addTelemetrySample, isTelemetryPeriod, telemetrySample, telemetryWindow, type TelemetrySample } from "../lib/telemetry-history.ts";
import { dashboardFeed } from "./dashboard-feed.ts";
import { dashboardAuthConfig, dashboardSessionExpiration, sessionCookieName } from "./dashboard-session.ts";
import { database } from "./db.ts";
import { createLogger, errorFields } from "./logger.ts";
import { isQueue, isScheduleDate } from "./outages/schedules.ts";
import { getOutageHistory } from "./outages/service.ts";
import { findTelemetryHistory } from "./stations/repository.ts";

const log = createLogger("dashboard.websocket");

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

function parseRequest(data: string): DashboardRequest | null {
  let request;
  try {
    request = JSON.parse(data);
  } catch {
    return null;
  }
  if (request?.type === "telemetry") {
    if (isTelemetryPeriod(request.period)) return { type: "telemetry", period: request.period };
    if (request.period === "dates" && isScheduleDate(request.from) && isScheduleDate(request.to) && request.from <= request.to) {
      return { type: "telemetry", period: "dates", from: request.from, to: request.to };
    }
  }
  if (request?.type === "outageHistory" && isScheduleDate(request.date) && (request.queue === null || isQueue(request.queue))) {
    return { type: "outageHistory", date: request.date, queue: request.queue };
  }
  return null;
}

type SocketClient = {
  alive: boolean;
  pending: Map<DashboardRequest["type"], DashboardRequest>;
  telemetrySamples?: TelemetrySample[];
};

async function loadHistory(request: DashboardRequest, client: SocketClient): Promise<DashboardMessage> {
  try {
    if (request.type === "telemetry") {
      const stationId = process.env.STATION_ID?.trim();
      const period = request.period === "dates" ? request : request.period;
      if (!stationId) return { ...request, value: { ...telemetryWindow(period), samples: [] } };
      const samples: TelemetrySample[] = [];
      client.telemetrySamples = samples;
      try {
        const history = await findTelemetryHistory(database(), stationId, period);
        const value = samples.reduce((result, sample) => addTelemetrySample(result, request.period, sample), history);
        return { ...request, value };
      } finally {
        delete client.telemetrySamples;
      }
    }
    const versions = await getOutageHistory(request.date, request.queue);
    return { ...request, value: versions.map((version) => ({ ...version, observedAt: version.observedAt.toISOString() })) };
  } catch (error) {
    log.error("Unable to load dashboard history", { requestType: request.type, ...errorFields(error) });
    return { ...request, value: null };
  }
}

export function attachDashboardSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const clients = new Map<WebSocket, SocketClient>();
  const shutdown = new AbortController();
  let snapshot: ReturnType<typeof dashboardFeed> | undefined;

  function send(ws: WebSocket, data: string) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 64 * 1024) ws.terminate();
    else ws.send(data);
  }

  function broadcast(message: DashboardMessage) {
    const data = JSON.stringify(message);
    const sample = message.type === "station" && message.value.kind === "station" && message.value.measurement
      ? telemetrySample(message.value.measurement) : null;
    for (const [ws, client] of clients) {
      if (sample) client.telemetrySamples?.push(sample);
      send(ws, data);
    }
  }

  async function sendHistory(ws: WebSocket, client: SocketClient, request: DashboardRequest) {
    const { type } = request;
    // Keep one query per kind in flight and coalesce rapid filter changes.
    const busy = client.pending.has(type);
    client.pending.set(type, request);
    if (busy) return;

    let next: DashboardRequest | undefined = request;
    while (next && ws.readyState === WebSocket.OPEN) {
      const message = await loadHistory(next, client);
      const latest = client.pending.get(type);
      if (latest === next) {
        client.pending.delete(type);
        send(ws, JSON.stringify(message));
        return;
      }
      next = latest;
    }
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
        ws.on("error", (error) => {
          log.warn("Dashboard WebSocket failed", errorFields(error));
          ws.terminate();
        });
        if (!expiresAt) {
          ws.close(dashboardSessionExpired);
          return;
        }
        const client: SocketClient = { alive: true, pending: new Map() };
        ws.on("message", (data, isBinary) => {
          const request = isBinary ? null : parseRequest(data.toString());
          if (!request) ws.close(1008);
          else void sendHistory(ws, client, request);
        });
        const expiry = setTimeout(() => ws.close(dashboardSessionExpired), expiresAt - Date.now());
        expiry.unref();
        ws.on("close", () => {
          clearTimeout(expiry);
          clients.delete(ws);
        });
        ws.on("pong", () => { client.alive = true; });
        clients.set(ws, client);
        snapshot ??= dashboardFeed(broadcast, shutdown.signal);
        snapshot((message) => send(ws, JSON.stringify(message)));
      });
    }).catch((error: Error) => {
      log.error("Unable to open dashboard WebSocket", errorFields(error));
      socket.destroy();
    });
  });

  const heartbeat = setInterval(() => {
    for (const [ws, client] of clients) {
      if (!client.alive) ws.terminate();
      else if (ws.readyState === WebSocket.OPEN) {
        client.alive = false;
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
