/**
 * DannySoul Agent Dialogue Extension
 *
 * Three inter-agent dialogue modes:
 *
 * 1. **Direct** (A → B): One agent requests another via sessions_send.
 *    Uses OpenClaw native mechanism — no custom code needed.
 *
 * 2. **Ping-Pong** (A ↔ B): Two agents discuss a topic alternately.
 *    Built on OpenClaw's maxPingPongTurns with topic tracking + conclusion.
 *
 * 3. **Triangle** (User + A + B): User drives a three-way conversation.
 *    Agents reply in parallel; user sees all responses and guides the discussion.
 *    This is a fully custom mode not available in OpenClaw.
 *
 * Trigger detection:
 * - "@helen @ken <question>" → triangle (user participates)
 * - "@helen @charlie 你們討論一下" → ping-pong (agents discuss alone)
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { DialogueStore, type DialogueMode } from "./dialogue-session.js";
import {
  detectDialogueMode,
  extractMentions,
  extractTopic,
  hasConsensus,
} from "./dialogue-router.js";
import {
  buildConclusionPrompt,
  buildPingPongContext,
  buildTriangleContext,
  formatAgentReply,
} from "./triangle.js";

type DialogueConfig = {
  maxTriangleTurns: number;
  maxPingPongTurns: number;
  agentReplyTimeoutMs: number;
  parallelReplies: boolean;
  showAgentEmoji: boolean;
  concludeOnConsensus: boolean;
};

function parseConfig(raw: unknown): DialogueConfig {
  const cfg = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    maxTriangleTurns: Number(cfg.maxTriangleTurns ?? 20),
    maxPingPongTurns: Number(cfg.maxPingPongTurns ?? 5),
    agentReplyTimeoutMs: Number(cfg.agentReplyTimeoutMs ?? 30000),
    parallelReplies: cfg.parallelReplies !== false,
    showAgentEmoji: cfg.showAgentEmoji !== false,
    concludeOnConsensus: cfg.concludeOnConsensus !== false,
  };
}

const dialoguePlugin = {
  id: "dannysoul-agent-dialogue",
  name: "DannySoul Agent Dialogue",
  description: "Inter-agent dialogue: direct, ping-pong, and triangle modes",

  register(api: OpenClawPluginApi) {
    const config = parseConfig(api.pluginConfig);
    const store = new DialogueStore();

    api.logger.info(
      `dannysoul-agent-dialogue: registered (triangle=${config.maxTriangleTurns}, pingpong=${config.maxPingPongTurns})`,
    );

    // ========================================================================
    // Tool: start_dialogue — initiate a multi-agent dialogue
    // ========================================================================

    api.registerTool(
      {
        name: "dannysoul_start_dialogue",
        label: "Start Dialogue",
        description:
          "Start a multi-agent dialogue. Use when user @mentions 2+ agents. Mode: 'triangle' (user participates) or 'ping-pong' (agents discuss alone).",
        parameters: Type.Object({
          mode: Type.Union([Type.Literal("triangle"), Type.Literal("ping-pong")]),
          participants: Type.Array(Type.String(), {
            description: "Agent IDs to include",
            minItems: 2,
          }),
          topic: Type.String({ description: "Discussion topic" }),
          sessionKey: Type.Optional(Type.String({ description: "OpenClaw session key" })),
        }),
        async execute(_toolCallId, params) {
          const { mode, participants, topic, sessionKey = "current" } = params as {
            mode: DialogueMode;
            participants: string[];
            topic: string;
            sessionKey?: string;
          };

          const maxTurns =
            mode === "triangle" ? config.maxTriangleTurns : config.maxPingPongTurns * 2;

          const session = store.create({
            sessionKey,
            mode,
            participants,
            initiator: "user",
            topic,
            maxTurns,
          });

          return {
            content: [
              {
                type: "text",
                text: `Dialogue started: ${mode}\nParticipants: ${participants.join(", ")}\nTopic: ${topic}\nMax turns: ${maxTurns}\nSession: ${session.id}`,
              },
            ],
            details: { dialogueId: session.id, mode, participants },
          };
        },
      },
      { name: "dannysoul_start_dialogue" },
    );

    // ========================================================================
    // Tool: dialogue_reply — get an agent's reply in a dialogue
    // ========================================================================

    api.registerTool(
      {
        name: "dannysoul_dialogue_reply",
        label: "Dialogue Reply",
        description: "Get context for an agent to reply in an active dialogue.",
        parameters: Type.Object({
          agentId: Type.String({ description: "Agent ID to get reply context for" }),
          sessionKey: Type.Optional(Type.String()),
        }),
        async execute(_toolCallId, params) {
          const { agentId, sessionKey = "current" } = params as {
            agentId: string;
            sessionKey?: string;
          };

          const session = store.getActiveForSession(sessionKey);
          if (!session) {
            return {
              content: [{ type: "text", text: "No active dialogue for this session." }],
              details: { error: "no_active_dialogue" },
            };
          }

          let context: string;
          if (session.mode === "triangle") {
            context = buildTriangleContext(session, agentId);
          } else {
            const otherAgent = session.participants.find((p) => p !== agentId) ?? "unknown";
            context = buildPingPongContext(session, agentId, otherAgent);
          }

          return {
            content: [{ type: "text", text: context }],
            details: { dialogueId: session.id, agentId, mode: session.mode },
          };
        },
      },
      { name: "dannysoul_dialogue_reply" },
    );

    // ========================================================================
    // Tool: dialogue_add_message — record a message in the dialogue
    // ========================================================================

    api.registerTool(
      {
        name: "dannysoul_dialogue_add_message",
        label: "Add Dialogue Message",
        description: "Record a message from a participant in an active dialogue.",
        parameters: Type.Object({
          from: Type.String({ description: "Sender: agent ID or 'user'" }),
          content: Type.String({ description: "Message content" }),
          sessionKey: Type.Optional(Type.String()),
        }),
        async execute(_toolCallId, params) {
          const { from, content, sessionKey = "current" } = params as {
            from: string;
            content: string;
            sessionKey?: string;
          };

          const session = store.getActiveForSession(sessionKey);
          if (!session) {
            return {
              content: [{ type: "text", text: "No active dialogue." }],
              details: { error: "no_active_dialogue" },
            };
          }

          store.addMessage(session.id, from, content);

          // Check for consensus
          if (config.concludeOnConsensus && from !== "user" && hasConsensus(content)) {
            session.status = "concluded";
            return {
              content: [
                {
                  type: "text",
                  text: `Message added. ${from} indicated consensus — dialogue concluded.`,
                },
              ],
              details: {
                dialogueId: session.id,
                status: "concluded",
                totalMessages: session.messages.length,
              },
            };
          }

          const formatted = formatAgentReply(from, content, config.showAgentEmoji);

          return {
            content: [
              {
                type: "text",
                text: `Message added (turn ${session.messages.length}/${session.maxTurns}).\n\n${formatted}`,
              },
            ],
            details: {
              dialogueId: session.id,
              turnNumber: session.messages.length,
              status: session.status,
            },
          };
        },
      },
      { name: "dannysoul_dialogue_add_message" },
    );

    // ========================================================================
    // Commands: /conclude, /dialogue, /stop-dialogue
    // ========================================================================

    api.registerCommand({
      name: "conclude",
      description: "End the active dialogue and request a summary",
      handler(ctx) {
        const sessionKey = String(
          (ctx as Record<string, unknown>).sessionKey ?? "current",
        );
        const session = store.concludeForSession(sessionKey);

        if (!session) {
          return { text: "No active dialogue to conclude." };
        }

        const prompt = buildConclusionPrompt(session);
        return {
          text: `Dialogue concluded (${session.messages.length} messages).\n\nConclusion prompt generated — use it to get a summary from any agent.`,
        };
      },
    });

    api.registerCommand({
      name: "dialogue",
      description: "Show status of active dialogues",
      handler() {
        const active = store.listActive();
        if (active.length === 0) {
          return { text: "No active dialogues." };
        }

        const lines = active.map((s) => {
          const age = Math.floor((Date.now() - s.createdAt) / 1000);
          return `- [${s.id.slice(0, 12)}] ${s.mode}: ${s.participants.join(" + ")} — "${s.topic}" (${s.messages.length}/${s.maxTurns} turns, ${age}s)`;
        });

        return { text: `Active dialogues (${active.length}):\n${lines.join("\n")}` };
      },
    });

    api.registerCommand({
      name: "stop-dialogue",
      description: "Force-stop the active dialogue",
      handler(ctx) {
        const sessionKey = String(
          (ctx as Record<string, unknown>).sessionKey ?? "current",
        );
        const session = store.concludeForSession(sessionKey);

        if (!session) {
          return { text: "No active dialogue to stop." };
        }

        return {
          text: `Dialogue ${session.id.slice(0, 12)} stopped (${session.messages.length} messages).`,
        };
      },
    });

    // ========================================================================
    // Lifecycle Hook: detect multi-mention messages
    // ========================================================================

    api.on("message_received", async (event) => {
      const meta = event as Record<string, unknown>;
      const content = String(meta.content ?? "");
      if (!content) return;

      const mentions = extractMentions(content);
      if (mentions.length < 2) return;

      const mode = detectDialogueMode(content, mentions);
      if (!mode) return;

      const topic = extractTopic(content, mentions);
      const sessionKey = String(meta.sessionKey ?? "current");

      api.logger.info?.(
        `dannysoul-agent-dialogue: detected ${mode} dialogue with ${mentions.join(", ")} — "${topic}"`,
      );

      // The dialogue will be formally started when the agent processes the message
      // and calls dannysoul_start_dialogue tool. This hook just logs the detection.
    });

    // ========================================================================
    // CLI
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const dialogue = program
          .command("dialogue")
          .description("DannySoul agent dialogue management");

        dialogue
          .command("list")
          .description("List active dialogues")
          .action(() => {
            const active = store.listActive();
            if (active.length === 0) {
              console.log("No active dialogues.");
              return;
            }
            for (const s of active) {
              console.log(
                `${s.id} [${s.mode}] ${s.participants.join(" + ")} — ${s.topic} (${s.messages.length} msgs)`,
              );
            }
          });
      },
      { commands: ["dialogue"] },
    );
  },
};

export default dialoguePlugin;
