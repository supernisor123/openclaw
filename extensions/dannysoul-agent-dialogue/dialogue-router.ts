/**
 * Dialogue router: detect dialogue mode from user messages.
 *
 * Rules:
 * - 2+ @mentions + delegation keyword → ping-pong (agents discuss alone)
 * - 2+ @mentions + no delegation → triangle (user participates)
 * - 1 @mention → normal single-agent routing
 * - Agent reply containing @mention → direct (agent-to-agent)
 */

import type { DialogueMode } from "./dialogue-session.js";

// Delegation keywords: patterns that indicate user wants agents to discuss among themselves
const DELEGATE_PATTERNS = [
  /討論/, // discuss (zh)
  /你們/, // you (plural, zh)
  /互相/, // mutually (zh)
  /商量/, // consult (zh)
  /debate/i,
  /discuss/i,
  /talk\s+(?:to|with)\s+each\s+other/i,
  /work\s+(?:it\s+)?out/i,
];

// Consensus keywords: patterns that indicate agents have reached agreement
const CONSENSUS_PATTERNS = [
  /CONCLUDE/,
  /達成共識/, // reached consensus (zh)
  /同意/, // agree (zh)
  /沒有異議/, // no objection (zh)
  /agreed/i,
  /consensus/i,
];

/**
 * Extract @mentions from text.
 * Matches patterns like @helen, @ken, @charlie-pjm
 */
export function extractMentions(text: string): string[] {
  const matches = text.match(/@([a-z0-9][a-z0-9_-]{1,})/gi);
  if (!matches) return [];
  return matches.map((m) => m.slice(1).toLowerCase());
}

/**
 * Detect dialogue mode from user message and extracted mentions.
 *
 * Returns null if the message doesn't trigger a dialogue mode.
 */
export function detectDialogueMode(
  text: string,
  mentions: string[],
): DialogueMode | null {
  if (mentions.length < 2) return null;

  // Check if user is delegating the discussion to agents
  const isDelegated = DELEGATE_PATTERNS.some((p) => p.test(text));
  return isDelegated ? "ping-pong" : "triangle";
}

/**
 * Check if an agent's reply indicates consensus (for auto-conclude).
 */
export function hasConsensus(text: string): boolean {
  return CONSENSUS_PATTERNS.some((p) => p.test(text));
}

/**
 * Extract a topic summary from the user message.
 * Takes the first 100 chars, trimming at word boundary.
 */
export function extractTopic(text: string, mentions: string[]): string {
  // Remove @mentions from the topic
  let topic = text;
  for (const m of mentions) {
    topic = topic.replace(new RegExp(`@${m}\\b`, "gi"), "").trim();
  }
  // Remove delegation keywords
  for (const p of DELEGATE_PATTERNS) {
    topic = topic.replace(p, "").trim();
  }
  // Trim to 100 chars at word boundary
  if (topic.length > 100) {
    topic = topic.slice(0, 100).replace(/\s+\S*$/, "") + "...";
  }
  return topic || "(untitled dialogue)";
}
