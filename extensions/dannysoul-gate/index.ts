/**
 * DannySoul Gate Extension
 *
 * Approval gate for dangerous/irreversible actions.
 * - Reversible actions: auto-run with audit trail
 * - Irreversible actions: require Telegram /approve before execution
 * - TTL-based expiry for pending gates
 *
 * Ported from DannySoul bot/app.py approval gate logic.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import {
  type ApprovalMode,
  PendingStore,
  classifyAction,
  requiresApproval,
} from "./gate-policy.js";

type GateConfig = {
  approvalMode: ApprovalMode;
  ttlSeconds: number;
  maxSteps: number;
  stepTimeout: number;
  includeScreenshot: boolean;
};

function parseConfig(raw: unknown): GateConfig {
  const cfg = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const mode = String(cfg.approvalMode ?? "dangerous");
  return {
    approvalMode: (["always", "dangerous", "never"].includes(mode)
      ? mode
      : "dangerous") as ApprovalMode,
    ttlSeconds: Number(cfg.ttlSeconds ?? 180),
    maxSteps: Number(cfg.maxSteps ?? 12),
    stepTimeout: Number(cfg.stepTimeout ?? 45),
    includeScreenshot: Boolean(cfg.includeScreenshot ?? false),
  };
}

const gatePlugin = {
  id: "dannysoul-gate",
  name: "DannySoul Gate",
  description: "Approval gate for dangerous/irreversible actions",

  register(api: OpenClawPluginApi) {
    const config = parseConfig(api.pluginConfig);
    const pendingStore = new PendingStore();
    const ttlMs = config.ttlSeconds * 1000;

    api.logger.info(
      `dannysoul-gate: registered (mode: ${config.approvalMode}, ttl: ${config.ttlSeconds}s)`,
    );

    // ========================================================================
    // Tool: gate_check — check if an action requires approval
    // ========================================================================

    api.registerTool(
      {
        name: "dannysoul_gate_check",
        label: "Gate Check",
        description:
          "Check if an action requires approval before execution. Returns 'approved' (auto-run) or 'pending' (needs /approve).",
        parameters: Type.Object({
          action: Type.String({ description: "Action name (e.g., git_push, type, click)" }),
          detail: Type.Optional(Type.String({ description: "Human-readable description" })),
          payload: Type.Optional(Type.Unknown({ description: "Action payload to execute on approval" })),
        }),
        async execute(_toolCallId, params) {
          const { action, detail = "", payload } = params as {
            action: string;
            detail?: string;
            payload?: unknown;
          };

          const classification = classifyAction(action);
          const needsApproval = requiresApproval(action, config.approvalMode);

          if (!needsApproval) {
            return {
              content: [
                {
                  type: "text",
                  text: `Action "${action}" auto-approved (${classification}).`,
                },
              ],
              details: { status: "approved", action, classification },
            };
          }

          // Create pending gate — needs /approve
          const gate = pendingStore.create({
            sessionId: "current", // Will be resolved by session context
            gateType: "tool_call",
            action,
            detail: detail || action,
            payload,
            ttlMs,
          });

          return {
            content: [
              {
                type: "text",
                text: `Action "${action}" requires approval.\nGate ID: ${gate.id}\nDetail: ${detail}\nExpires in ${config.ttlSeconds}s.\nUse /approve to proceed or /deny to cancel.`,
              },
            ],
            details: { status: "pending", gateId: gate.id, action, classification },
          };
        },
      },
      { name: "dannysoul_gate_check" },
    );

    // ========================================================================
    // Commands: /approve, /deny, /gates
    // ========================================================================

    api.registerCommand({
      name: "approve",
      description: "Approve the pending gate for this session",
      handler(ctx) {
        const sessionId = String(
          (ctx as Record<string, unknown>).sessionKey ??
            (ctx as Record<string, unknown>).sessionId ??
            "current",
        );
        const gate = pendingStore.approve(sessionId);

        if (!gate) {
          return { text: "No pending gate to approve." };
        }

        return {
          text: `Approved: ${gate.action} — ${gate.detail}\nGate ${gate.id} executed.`,
        };
      },
    });

    api.registerCommand({
      name: "deny",
      description: "Deny/cancel the pending gate for this session",
      handler(ctx) {
        const sessionId = String(
          (ctx as Record<string, unknown>).sessionKey ??
            (ctx as Record<string, unknown>).sessionId ??
            "current",
        );
        const gate = pendingStore.deny(sessionId);

        if (!gate) {
          return { text: "No pending gate to deny." };
        }

        return { text: `Denied: ${gate.action} — ${gate.detail}\nGate ${gate.id} cancelled.` };
      },
    });

    api.registerCommand({
      name: "gates",
      description: "List all pending approval gates",
      handler() {
        const pending = pendingStore.listPending();
        if (pending.length === 0) {
          return { text: "No pending gates." };
        }

        const lines = pending.map((g) => {
          const ageMs = Date.now() - g.createdAt;
          const ageSec = Math.floor(ageMs / 1000);
          const remainingSec = Math.max(0, Math.floor((g.ttlMs - ageMs) / 1000));
          return `- [${g.id.slice(0, 12)}] ${g.action}: ${g.detail} (${ageSec}s ago, expires in ${remainingSec}s)`;
        });

        return { text: `Pending gates (${pending.length}):\n${lines.join("\n")}` };
      },
    });

    // ========================================================================
    // Lifecycle Hook: intercept dangerous tool calls
    // ========================================================================

    api.on("before_tool_call", async (event) => {
      const meta = event as Record<string, unknown>;
      const toolName = String(meta.toolName ?? meta.name ?? "");

      if (requiresApproval(toolName, config.approvalMode)) {
        api.logger.info?.(`dannysoul-gate: tool "${toolName}" requires approval`);
        // Note: actual blocking depends on OpenClaw's tool policy integration
      }
    });

    // ========================================================================
    // CLI
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const gate = program
          .command("gate")
          .description("DannySoul gate management");

        gate
          .command("status")
          .description("Show gate configuration and pending gates")
          .action(() => {
            console.log(`Mode: ${config.approvalMode}`);
            console.log(`TTL: ${config.ttlSeconds}s`);
            console.log(`Max steps: ${config.maxSteps}`);
            const pending = pendingStore.listPending();
            console.log(`Pending: ${pending.length}`);
          });
      },
      { commands: ["gate"] },
    );
  },
};

export default gatePlugin;
