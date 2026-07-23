export interface EngagementContext {
  side: 'plaintiff' | 'defense' | 'neutral' | '';
  scope: string;
  allegations: string;
}

const SIDE_LABEL: Record<Exclude<EngagementContext['side'], ''>, string> = {
  plaintiff: 'Plaintiff', defense: 'Defense', neutral: 'Neutral',
};

/** Markdown block for cases.summary. Null when nothing was provided. */
export function buildEngagementSummary(ctx: EngagementContext): string | null {
  const lines: string[] = [];
  if (ctx.side) lines.push(`**Retained by:** ${SIDE_LABEL[ctx.side]}`);
  if (ctx.scope.trim()) lines.push(`**Scope of engagement:** ${ctx.scope.trim()}`);
  if (ctx.allegations.trim()) lines.push(`**Key allegations:** ${ctx.allegations.trim()}`);
  return lines.length ? lines.join('\n\n') : null;
}
