interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const STORAGE_KEY_PREFIX = 'daubert_cache_';
const MAX_ENTRIES = 200;

export class ResponseCache {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_PREFIX + key);
      if (!raw) return null;
      const entry: CacheEntry<T> = JSON.parse(raw);
      if (Date.now() > entry.expiresAt) {
        localStorage.removeItem(STORAGE_KEY_PREFIX + key);
        return null;
      }
      return entry.data;
    } catch {
      return null;
    }
  }

  set<T>(key: string, data: T, ttlMs: number): void {
    const entry: CacheEntry<T> = {
      data,
      expiresAt: Date.now() + ttlMs,
    };
    try {
      localStorage.setItem(STORAGE_KEY_PREFIX + key, JSON.stringify(entry));
    } catch {
      // Storage full — evict oldest entries and retry
      this.evict();
      try {
        localStorage.setItem(STORAGE_KEY_PREFIX + key, JSON.stringify(entry));
      } catch {
        // Still full, give up silently
      }
    }
  }

  private evict(): void {
    const keys: { key: string; expiresAt: number }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_KEY_PREFIX)) {
        try {
          const raw = localStorage.getItem(key)!;
          const entry = JSON.parse(raw);
          keys.push({ key, expiresAt: entry.expiresAt });
        } catch {
          localStorage.removeItem(key);
        }
      }
    }

    // Remove expired first
    const now = Date.now();
    for (const { key, expiresAt } of keys) {
      if (expiresAt < now) {
        localStorage.removeItem(key);
      }
    }

    // If still too many, remove oldest
    const remaining = keys.filter((k) => k.expiresAt >= now);
    if (remaining.length > MAX_ENTRIES) {
      remaining.sort((a, b) => a.expiresAt - b.expiresAt);
      const toRemove = remaining.slice(0, remaining.length - MAX_ENTRIES);
      for (const { key } of toRemove) {
        localStorage.removeItem(key);
      }
    }
  }

  buildKey(chain: string, endpoint: string, params: Record<string, string>): string {
    const sorted = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
    return `${chain}:${endpoint}:${sorted.map(([k, v]) => `${k}=${v}`).join('&')}`;
  }
}
