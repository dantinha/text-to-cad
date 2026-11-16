import {
  handleGeminiProxyRequest,
  isOriginAllowed,
  MAX_PROXY_BODY_BYTES,
  parseAllowedOrigins,
  type GeminiClientFactory,
  type ProxyEnv,
} from './proxy-core';

const DEFAULT_IP_RATE_LIMIT_MAX = 15;
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_TRACKED_IPS = 1_000;
const GEMINI_ENDPOINT_PATH = '/api/gemini';

export interface WorkerEnv extends ProxyEnv {
  readonly RATE_LIMIT_MAX?: string;
}

export interface WorkerHandler {
  fetch(request: Request, env: WorkerEnv): Promise<Response>;
}

export interface WorkerDeps {
  readonly clientFactory?: GeminiClientFactory;
  readonly now?: () => number;
}

function getClientIp(request: Request): string {
  const cfIp = request.headers.get('cf-connecting-ip')?.trim();
  if (cfIp) return cfIp;

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }

  return 'unknown';
}

function parseRateLimitMax(raw?: string): number {
  if (!raw) return DEFAULT_IP_RATE_LIMIT_MAX;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_IP_RATE_LIMIT_MAX;
}

function buildCorsHeaders(
  origin: string | null,
  env: WorkerEnv,
  selfOrigin: string,
): Record<string, string> {
  if (!origin) return {};
  const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  if (allowed.length > 0) {
    return allowed.includes(origin)
      ? {
          'Access-Control-Allow-Origin': origin,
          Vary: 'Origin',
        }
      : {};
  }
  if (origin === selfOrigin) {
    return {
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
    };
  }
  return {};
}

async function readLimitedRequestBody(
  request: Request,
  maxBytes: number,
): Promise<
  { ok: true; text: string } | { ok: false; status: number; code: string; message: string }
> {
  if (!request.body) {
    return { ok: true, text: '' };
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        parts.push(decoder.decode());
        return { ok: true, text: parts.join('') };
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        return {
          ok: false,
          status: 413,
          code: 'payload_too_large',
          message: 'Payload excede o limite de 150 KB.',
        };
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
  } catch {
    return {
      ok: false,
      status: 400,
      code: 'read_error',
      message: 'Falha ao ler o corpo da requisição.',
    };
  } finally {
    reader.releaseLock();
  }
}

function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

/**
 * Cria o handler do Cloudflare Worker com rate limit por IP (em memória por isolate)
 * e allowlist obrigatória de `Origin` quando `ALLOWED_ORIGINS` está configurado.
 */
export function createWorkerHandler(deps: WorkerDeps = {}): WorkerHandler {
  const now = deps.now ?? (() => Date.now());
  const ipHits = new Map<string, number[]>();

  function pruneExpiredIps(current: number): void {
    for (const [trackedIp, timestamps] of ipHits.entries()) {
      const active = timestamps.filter((ts) => current - ts < RATE_LIMIT_WINDOW_MS);
      if (active.length === 0) {
        ipHits.delete(trackedIp);
      } else {
        ipHits.set(trackedIp, active);
      }
    }
  }

  function checkIpRateLimit(ip: string, maxRequests: number): boolean {
    const current = now();
    if (ipHits.size > MAX_TRACKED_IPS) {
      pruneExpiredIps(current);
    }
    const existing = ipHits.get(ip) ?? [];
    const valid = existing.filter((ts) => current - ts < RATE_LIMIT_WINDOW_MS);

    if (valid.length >= maxRequests) {
      ipHits.set(ip, valid);
      return false;
    }

    valid.push(current);
    ipHits.set(ip, valid);
    return true;
  }

  return {
    async fetch(request: Request, env: WorkerEnv): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname !== GEMINI_ENDPOINT_PATH) {
        return jsonResponse(404, {
          ok: false,
          error: { code: 'not_found', message: 'Rota não encontrada.' },
        });
      }

      const origin = request.headers.get('origin');
      const selfOrigin = url.origin;
      const allowedList = parseAllowedOrigins(env.ALLOWED_ORIGINS);

      if (request.method.toUpperCase() === 'OPTIONS') {
        const originOk =
          allowedList.length > 0
            ? origin !== null && allowedList.includes(origin)
            : origin === null || origin === selfOrigin;
        if (!originOk) {
          return jsonResponse(403, {
            ok: false,
            error: { code: 'origin_forbidden', message: 'Origem não autorizada.' },
          });
        }
        return new Response(null, {
          status: 204,
          headers: {
            ...buildCorsHeaders(origin, env, selfOrigin),
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, x-user-key',
          },
        });
      }

      if (
        !isOriginAllowed(origin, env, {
          allowLocalhostOrigin: false,
          failClosedWithoutAllowlist: true,
          selfOrigin,
        })
      ) {
        return jsonResponse(403, {
          ok: false,
          error: { code: 'origin_forbidden', message: 'Origem da requisição não autorizada.' },
        });
      }

      const corsHeaders = buildCorsHeaders(origin, env, selfOrigin);
      const clientIp = getClientIp(request);
      const maxRequests = parseRateLimitMax(env.RATE_LIMIT_MAX);

      if (!checkIpRateLimit(clientIp, maxRequests)) {
        return jsonResponse(
          429,
          {
            ok: false,
            error: {
              code: 'rate_limited',
              message: 'Limite de requisições por IP atingido. Aguarde um minuto.',
            },
          },
          corsHeaders,
        );
      }

      const contentLength = Number.parseInt(request.headers.get('content-length') ?? '', 10);
      if (Number.isFinite(contentLength) && contentLength > MAX_PROXY_BODY_BYTES) {
        return jsonResponse(
          413,
          {
            ok: false,
            error: { code: 'payload_too_large', message: 'Payload excede o limite de 150 KB.' },
          },
          corsHeaders,
        );
      }

      const bodyResult = await readLimitedRequestBody(request, MAX_PROXY_BODY_BYTES);
      if (!bodyResult.ok) {
        return jsonResponse(
          bodyResult.status,
          {
            ok: false,
            error: { code: bodyResult.code, message: bodyResult.message },
          },
          corsHeaders,
        );
      }

      const proxyRes = await handleGeminiProxyRequest({
        method: request.method,
        headers: request.headers,
        rawBody: bodyResult.text,
        env,
        allowLocalhostOrigin: false,
        failClosedWithoutAllowlist: true,
        selfOrigin,
        abortSignal: request.signal,
        clientFactory: deps.clientFactory,
      });

      return new Response(JSON.stringify(proxyRes.body), {
        status: proxyRes.status,
        headers: {
          ...proxyRes.headers,
          ...corsHeaders,
        },
      });
    },
  };
}

const worker: WorkerHandler = createWorkerHandler();
export default worker;
