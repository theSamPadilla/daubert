export interface TurnMessage {
  id: string;
  role: 'assistant' | 'status';
  text: string;
  isStreaming?: boolean;
}

export type TurnSideEffect = 'graph' | 'production' | null;

interface TurnDeps {
  newId: () => string;
  formatToolStatus: (tool: { name: string; input?: Record<string, unknown> }) => string;
}

/**
 * The assistant side of one turn, built from run events. Pure state, with no
 * React: AIChat renders `[...base, ...turn.bubbles()]`, and the same model
 * serves live sends and re-attaching to a turn that is already running.
 * Bubbles are replaced, never mutated, so memoized rows re-render.
 */
export class ChatTurn {
  private items: TurnMessage[] = [];
  private curId = '';
  private statusId: string | null = null;
  finished = false;

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
        this.removeStatus();
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
        this.showStatus(this.deps.formatToolStatus({ name: data?.name, input: data?.input }));
        return null;
      case 'tool_done':
        this.removeStatus();
        this.finalizeOrDropCurrent();
        this.curId = '';
        return null;
      case 'graph_updated':
        return 'graph';
      case 'production_updated':
        return 'production';
      case 'done':
        this.finished = true;
        this.removeStatus();
        this.finalizeOrDropCurrent();
        return null;
      case 'error': {
        this.removeStatus();
        const text: string = data?.errorId
          ? `${data.message} (ref: ${data.errorId})`
          : data?.message ?? 'Something went wrong.';
        const cur = this.current();
        if (cur && !cur.text) {
          this.replace({ ...cur, text, isStreaming: false });
        } else {
          this.finalizeOrDropCurrent();
          this.curId = '';
          this.items = [...this.items, { id: this.deps.newId(), role: 'assistant', text, isStreaming: false }];
        }
        return null;
      }
      default:
        return null;
    }
  }

  /** Final bubbles once following stops: drop empty and status bubbles, append the failure if any. */
  settle(failure: string | null): TurnMessage[] {
    const settled = this.items.flatMap((m) => {
      if (!m.isStreaming) return [m];
      if (m.role === 'status' || !m.text) return [];
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

  private showStatus(text: string) {
    this.removeStatus();
    this.statusId = this.deps.newId();
    this.items = [...this.items, { id: this.statusId, role: 'status', text, isStreaming: true }];
  }

  private removeStatus() {
    if (!this.statusId) return;
    const id = this.statusId;
    this.statusId = null;
    this.items = this.items.filter((m) => m.id !== id);
  }
}
