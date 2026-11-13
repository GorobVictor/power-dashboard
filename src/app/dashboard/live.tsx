"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { dashboardSessionExpired, dashboardSocketPath, type DashboardMessage, type DashboardOutages, type DashboardRequest, type DashboardStation } from "@/lib/dashboard-feed";
import { addTelemetrySample, telemetrySample } from "@/lib/telemetry-history";
import { kyivDate } from "@/server/outages/schedules";

type Connection = "connecting" | "connected" | "disconnected";
type DashboardLiveState = {
  connection: Connection;
  station: DashboardStation | undefined;
  stationStale: boolean;
  outages: DashboardOutages | undefined;
  outagesStale: boolean;
  today: string;
  now: number;
  historySupported: boolean;
  revision: number;
  schedulesRevision: number;
  telemetry: Extract<DashboardMessage, { type: "telemetry" }> | undefined;
  chargeHistory: Extract<DashboardMessage, { type: "chargeHistory" }> | undefined;
  outageHistory: Extract<DashboardMessage, { type: "outageHistory" }> | undefined;
  request: (request: DashboardRequest) => void;
};

const DashboardContext = createContext<DashboardLiveState | null>(null);
const minuteMs = 60_000;

export function DashboardLive({ children, mock }: { children: ReactNode; mock: boolean }) {
  const [station, setStation] = useState<DashboardStation>();
  const [outages, setOutages] = useState<DashboardOutages>();
  const [telemetry, setTelemetry] = useState<DashboardLiveState["telemetry"]>();
  const [chargeHistory, setChargeHistory] = useState<DashboardLiveState["chargeHistory"]>();
  const [outageHistory, setOutageHistory] = useState<DashboardLiveState["outageHistory"]>();
  const [connection, setConnection] = useState<Connection>("connecting");
  const [historySupported, setHistorySupported] = useState(false);
  const [now, setNow] = useState(0);
  const [revision, setRevision] = useState(0);
  const [schedulesRevision, setSchedulesRevision] = useState(0);
  const sendRequest = useRef<(message: DashboardRequest) => void>(null);

  const request = useCallback((message: DashboardRequest) => {
    sendRequest.current?.(message);
  }, []);

  useEffect(() => {
    let disposed = false;
    let retryMs = 1_000;

    function receive(message: DashboardMessage) {
      switch (message.type) {
        case "station": {
          setStation(message.value);
          if (message.value.kind === "station" && message.value.measurement) {
            const sample = telemetrySample(message.value.measurement);
            setTelemetry((history) => {
              if (!history?.value) return history;
              const value = addTelemetrySample(history.value, history.period, sample);
              return value === history.value ? history : { ...history, value };
            });
            setChargeHistory((history) => {
              if (!history?.value) return history;
              const value = addTelemetrySample(history.value, "dates", sample);
              return value === history.value ? history : { ...history, value };
            });
          }
          break;
        }
        case "outages":
          setOutages(message.value);
          if (message.schedulesChanged) setSchedulesRevision((value) => value + 1);
          break;
        case "telemetry": setTelemetry(message); break;
        case "chargeHistory": setChargeHistory(message); break;
        case "outageHistory": setOutageHistory(message); break;
        case "status":
          setConnection(message.connected ? "connected" : "disconnected");
          setHistorySupported(message.history === true);
          if (message.connected) {
            retryMs = 1_000;
            setRevision((value) => value + 1);
          }
          break;
      }
      setNow(Date.now());
    }

    if (mock) {
      let timer: number | undefined;
      void import("./mock-feed").then(({ mockStation, mockOutages, mockHistory }) => {
        if (disposed) return;
        let previousDate = "";
        const publish = () => {
          const now = Date.now();
          const today = kyivDate(new Date(now));
          receive(mockStation(now));
          receive(mockOutages(now, today, today !== previousDate));
          previousDate = today;
        };
        sendRequest.current = (message) => receive(mockHistory(message, Date.now()));
        publish();
        receive({ type: "status", connected: true, history: true });
        timer = window.setInterval(publish, 30_000);
      });
      return () => {
        disposed = true;
        sendRequest.current = null;
        window.clearInterval(timer);
      };
    }

    let socket: WebSocket;
    let reconnectTimer: number | undefined;
    let refreshRetryTimer: number | undefined;
    let refreshing: Promise<"ok" | "unauthorized" | "retry"> | undefined;
    const url = new URL(dashboardSocketPath, window.location.href);
    url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

    function refresh() {
      refreshing ??= fetch("/api/session/refresh", { method: "POST", cache: "no-store" })
        .then((response) => response.ok ? "ok" as const : response.status === 401 ? "unauthorized" as const : "retry" as const)
        .catch(() => "retry" as const)
        .finally(() => { refreshing = undefined; });
      return refreshing;
    }

    async function maintainSession() {
      if (disposed || document.visibilityState !== "visible") return;
      const result = await refresh();
      if (disposed) return;
      if (result === "unauthorized") {
        window.location.replace("/login");
        return;
      }
      if (result === "retry") {
        window.clearTimeout(refreshRetryTimer);
        refreshRetryTimer = window.setTimeout(() => void maintainSession(), 30_000);
      } else {
        window.clearTimeout(refreshRetryTimer);
        if (socket.readyState === WebSocket.CLOSED) connect();
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") void maintainSession();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    const refreshTimer = window.setInterval(() => void maintainSession(), 60 * 60 * 1_000);

    function connect() {
      window.clearTimeout(reconnectTimer);
      socket = new WebSocket(url);
      sendRequest.current = (message) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
      };
      socket.onmessage = ({ data }) => {
        if (!disposed) receive(JSON.parse(data));
      };
      socket.onclose = ({ code }) => {
        if (disposed) return;
        sendRequest.current = null;
        if (code === dashboardSessionExpired) {
          setConnection("disconnected");
          void maintainSession();
          return;
        }
        setConnection("disconnected");
        setNow(Date.now());
        reconnectTimer = window.setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 30_000);
      };
    }

    connect();
    return () => {
      disposed = true;
      sendRequest.current = null;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(refreshTimer);
      window.clearTimeout(refreshRetryTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      socket.close();
    };
  }, [mock]);

  const stationExpires = station?.kind === "station" && station.measurement
    ? Date.parse(station.measurement.measuredAt) + station.staleAfterMs : Infinity;
  const outagesExpire = outages?.lastSuccessfulPollAt
    ? Date.parse(outages.lastSuccessfulPollAt) + outages.staleAfterMs : Infinity;

  useEffect(() => {
    if (!now) return;
    const nextMinute = now - now % minuteMs + minuteMs;
    const next = Math.min(nextMinute, stationExpires > now ? stationExpires : Infinity, outagesExpire > now ? outagesExpire : Infinity);
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()));
    return () => window.clearTimeout(timer);
  }, [now, stationExpires, outagesExpire]);

  return (
    <DashboardContext.Provider value={{
      connection, station, stationStale: now >= stationExpires, outages, outagesStale: now >= outagesExpire,
      today: now ? kyivDate(new Date(now)) : "", now,
      historySupported, revision, schedulesRevision, telemetry, chargeHistory, outageHistory, request,
    }}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboardLive() {
  const dashboard = useContext(DashboardContext);
  if (!dashboard) throw new Error("Dashboard live provider is missing");
  return dashboard;
}
