import { z } from 'zod';
import { buildGeminiIrSchema } from '../src/ai/geminiSchema';
import {
  buildRepairPrompt,
  buildUserGenerationPrompt,
  MAX_PROMPT_LENGTH,
  sanitizePrompt,
  STATIC_SYSTEM_INSTRUCTION,
} from '../src/ai/prompts';
import type { IRIssueCode } from '../src/core';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
export const MAX_PROXY_BODY_BYTES = 150 * 1024;

const MAX_REPAIR_JSON_BODY = 100_000;
const MAX_REPAIR_ISSUES = 50;

const IR_ISSUE_CODES = [
  'campo_obrigatorio',
  'campo_desconhecido',
  'tipo_invalido',
  'formato_invalido',
  'valor_invalido',
  'valor_fora_do_limite',
  'schema_version',
  'unidade_invalida',
  'id_duplicado',
  'limite_nos',
  'limite_profundidade',
  'ciclo',
] as const satisfies readonly IRIssueCode[];

const issueSchema = z.strictObject({
  path: z.string().max(200),
  code: z.enum(IR_ISSUE_CODES),
  message: z.string().max(500),
});

const proxyRequestBodySchema = z.strictObject({
  prompt: z.string().min(1).max(MAX_PROMPT_LENGTH),
  repair: z
    .strictObject({
      previousJson: z.string().max(MAX_REPAIR_JSON_BODY),
      issues: z.array(issueSchema).max(MAX_REPAIR_ISSUES),
    })
    .optional(),
});

export interface GeminiClient {
  generateContent(params: {
    model: string;
    contents: string;
    config: {
      systemInstruction: string;
      temperature: number;
      responseMimeType: string;
      responseJsonSchema: Record<string, unknown>;
      abortSignal?: AbortSignal;
    };
  }): Promise<{ text?: string }>;
}

export type GeminiClientFactory = (apiKey: string) => GeminiClient;

export interface ProxyEnv {
  readonly GEMINI_API_KEY?: string;
  readonly GEMINI_MODEL?: string;
  readonly ALLOWED_ORIGINS?: string;
}

export type HeaderBag =
  { get(name: string): string | null } | Readonly<Record<string, string | string[] | undefined>>;

export interface ProxyRequestInput {
  readonly method: string;
  readonly headers: HeaderBag;
  readonly rawBody: string;
  readonly env: ProxyEnv;
  readonly allowLocalhostOrigin?: boolean;
  readonly failClosedWithoutAllowlist?: boolean;
  readonly selfOrigin?: string;
  readonly abortSignal?: AbortSignal;
  readonly clientFactory?: GeminiClientFactory;
}

export interface ProxyResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body:
    | { readonly ok: true; readonly text: string; readonly model: string }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };
}

const DEFAULT_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const defaultClientFactory: GeminiClientFactory = (apiKey: string): GeminiClient => ({
  generateContent: async (params) => {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    return ai.models.generateContent(params);
  },
});

let cachedGeminiIrSchema: Record<string, unknown> | null = null;

function getGeminiIrSchema(): Record<string, unknown> {
  if (cachedGeminiIrSchema === null) {
    cachedGeminiIrSchema = buildGeminiIrSchema();
  }
  return cachedGeminiIrSchema;
}

function hasGetMethod(headers: HeaderBag): headers is { get(name: string): string | null } {
  return 'get' in headers && typeof headers.get === 'function';
}

function readHeader(headers: HeaderBag, name: string): string | null {
  if (hasGetMethod(headers)) {
    return headers.get(name);
  }
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) {
      if (Array.isArray(v)) {
        return typeof v[0] === 'string' ? v[0] : null;
      }
      return typeof v === 'string' ? v : null;
    }
  }
  return null;
}

export function parseAllowedOrigins(raw?: string): readonly string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function isLocalhostOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '[::1]')
    );
  } catch {
    return false;
  }
}

export interface OriginCheckOptions {
  readonly allowLocalhostOrigin?: boolean;
  readonly failClosedWithoutAllowlist?: boolean;
  readonly selfOrigin?: string;
}

export function isOriginAllowed(
  origin: string | null,
  env: ProxyEnv,
  allowLocalhostOrOpts: boolean | OriginCheckOptions = false,
): boolean {
  if (origin === null) {
    return true;
  }
  const opts: OriginCheckOptions =
    typeof allowLocalhostOrOpts === 'boolean'
      ? { allowLocalhostOrigin: allowLocalhostOrOpts }
      : allowLocalhostOrOpts;

  const allowedList = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  if (allowedList.length > 0) {
    if (allowedList.includes(origin)) return true;
    return Boolean(opts.allowLocalhostOrigin && isLocalhostOrigin(origin));
  }
  if (opts.allowLocalhostOrigin) {
    return isLocalhostOrigin(origin);
  }
  if (opts.failClosedWithoutAllowlist) {
    return opts.selfOrigin !== undefined && origin === opts.selfOrigin;
  }
  return true;
}

