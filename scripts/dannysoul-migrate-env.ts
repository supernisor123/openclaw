#!/usr/bin/env -S npx tsx
/**
 * DannySoul Env Migration Script
 *
 * Converts DannySoul's Python-based configuration (bot/.env, registry.json,
 * personas/*.md, personality.md) into OpenClaw-compatible format.
 *
 * Input:
 *   bot/.env                     # 77 env vars
 *   bot/agents/registry.json     # 8 agents
 *   bot/agents/personas/*.md     # 8 persona files
 *   bot/soul/personality.md      # personality definition
 *
 * Output:
 *   ~/.openclaw/openclaw.json    # Complete OpenClaw config
 *   ~/.openclaw/.env             # Only credentials (passthrough)
 *   ~/.openclaw/workspace/SOUL.md     # Converted personality
 *   ~/.openclaw/workspace/AGENTS.md   # Converted agents
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let inputDir = "";
let outputDir = "";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--input" && args[i + 1]) {
    inputDir = args[++i];
  } else if (args[i] === "--output" && args[i + 1]) {
    outputDir = args[++i];
  }
}

if (!inputDir) {
  console.error("Usage: dannysoul-migrate-env.ts --input <dannysoul-repo> --output <openclaw-dir>");
  console.error("Example: npx tsx scripts/dannysoul-migrate-env.ts --input ~/DannySoul --output ~/.openclaw/");
  process.exit(1);
}

inputDir = resolve(inputDir.replace(/^~/, homedir()));
outputDir = resolve((outputDir || "~/.openclaw").replace(/^~/, homedir()));

// ---------------------------------------------------------------------------
// Parse .env file
// ---------------------------------------------------------------------------

function parseDotEnv(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) {
    console.warn(`Warning: ${filePath} not found`);
    return {};
  }
  const content = readFileSync(filePath, "utf-8");
  const env: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Strip quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

// ---------------------------------------------------------------------------
// Read input files
// ---------------------------------------------------------------------------

const envPath = join(inputDir, "bot", ".env");
const registryPath = join(inputDir, "bot", "agents", "registry.json");
const personasDir = join(inputDir, "bot", "agents", "personas");
const personalityPath = join(inputDir, "bot", "soul", "personality.md");

console.log(`Reading from: ${inputDir}`);
console.log(`  .env: ${envPath}`);
console.log(`  registry: ${registryPath}`);
console.log(`  personas: ${personasDir}`);
console.log(`  personality: ${personalityPath}`);

const env = parseDotEnv(envPath);

// ---------------------------------------------------------------------------
// Group 1: Passthrough credentials → .env
// ---------------------------------------------------------------------------

const PASSTHROUGH_KEYS = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_SECRET_TOKEN",
  "OPENAI_API_KEY",
  "GITHUB_TOKEN",
  "LOG_LEVEL",
];

const credentialLines: string[] = [
  "# DannySoul credentials (migrated from bot/.env)",
  `# Generated: ${new Date().toISOString()}`,
  "",
];

for (const key of PASSTHROUGH_KEYS) {
  if (env[key]) {
    credentialLines.push(`${key}=${env[key]}`);
  }
}

// ---------------------------------------------------------------------------
// Group 2: Map to openclaw.json
// ---------------------------------------------------------------------------

const openclawConfig: Record<string, unknown> = {
  agent: {
    model: env.OPENAI_MODEL || "openai/gpt-5-mini",
  },
  channels: {
    telegram: {
      dmPolicy: {
        mode: "allowlist",
        allowlist: env.ALLOWED_CHAT_IDS
          ? env.ALLOWED_CHAT_IDS.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
      },
      ...(env.PUBLIC_WEBHOOK_BASE_URL
        ? { webhook: { url: env.PUBLIC_WEBHOOK_BASE_URL } }
        : {}),
      ...(env.TELEGRAM_TIMEOUT_SECONDS
        ? { timeout: Number(env.TELEGRAM_TIMEOUT_SECONDS) * 1000 }
        : {}),
    },
  },
  session: {
    historySize: Number(env.CHAT_MEMORY_MAX_TURNS || 40),
    agentToAgent: {
      enabled: true,
      allow: ["*"],
    },
  },
  memorySearch: {
    provider: "lancedb",
  },
  models: {
    providers: {
      openai: {
        ...(env.OPENAI_TIMEOUT_SECONDS
          ? { timeout: Number(env.OPENAI_TIMEOUT_SECONDS) * 1000 }
          : {}),
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Group 3: Extension configs
// ---------------------------------------------------------------------------

const pluginsConfig: Record<string, Record<string, unknown>> = {};

// Model Router
pluginsConfig["dannysoul-model-router"] = {
  tiers: {
    simple: env.MODEL_TIER_SIMPLE || "haiku",
    conversation: env.MODEL_TIER_CONVERSATION || "sonnet",
    planning: env.MODEL_TIER_PLANNING || "sonnet",
    critical: env.MODEL_TIER_CRITICAL || "opus",
    tool: env.MODEL_TIER_TOOL || "",
  },
};

// Usage Tracker
const usageConfig: Record<string, unknown> = {};
if (env.MODEL_COST_PER_1M_JSON) {
  try {
    usageConfig.costsPerMillion = JSON.parse(env.MODEL_COST_PER_1M_JSON);
  } catch {
    console.warn("Warning: Could not parse MODEL_COST_PER_1M_JSON");
  }
}
if (env.TEAM_TOKEN_POOL) usageConfig.teamTokenPool = Number(env.TEAM_TOKEN_POOL);
if (env.TEAM_MONTHLY_USD_BUDGET)
  usageConfig.monthlyBudget = Number(env.TEAM_MONTHLY_USD_BUDGET);
pluginsConfig["dannysoul-usage-tracker"] = usageConfig;

// Gate
const gateConfig: Record<string, unknown> = {};
if (env.GUI_APPROVAL_MODE) gateConfig.approvalMode = env.GUI_APPROVAL_MODE.toLowerCase();
if (env.GUI_MAX_STEPS) gateConfig.maxSteps = Number(env.GUI_MAX_STEPS);
if (env.GUI_STEP_TIMEOUT_SECONDS) gateConfig.stepTimeout = Number(env.GUI_STEP_TIMEOUT_SECONDS);
if (env.GUI_PLAN_TTL_SECONDS) gateConfig.ttlSeconds = Number(env.GUI_PLAN_TTL_SECONDS);
if (env.GUI_APPROVAL_INCLUDE_SCREENSHOT)
  gateConfig.includeScreenshot = env.GUI_APPROVAL_INCLUDE_SCREENSHOT === "true";
pluginsConfig["dannysoul-gate"] = gateConfig;

// Claude Code
pluginsConfig["dannysoul-claude-code"] = {
  defaultWorkdir: env.BOT_WORKDIR || "~/Documents/antigravity/DannySoul",
  defaultModel: "sonnet",
  maxConcurrentSessions: 3,
};

// Agent Dialogue
pluginsConfig["dannysoul-agent-dialogue"] = {
  maxTriangleTurns: 20,
  maxPingPongTurns: 5,
  parallelReplies: true,
  showAgentEmoji: true,
};

// Audit Log
pluginsConfig["dannysoul-audit-log"] = {};

(openclawConfig as Record<string, unknown>).plugins = {
  entries: Object.fromEntries(
    Object.entries(pluginsConfig).map(([id, cfg]) => [id, { enabled: true, config: cfg }]),
  ),
};

// GitHub skill config
if (env.GITHUB_REPO || env.GITHUB_API_BASE) {
  (openclawConfig as Record<string, unknown>).skills = {
    github: {
      config: {
        ...(env.GITHUB_REPO ? { repo: env.GITHUB_REPO } : {}),
        ...(env.GITHUB_API_BASE ? { apiBase: env.GITHUB_API_BASE } : {}),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Generate SOUL.md from personality.md
// ---------------------------------------------------------------------------

let soulMd: string;
if (existsSync(personalityPath)) {
  soulMd = readFileSync(personalityPath, "utf-8");
} else {
  soulMd = [
    "# DannySoul",
    "You are DannySoul, Danny Lee's personal agent and operator.",
    "",
    "## Identity",
    "- Owner: Danny Lee",
    "- Default language: 繁體中文, unless user requests otherwise",
    "",
    "## Design Principles",
    "1. Deterministic core, LLM at edges",
    "2. Side effects must gate + audit",
    "3. Evidence over promises",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Generate AGENTS.md from registry.json + personas/*.md
// ---------------------------------------------------------------------------

let agentsMd = "# DannySoul Agent Team\n\n";

if (existsSync(registryPath)) {
  try {
    const registry = JSON.parse(readFileSync(registryPath, "utf-8"));
    const agents = registry.agents || [];

    for (const agent of agents) {
      const id = agent.agent_id || "unknown";
      const name = agent.display_name || id;
      const role = agent.role || "";
      const aliases = (agent.aliases || []).join(", ");
      const responsibilities = (agent.responsibility_scope || []).join(", ");

      agentsMd += `## ${id}\n`;
      agentsMd += `- **Display Name**: ${name}\n`;
      agentsMd += `- **Role**: ${role}\n`;
      agentsMd += `- **Aliases**: ${aliases}\n`;
      agentsMd += `- **Responsibilities**: ${responsibilities}\n`;

      if (agent.recommended_model) {
        agentsMd += `- **Recommended Model**: ${agent.recommended_model}\n`;
      }
      if (agent.budget_share_ratio) {
        agentsMd += `- **Budget Share**: ${(agent.budget_share_ratio * 100).toFixed(0)}%\n`;
      }

      // Try to load persona file
      const personaFile = agent.persona_file;
      if (personaFile) {
        const personaPath = join(inputDir, personaFile);
        if (existsSync(personaPath)) {
          const persona = readFileSync(personaPath, "utf-8").trim();
          agentsMd += `\n### Persona\n${persona}\n`;
        } else {
          // Try without "bot/" prefix
          const altPath = join(inputDir, "bot", "agents", "personas", basename(personaFile));
          if (existsSync(altPath)) {
            const persona = readFileSync(altPath, "utf-8").trim();
            agentsMd += `\n### Persona\n${persona}\n`;
          }
        }
      }

      agentsMd += "\n---\n\n";
    }
  } catch (err) {
    console.warn(`Warning: Could not parse registry.json: ${err}`);
  }
} else {
  agentsMd += "(No registry.json found — add agents manually)\n";
}

// ---------------------------------------------------------------------------
// Write output files
// ---------------------------------------------------------------------------

const workspaceDir = join(outputDir, "workspace");

mkdirSync(outputDir, { recursive: true });
mkdirSync(workspaceDir, { recursive: true });

// .env (credentials only)
const envOutputPath = join(outputDir, ".env");
writeFileSync(envOutputPath, credentialLines.join("\n") + "\n", "utf-8");
console.log(`\nWritten: ${envOutputPath} (${PASSTHROUGH_KEYS.filter((k) => env[k]).length} credentials)`);

// openclaw.json
const configOutputPath = join(outputDir, "openclaw.json");
writeFileSync(configOutputPath, JSON.stringify(openclawConfig, null, 2) + "\n", "utf-8");
console.log(`Written: ${configOutputPath}`);

// SOUL.md
const soulOutputPath = join(workspaceDir, "SOUL.md");
writeFileSync(soulOutputPath, soulMd, "utf-8");
console.log(`Written: ${soulOutputPath}`);

// AGENTS.md
const agentsOutputPath = join(workspaceDir, "AGENTS.md");
writeFileSync(agentsOutputPath, agentsMd, "utf-8");
console.log(`Written: ${agentsOutputPath}`);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log("\n--- Migration Summary ---");
console.log(`Input dir: ${inputDir}`);
console.log(`Output dir: ${outputDir}`);
console.log(`Env vars read: ${Object.keys(env).length}`);
console.log(`Credentials: ${PASSTHROUGH_KEYS.filter((k) => env[k]).length}`);
console.log(`Plugins configured: ${Object.keys(pluginsConfig).length}`);

// List deprecated vars
const DEPRECATED_PREFIXES = ["SHOPEE_", "CODEX_"];
const deprecated = Object.keys(env).filter((k) =>
  DEPRECATED_PREFIXES.some((p) => k.startsWith(p)),
);
if (deprecated.length > 0) {
  console.log(`\nDeprecated vars (${deprecated.length}, not migrated):`);
  for (const k of deprecated) {
    console.log(`  - ${k}`);
  }
}

console.log("\nMigration complete. Review the generated files before starting OpenClaw.");
