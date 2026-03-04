export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private queue: (() => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private maxTokens: number = 5,
    private refillRate: number = 5 // tokens per second
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  private refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  private processQueue() {
    this.refill();
    while (this.queue.length > 0 && this.tokens >= 1) {
      this.tokens -= 1;
      const resolve = this.queue.shift()!;
      resolve();
    }
    if (this.queue.length > 0 && !this.timer) {
      const waitMs = ((1 - this.tokens) / this.refillRate) * 1000;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.processQueue();
      }, Math.max(waitMs, 50));
    }
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
      if (!this.timer) {
        const waitMs = ((1 - this.tokens) / this.refillRate) * 1000;
        this.timer = setTimeout(() => {
          this.timer = null;
          this.processQueue();
        }, Math.max(waitMs, 50));
      }
    });
  }
}