/**
 * Remove qualquer indício de chaves de API, tokens ou headers sensíveis antes de retornar ou logar erros.
 */
export function sanitizeErrorMessage(err: unknown, knownSecret?: string): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'Erro interno ao consultar o modelo Gemini.';

  let sanitized = raw
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, '[REDACTED_KEY]')
    .replace(/\bAQ\.[0-9A-Za-z_-]{10,}/g, '[REDACTED_TOKEN]')
    .replace(/([?&](?:key|api_key|token)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(x-user-key|x-goog-api-key|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1: [REDACTED]');

  const trimmedSecret = knownSecret?.trim();
  if (trimmedSecret && trimmedSecret.length >= 6) {
    sanitized = sanitized.split(trimmedSecret).join('[REDACTED_KEY]');
  }

  return sanitized.slice(0, 400);
}

function errorResponse(status: number, code: string, message: string): ProxyResponse {
  return {
    status,
    headers: DEFAULT_HEADERS,
    body: { ok: false, error: { code, message } },
  };
}

function getErrorStatus(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    return typeof err.status === 'number' ? err.status : undefined;
  }
  return undefined;
}

/**
 * Núcleo puro de tratamento do endpoint `POST /api/gemini` (compartilhado entre Node/Vite e Cloudflare Worker).
 */
export async function handleGeminiProxyRequest(input: ProxyRequestInput): Promise<ProxyResponse> {
  if (input.method.toUpperCase() !== 'POST') {
    return errorResponse(405, 'method_not_allowed', 'Método não permitido. Utilize POST.');
  }

  const origin = readHeader(input.headers, 'origin');
  if (
    !isOriginAllowed(origin, input.env, {
      allowLocalhostOrigin: input.allowLocalhostOrigin,
      failClosedWithoutAllowlist: input.failClosedWithoutAllowlist,
      selfOrigin: input.selfOrigin,
    })
  ) {
    return errorResponse(403, 'origin_forbidden', 'Origem da requisição não autorizada.');
  }

  const byteLength = new TextEncoder().encode(input.rawBody).byteLength;
  if (byteLength > MAX_PROXY_BODY_BYTES) {
    return errorResponse(413, 'payload_too_large', 'Payload excede o limite de 150 KB.');
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(input.rawBody);
  } catch {
    return errorResponse(400, 'invalid_json', 'Corpo da requisição não é um JSON válido.');
  }

  const bodyParsed = proxyRequestBodySchema.safeParse(rawJson);
  if (!bodyParsed.success) {
    return errorResponse(400, 'invalid_request', 'Parâmetros da requisição inválidos.');
  }

  const sanitized = sanitizePrompt(bodyParsed.data.prompt);
  if (!sanitized.ok) {
    return errorResponse(400, 'prompt_invalid', sanitized.error.message);
  }

  const userKey = readHeader(input.headers, 'x-user-key')?.trim() ?? '';
  const serverKey = input.env.GEMINI_API_KEY?.trim() ?? '';
  const effectiveKey = userKey.length > 0 ? userKey : serverKey;

  if (effectiveKey.length === 0) {
    return errorResponse(
      503,
      'missing_api_key',
      'Chave GEMINI_API_KEY não configurada no servidor.',
    );
  }

  const model = input.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const contents = bodyParsed.data.repair
    ? buildRepairPrompt(
        sanitized.value,
        bodyParsed.data.repair.previousJson,
        bodyParsed.data.repair.issues,
      )
    : buildUserGenerationPrompt(sanitized.value);

  const clientFactory = input.clientFactory ?? defaultClientFactory;
  const client = clientFactory(effectiveKey);

  try {
    const result = await client.generateContent({
      model,
      contents,
      config: {
        systemInstruction: STATIC_SYSTEM_INSTRUCTION,
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseJsonSchema: getGeminiIrSchema(),
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      },
    });

    if (typeof result.text !== 'string' || result.text.trim().length === 0) {
      return errorResponse(502, 'empty_response', 'O modelo Gemini não retornou conteúdo.');
    }

    return {
      status: 200,
      headers: DEFAULT_HEADERS,
      body: { ok: true, text: result.text, model },
    };
  } catch (err) {
    if (input.abortSignal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
      return errorResponse(499, 'cancelled', 'Requisição cancelada.');
    }

    const upstreamStatus = getErrorStatus(err);
    const cleanMsg = sanitizeErrorMessage(err, effectiveKey);

    if (upstreamStatus === 429 || cleanMsg.includes('RESOURCE_EXHAUSTED')) {
      return errorResponse(
        429,
        'rate_limited',
        'Limite de taxa da API Gemini atingido. Aguarde e tente novamente.',
      );
    }

    return errorResponse(502, 'upstream_error', cleanMsg);
  }
}
