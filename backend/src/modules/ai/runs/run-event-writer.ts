import type { SseEvent } from '../ai.service';

export interface RunEventRow {
  seq: number;
  type: string;
  data: unknown;
}

/**
 * Assigns seq numbers and appends a run's events in order. text_delta events
 * are coalesced into one row per flush window so a long response doesn't cost
 * one insert per token. Any other event flushes pending text first, so the
 * log order matches what the model produced.
 */
export class RunEventWriter {
  private seq = 0;
  private pendingText = '';
  private timer: NodeJS.Timeout | null = null;
  private chain: Promise<void> = Promise.resolve();
  private failure: unknown = null;

  constructor(
    private readonly append: (rows: RunEventRow[]) => Promise<void>,
    private readonly flushMs = 250,
  ) {}

  async push(event: SseEvent): Promise<void> {
    this.throwIfFailed();
    if (event.type === 'text_delta') {
      this.pendingText += (event.data as { content?: string })?.content ?? '';
      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.write([]).catch(() => {
            // Recorded in this.failure; the next push/flush rethrows it.
          });
        }, this.flushMs);
      }
      return;
    }
    await this.write([{ type: event.type, data: event.data }]);
  }

  async flush(): Promise<void> {
    this.throwIfFailed();
    await this.write([]);
  }

  private write(events: Array<{ type: string; data: unknown }>): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch: Array<{ type: string; data: unknown }> = [];
    if (this.pendingText) {
      batch.push({ type: 'text_delta', data: { content: this.pendingText } });
      this.pendingText = '';
    }
    batch.push(...events);
    if (batch.length === 0) return this.chain;
    const rows = batch.map((e) => ({ seq: ++this.seq, type: e.type, data: e.data }));
    this.chain = this.chain
      .then(() => this.append(rows))
      .catch((err) => {
        this.failure = err;
        throw err;
      });
    return this.chain;
  }

  private throwIfFailed(): void {
    if (this.failure) throw this.failure;
  }
}
