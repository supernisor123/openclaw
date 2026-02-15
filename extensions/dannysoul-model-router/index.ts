/**
 * DannySoul Model Router Extension
 *
 * Intent-based model routing using keyword/regex matching (zero LLM cost).
 * Automatically selects the appropriate model tier based on user message content.
 *
 * 5 intent tiers:
 *   simple → haiku (fast, cheap)
 *   tool → current model
 *   conversation → sonnet (balanced)
 *   planning → sonnet (needs reasoning)
 *   critical → opus (highest capability)
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { parseConfig } from "./config.js";
import { buildPlanningPattern, classifyIntent } from "./intent-classifier.js";
import { selectModelForIntent } from "./model-tier.js";

const modelRouterPlugin = {
  id: "dannysoul-model-router",
  name: "DannySoul Model Router",
  description: "Intent-based model routing (keyword/regex, zero LLM cost)",

  register(api: OpenClawPluginApi) {
    const config = parseConfig(api.pluginConfig);
    const planningPattern = buildPlanningPattern(config.agentNames);

    api.logger.info(
      `dannysoul-model-router: registered (tiers: ${JSON.stringify(config.tiers)})`,
    );

    // ========================================================================
    // Tool: classify_intent — available for other plugins/agents
    // ========================================================================

    api.registerTool(
      {
        name: "dannysoul_classify_intent",
        label: "Classify Intent",
        description:
          "Classify user text into intent tier (simple/tool/conversation/planning/critical). Uses keyword matching, zero LLM cost.",
        parameters: Type.Object({
          text: Type.String({ description: "User message text to classify" }),
        }),
        async execute(_toolCallId, params) {
          const { text } = params as { text: string };
          const intent = classifyIntent(text, planningPattern);
          const model = selectModelForIntent(intent, config);

          return {
            content: [
              {
                type: "text",
                text: `Intent: ${intent}, Recommended model: ${model || "(current)"}`,
              },
            ],
            details: { intent, model },
          };
        },
      },
      { name: "dannysoul_classify_intent" },
    );

    // ========================================================================
    // Lifecycle Hook: auto-route model before agent starts
    // ========================================================================

    api.on("before_agent_start", async (event) => {
      if (!event.prompt) return;

      const intent = classifyIntent(event.prompt, planningPattern);
      const model = selectModelForIntent(intent, config);

      if (model) {
        api.logger.info?.(
          `dannysoul-model-router: intent=${intent} → model=${model}`,
        );
        // Return model override for this agent run
        return { model };
      }
    });

    // ========================================================================
    // CLI Command
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const router = program
          .command("intent")
          .description("DannySoul intent classification");

        router
          .command("classify")
          .description("Classify a text into intent tier")
          .argument("<text>", "Text to classify")
          .action(async (text: string) => {
            const intent = classifyIntent(text, planningPattern);
            const model = selectModelForIntent(intent, config);
            console.log(`Intent: ${intent}`);
            console.log(`Model: ${model || "(use current)"}`);
          });

        router
          .command("tiers")
          .description("Show current tier configuration")
          .action(() => {
            for (const [tier, alias] of Object.entries(config.tiers)) {
              const resolved =
                config.aliases[alias.toLowerCase()] ?? alias ?? "(current)";
              console.log(`${tier}: ${alias} → ${resolved}`);
            }
          });
      },
      { commands: ["intent"] },
    );
  },
};

export default modelRouterPlugin;
