import type { Storage } from "../storage";

export class CachedProvider {
  private pending = new Map<string, Promise<any>>();
  constructor(protected storage: Storage) {}
  protected async cached<T>(
    key: string,
    ttl: number,
    fetch: () => Promise<T>,
  ): Promise<{ data: T; stale: boolean }> {
    const stored = await this.storage.cache<T>(key);
    if (stored && Date.now() - stored.at < ttl)
      return { data: stored.data, stale: false };
    if (!this.pending.has(key)) {
      const request = fetch()
        .then(async (data) => {
          await this.storage.put(key, data);
          return { data, stale: false };
        })
        .catch((error) => {
          if (stored) return { data: stored.data, stale: true };
          throw error;
        })
        .finally(() => this.pending.delete(key));
      this.pending.set(key, request);
    }
    return this.pending.get(key)!;
  }
}
