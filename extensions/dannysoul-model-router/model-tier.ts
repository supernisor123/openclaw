/**
 * Map intent categories to model names using configurable tiers.
 *
 * Ported from DannySoul bot/model_router.py select_model_for_intent()
 */

import type { IntentCategory } from "./intent-classifier.js";
import type { ModelRouterConfig } from "./config.js";

/**
 * Given an intent category and config, return the resolved model name.
 *
 * Resolution order:
 * 1. Look up the tier alias from config.tiers[intent]
 * 2. Resolve alias to full model name via config.aliases
 * 3. If tier is empty, return fallbackModel
 */
export function selectModelForIntent(
  intent: IntentCategory,
  config: ModelRouterConfig,
  fallbackModel: string = "",
): string {
  const tierAlias = config.tiers[intent] ?? "";
  if (!tierAlias) return fallbackModel;

  // Resolve alias → full model name
  const resolved = config.aliases[tierAlias.toLowerCase()];
  return resolved ?? tierAlias;
}
