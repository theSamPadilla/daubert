export interface ActivityStep {
  id: string;
  text: string;
  state: 'running' | 'done' | 'stopped';
}

export interface TurnMessage {
  id: string;
  role: 'assistant' | 'activity';
  text: string;
  isStreaming?: boolean;
  /** Error code carried by a failed run's error bubble, e.g. 'context_overflow'. */
  code?: string;
  /** Tool calls in an 'activity' bubble, in the order the agent made them. */
  steps?: ActivityStep[];
}

export type TurnSideEffect = 'graph' | 'production' | 'context' | null;

interface TurnDeps {
  newId: () => string;
  formatToolStatus: (tool: { name: string; input?: Record<string, unknown> }) => string;
}

/**
 * The assistant side of one turn, built from run events. Pure state, with no
 * React: AIChat renders `[...base, ...turn.bubbles()]`, and the same model
 * serves live sends and re-attaching to a turn that is already running.
 * Bubbles are replaced, never mutated, so memoized rows re-render.
 *
 * Tool calls accumulate as steps in an 'activity' bubble instead of a status
 * line that vanishes when the tool finishes, so the user can see what the
 * agent has done so far. Consecutive tool calls share one bubble; text in
 * between closes it, and the next tool call opens a new one.
 */
export class ChatTurn {
  private items: TurnMessage[] = [];
  private curId = '';
  private activityId: string | null = null;
  finished = false;
  /** Latest context size from a `context_usage` event; read it when apply() returns 'context'. */
  contextTokens: number | null = null;

  constructor(private readonly deps: TurnDeps, opts: { placeholder: boolean }) {
    if (opts.placeholder) {
      this.curId = deps.newId();
      this.items = [{ id: this.curId, role: 'assistant', text: '', isStreaming: true }];
    }
  }

  bubbles(): TurnMessage[] {
    return this.items;
  }

  apply(type: string, data: any): TurnSideEffect {
    switch (type) {
      case 'text_delta': {
        this.closeActivity('done');
        const content: string = data?.content ?? '';
        const cur = this.current();
        if (cur && cur.isStreaming) {
          this.replace({ ...cur, text: cur.text + content });
        } else {
          this.curId = this.deps.newId();
          this.items = [...this.items, { id: this.curId, role: 'assistant', text: content, isStreaming: true }];
        }
        return null;
      }
      case 'tool_start':
        this.finalizeOrDropCurrent();
        this.curId = '';
        this.addStep(this.deps.formatToolStatus({ name: data?.name, input: data?.input }));
        return null;
      case 'tool_done':
        this.finishRunningStep();
        return null;
      case 'graph_updated':
        return 'graph';
      case 'production_updated':
        return 'production';
      case 'context_usage':
        if (typeof data?.tokens !== 'number') return null;
        this.contextTokens = data.tokens;
        return 'context';
      case 'done':
        this.finished = true;
        this.closeActivity('done');
        this.finalizeOrDropCurrent();
        return null;
      case 'error': {
        this.closeActivity('stopped');
        const text: string = data?.errorId
          ? `${data.message} (ref: ${data.errorId})`
          : data?.message ?? 'Something went wrong.';
        const code: string | undefined = typeof data?.code === 'string' ? data.code : undefined;
        const cur = this.current();
        if (cur && !cur.text) {
          this.replace({ ...cur, text, isStreaming: false, ...(code ? { code } : {}) });
        } else {
          this.finalizeOrDropCurrent();
          this.curId = '';
          this.items = [...this.items, { id: this.deps.newId(), role: 'assistant', text, isStreaming: false, ...(code ? { code } : {}) }];
        }
        return null;
      }
      default:
        return null;
    }
  }

  /**
   * Final bubbles once following stops: drop empty text bubbles, keep the
   * activity (a step still running when following stopped is marked stopped,
   * since nothing confirmed it finished), and append the failure if any.
   */
  settle(failure: string | null): TurnMessage[] {
    this.closeActivity(failure ? 'stopped' : 'done');
    const settled = this.items.flatMap((m) => {
      if (!m.isStreaming) return [m];
      if (!m.text) return [];
      return [{ ...m, isStreaming: false }];
    });
    this.items = failure
      ? [...settled, { id: this.deps.newId(), role: 'assistant', text: failure }]
      : settled;
    return this.items;
  }

  private current(): TurnMessage | undefined {
    return this.items.find((m) => m.id === this.curId);
  }

  private replace(next: TurnMessage) {
    this.items = this.items.map((m) => (m.id === next.id ? next : m));
  }

  private finalizeOrDropCurrent() {
    this.items = this.items.flatMap((m) => {
      if (m.id !== this.curId) return [m];
      return m.text ? [{ ...m, isStreaming: false }] : [];
    });
  }

  private addStep(text: string) {
    const step: ActivityStep = { id: this.deps.newId(), text, state: 'running' };
    const open = this.activityId ? this.items.find((m) => m.id === this.activityId) : undefined;
    if (open) {
      this.replace({ ...open, steps: [...(open.steps ?? []), step] });
      return;
    }
    this.activityId = this.deps.newId();
    this.items = [...this.items, { id: this.activityId, role: 'activity', text: '', isStreaming: true, steps: [step] }];
  }

  private finishRunningStep() {
    const open = this.activityId ? this.items.find((m) => m.id === this.activityId) : undefined;
    if (!open?.steps) return;
    const idx = open.steps.findIndex((s) => s.state === 'running');
    if (idx < 0) return;
    const steps = open.steps.map((s, i) => (i === idx ? { ...s, state: 'done' as const } : s));
    this.replace({ ...open, steps });
  }

  /** Close the open activity bubble; steps still running end in `pending`. */
  private closeActivity(pending: 'done' | 'stopped') {
    if (!this.activityId) return;
    const open = this.items.find((m) => m.id === this.activityId);
    this.activityId = null;
    if (!open) return;
    const steps = (open.steps ?? []).map((s) => (s.state === 'running' ? { ...s, state: pending } : s));
    this.replace({ ...open, isStreaming: false, steps });
  }
}
