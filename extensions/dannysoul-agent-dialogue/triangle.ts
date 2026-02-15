/**
 * Triangle dialogue coordinator: User + 2 Agents three-way conversation.
 *
 * Design principles:
 * 1. User is always the driver — agents reply and wait for user's next input
 * 2. Every agent sees the full conversation context
 * 3. Agents reply in parallel for speed
 * 4. Agents can reference each other's points
 */

import type { DialogueSession, DialogueStore } from "./dialogue-session.js";

// Default emoji map for agent display names
const AGENT_EMOJI: Record<string, string> = {
  "helen": "🎯",
  "helen-pdm": "🎯",
  "charlie": "📋",
  "charlie-pjm": "📋",
  "ken": "💻",
  "ken-fullstack": "💻",
  "sunny": "🧪",
  "sunny-qa": "🧪",
  "lael": "🎨",
  "lael-uiux": "🎨",
  "daniel": "🔒",
  "daniel-sec": "🔒",
  "feng": "🚀",
  "feng-devops": "🚀",
  "wacker": "⚙️",
  "wacker-sre": "⚙️",
};

export function getAgentEmoji(agentId: string): string {
  return AGENT_EMOJI[agentId.toLowerCase()] ?? "🤖";
}

/**
 * Build the context prompt for an agent in a triangle dialogue.
 * Each agent sees the full conversation history from all participants.
 */
export function buildTriangleContext(
  session: DialogueSession,
  agentId: string,
): string {
  const history = session.messages
    .map((m) => {
      const label = m.from === "user" ? "User" : m.from;
      return `[${label}]: ${m.content}`;
    })
    .join("\n\n");

  return [
    `## Active Triangle Dialogue`,
    `Topic: ${session.topic}`,
    `Participants: ${session.participants.join(", ")} + User`,
    `Your role: ${agentId}`,
    `Turn: ${session.messages.length + 1}/${session.maxTurns}`,
    ``,
    `### Conversation History`,
    history || "(No messages yet)",
    ``,
    `### Instructions`,
    `- Respond from your role's perspective (${agentId})`,
    `- You may reference other participants' points by name`,
    `- Keep responses focused and actionable`,
    `- If the discussion has reached consensus, say "CONCLUDE"`,
    `- Do NOT repeat what others have already said`,
  ].join("\n");
}

/**
 * Build the context prompt for an agent in a ping-pong dialogue.
 * Similar to triangle but focused on agent-to-agent exchange.
 */
export function buildPingPongContext(
  session: DialogueSession,
  agentId: string,
  otherAgentId: string,
): string {
  const history = session.messages
    .map((m) => {
      const label = m.from === "user" ? "User" : m.from;
      return `[${label}]: ${m.content}`;
    })
    .join("\n\n");

  return [
    `## Agent-to-Agent Discussion`,
    `Topic: ${session.topic}`,
    `You: ${agentId}`,
    `Discussing with: ${otherAgentId}`,
    `Turn: ${session.messages.length + 1}/${session.maxTurns}`,
    ``,
    `### Conversation History`,
    history || "(No messages yet)",
    ``,
    `### Instructions`,
    `- Discuss the topic from your role's perspective`,
    `- Build on or challenge ${otherAgentId}'s points constructively`,
    `- Work toward a concrete conclusion or recommendation`,
    `- Say "CONCLUDE" when you agree with the current proposal`,
    `- Be concise — aim for 2-4 paragraphs max`,
  ].join("\n");
}

/**
 * Format an agent's reply for Telegram display with emoji label.
 */
export function formatAgentReply(
  agentId: string,
  content: string,
  showEmoji: boolean = true,
): string {
  const emoji = showEmoji ? `${getAgentEmoji(agentId)} ` : "";
  return `${emoji}**${agentId}**\n${content}`;
}

/**
 * Generate a conclusion summary prompt for the concluding agent.
 */
export function buildConclusionPrompt(session: DialogueSession): string {
  const history = session.messages
    .map((m) => {
      const label = m.from === "user" ? "User" : m.from;
      return `[${label}]: ${m.content}`;
    })
    .join("\n\n");

  return [
    `## Dialogue Conclusion`,
    `The following dialogue has concluded. Summarize the key decisions and action items.`,
    ``,
    `### Full Conversation`,
    history,
    ``,
    `### Instructions`,
    `- List 3-5 key decisions or agreements`,
    `- Note any unresolved items`,
    `- Assign action items to specific agents where applicable`,
    `- Keep the summary concise (under 200 words)`,
  ].join("\n");
}
