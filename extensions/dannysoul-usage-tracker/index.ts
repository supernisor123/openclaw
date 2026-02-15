/**
 * DannySoul Usage Tracker Extension
 *
 * Tracks token usage and cost estimation per model/operation/agent.
 * Monthly JSON ledger with automatic period reset.
 *
 * Ported from DannySoul bot/usage_ops.py
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { join } from "node:path";
import {
  currentPeriodKey,
  estimateUsd,
  formatUsageSummary,
  loadLedger,
  recordUsageEvent,
  type UsageStats,
} from "./ledger.js";

type UsageTrackerConfig = {
  ledgerDir: string;
  costsPerMillion: Record<string, number>;
  teamTokenPool: number;
  monthlyBudget: number;
  maxRecentEvents: number;
};

function parseConfig(raw: unknown, resolvePath: (p: string) => string): UsageTrackerConfig {
  const cfg = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const costsRaw = cfg.costsPerMillion;
  const costs: Record<string, number> = {};
  if (costsRaw && typeof costsRaw === "object") {
    for (const [k, v] of Object.entries(costsRaw as Record<string, unknown>)) {
      const num = Number(v);
      if (!isNaN(num) && num > 0) costs[k] = num;
    }
  }

  return {
    ledgerDir: resolvePath(String(cfg.ledgerDir ?? "~/.openclaw/usage")),
    costsPerMillion: costs,
    teamTokenPool: Number(cfg.teamTokenPool ?? 0),
    monthlyBudget: Number(cfg.monthlyBudget ?? 0),
    maxRecentEvents: Number(cfg.maxRecentEvents ?? 80),
  };
}

const usageTrackerPlugin = {
  id: "dannysoul-usage-tracker",
  name: "DannySoul Usage Tracker",
  description: "Token usage tracking and cost estimation",

  register(api: OpenClawPluginApi) {
    const config = parseConfig(api.pluginConfig, api.resolvePath);

    function ledgerPath(): string {
      const period = currentPeriodKey();
      return join(config.ledgerDir, `usage-${period}.json`);
    }

    api.logger.info(
      `dannysoul-usage-tracker: registered (dir: ${config.ledgerDir})`,
    );

    // ========================================================================
    // Tool: usage_summary
    // ========================================================================

    api.registerTool(
      {
        name: "dannysoul_usage_summary",
        label: "Usage Summary",
        description: "Show current month's token usage and cost summary.",
        parameters: Type.Object({}),
        async execute() {
          const period = currentPeriodKey();
          const ledger = loadLedger(ledgerPath(), period);
          const summary = formatUsageSummary(
            ledger,
            config.teamTokenPool,
            config.monthlyBudget,
          );
          return {
            content: [{ type: "text", text: summary }],
            details: { period, totals: ledger.totals },
          };
        },
      },
      { name: "dannysoul_usage_summary" },
    );

    // ========================================================================
    // Command: /usage (bypass LLM)
    // ========================================================================

    api.registerCommand({
      name: "usage",
      description: "Show token usage summary for the current month",
      handler() {
        const period = currentPeriodKey();
        const ledger = loadLedger(ledgerPath(), period);
        const summary = formatUsageSummary(
          ledger,
          config.teamTokenPool,
          config.monthlyBudget,
        );
        return { text: summary };
      },
    });

    // ========================================================================
    // Lifecycle Hook: record usage after agent run
    // ========================================================================

    api.on("agent_end", async (event) => {
      // Extract usage stats from event metadata
      const meta = event as Record<string, unknown>;
      const usage = meta.usage as Record<string, unknown> | undefined;
      if (!usage) return;

      const stats: UsageStats = {
        inputTokens: Number(usage.input_tokens ?? usage.prompt_tokens ?? 0),
        outputTokens: Number(usage.output_tokens ?? usage.completion_tokens ?? 0),
        totalTokens: Number(usage.total_tokens ?? 0),
      };
      if (stats.totalTokens <= 0) {
        stats.totalTokens = stats.inputTokens + stats.outputTokens;
      }
      if (stats.totalTokens <= 0) return;

      const model = String(meta.model ?? "unknown");
      const operation = String(meta.operation ?? "chat");
      const agentId = String(meta.agentId ?? "");

      try {
        recordUsageEvent(
          ledgerPath(),
          currentPeriodKey(),
          config.costsPerMillion,
          model,
          operation,
          agentId,
          stats,
          config.maxRecentEvents,
        );
      } catch (err) {
        api.logger.warn(`dannysoul-usage-tracker: record failed: ${String(err)}`);
      }
    });

    // ========================================================================
    // CLI
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const usage = program
          .command("usage")
          .description("DannySoul usage tracking commands");

        usage
          .command("summary")
          .description("Show current month usage summary")
          .action(() => {
            const period = currentPeriodKey();
            const ledger = loadLedger(ledgerPath(), period);
            console.log(
              formatUsageSummary(ledger, config.teamTokenPool, config.monthlyBudget),
            );
          });

        usage
          .command("period")
          .description("Show current period key")
          .action(() => {
            console.log(currentPeriodKey());
          });
      },
      { commands: ["usage"] },
    );
  },
};

export default usageTrackerPlugin;
