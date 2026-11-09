import { createServer } from "node:http";
import next from "next";
import { attachDashboardSocket } from "./dashboard-socket.ts";

const port = Number(process.env.PORT || 3000);
const hostname = "0.0.0.0";
const server = createServer();
const app = next({ dev: process.env.NODE_ENV !== "production", hostname, port, httpServer: server });

await app.prepare();
const handle = app.getRequestHandler();
server.on("request", (request, response) => {
  void handle(request, response).catch((error: Error) => {
    console.error("Unable to handle HTTP request", error.name);
    if (response.headersSent) response.destroy();
    else {
      response.statusCode = 500;
      response.end();
    }
  });
});
attachDashboardSocket(server);
server.listen(port, hostname, () => console.info(`Power Dashboard listening on port ${port}`));
