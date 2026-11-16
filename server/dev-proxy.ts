import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import {
  handleGeminiProxyRequest,
  isLocalhostOrigin,
  MAX_PROXY_BODY_BYTES,
  type GeminiClientFactory,
  type ProxyResponse,
} from './proxy-core';

export interface GeminiDevPluginOptions {
  readonly env?: Record<string, string | undefined>;
  readonly clientFactory?: GeminiClientFactory;
}

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const line = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function loadDevEnv(mode: string, root: string): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = {};
  const files = ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`];
  for (const file of files) {
    const fullPath = join(root, file);
    if (!existsSync(fullPath)) continue;
    Object.assign(merged, parseEnvContent(readFileSync(fullPath, 'utf8')));
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && value !== '') {
      merged[key] = value;
    }
  }
  return merged;
}

function writeProxyResponse(res: ServerResponse, proxyRes: ProxyResponse): void {
  if (res.writableEnded) return;
  res.statusCode = proxyRes.status;
  for (const [key, value] of Object.entries(proxyRes.headers)) {
    res.setHeader(key, value);
  }
  res.end(JSON.stringify(proxyRes.body));
}

function readLimitedBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<
  { ok: true; text: string } | { ok: false; status: number; code: string; message: string }
> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    const finish = (
      result:
        { ok: true; text: string } | { ok: false; status: number; code: string; message: string },
    ) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    req.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
      totalBytes += buf.byteLength;
      if (totalBytes > maxBytes) {
        finish({
          ok: false,
          status: 413,
          code: 'payload_too_large',
          message: 'Payload excede o limite de 150 KB.',
        });
        if (typeof req.destroy === 'function') {
          req.destroy();
        }
        return;
      }
      chunks.push(buf);
    });

    req.on('end', () => {
      finish({ ok: true, text: Buffer.concat(chunks).toString('utf8') });
    });

    req.on('error', () => {
      finish({
        ok: false,
        status: 400,
        code: 'read_error',
        message: 'Falha ao ler o corpo da requisição.',
      });
    });
  });
}

/**
 * Plugin Vite para desenvolvimento: expõe `POST /api/gemini` lendo `.env.local` sem prefixo `VITE_`.
 */
export function createGeminiDevPlugin(options: GeminiDevPluginOptions = {}): Plugin {
  return {
    name: 'text-to-cad-gemini-dev-proxy',
    configureServer(server) {
      const env = options.env ?? loadDevEnv(server.config.mode, server.config.root);

      server.middlewares.use('/api/gemini', (req: IncomingMessage, res: ServerResponse) => {
        const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null;

        if (req.method?.toUpperCase() === 'OPTIONS') {
          if (origin !== null && !isLocalhostOrigin(origin)) {
            writeProxyResponse(res, {
              status: 403,
              headers: SECURITY_HEADERS,
              body: {
                ok: false,
                error: { code: 'origin_forbidden', message: 'Origem não autorizada.' },
              },
            });
            return;
          }
          res.statusCode = 204;
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          if (origin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
          }
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-key');
          res.end();
          return;
        }

        const controller = new AbortController();
        req.on('close', () => {
          if (!req.complete) {
            controller.abort();
          }
        });
        res.on('close', () => {
          if (!res.writableFinished) {
            controller.abort();
          }
        });

        void (async () => {
          try {
            const bodyResult = await readLimitedBody(req, MAX_PROXY_BODY_BYTES);
            if (!bodyResult.ok) {
              writeProxyResponse(res, {
                status: bodyResult.status,
                headers: SECURITY_HEADERS,
                body: { ok: false, error: { code: bodyResult.code, message: bodyResult.message } },
              });
              return;
            }

            const proxyRes = await handleGeminiProxyRequest({
              method: req.method ?? 'GET',
              headers: req.headers,
              rawBody: bodyResult.text,
              env,
              allowLocalhostOrigin: true,
              abortSignal: controller.signal,
              clientFactory: options.clientFactory,
            });

            writeProxyResponse(res, proxyRes);
          } catch {
            if (!res.writableEnded) {
              writeProxyResponse(res, {
                status: 500,
                headers: SECURITY_HEADERS,
                body: {
                  ok: false,
                  error: {
                    code: 'internal_error',
                    message: 'Erro interno inesperado no proxy de desenvolvimento.',
                  },
                },
              });
            }
          }
        })();
      });
    },
  };
}
