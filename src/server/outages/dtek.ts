import { kyivDate, type Schedule } from "./schedules.ts";

export function parseDtekFact(value: unknown): Schedule[] {
  if (!value || typeof value !== "object" || !("data" in value) || !value.data || typeof value.data !== "object" || Array.isArray(value.data)) throw new Error("Invalid DTEK schedule");
  const result: Schedule[] = [];
  const codes: Record<string, 0 | 1 | 2 | 3> = { yes: 0, no: 1, first: 2, second: 3 };
  for (const [timestamp, groups] of Object.entries(value.data)) {
    if (!/^\d{10}$/.test(timestamp) || !groups || typeof groups !== "object" || Array.isArray(groups)) throw new Error("Invalid DTEK date");
    const date = kyivDate(new Date(Number(timestamp) * 1000));
    for (const [name, hours] of Object.entries(groups)) {
      const match = /^GPV(\d+\.\d+)$/.exec(name);
      if (!match || !hours || typeof hours !== "object" || Array.isArray(hours)) throw new Error("Invalid DTEK group");
      const slots = hours as Record<string, unknown>;
      const parsed = Array.from({ length: 24 }, (_, i) => codes[String(slots[String(i + 1)])]);
      if (parsed.some((code) => code === undefined) || Object.keys(slots).length !== 24) throw new Error("Invalid DTEK hours");
      result.push({ queue: match[1], date, content: { status: "ScheduleApplies", hours: parsed, possible: [], publishedSchedule: null } });
    }
  }
  if (!result.length) throw new Error("Empty DTEK schedule");
  return result;
}

export class DtekBrowser {
  private session: string | null = null;
  private awaitingChallenge = false;
  private readonly endpoint: string;
  constructor(endpoint: string) { this.endpoint = endpoint; }
  private async command(path: string, body?: object) {
    const response = await fetch(`${this.endpoint}${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45_000) });
    const data = await response.json();
    if (!response.ok || data.value?.error) throw new Error(`WebDriver: ${data.value?.message ?? response.status}`);
    return data.value;
  }
  async poll() {
    if (!this.session) {
      const session = await this.command("/session", { capabilities: { alwaysMatch: { browserName: "chrome" } } });
      this.session = session.sessionId;
    }
    const base = `/session/${this.session}`;
    try {
      if (!this.awaitingChallenge) await this.command(`${base}/url`, { url: "https://www.dtek-krem.com.ua/ua/shutdowns" });
      const result = await this.command(`${base}/execute/sync`, { script: "return {fact: window.DisconSchedule?.fact ?? null, challenge: !!document.querySelector('iframe[src*=hcaptcha], iframe[title*=challenge]') || document.body.innerText.includes('Additional security check is required')};", args: [] });
      if (!result.fact && result.challenge) {
        this.awaitingChallenge = true;
        return { challenge: true as const };
      }
      const schedules = parseDtekFact(result.fact);
      this.awaitingChallenge = false;
      return { challenge: false as const, schedules };
    } catch (error) {
      if (error instanceof Error && /invalid session|no such window/i.test(error.message)) this.session = null;
      throw error;
    }
  }
}
