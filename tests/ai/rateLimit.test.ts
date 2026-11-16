import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '@/ai/rateLimit';

describe('createRateLimiter', () => {
  it('permite apenas 1 requisição simultânea e libera após release()', () => {
    let now = 1_000;
    const limiter = createRateLimiter({ now: () => now });

    const first = limiter.tryAcquire();
    expect(first.ok).toBe(true);

    const concurrent = limiter.tryAcquire();
    expect(concurrent.ok).toBe(false);
    if (!concurrent.ok) {
      expect(concurrent.error.code).toBe('rate_limited');
      expect(concurrent.error.message.length).toBeGreaterThan(5);
    }

    limiter.release();
    limiter.release(); // idempotente

    now += 10;
    const second = limiter.tryAcquire();
    expect(second.ok).toBe(true);
    limiter.release();
  });

  it('aplica limite deslizante de 10 requisições por 60_000 ms e reseta após a janela', () => {
    let now = 10_000;
    const limiter = createRateLimiter({ maxRequests: 10, windowMs: 60_000, now: () => now });

    for (let i = 0; i < 10; i++) {
      const res = limiter.tryAcquire();
      expect(res.ok).toBe(true);
      limiter.release();
      now += 1_000;
    }

    // 11ª dentro da janela de 60s falha (sem consumir cota)
    const eleventh = limiter.tryAcquire();
    expect(eleventh.ok).toBe(false);
    if (!eleventh.ok) {
      expect(eleventh.error.code).toBe('rate_limited');
    }

    // Avança para além dos 60_000 ms da 1ª requisição (10_000 + 60_000)
    now = 70_001;
    const afterWindow = limiter.tryAcquire();
    expect(afterWindow.ok).toBe(true);
    limiter.release();
  });
});
