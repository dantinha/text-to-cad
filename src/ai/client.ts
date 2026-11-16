import {
  err,
  validateIR,
  type GenError,
  type GenerateIR,
  type GenOptions,
  type IR,
  type IRIssue,
  type Result,
} from '../core';
import { sanitizePrompt } from './prompts';
import { createRateLimiter, type RateLimiter } from './rateLimit';

export const DEFAULT_AI_TIMEOUT_MS = 30_000;
const MAX_REPAIR_ATTEMPTS = 2;
const GEMINI_PROXY_ENDPOINT = '/api/gemini';

export interface AiGeneratorDeps {
  readonly fetchFn?: typeof fetch;
  readonly rateLimiter?: RateLimiter;
  readonly timeoutMs?: number;
}

interface ProxySuccessPayload {
  readonly ok: true;
  readonly text: string;
  readonly model?: string;
}

interface ProxyErrorPayload {
  readonly ok: false;
  readonly error?: { readonly code?: string; readonly message?: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripKeyFromMessage(message: string, userKey?: string): string {
  let clean = message
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, '[REDACTED]')
    .replace(/\bAQ\.[0-9A-Za-z_-]{10,}/g, '[REDACTED]');
  const trimmedKey = userKey?.trim();
  if (trimmedKey && trimmedKey.length >= 6) {
    clean = clean.split(trimmedKey).join('[REDACTED]');
  }
  return clean;
}

function extractErrorMessage(payload: unknown, userKey?: string): string | null {
  if (!isRecord(payload)) return null;
  const errorObj = payload['error'];
  if (!isRecord(errorObj)) return null;
  const message = errorObj['message'];
  if (typeof message !== 'string' || message.trim().length === 0) return null;
  return stripKeyFromMessage(message.trim(), userKey);
}

function extractErrorCode(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const errorObj = payload['error'];
  if (!isRecord(errorObj)) return null;
  return typeof errorObj['code'] === 'string' ? errorObj['code'] : null;
}

function isProxySuccess(payload: unknown): payload is ProxySuccessPayload {
  return (
    isRecord(payload) &&
    payload['ok'] === true &&
    typeof payload['text'] === 'string' &&
    payload['text'].trim().length > 0
  );
}

function isProxyFailure(payload: unknown): payload is ProxyErrorPayload {
  return isRecord(payload) && payload['ok'] === false;
}

function mapHttpFailure(status: number, payload: unknown, userKey?: string): GenError {
  const message = extractErrorMessage(payload, userKey);
  if (status === 429) {
    return {
      code: 'rate_limited',
      message:
        message ?? 'Limite de requisições atingido. Aguarde alguns segundos e tente novamente.',
    };
  }
  if (status === 400) {
    return {
      code: 'prompt_invalid',
      message: message ?? 'Descrição inválida para geração do modelo.',
    };
  }
  return {
    code: 'proxy_error',
    message: message ?? `Erro ao consultar o serviço de IA (HTTP ${status}).`,
  };
}

/**
 * Cria a função `generateIR` com injeção de dependências para testes unitários puros.
 */
export function createAiGenerator(deps: AiGeneratorDeps = {}): GenerateIR {
  const fetchFn = deps.fetchFn ?? fetch;
  const rateLimiter = deps.rateLimiter ?? createRateLimiter();
  const timeoutMs = deps.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
  const timeoutSeconds = Math.max(1, Math.round(timeoutMs / 1000));
  const timeoutMessage = `Tempo limite de ${timeoutSeconds} segundos excedido ao gerar o modelo.`;

  return async function generateIR(
    prompt: string,
    opts: GenOptions = {},
  ): Promise<Result<IR, GenError>> {
    if (opts.signal?.aborted) {
      return err({ code: 'cancelled', message: 'Geração cancelada pelo usuário.' });
    }

    const sanitized = sanitizePrompt(prompt);
    if (!sanitized.ok) {
      return sanitized;
    }

    const acquired = rateLimiter.tryAcquire();
    if (!acquired.ok) {
      return acquired;
    }

    const controller = new AbortController();
    let userAborted = false;
    let timedOut = false;

    const onUserAbort = () => {
      userAborted = true;
      controller.abort();
    };

    if (opts.signal) {
      opts.signal.addEventListener('abort', onUserAbort, { once: true });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const userKey = opts.userKey?.trim();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (userKey && userKey.length > 0) {
        headers['x-user-key'] = userKey;
      }

      let previousJson: string | undefined;
      let lastIssues: readonly IRIssue[] = [];

      for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
        const bodyPayload =
          attempt === 0 || previousJson === undefined
            ? { prompt: sanitized.value }
            : {
                prompt: sanitized.value,
                repair: {
                  previousJson,
                  issues: lastIssues,
                },
              };

        let response: Response;
        try {
          response = await fetchFn(GEMINI_PROXY_ENDPOINT, {
            method: 'POST',
            headers,
            body: JSON.stringify(bodyPayload),
            signal: controller.signal,
          });
        } catch (cause) {
          if (userAborted || opts.signal?.aborted) {
            return err({ code: 'cancelled', message: 'Geração cancelada pelo usuário.' });
          }
          if (timedOut) {
            return err({
              code: 'timeout',
              message: timeoutMessage,
            });
          }
          if (cause instanceof Error && cause.name === 'AbortError') {
            return err({ code: 'cancelled', message: 'Geração cancelada.' });
          }
          return err({
            code: 'network',
            message: 'Falha de rede ao conectar com o servidor de IA.',
          });
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch (cause) {
          if (userAborted || opts.signal?.aborted) {
            return err({ code: 'cancelled', message: 'Geração cancelada pelo usuário.' });
          }
          if (timedOut) {
            return err({
              code: 'timeout',
              message: timeoutMessage,
            });
          }
          if (cause instanceof Error && cause.name === 'AbortError') {
            return err({ code: 'cancelled', message: 'Geração cancelada.' });
          }
          if (!response.ok) {
            return err(mapHttpFailure(response.status, null, userKey));
          }
          return err({
            code: 'invalid_response',
            message: 'Resposta inválida recebida do servidor de IA.',
          });
        }

        if (!response.ok) {
          return err(mapHttpFailure(response.status, payload, userKey));
        }

        if (isProxyFailure(payload)) {
          const code = extractErrorCode(payload);
          if (code === 'rate_limited') {
            return err(mapHttpFailure(429, payload, userKey));
          }
          return err({
            code: 'proxy_error',
            message: extractErrorMessage(payload, userKey) ?? 'Erro inesperado no servidor de IA.',
          });
        }

        if (!isProxySuccess(payload)) {
          return err({
            code: 'invalid_response',
            message: 'Resposta inesperada recebida do servidor de IA.',
          });
        }

        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(payload.text);
        } catch {
          previousJson = payload.text;
          lastIssues = [
            {
              path: '',
              code: 'formato_invalido',
              message: 'A resposta não é um objeto JSON sintaticamente válido.',
            },
          ];
          continue;
        }

        const validated = validateIR(parsedJson);
        if (validated.ok) {
          return validated;
        }

        previousJson = payload.text;
        lastIssues = validated.error;
      }

      return err({
        code: 'repair_failed',
        message:
          'Não foi possível gerar um modelo 3D válido após as tentativas de correção. Tente reformular a descrição.',
        issues: lastIssues,
      });
    } finally {
      clearTimeout(timer);
      if (opts.signal) {
        opts.signal.removeEventListener('abort', onUserAbort);
      }
      rateLimiter.release();
    }
  };
}

/** Instância padrão de geração de IR via proxy `/api/gemini`. */
export const generateIR: GenerateIR = createAiGenerator();
