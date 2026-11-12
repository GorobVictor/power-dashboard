type Level = "info" | "warn" | "error";
type Fields = Record<string, string | number | boolean | null | undefined>;

function formatValue(value: string | number | boolean | null) {
  return typeof value === "string" && /^[\w./:+-]+$/.test(value) ? value : JSON.stringify(value);
}

export function createLogger(component: string) {
  function write(level: Level, message: string, fields?: Fields) {
    const stream = level === "info" ? process.stdout : process.stderr;
    const timestamp = new Date().toISOString();
    if (process.env.LOG_FORMAT === "json") {
      stream.write(JSON.stringify({ timestamp, level, component, message, ...fields }) + "\n");
      return;
    }

    const details = Object.entries(fields ?? {}).flatMap(([key, value]) =>
      value === undefined ? [] : [`${key}=${formatValue(value)}`]);
    const headline = `${timestamp} ${level.toUpperCase().padEnd(5)} [${component}] ${JSON.stringify(message).slice(1, -1)}`;
    stream.write(`${[headline, ...details].join(" ")}\n`);
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
  const cause = error.cause;
  const causeCode = cause instanceof Error && "code" in cause ? cause.code : undefined;
  return {
    errorName: error.name,
    errorCode: typeof code === "string" ? code : undefined,
    causeCode: typeof causeCode === "string" ? causeCode : undefined,
  };
}

export function errorMessage(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length) {
    return error.errors.map(errorMessage).join(", ");
  }
  return error instanceof Error ? error.message || error.name : String(error);
}
