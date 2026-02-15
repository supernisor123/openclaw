/**
 * Usage ledger: monthly JSON file tracking token usage by model/operation/agent.
 *
 * Ported from DannySoul bot/usage_ops.py
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UsageStats = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type UsageBucket = {
  requests: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_usd: number;
};

export type UsageEvent = {
  ts: string;
  model: string;
  operation: string;
  agent_id: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_usd: number;
};

export type UsageLedger = {
  version: number;
  period: string;
  updated_at: string;
  totals: UsageBucket;
  by_model: Record<string, UsageBucket>;
  by_operation: Record<string, UsageBucket>;
  by_agent: Record<string, UsageBucket>;
  recent_events: UsageEvent[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

export function currentPeriodKey(now?: Date): string {
  const dt = now ?? new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function emptyBucket(): UsageBucket {
  return {
    requests: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    estimated_usd: 0,
  };
}

function emptyLedger(period: string): UsageLedger {
  return {
    version: 1,
    period,
    updated_at: nowIso(),
    totals: emptyBucket(),
    by_model: {},
    by_operation: {},
    by_agent: {},
    recent_events: [],
  };
}

function incBucket(bucket: UsageBucket, stats: UsageStats, usd: number): void {
  bucket.requests += 1;
  bucket.input_tokens += stats.inputTokens;
  bucket.output_tokens += stats.outputTokens;
  bucket.total_tokens += stats.totalTokens;
  bucket.estimated_usd += usd;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function loadLedger(filePath: string, period: string): UsageLedger {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as UsageLedger;
    if (data && typeof data === "object" && data.period === period) {
      return data;
    }
  } catch {
    // File missing or invalid — start fresh
  }
  return emptyLedger(period);
}

export function saveLedger(filePath: string, ledger: UsageLedger): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = filePath + ".tmp";
  writeFileSync(tmp, JSON.stringify(ledger, null, 2), "utf-8");
  renameSync(tmp, filePath);
}

export function estimateUsd(
  costsPerMillion: Record<string, number>,
  model: string,
  totalTokens: number,
): number {
  const cost = costsPerMillion[model] ?? 0;
  if (cost <= 0) return 0;
  return (totalTokens / 1_000_000) * cost;
}

export function recordUsageEvent(
  filePath: string,
  period: string,
  costsPerMillion: Record<string, number>,
  model: string,
  operation: string,
  agentId: string,
  stats: UsageStats,
  maxRecent: number = 80,
): void {
  const ledger = loadLedger(filePath, period);
  const usd = estimateUsd(costsPerMillion, model, stats.totalTokens);

  ledger.updated_at = nowIso();

  // Totals
  incBucket(ledger.totals, stats, usd);

  // By model
  if (!ledger.by_model[model]) ledger.by_model[model] = emptyBucket();
  incBucket(ledger.by_model[model], stats, usd);

  // By operation
  const op = operation || "<unknown>";
  if (!ledger.by_operation[op]) ledger.by_operation[op] = emptyBucket();
  incBucket(ledger.by_operation[op], stats, usd);

  // By agent
  const agent = agentId || "<none>";
  if (!ledger.by_agent[agent]) ledger.by_agent[agent] = emptyBucket();
  incBucket(ledger.by_agent[agent], stats, usd);

  // Recent events
  ledger.recent_events.push({
    ts: nowIso(),
    model,
    operation: op,
    agent_id: agent,
    input_tokens: stats.inputTokens,
    output_tokens: stats.outputTokens,
    total_tokens: stats.totalTokens,
    estimated_usd: usd,
  });
  if (ledger.recent_events.length > maxRecent) {
    ledger.recent_events = ledger.recent_events.slice(-maxRecent);
  }

  saveLedger(filePath, ledger);
}

export function formatUsageSummary(
  ledger: UsageLedger,
  teamTokenPool: number,
  monthlyBudget: number,
): string {
  const t = ledger.totals;
  const lines: string[] = [];

  lines.push(`Usage period: ${ledger.period} (monthly reset)`);
  lines.push(`- requests: ${t.requests}`);
  lines.push(`- tokens: ${t.total_tokens} (in=${t.input_tokens}, out=${t.output_tokens})`);
  if (t.estimated_usd > 0) {
    lines.push(`- est usd: ${t.estimated_usd.toFixed(6)}`);
  }

  if (teamTokenPool > 0) {
    const remaining = Math.max(0, teamTokenPool - t.total_tokens);
    lines.push(`Team token pool: ${teamTokenPool} (remaining ${remaining})`);
  }
  if (monthlyBudget > 0) {
    const remaining = Math.max(0, monthlyBudget - t.estimated_usd);
    lines.push(`Team monthly budget: $${monthlyBudget.toFixed(2)} (remaining $${remaining.toFixed(6)})`);
  }

  // By model
  const models = Object.entries(ledger.by_model).sort(
    (a, b) => b[1].total_tokens - a[1].total_tokens,
  );
  if (models.length > 0) {
    lines.push("\nBy model:");
    for (const [model, info] of models) {
      const usdPart = info.estimated_usd > 0 ? ` | est $${info.estimated_usd.toFixed(6)}` : "";
      lines.push(
        `- ${model}: req=${info.requests}, tokens=${info.total_tokens} (in=${info.input_tokens}, out=${info.output_tokens})${usdPart}`,
      );
    }
  }

  // By operation
  const ops = Object.entries(ledger.by_operation).sort(
    (a, b) => b[1].total_tokens - a[1].total_tokens,
  );
  if (ops.length > 0) {
    lines.push("\nBy operation:");
    for (const [op, info] of ops) {
      lines.push(`- ${op}: req=${info.requests}, tokens=${info.total_tokens}`);
    }
  }

  return lines.join("\n");
}
