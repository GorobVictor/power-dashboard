import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { createLogger, errorFields } = await import("./server/logger.ts");
  const log = createLogger("next");
  const digest = typeof error === "object" && error !== null && "digest" in error ? error.digest : undefined;
  log.error("Next.js request failed", {
    method: request.method,
    route: context.routePath,
    routeType: context.routeType,
    digest: typeof digest === "string" ? digest : undefined,
    ...errorFields(error),
  });
};
