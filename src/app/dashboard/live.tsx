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

export function DashboardLive({ children }: { children: ReactNode }) {
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
  const activeSocket = useRef<WebSocket | null>(null);

  const request = useCallback((message: DashboardRequest) => {
    const socket = activeSocket.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  useEffect(() => {
    let socket: WebSocket;
    let reconnectTimer: number | undefined;
    let retryMs = 1_000;
    let disposed = false;
    const url = new URL(dashboardSocketPath, window.location.href);
    url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

    function connect() {
      activeSocket.current = socket = new WebSocket(url);
      socket.onmessage = ({ data }) => {
        if (disposed) return;
        const message: DashboardMessage = JSON.parse(data);
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
      };
      socket.onclose = ({ code }) => {
        if (disposed) return;
        activeSocket.current = null;
        if (code === dashboardSessionExpired) {
          window.location.replace("/login");
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
      activeSocket.current = null;
      window.clearTimeout(reconnectTimer);
      socket.close();
    };
  }, []);

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
