import { err, ok, type GenError, type Result } from '../core';

export const DEFAULT_RATE_LIMIT_MAX = 10;
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

export interface RateLimiterOptions {
  readonly maxRequests?: number;
  readonly windowMs?: number;
  readonly now?: () => number;
}

export interface RateLimiter {
  tryAcquire(): Result<void, GenError>;
  release(): void;
}

/**
 * Limitador de taxa do cliente: garante 1 requisição ativa por vez e janela deslizante (padrão 10/min).
 */
export function createRateLimiter(opts: RateLimiterOptions = {}): RateLimiter {
  const maxRequests = opts.maxRequests ?? DEFAULT_RATE_LIMIT_MAX;
  const windowMs = opts.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
  const now = opts.now ?? (() => Date.now());

  let inFlight = false;
  let timestamps: number[] = [];

  return {
    tryAcquire(): Result<void, GenError> {
      if (inFlight) {
        return err({
          code: 'rate_limited',
          message:
            'Já existe uma geração em andamento. Aguarde a conclusão ou cancele antes de iniciar outra.',
        });
      }

      const currentTime = now();
      timestamps = timestamps.filter((ts) => currentTime - ts < windowMs);

      if (timestamps.length >= maxRequests) {
        return err({
          code: 'rate_limited',
          message: `Limite de ${maxRequests} gerações por minuto atingido. Aguarde alguns segundos e tente novamente.`,
        });
      }

      timestamps.push(currentTime);
      inFlight = true;
      return ok(undefined);
    },

    release(): void {
      inFlight = false;
    },
  };
}
