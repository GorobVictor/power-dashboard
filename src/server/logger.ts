type Level = "info" | "warn" | "error";
type Fields = Record<string, string | number | boolean | null | undefined>;

export function createLogger(component: string) {
  function write(level: Level, message: string, fields?: Fields) {
    const stream = level === "info" ? process.stdout : process.stderr;
    stream.write(JSON.stringify({ timestamp: new Date().toISOString(), level, component, message, ...fields }) + "\n");
  }

  return {
    info: (message: string, fields?: Fields) => write("info", message, fields),
    warn: (message: string, fields?: Fields) => write("warn", message, fields),
    error: (message: string, fields?: Fields) => write("error", message, fields),
  };
}

export function errorFields(error: unknown): Fields {
  if (!(error instanceof Error)) return { errorName: "UnknownError" };
  const code = "code" in error ? error.code : undefined;
  return { errorName: error.name, errorCode: typeof code === "string" ? code : undefined };
}

export function errorMessage(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length) {
    return error.errors.map(errorMessage).join(", ");
  }
  return error instanceof Error ? error.message || error.name : String(error);
}
