/**
 * DannySoul Claude Code Extension
 *
 * Telegram-controlled Claude Code CLI integration.
 * Replaces the old Codex Workflow with direct Claude Code CLI management.
 *
 * Commands:
 *   /claude <workdir> <prompt>       → Start new session
 *   /claude --model opus <prompt>    → Start with specific model
 *   /claude --resume [session_id]    → Resume session
 *   /claude status                   → List active sessions
 *   /claude stop [session_id]        → Stop session
 *   /claude approve                  → Approve pending permission
 *   /claude deny                     → Deny pending permission
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { SessionManager } from "./session-manager.js";
import { OutputStreamer, type OutputMessage } from "./output-streamer.js";
import type { ClaudeSession, ClaudeStreamEvent } from "./claude-runner.js";

type ClaudeCodeConfig = {
  defaultWorkdir: string;
  defaultModel: string;
  maxConcurrentSessions: number;
  outputBatchIntervalMs: number;
  maxOutputCharsPerMessage: number;
  allowedTools: string[];
  autoApprovePatterns: string[];
};

function parseConfig(raw: unknown, resolvePath: (p: string) => string): ClaudeCodeConfig {
  const cfg = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    defaultWorkdir: resolvePath(
      String(cfg.defaultWorkdir ?? "~/Documents/antigravity/DannySoul"),
    ),
    defaultModel: String(cfg.defaultModel ?? "sonnet"),
    maxConcurrentSessions: Number(cfg.maxConcurrentSessions ?? 3),
    outputBatchIntervalMs: Number(cfg.outputBatchIntervalMs ?? 2000),
    maxOutputCharsPerMessage: Number(cfg.maxOutputCharsPerMessage ?? 3000),
    allowedTools: Array.isArray(cfg.allowedTools)
      ? (cfg.allowedTools as string[])
      : ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    autoApprovePatterns: Array.isArray(cfg.autoApprovePatterns)
      ? (cfg.autoApprovePatterns as string[])
      : ["Read", "Glob", "Grep"],
  };
}

/**
 * Parse /claude command arguments.
 */
function parseClaudeCommand(args: string): {
  subcommand: string;
  workdir?: string;
  model?: string;
  prompt?: string;
  sessionId?: string;
} {
  const trimmed = args.trim();

  // /claude status
  if (trimmed === "status") return { subcommand: "status" };

  // /claude stop [sessionId]
  if (trimmed.startsWith("stop")) {
    const sessionId = trimmed.slice(4).trim() || undefined;
    return { subcommand: "stop", sessionId };
  }

  // /claude approve / deny
  if (trimmed === "approve") return { subcommand: "approve" };
  if (trimmed === "deny") return { subcommand: "deny" };

  // /claude --resume [sessionId]
  if (trimmed.startsWith("--resume")) {
    const sessionId = trimmed.slice(8).trim() || undefined;
    return { subcommand: "resume", sessionId };
  }

  // /claude [--model <model>] [workdir] <prompt>
  let model: string | undefined;
  let remaining = trimmed;

  // Extract --model flag
  const modelMatch = remaining.match(/--model\s+(\S+)/);
  if (modelMatch) {
    model = modelMatch[1];
    remaining = remaining.replace(modelMatch[0], "").trim();
  }

  // First word could be a workdir (if it looks like a path)
  let workdir: string | undefined;
  const parts = remaining.split(/\s+/);
  if (parts[0] && (parts[0].includes("/") || parts[0].includes("~"))) {
    workdir = parts.shift();
    remaining = parts.join(" ");
  }

  return { subcommand: "start", workdir, model, prompt: remaining || undefined };
}

