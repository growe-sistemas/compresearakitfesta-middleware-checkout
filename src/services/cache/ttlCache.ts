/**
 * Cache em memoria com TTL e limite de entradas (LRU simples).
 *
 * Escopo deliberadamente pequeno: guarda o resultado de consulta cara a
 * upstream (hoje, a consolidacao de CNPJ). Nao substitui cache distribuido —
 * e por instancia e some no restart. Ainda assim resolve o caso real: varios
 * cliques em "Buscar" com o mesmo CNPJ dentro da mesma sessao, e o mesmo CNPJ
 * consultado por clientes diferentes ao longo do dia.
 */
export interface CacheEntry<T> {
  value: T;
  /** Momento (epoch ms) em que a entrada foi gravada. */
  storedAt: number;
}

export interface CacheHit<T> {
  value: T;
  ageSeconds: number;
}

export class TtlCache<T> {
  readonly #entries = new Map<string, CacheEntry<T>>();
  readonly #ttlMs: number;
  readonly #maxEntries: number;

  constructor(options: { ttlMs: number; maxEntries: number }) {
    this.#ttlMs = options.ttlMs;
    this.#maxEntries = options.maxEntries;
  }

  get(key: string): CacheHit<T> | null {
    // TTL zero desliga o cache sem precisar de flag separada.
    if (this.#ttlMs === 0) return null;

    const entry = this.#entries.get(key);
    if (entry === undefined) return null;

    const ageMs = Date.now() - entry.storedAt;
    if (ageMs > this.#ttlMs) {
      this.#entries.delete(key);
      return null;
    }

    // Reinsere para virar a entrada mais recente (ordem do Map = ordem de uso).
    this.#entries.delete(key);
    this.#entries.set(key, entry);

    return { value: entry.value, ageSeconds: Math.floor(ageMs / 1000) };
  }

  set(key: string, value: T): void {
    if (this.#ttlMs === 0) return;

    this.#entries.delete(key);
    this.#entries.set(key, { value, storedAt: Date.now() });

    while (this.#entries.size > this.#maxEntries) {
      // O primeiro do Map e o menos recentemente usado.
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
    }
  }

  get size(): number {
    return this.#entries.size;
  }

  clear(): void {
    this.#entries.clear();
  }
}
