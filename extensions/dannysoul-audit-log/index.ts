/**
 * DannySoul Audit Log Extension
 *
 * Append-only JSONL event log for all actions (intent, tool_call, gate, error).
 * Provides auditability, traceability, and replay capability.
 *
 * Unlike OpenClaw's ephemeral WebSocket events, this extension persists
 * events to disk with automatic rotation.
 *
 * Ported from DannySoul bot/soul/events.py
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { createEvent, formatEventLine } from "./event-schema.js";
import { JsonlWriter } from "./jsonl-writer.js";

type AuditLogConfig = {
  logDir: string;
  maxFileBytes: number;
};

function parseConfig(raw: unknown, resolvePath: (p: string) => string): AuditLogConfig {
  const cfg = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    logDir: resolvePath(String(cfg.logDir ?? "~/.openclaw/audit")),
    maxFileBytes: Number(cfg.maxFileBytes ?? 10 * 1024 * 1024),
  };
}

const auditLogPlugin = {
  id: "dannysoul-audit-log",
  name: "DannySoul Audit Log",
  description: "Append-only JSONL audit log for all actions",

  register(api: OpenClawPluginApi) {
    const config = parseConfig(api.pluginConfig, api.resolvePath);
    const writer = new JsonlWriter(config.logDir, config.maxFileBytes);

    api.logger.info(`dannysoul-audit-log: registered (dir: ${config.logDir})`);

    // ========================================================================
    // Tool: view recent events
    // ========================================================================

    api.registerTool(
      {
        name: "dannysoul_events",
        label: "Audit Events",
        description: "View recent audit events from the JSONL log.",
        parameters: Type.Object({
          count: Type.Optional(
            Type.Number({ description: "Number of recent events (default: 10)" }),
          ),
        }),
        async execute(_toolCallId, params) {
          const { count = 10 } = params as { count?: number };
          const events = writer.readTail(count);

          if (events.length === 0) {
            return {
              content: [{ type: "text", text: "No events recorded." }],
              details: { count: 0 },
            };
          }

          const text = events.map(formatEventLine).join("\n");
          return {
            content: [{ type: "text", text }],
            details: { count: events.length },
          };
        },
      },
      { name: "dannysoul_events" },
    );

    // ========================================================================
    // Command: /events (bypass LLM)
    // ========================================================================

    api.registerCommand({
      name: "events",
      description: "Show recent audit events",
      handler() {
        const events = writer.readTail(10);
        if (events.length === 0) {
          return { text: "No events recorded." };
        }
        return { text: events.map(formatEventLine).join("\n") };
      },
    });

    // ========================================================================
    // Lifecycle Hooks: emit events for key actions
    // ========================================================================

    // Before agent starts: record intent
    api.on("before_agent_start", async (event) => {
      if (!event.prompt) return;

      const meta = event as Record<string, unknown>;
      const sessionId = String(meta.sessionKey ?? meta.sessionId ?? "unknown");

      writer.append(
        createEvent({
          sessionId,
          actor: "user",
          kind: "intent",
          detail: event.prompt.slice(0, 200),
        }),
      );
    });

    // After tool call
    api.on("after_tool_call", async (event) => {
      const meta = event as Record<string, unknown>;
      const sessionId = String(meta.sessionKey ?? meta.sessionId ?? "unknown");
      const toolName = String(meta.toolName ?? meta.name ?? "");
      const durationMs = Number(meta.durationMs ?? 0);

      writer.append(
        createEvent({
          sessionId,
          actor: "bot",
          kind: "tool_result",
          tool: toolName,
          durationMs,
        }),
      );
    });

    // Agent end
    api.on("agent_end", async (event) => {
      const meta = event as Record<string, unknown>;
      const sessionId = String(meta.sessionKey ?? meta.sessionId ?? "unknown");
      const success = Boolean(meta.success ?? true);
      const durationMs = Number(meta.durationMs ?? 0);

      writer.append(
        createEvent({
          sessionId,
          actor: "bot",
          kind: success ? "info" : "error",
          detail: success ? "agent_end" : `agent_error: ${String(meta.error ?? "")}`,
          durationMs,
        }),
      );
    });

    // ========================================================================
    // CLI
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const audit = program
          .command("audit")
          .description("DannySoul audit log commands");

        audit
          .command("tail")
          .description("Show recent events")
          .option("-n <count>", "Number of events", "20")
          .action((opts) => {
            const events = writer.readTail(parseInt(opts.n));
            for (const event of events) {
              console.log(formatEventLine(event));
            }
          });
      },
      { commands: ["audit"] },
    );

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "dannysoul-audit-log",
      start: () => {
        api.logger.info(`dannysoul-audit-log: started (log: ${config.logDir})`);
      },
      stop: () => {
        api.logger.info("dannysoul-audit-log: stopped");
      },
    });
  },
};

export default auditLogPlugin;
