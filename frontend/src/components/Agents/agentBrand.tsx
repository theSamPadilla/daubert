import type { IconType } from 'react-icons';
import { FaRobot } from 'react-icons/fa6';
import { SiClaude, SiOpenai, SiPerplexity } from 'react-icons/si';

/**
 * Vendor marks for the agents that can connect to Daubert.
 *
 * Two callers, one mapping:
 *   - the connect panel's surface tabs, keyed off a known surface id;
 *   - the connected-agents table and header chip, which only have the
 *     session's `surfaceLabel` — a free-text string the agent reports about
 *     itself at MCP `initialize` (e.g. "Anthropic/ClaudeAI 1.0.0 · macOS").
 *
 * Labels are matched loosely because we do not control their wording; anything
 * unrecognised falls back to the generic robot rather than guessing a vendor.
 */

/** Vendor mark for a known surface id. */
export const SURFACE_ICONS = {
  claudeApps: SiClaude,
  chatgpt: SiOpenai,
  perplexity: SiPerplexity,
} as const satisfies Record<string, IconType>;

/**
 * Best-effort vendor mark for a free-text agent label. Returns the generic
 * robot when the label matches no known vendor — a wrong logo is worse than
 * no logo, so the match has to be explicit.
 */
export function iconForAgentLabel(surfaceLabel: string): IconType {
  const label = surfaceLabel.toLowerCase();
  if (label.includes('claude') || label.includes('anthropic')) return SiClaude;
  if (label.includes('chatgpt') || label.includes('openai')) return SiOpenai;
  if (label.includes('perplexity')) return SiPerplexity;
  return FaRobot;
}
