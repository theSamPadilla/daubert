interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const MAX_ENTRIES = 200;

export class ResponseCache {
  private store = new Map<string, string>();

  get<T>(key: string): T | null {
    const raw = this.store.get(key);
    if (!raw) return null;
    try {
      const entry: CacheEntry<T> = JSON.parse(raw);
      if (Date.now() > entry.expiresAt) {
        this.store.delete(key);
        return null;
      }
      return entry.data;
    } catch {
      this.store.delete(key);
      return null;
    }
  }

  set<T>(key: string, data: T, ttlMs: number): void {
    const entry: CacheEntry<T> = {
      data,
      expiresAt: Date.now() + ttlMs,
    };
    this.store.set(key, JSON.stringify(entry));
    if (this.store.size > MAX_ENTRIES) {
      this.evict();
    }
  }

  private evict(): void {
    const now = Date.now();
    // Remove expired first
    for (const [key, raw] of this.store.entries()) {
      try {
        const entry = JSON.parse(raw);
        if (entry.expiresAt < now) {
          this.store.delete(key);
        }
      } catch {
        this.store.delete(key);
      }
    }
    // If still too many, remove oldest
    if (this.store.size > MAX_ENTRIES) {
      const entries: { key: string; expiresAt: number }[] = [];
      for (const [key, raw] of this.store.entries()) {
        try {
          entries.push({ key, expiresAt: JSON.parse(raw).expiresAt });
        } catch {
          this.store.delete(key);
        }
      }
      entries.sort((a, b) => a.expiresAt - b.expiresAt);
      const toRemove = entries.slice(0, entries.length - MAX_ENTRIES);
      for (const { key } of toRemove) {
        this.store.delete(key);
      }
    }
  }

  buildKey(
    chain: string,
    endpoint: string,
    params: Record<string, string>,
  ): string {
    const sorted = Object.entries(params).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `${chain}:${endpoint}:${sorted.map(([k, v]) => `${k}=${v}`).join('&')}`;
  }
}
