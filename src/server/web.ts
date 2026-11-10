import { createServer } from "node:http";
import next from "next";
import { attachDashboardSocket } from "./dashboard-socket.ts";
import { createLogger, errorFields } from "./logger.ts";

const log = createLogger("web");
const port = Number(process.env.PORT || 3000);
const hostname = "0.0.0.0";
const server = createServer();
const app = next({ dev: process.env.NODE_ENV !== "production", hostname, port, httpServer: server });

async function start() {
  await app.prepare();
  const handle = app.getRequestHandler();
  server.on("request", (request, response) => {
    const startedAt = performance.now();
    const path = request.url?.startsWith("/") ? request.url.split("?", 1)[0] : undefined;
    const method = request.method;
    response.once("finish", () => {
      log.info("HTTP request completed", {
        method,
        path,
        statusCode: response.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      });
    });
    void handle(request, response).catch((error: unknown) => {
      log.error("Unable to handle HTTP request", { method, path, ...errorFields(error) });
      if (response.headersSent) response.destroy();
      else {
        response.statusCode = 500;
        response.end();
      }
    });
  });
  attachDashboardSocket(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, () => {
      server.off("error", reject);
      resolve();
    });
  });
  log.info("Power Dashboard listening", { port });
}

start().catch((error: unknown) => {
  log.error("Unable to start Power Dashboard", { port, ...errorFields(error) });
  process.exitCode = 1;
});