const claudeCodePlugin = {
  id: "dannysoul-claude-code",
  name: "DannySoul Claude Code",
  description: "Telegram-controlled Claude Code CLI integration",

  register(api: OpenClawPluginApi) {
    const config = parseConfig(api.pluginConfig, api.resolvePath);
    const sessionMgr = new SessionManager(config.maxConcurrentSessions);
    // Per-session output streamers
    const streamers: Map<string, OutputStreamer> = new Map();

    api.logger.info(
      `dannysoul-claude-code: registered (workdir: ${config.defaultWorkdir}, max: ${config.maxConcurrentSessions})`,
    );

    // ========================================================================
    // Helper: send message via channel
    // ========================================================================

    function formatSessionInfo(session: ClaudeSession): string {
      const age = Math.floor((Date.now() - session.startedAt.getTime()) / 1000);
      return `[${session.id.slice(0, 10)}] ${session.status} | ${session.workdir} | ${age}s | "${session.prompt.slice(0, 60)}"`;
    }

    // ========================================================================
    // Tool: claude_code_run — start a Claude Code session
    // ========================================================================

    api.registerTool(
      {
        name: "dannysoul_claude_run",
        label: "Claude Code Run",
        description:
          "Start a Claude Code CLI session. The session runs in background and streams output to the chat.",
        parameters: Type.Object({
          prompt: Type.String({ description: "Task prompt for Claude Code" }),
          workdir: Type.Optional(Type.String({ description: "Working directory" })),
          model: Type.Optional(Type.String({ description: "Model to use" })),
          chatId: Type.Optional(Type.String({ description: "Chat ID for output routing" })),
        }),
        async execute(_toolCallId, params) {
          const {
            prompt,
            workdir = config.defaultWorkdir,
            model = config.defaultModel,
            chatId = "current",
          } = params as {
            prompt: string;
            workdir?: string;
            model?: string;
            chatId?: string;
          };

          const resolvedWorkdir = api.resolvePath(workdir);
          const streamer = new OutputStreamer(
            config.outputBatchIntervalMs,
            config.maxOutputCharsPerMessage,
          );

          const result = sessionMgr.start(
            {
              chatId,
              workdir: resolvedWorkdir,
              prompt,
              model,
              allowedTools: config.allowedTools,
              dangerouslySkipPermissions: true,
            },
            // onEvent
            (session, event) => {
              const messages = streamer.processEvent(event);
              for (const msg of messages) {
                api.logger.info?.(`claude-code [${session.id.slice(0, 8)}]: ${msg.text.slice(0, 100)}`);
              }
            },
            // onClose
            (session, code) => {
              const final = streamer.forceFlush();
              if (final) {
                api.logger.info?.(`claude-code [${session.id.slice(0, 8)}] final: ${final.text.slice(0, 100)}`);
              }
              streamers.delete(session.id);
              api.logger.info?.(
                `claude-code [${session.id.slice(0, 8)}] closed (code: ${code})`,
              );
            },
          );

          if ("error" in result) {
            return {
              content: [{ type: "text", text: `Failed: ${result.error}` }],
              details: { error: result.error },
            };
          }

          streamers.set(result.id, streamer);

          return {
            content: [
              {
                type: "text",
                text: `Claude Code session started.\nID: ${result.id}\nWorkdir: ${resolvedWorkdir}\nModel: ${model}\nPrompt: ${prompt.slice(0, 100)}`,
              },
            ],
            details: { sessionId: result.id, status: result.status },
          };
        },
      },
      { name: "dannysoul_claude_run" },
    );

    // ========================================================================
    // Tool: claude_code_status
    // ========================================================================

    api.registerTool(
      {
        name: "dannysoul_claude_status",
        label: "Claude Code Status",
        description: "List active Claude Code sessions.",
        parameters: Type.Object({}),
        async execute() {
          const sessions = sessionMgr.listActive();
          if (sessions.length === 0) {
            return {
              content: [{ type: "text", text: "No active Claude Code sessions." }],
              details: { count: 0 },
            };
          }

          const text = sessions.map(formatSessionInfo).join("\n");
          return {
            content: [
              {
                type: "text",
                text: `Active sessions (${sessions.length}):\n${text}`,
              },
            ],
            details: { count: sessions.length },
          };
        },
      },
      { name: "dannysoul_claude_status" },
    );

    // ========================================================================
    // Command: /claude (bypass LLM)
    // ========================================================================

    api.registerCommand({
      name: "claude",
      description: "Control Claude Code CLI sessions",
      acceptsArgs: true,
      handler(ctx) {
        const ctxRecord = ctx as Record<string, unknown>;
        const args = String(ctxRecord.args ?? ctxRecord.text ?? "status");
        const chatId = String(ctxRecord.chatId ?? ctxRecord.senderId ?? "current");
        const parsed = parseClaudeCommand(args);

        switch (parsed.subcommand) {
          case "status": {
            const sessions = sessionMgr.listActive();
            if (sessions.length === 0) {
              return { text: "No active Claude Code sessions." };
            }
            return {
              text: `Active sessions (${sessions.length}):\n${sessions.map(formatSessionInfo).join("\n")}`,
            };
          }

          case "stop": {
            if (parsed.sessionId) {
              const ok = sessionMgr.stop(parsed.sessionId);
              return {
                text: ok
                  ? `Session ${parsed.sessionId} stopped.`
                  : `Session ${parsed.sessionId} not found.`,
              };
            }
            const count = sessionMgr.stopForChat(chatId);
            return { text: `Stopped ${count} session(s) for this chat.` };
          }

          case "approve": {
            const sessions = sessionMgr.listForChat(chatId);
            for (const s of sessions) {
              if (s.status === "waiting") {
                sessionMgr.sendInput(s.id, "y");
                return { text: `Approved for session ${s.id.slice(0, 10)}.` };
              }
            }
            return { text: "No pending permission requests." };
          }

          case "deny": {
            const sessions2 = sessionMgr.listForChat(chatId);
            for (const s of sessions2) {
              if (s.status === "waiting") {
                sessionMgr.sendInput(s.id, "n");
                return { text: `Denied for session ${s.id.slice(0, 10)}.` };
              }
            }
            return { text: "No pending permission requests." };
          }

          case "start": {
            if (!parsed.prompt) {
              return {
                text: "Usage: /claude [--model <model>] [workdir] <prompt>",
              };
            }

            const workdir = parsed.workdir
              ? api.resolvePath(parsed.workdir)
              : config.defaultWorkdir;
            const model = parsed.model ?? config.defaultModel;
            const streamer = new OutputStreamer(
              config.outputBatchIntervalMs,
              config.maxOutputCharsPerMessage,
            );

            const result = sessionMgr.start(
              {
                chatId,
                workdir,
                prompt: parsed.prompt,
                model,
                allowedTools: config.allowedTools,
                dangerouslySkipPermissions: true,
              },
              (session, event) => {
                streamer.processEvent(event);
              },
              (session, _code) => {
                streamer.forceFlush();
                streamers.delete(session.id);
              },
            );

            if ("error" in result) {
              return { text: `Error: ${result.error}` };
            }

            streamers.set(result.id, streamer);
            return {
              text: `Claude Code started.\nSession: ${result.id.slice(0, 10)}\nWorkdir: ${workdir}\nModel: ${model}\nPrompt: ${parsed.prompt.slice(0, 100)}`,
            };
          }

          default:
            return {
              text: "Usage: /claude [status|stop|approve|deny|<prompt>]",
            };
        }
      },
    });

    // ========================================================================
    // CLI
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const claude = program
          .command("claude-code")
          .description("DannySoul Claude Code session management");

        claude
          .command("status")
          .description("Show active sessions")
          .action(() => {
            const sessions = sessionMgr.listActive();
            if (sessions.length === 0) {
              console.log("No active sessions.");
              return;
            }
            for (const s of sessions) {
              console.log(formatSessionInfo(s));
            }
          });
      },
      { commands: ["claude-code"] },
    );

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "dannysoul-claude-code",
      start: () => {
        api.logger.info("dannysoul-claude-code: service started");
      },
      stop: () => {
        // Stop all running sessions on shutdown
        for (const s of sessionMgr.listActive()) {
          sessionMgr.stop(s.id);
        }
        api.logger.info("dannysoul-claude-code: all sessions stopped");
      },
    });
  },
};

export default claudeCodePlugin;
