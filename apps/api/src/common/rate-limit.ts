import { HttpException, HttpStatus } from '@nestjs/common';

/** Простое ограничение частоты запросов в памяти процесса (одна копия API). */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly max: number, private readonly windowMs: number) {}

  check(key: string) {
    const now = Date.now();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      throw new HttpException({ message: 'Слишком много запросов, попробуйте через несколько минут' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
  }
}
