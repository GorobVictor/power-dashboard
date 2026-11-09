"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { dashboardSessionExpired, dashboardSocketPath, type DashboardMessage, type DashboardOutages, type DashboardStation } from "@/lib/dashboard-feed";
import { kyivDate } from "@/server/outages/schedules";

type Connection = "connecting" | "connected" | "disconnected";
type DashboardLiveState = {
  connection: Connection;
  station: DashboardStation | undefined;
  stationStale: boolean;
  outages: DashboardOutages | undefined;
  outagesStale: boolean;
  today: string;
  reconnect: () => void;
};

const DashboardContext = createContext<DashboardLiveState | null>(null);
const minuteMs = 60_000;

export function DashboardLive({ children }: { children: ReactNode }) {
  const [station, setStation] = useState<DashboardStation>();
  const [outages, setOutages] = useState<DashboardOutages>();
  const [connection, setConnection] = useState<Connection>("connecting");
  const [now, setNow] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let socket: WebSocket;
    let reconnectTimer: number | undefined;
    let retryMs = 1_000;
    let disposed = false;
    const url = new URL(dashboardSocketPath, window.location.href);
    url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

    function connect() {
      socket = new WebSocket(url);
      socket.onmessage = ({ data }) => {
        if (disposed) return;
        const message: DashboardMessage = JSON.parse(data);
        switch (message.type) {
          case "station": setStation(message.value); break;
          case "outages": setOutages(message.value); break;
          case "status":
            setConnection(message.connected ? "connected" : "disconnected");
            if (message.connected) retryMs = 1_000;
            break;
        }
        setNow(Date.now());
      };
      socket.onclose = ({ code }) => {
        if (disposed) return;
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
      window.clearTimeout(reconnectTimer);
      socket.close();
    };
  }, [attempt]);

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
      today: now ? kyivDate(new Date(now)) : "",
      reconnect: () => {
        setConnection("connecting");
        setAttempt((value) => value + 1);
      },
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
