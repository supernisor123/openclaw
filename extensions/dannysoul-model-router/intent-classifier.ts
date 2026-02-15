/**
 * Deterministic intent classification using keyword/regex matching.
 * Zero LLM cost — all pattern matching is local.
 *
 * Ported from DannySoul bot/model_router.py
 */

export const INTENT_SIMPLE = "simple" as const;
export const INTENT_TOOL = "tool" as const;
export const INTENT_CONVERSATION = "conversation" as const;
export const INTENT_PLANNING = "planning" as const;
export const INTENT_CRITICAL = "critical" as const;

export type IntentCategory =
  | typeof INTENT_SIMPLE
  | typeof INTENT_TOOL
  | typeof INTENT_CONVERSATION
  | typeof INTENT_PLANNING
  | typeof INTENT_CRITICAL;

const INTENT_PRIORITY: Record<IntentCategory, number> = {
  [INTENT_SIMPLE]: 0,
  [INTENT_TOOL]: 1,
  [INTENT_CONVERSATION]: 2,
  [INTENT_PLANNING]: 3,
  [INTENT_CRITICAL]: 4,
};

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const SIMPLE_COMMANDS = new Set([
  "/help",
  "/start",
  "/status",
  "/usage",
  "/id",
  "/agents",
  "/reset",
  "/files",
  "/reload",
  "/events",
  "/memory",
]);

const SIMPLE_PATTERN = /^\/gui\s+status\b/i;

const TOOL_COMMANDS = new Set([
  "/run",
  "/commit",
  "/push",
  "/upgrade",
  "/patch",
  "/apply",
  "/gui",
  "/peekaboo",
  "/line",
  "/claude",
]);

// Chinese: "在mac" (on Mac)
const TOOL_PATTERN = /\u5728mac/i;

// Critical: 安全, security, 不可逆, irreversible, 刪除所有, delete all, production, deploy
const CRITICAL_PATTERN =
  /\u5b89\u5168|security|\u4e0d\u53ef\u9006|irreversible|\u522a\u9664\u6240\u6709|delete\s+all|production|deploy/i;

function extractCommand(text: string): string {
  const m = text.match(/^(\/[a-zA-Z_]+)/);
  return m ? m[1].toLowerCase() : "";
}

/**
 * Build a planning pattern dynamically from agent names.
 */
export function buildPlanningPattern(agentNames: string[]): RegExp {
  const mentionPart = agentNames.map((n) => `@${n}`).join("|");
  // PRD | architecture | 設計 | 規劃 | 需求 | sprint
  const keywordPart =
    "PRD|architecture|\\u8a2d\\u8a08|\\u898f\\u5283|\\u9700\\u6c42|sprint";
  return new RegExp(`${mentionPart}|${keywordPart}`, "i");
}

/**
 * Classify user text into an intent category.
 *
 * When multiple categories match, the highest-tier wins
 * (critical > planning > conversation > tool > simple).
 */
export function classifyIntent(
  userText: string,
  planningPattern: RegExp,
): IntentCategory {
  const text = (userText || "").trim();
  if (!text) return INTENT_SIMPLE;

  const matched: IntentCategory[] = [];

  // --- Simple ---
  const cmd = extractCommand(text);
  if (SIMPLE_COMMANDS.has(cmd)) {
    matched.push(INTENT_SIMPLE);
  } else if (SIMPLE_PATTERN.test(text)) {
    matched.push(INTENT_SIMPLE);
  }

  // --- Tool ---
  if (cmd && TOOL_COMMANDS.has(cmd)) {
    // "/gui status" is simple, not tool
    if (!(cmd === "/gui" && SIMPLE_PATTERN.test(text))) {
      matched.push(INTENT_TOOL);
    }
  }
  if (TOOL_PATTERN.test(text)) {
    matched.push(INTENT_TOOL);
  }

  // --- Planning ---
  if (planningPattern.test(text)) {
    matched.push(INTENT_PLANNING);
  }

  // --- Critical ---
  if (CRITICAL_PATTERN.test(text)) {
    matched.push(INTENT_CRITICAL);
  }

  // --- Resolve ---
  if (matched.length === 0) return INTENT_CONVERSATION;
  if (matched.length === 1) return matched[0];

  // Multiple matches: pick the highest tier
  return matched.reduce((a, b) =>
    INTENT_PRIORITY[a] >= INTENT_PRIORITY[b] ? a : b,
  );
}
