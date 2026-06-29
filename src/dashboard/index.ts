import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface RequestMetric {
  id: string;
  timestamp: number;
  model: string;
  stream: boolean;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  timeToFirstTokenMs: number;
  status: "success" | "error";
  error?: string;
  messageCount: number;
  contextCharCount: number;
}

export interface StatsSummary {
  totalRequests: number;
  totalTokens: number;
  avgLatencyMs: number;
  peakTokensPerSec: number;
  uptimeMs: number;
}

const DATA_DIR = join(homedir(), ".claude-nim");
const METRICS_FILE = join(DATA_DIR, "metrics.jsonl");
const RING_BUFFER_SIZE = 500;

const ringBuffer: RequestMetric[] = [];
const startTime = Date.now();

// ── Session counters ───────────────────────────────────────────────────────
let sessionRequestCount = 0;
let sessionTokenCount = 0;
let sessionStartTime = Date.now();

export function recordSessionRequest(): void {
  sessionRequestCount++;
}

const METRIC_COUNTER = { id: 0 };

export function recordMetric(
  metric: Omit<RequestMetric, "id" | "timestamp">,
): void {
  METRIC_COUNTER.id++;
  const entry: RequestMetric = {
    id: `m_${METRIC_COUNTER.id}`,
    timestamp: Date.now(),
    ...metric,
  };
  ringBuffer.push(entry);
  if (ringBuffer.length > RING_BUFFER_SIZE) {
    ringBuffer.shift();
  }
  try {
    ensureDir();
    appendFileSync(METRICS_FILE, JSON.stringify(entry) + "\n");
  } catch {
    // metrics logging is best-effort
  }
}

export function addSessionTokens(tokens: number): void {
  sessionTokenCount += tokens;
}
export function resetSessionStats(): void {
  sessionRequestCount = 0;
  sessionTokenCount = 0;
  sessionStartTime = Date.now();
}
export function getSessionStats(): {
  requests: number;
  tokens: number;
  uptimeMs: number;
} {
  return {
    requests: sessionRequestCount,
    tokens: sessionTokenCount,
    uptimeMs: Date.now() - sessionStartTime,
  };
}

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadMetricsFromFile(): void {
  try {
    if (!existsSync(METRICS_FILE)) return;
    const lines = readFileSync(METRICS_FILE, "utf8")
      .split("\n")
      .filter((l) => l.trim());
    const tail = lines.slice(-RING_BUFFER_SIZE);
    for (const line of tail) {
      try {
        ringBuffer.push(JSON.parse(line) as RequestMetric);
      } catch {}
    }
  } catch {}
}

export function initDashboard(): void {
  ensureDir();
  loadMetricsFromFile();
}

export function getMetricsHistory(): RequestMetric[] {
  return ringBuffer.slice(-200);
}

export function getMetricsSSEStream(): ReadableStream {
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(":ok\n\n"));
      const history = getMetricsHistory();
      for (const m of history) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(m)}\n\n`));
      }
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(":heartbeat\n\n"));
        } catch {
          if (heartbeat) clearInterval(heartbeat);
        }
      }, 15_000);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
    },
  });
}

export function getStats(): StatsSummary {
  const totalRequests = ringBuffer.length;
  const totalTokens = ringBuffer.reduce(
    (sum, m) => sum + m.inputTokens + m.outputTokens,
    0,
  );
  const avgLatencyMs =
    totalRequests > 0
      ? ringBuffer.reduce((sum, m) => sum + m.latencyMs, 0) / totalRequests
      : 0;
  let peakTokensPerSec = 0;
  for (const m of ringBuffer) {
    if (m.latencyMs > 0) {
      const tps = ((m.inputTokens + m.outputTokens) / m.latencyMs) * 1000;
      if (tps > peakTokensPerSec) peakTokensPerSec = tps;
    }
  }
  return {
    totalRequests,
    totalTokens,
    avgLatencyMs: Math.round(avgLatencyMs),
    peakTokensPerSec: Math.round(peakTokensPerSec),
    uptimeMs: Date.now() - startTime,
  };
}
