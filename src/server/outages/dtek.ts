import { createLogger } from "../logger.ts";
import { kyivDate, type Schedule } from "./schedules.ts";

export class DtekError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DtekError";
  }
}

export function parseDtekFact(value: unknown): Schedule[] {
  if (!value || typeof value !== "object" || !("data" in value) || !value.data || typeof value.data !== "object" || Array.isArray(value.data)) throw new DtekError("Invalid DTEK schedule");
  const result: Schedule[] = [];
  const codes: Record<string, 0 | 1 | 2 | 3> = { yes: 0, no: 1, first: 2, second: 3 };
  for (const [timestamp, groups] of Object.entries(value.data)) {
    if (!/^\d{10}$/.test(timestamp) || !groups || typeof groups !== "object" || Array.isArray(groups)) throw new DtekError("Invalid DTEK date");
    const date = kyivDate(new Date(Number(timestamp) * 1000));
    for (const [name, hours] of Object.entries(groups)) {
      const match = /^GPV(\d+\.\d+)$/.exec(name);
      if (!match || !hours || typeof hours !== "object" || Array.isArray(hours)) throw new DtekError("Invalid DTEK group");
      const slots = hours as Record<string, unknown>;
      const parsed = Array.from({ length: 24 }, (_, i) => codes[String(slots[String(i + 1)])]);
      if (parsed.some((code) => code === undefined) || Object.keys(slots).length !== 24) throw new DtekError("Invalid DTEK hours");
      result.push({ queue: match[1], date, content: { status: "ScheduleApplies", hours: parsed, possible: [], publishedSchedule: null } });
    }
  }
  if (!result.length) throw new DtekError("Empty DTEK schedule");
  return result;
}

const log = createLogger("worker.outages.browser");

// Top-level let/const declarations are global bindings but not window properties.
const readPageScript = `
  const schedule = typeof DisconSchedule !== 'undefined' ? DisconSchedule : window.DisconSchedule;
  let fact = schedule?.fact ?? null;
  if (!fact) {
    for (const script of document.scripts) {
      const text = script.textContent || '';
      const match = /DisconSchedule\\.fact\\s*=\\s*/.exec(text);
      if (!match) continue;
      const start = match.index + match[0].length;
      if (text[start] !== '{') continue;
      let depth = 0, inString = false, escaped = false;
      for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (c === String.fromCharCode(92)) escaped = true;
          else if (c === '"') inString = false;
        } else if (c === '"') inString = true;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) {
          try { fact = JSON.parse(text.slice(start, i + 1)); } catch {}
          break;
        }
      }
      if (fact) break;
    }
  }
  return { fact, challenge: !!document.querySelector('iframe[src*=hcaptcha], iframe[title*=challenge]') || (document.body?.innerText ?? '').includes('Additional security check is required') };
`;

export class DtekBrowser {
  stage = "browser.session";
  private session: string | null = null;
  private awaitingChallenge = false;
  private readonly endpoint: string;
  constructor(endpoint: string) { this.endpoint = endpoint; }
  private async command(path: string, body?: object) {
    const response = await fetch(`${this.endpoint}${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45_000) });
    const data = await response.json();
    if (!response.ok || data.value?.error) {
      const code = typeof data.value?.error === "string" && /^[a-z ]+$/.test(data.value.error)
        ? data.value.error : `HTTP ${response.status}`;
      throw new DtekError(`WebDriver: ${code}`);
    }
    return data.value;
  }
  async poll() {
    if (!this.session) {
      this.stage = "browser.session";
      const session = await this.command("/session", { capabilities: { alwaysMatch: { browserName: "chrome" } } });
      this.session = session.sessionId;
      log.info("Selenium browser session created");
    }
    const base = `/session/${this.session}`;
    try {
      this.stage = "browser.navigate";
      if (!this.awaitingChallenge) await this.command(`${base}/url`, { url: "https://www.dtek-krem.com.ua/ua/shutdowns" });
      this.stage = "browser.read";
      const result = await this.command(`${base}/execute/sync`, { script: readPageScript, args: [] });
      if (!result.fact && result.challenge) {
        this.awaitingChallenge = true;
        return { challenge: true as const };
      }
      if (!result.fact) throw new DtekError("DTEK page does not contain DisconSchedule.fact");
      this.stage = "source.parse";
      const schedules = parseDtekFact(result.fact);
      this.awaitingChallenge = false;
      return { challenge: false as const, schedules };
    } catch (error) {
      if (error instanceof Error && /invalid session|no such window/i.test(error.message)) {
        this.session = null;
        log.warn("Selenium browser session ended; a new session will be created");
      }
      throw error;
    }
  }
}
