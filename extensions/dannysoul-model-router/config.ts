/**
 * Configuration schema and defaults for the model-router extension.
 */

export type ModelRouterConfig = {
  tiers: {
    simple: string;
    conversation: string;
    planning: string;
    critical: string;
    tool: string;
  };
  aliases: Record<string, string>;
  agentNames: string[];
};

export const DEFAULT_TIERS = {
  simple: "haiku",
  conversation: "sonnet",
  planning: "sonnet",
  critical: "opus",
  tool: "", // empty = use current model
} as const;

export const DEFAULT_ALIASES: Record<string, string> = {
  haiku: "claude-3-5-haiku-20241022",
  sonnet: "claude-sonnet-4-20250514",
  opus: "claude-opus-4-20250514",
};

export const DEFAULT_AGENT_NAMES = [
  "helen",
  "charlie",
  "ken",
  "sunny",
  "danny",
  "lael",
  "daniel",
  "feng",
  "wacker",
];

export function parseConfig(raw: unknown): ModelRouterConfig {
  const cfg = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const tiers = (cfg.tiers && typeof cfg.tiers === "object" ? cfg.tiers : {}) as Record<
    string,
    unknown
  >;
  const aliases = (cfg.aliases && typeof cfg.aliases === "object" ? cfg.aliases : {}) as Record<
    string,
    string
  >;
  const agentNames = Array.isArray(cfg.agentNames)
    ? (cfg.agentNames as string[])
    : DEFAULT_AGENT_NAMES;

  return {
    tiers: {
      simple: String(tiers.simple ?? DEFAULT_TIERS.simple),
      conversation: String(tiers.conversation ?? DEFAULT_TIERS.conversation),
      planning: String(tiers.planning ?? DEFAULT_TIERS.planning),
      critical: String(tiers.critical ?? DEFAULT_TIERS.critical),
      tool: String(tiers.tool ?? DEFAULT_TIERS.tool),
    },
    aliases: { ...DEFAULT_ALIASES, ...aliases },
    agentNames,
  };
}
