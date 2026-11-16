import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ViteDevServer } from 'vite';
import { cubeDoc } from '../fixtures/ir';
import {
  DEFAULT_GEMINI_MODEL,
  handleGeminiProxyRequest,
  sanitizeErrorMessage,
  type GeminiClientFactory,
} from '../../server/proxy-core';
import { createGeminiDevPlugin } from '../../server/dev-proxy';
import { createWorkerHandler } from '../../server/worker';

const makeFakeGoogleKey = (suffix = '1234567890') => `AIza${'FakeKeyTestPart'}${suffix}ABCDEFG`;
const makeFakeAiStudioToken = () => `AQ.${'AbCdEfGhIjKlMnOpQrStUvWxYz'}`;

function createMockReq(opts: {
  method: string;
  url?: string;
  headers?: Record<string, string | string[]>;
  body?: string;
  complete?: boolean;
}) {
  const emitter = new EventEmitter();
  const req = Object.assign(emitter, {
    method: opts.method,
    url: opts.url ?? '/',
    headers: opts.headers ?? {},
    complete: opts.complete ?? true,
    destroy: vi.fn(() => emitter),
  });

  const sendBody = () => {
    queueMicrotask(() => {
      if (opts.body !== undefined) {
        emitter.emit('data', Buffer.from(opts.body, 'utf8'));
      }
      emitter.emit('end');
    });
  };

  return {
    req: req as unknown as IncomingMessage & EventEmitter & { complete: boolean },
    sendBody,
  };
}

interface MockResState {
  statusCode: number;
  writableFinished: boolean;
  writableEnded: boolean;
  bodyText: string;
  headersMap: Record<string, string>;
}

function createMockRes() {
  const emitter = new EventEmitter();
  const headersMap: Record<string, string> = {};

  const mock = Object.assign(emitter, {
    statusCode: 200,
    writableFinished: false,
    writableEnded: false,
    bodyText: '',
    headersMap,
    setHeader(name: string, value: string | number | readonly string[]) {
      headersMap[name.toLowerCase()] = Array.isArray(value) ? value.join(',') : String(value);
      return mock;
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) {
        mock.bodyText += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      }
      mock.writableFinished = true;
      mock.writableEnded = true;
      emitter.emit('finish');
      return mock;
    },
  });

  return mock as unknown as ServerResponse & EventEmitter & MockResState;
}

describe('proxy-core', () => {
  it('sanitizeErrorMessage remove chaves AIza, tokens AQ., query params e objetos desconhecidos', () => {
    const fakeKey = makeFakeGoogleKey();
    const fakeToken = makeFakeAiStudioToken();
    const msg = sanitizeErrorMessage(
      new Error(`Falha ao chamar ?key=${fakeKey} com ${fakeToken} e x-user-key: segredo123`),
    );

    expect(msg).not.toContain(fakeKey);
    expect(msg).not.toContain(fakeToken);
    expect(msg).not.toContain('segredo123');
    expect(msg).toContain('REDACTED');

    expect(sanitizeErrorMessage('texto simples')).toBe('texto simples');
    expect(sanitizeErrorMessage({ unknown: true })).toContain('Erro interno');
  });

  it('rejeita método != POST (405), Origin não autorizado (403) e payload > 150 KB (413)', async () => {
    const env = { GEMINI_API_KEY: makeFakeGoogleKey(), ALLOWED_ORIGINS: 'https://cad.app' };

    const getRes = await handleGeminiProxyRequest({
      method: 'GET',
      headers: {},
      rawBody: '',
      env,
    });
    expect(getRes.status).toBe(405);

    const originRes = await handleGeminiProxyRequest({
      method: 'POST',
      headers: { origin: 'https://evil.example' },
      rawBody: JSON.stringify({ prompt: 'cubo' }),
      env,
    });
    expect(originRes.status).toBe(403);

    const bigRes = await handleGeminiProxyRequest({
      method: 'POST',
      headers: { origin: 'https://cad.app' },
      rawBody: 'x'.repeat(151 * 1024),
      env,
    });
    expect(bigRes.status).toBe(413);
  });

  it('rejeita JSON inválido, body inválido, prompt vazio e trata 429 / resposta vazia do upstream', async () => {
    const env = { GEMINI_API_KEY: makeFakeGoogleKey('UPSTREAM') };

    const badJson = await handleGeminiProxyRequest({
      method: 'POST',
      headers: {},
      rawBody: '{',
      env,
    });
    expect(badJson.status).toBe(400);

    const extraField = await handleGeminiProxyRequest({
      method: 'POST',
      headers: {},
      rawBody: JSON.stringify({ prompt: 'cubo', unexpected: true }),
      env,
    });
    expect(extraField.status).toBe(400);

    const emptyPrompt = await handleGeminiProxyRequest({
      method: 'POST',
      headers: {},
      rawBody: JSON.stringify({ prompt: '   \u0000 ' }),
      env,
    });
    expect(emptyPrompt.status).toBe(400);

    const invalidIssueCode = await handleGeminiProxyRequest({
      method: 'POST',
      headers: {},
      rawBody: JSON.stringify({
        prompt: 'cubo 10mm',
        repair: {
          previousJson: '{}',
          issues: [{ path: 'root', code: 'codigo_inexistente', message: 'Erro' }],
        },
      }),
      env,
    });
    expect(invalidIssueCode.status).toBe(400);

    const emptyTextRes = await handleGeminiProxyRequest({
      method: 'POST',
      headers: {},
      rawBody: JSON.stringify({ prompt: 'cubo 10mm' }),
      env,
      clientFactory: () => ({ generateContent: vi.fn().mockResolvedValueOnce({ text: '   ' }) }),
    });
    expect(emptyTextRes.status).toBe(502);

    const rate429Res = await handleGeminiProxyRequest({
      method: 'POST',
      headers: {},
      rawBody: JSON.stringify({ prompt: 'cubo 10mm' }),
      env,
      clientFactory: () => ({
        generateContent: vi
          .fn()
          .mockRejectedValueOnce(Object.assign(new Error('quota'), { status: 429 })),
      }),
    });
    expect(rate429Res.status).toBe(429);
  });

  it('retorna 503 quando não há GEMINI_API_KEY nem x-user-key', async () => {
    const res = await handleGeminiProxyRequest({
      method: 'POST',
      headers: {},
      rawBody: JSON.stringify({ prompt: 'cubo 10mm' }),
      env: {},
    });
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    if (!res.body.ok) {
      expect(res.body.error.message).toBe('Chave GEMINI_API_KEY não configurada no servidor.');
    }
  });

  it('usa x-user-key (BYOK), suporta modo repair no servidor e nunca vaza chave em erro', async () => {
    const byokKey = makeFakeGoogleKey('BYOK999999');
    const capturedKeys: string[] = [];
    const generateContent = vi.fn().mockResolvedValue({ text: JSON.stringify(cubeDoc()) });
    const clientFactory: GeminiClientFactory = (apiKey) => {
      capturedKeys.push(apiKey);
      return { generateContent };
    };

    const okRes = await handleGeminiProxyRequest({
      method: 'POST',
      headers: { 'x-user-key': [byokKey] },
      rawBody: JSON.stringify({ prompt: 'cubo 10mm' }),
      env: { GEMINI_API_KEY: makeFakeGoogleKey('SERVER111') },
      clientFactory,
    });

    expect(okRes.status).toBe(200);
    expect(capturedKeys).toEqual([byokKey]);
    expect(okRes.body).toEqual({
      ok: true,
      text: JSON.stringify(cubeDoc()),
      model: DEFAULT_GEMINI_MODEL,
    });

    const callArgs = generateContent.mock.calls[0]?.[0] as {
      model: string;
      contents: string;
      config: {
        temperature: number;
        responseMimeType: string;
        responseJsonSchema: Record<string, unknown>;
      };
    };
    expect(callArgs.contents).toContain('<descricao_peca>cubo 10mm</descricao_peca>');
    expect(callArgs.config.temperature).toBe(0.2);
    expect(callArgs.config.responseMimeType).toBe('application/json');
    expect(callArgs.config.responseJsonSchema['$schema']).toBeUndefined();

    // Fluxo de reparo no servidor
    const repairRes = await handleGeminiProxyRequest({
      method: 'POST',
      headers: { 'x-user-key': byokKey },
      rawBody: JSON.stringify({
        prompt: 'cubo 10mm',
        repair: {
          previousJson: '{}',
          issues: [{ path: 'root', code: 'campo_obrigatorio', message: 'Falta root' }],
        },
      }),
      env: {},
      clientFactory,
    });
    expect(repairRes.status).toBe(200);
    const repairCallArgs = generateContent.mock.calls[1]?.[0] as { contents: string };
    expect(repairCallArgs.contents).toContain('<erros_validacao>');
    expect(repairCallArgs.contents).toContain('Falta root');

    // Erro contendo chave não pode vazar na resposta
    generateContent.mockRejectedValueOnce(new Error(`Upstream rejected ${byokKey}`));
    const errRes = await handleGeminiProxyRequest({
      method: 'POST',
      headers: { 'x-user-key': byokKey },
      rawBody: JSON.stringify({ prompt: 'cubo 10mm' }),
      env: {},
      clientFactory,
    });
    expect(errRes.status).toBe(502);
    expect(JSON.stringify(errRes.body)).not.toContain(byokKey);
  });
});

describe('dev-proxy plugin', () => {
  type MiddlewareFn = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

  function setupPlugin(
    env: Record<string, string | undefined>,
    clientFactory?: GeminiClientFactory,
  ) {
    let mountedPath = '';
    let middleware!: MiddlewareFn;
    const plugin = createGeminiDevPlugin({ env, clientFactory });
    const fakeServer = {
      config: { mode: 'development', root: process.cwd() },
      middlewares: {
        use: (path: string, fn: MiddlewareFn) => {
          mountedPath = path;
          middleware = fn;
        },
      },
    } as unknown as ViteDevServer;
    const configure = plugin.configureServer;
    if (typeof configure === 'function') {
      Reflect.apply(configure, {}, [fakeServer]);
    }
    return { mountedPath, middleware };
  }

  it('monta /api/gemini, trata OPTIONS, aceita localhost, bloqueia origem externa e propaga abort', async () => {
    const serverKey = makeFakeGoogleKey('DEVSERVER');
    let capturedSignal: AbortSignal | undefined;
    const clientFactory: GeminiClientFactory = () => ({
      generateContent: vi.fn(async (params) => {
        capturedSignal = params.config.abortSignal;
        return { text: JSON.stringify(cubeDoc()) };
      }),
    });

    const { mountedPath, middleware } = setupPlugin({ GEMINI_API_KEY: serverKey }, clientFactory);
    expect(mountedPath).toBe('/api/gemini');

    // OPTIONS localhost -> 204
    const { req: optOkReq } = createMockReq({
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:5173' },
    });
    const optOkRes = createMockRes();
    middleware(optOkReq, optOkRes, () => {});
    expect(optOkRes.statusCode).toBe(204);
    expect(optOkRes.headersMap['access-control-allow-origin']).toBe('http://localhost:5173');

    // OPTIONS externo -> 403
    const { req: optBadReq } = createMockReq({
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    });
    const optBadRes = createMockRes();
    middleware(optBadReq, optBadRes, () => {});
    expect(optBadRes.statusCode).toBe(403);

    // Origin externo no POST -> 403
    const { req: badReq, sendBody: sendBad } = createMockReq({
      method: 'POST',
      headers: { origin: 'https://attacker.example' },
      body: JSON.stringify({ prompt: 'cubo' }),
    });
    const badRes = createMockRes();
    const badDone = new Promise<void>((r) => badRes.on('finish', r));
    middleware(badReq, badRes, () => {});
    sendBad();
    await badDone;
    expect(badRes.statusCode).toBe(403);

    // Localhost válido -> 200
    const { req: okReq, sendBody: sendOk } = createMockReq({
      method: 'POST',
      headers: { origin: 'http://localhost:5173' },
      body: JSON.stringify({ prompt: 'cubo 10mm' }),
    });
    const okRes = createMockRes();
    const okDone = new Promise<void>((r) => okRes.on('finish', r));
    middleware(okReq, okRes, () => {});
    sendOk();
    await okDone;
    expect(okRes.statusCode).toBe(200);
    expect(capturedSignal).toBeDefined();

    // Propagação de abort ao emitir close prematuro
    const slowFactory: GeminiClientFactory = () => ({
      generateContent: (params) =>
        new Promise((_resolve, reject) => {
          params.config.abortSignal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    });
    const { middleware: slowMw } = setupPlugin({ GEMINI_API_KEY: serverKey }, slowFactory);
    const { req: abortReq, sendBody: sendAbort } = createMockReq({
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:5173' },
      body: JSON.stringify({ prompt: 'cubo' }),
      complete: false,
    });
    const abortRes = createMockRes();
    const abortDone = new Promise<void>((r) => abortRes.on('finish', r));
    slowMw(abortReq, abortRes, () => {});
    sendAbort();
    await new Promise((r) => setTimeout(r, 10));
    abortReq.emit('close');
    await abortDone;
    expect(abortRes.statusCode).toBe(499);
  });

  it('retorna 413 quando payload excede 150 KB e 400 em erro de leitura do stream', async () => {
    const { middleware } = setupPlugin({ GEMINI_API_KEY: makeFakeGoogleKey('DEV150K') });
    const { req, sendBody } = createMockReq({
      method: 'POST',
      body: 'a'.repeat(160 * 1024),
    });
    const res = createMockRes();
    const done = new Promise<void>((r) => res.on('finish', r));
    middleware(req, res, () => {});
    sendBody();
    await done;
    expect(res.statusCode).toBe(413);

    const { req: errReq } = createMockReq({ method: 'POST' });
    const errRes = createMockRes();
    const errDone = new Promise<void>((r) => errRes.on('finish', r));
    middleware(errReq, errRes, () => {});
    errReq.emit('error', new Error('stream reset'));
    await errDone;
    expect(errRes.statusCode).toBe(400);
  });

  it('lê .env.local do diretório raiz quando options.env não é fornecido', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cad-dev-proxy-'));
    const envKey = makeFakeGoogleKey('ENVLOCAL');
    try {
      writeFileSync(
        join(tempDir, '.env.local'),
        `# comentário\nGEMINI_API_KEY="${envKey}"\nexport GEMINI_MODEL='gemini-2.5-flash'\n`,
        'utf8',
      );
      const capturedKeys: string[] = [];
      let middleware!: MiddlewareFn;
      const plugin = createGeminiDevPlugin({
        clientFactory: (key) => {
          capturedKeys.push(key);
          return {
            generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify(cubeDoc()) }),
          };
        },
      });
      const fakeServer = {
        config: { mode: 'development', root: tempDir },
        middlewares: {
          use: (_path: string, fn: MiddlewareFn) => {
            middleware = fn;
          },
        },
      } as unknown as ViteDevServer;
      if (typeof plugin.configureServer === 'function') {
        Reflect.apply(plugin.configureServer, {}, [fakeServer]);
      }

      const { req, sendBody } = createMockReq({
        method: 'POST',
        body: JSON.stringify({ prompt: 'cubo 10mm' }),
      });
      const res = createMockRes();
      const done = new Promise<void>((r) => res.on('finish', r));
      middleware(req, res, () => {});
      sendBody();
      await done;

      expect(res.statusCode).toBe(200);
      expect(capturedKeys).toEqual([envKey]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('retorna 500 JSON com cabeçalhos de segurança se ocorrer exceção inesperada no dev-proxy', async () => {
    const { middleware } = setupPlugin({ GEMINI_API_KEY: makeFakeGoogleKey('DEVBOOM') }, () => {
      throw new Error('Falha síncrona inesperada');
    });

    const { req, sendBody } = createMockReq({
      method: 'POST',
      body: JSON.stringify({ prompt: 'cubo 10mm' }),
    });
    const res = createMockRes();
    const done = new Promise<void>((r) => res.on('finish', r));
    middleware(req, res, () => {});
    sendBody();
    await done;

    expect(res.statusCode).toBe(500);
    expect(res.headersMap['cache-control']).toBe('no-store');
    expect(res.headersMap['x-content-type-options']).toBe('nosniff');
    expect(JSON.parse(res.bodyText)).toEqual({
      ok: false,
      error: {
        code: 'internal_error',
        message: 'Erro interno inesperado no proxy de desenvolvimento.',
      },
    });
  });
});

describe('Cloudflare Worker', () => {
  it('aplica Origin allowlist, rotas, content-length, rate limit deslizante por IP e sanitiza erros', async () => {
    const fakeServerKey = makeFakeGoogleKey('WORKERKEY');
    let now = 50_000;
    const generateContent = vi.fn().mockResolvedValue({ text: JSON.stringify(cubeDoc()) });
    const handler = createWorkerHandler({
      now: () => now,
      clientFactory: () => ({ generateContent }),
    });

    const env = {
      GEMINI_API_KEY: fakeServerKey,
      ALLOWED_ORIGINS: 'https://app.example,https://preview.example',
      RATE_LIMIT_MAX: '2',
    };

    // Rota inválida -> 404
    const notFound = await handler.fetch(new Request('https://api.example/other'), env);
    expect(notFound.status).toBe(404);

    // Preflight OPTIONS permitido
    const optOk = await handler.fetch(
      new Request('https://api.example/api/gemini', {
        method: 'OPTIONS',
        headers: { origin: 'https://app.example' },
      }),
      env,
    );
    expect(optOk.status).toBe(204);
    expect(optOk.headers.get('access-control-allow-origin')).toBe('https://app.example');

    // Preflight OPTIONS externo -> 403
    const optBad = await handler.fetch(
      new Request('https://api.example/api/gemini', {
        method: 'OPTIONS',
        headers: { origin: 'https://evil.example' },
      }),
      env,
    );
    expect(optBad.status).toBe(403);

    // POST externo -> 403
    const postBad = await handler.fetch(
      new Request('https://api.example/api/gemini', {
        method: 'POST',
        headers: { origin: 'https://evil.example', 'cf-connecting-ip': '1.2.3.4' },
        body: JSON.stringify({ prompt: 'cubo' }),
      }),
      env,
    );
    expect(postBad.status).toBe(403);

    // Content-Length > 150 KB -> 413
    const tooLarge = await handler.fetch(
      new Request('https://api.example/api/gemini', {
        method: 'POST',
        headers: {
          origin: 'https://app.example',
          'x-forwarded-for': '198.51.100.1, 10.0.0.1',
          'content-length': String(160 * 1024),
        },
        body: JSON.stringify({ prompt: 'cubo' }),
      }),
      env,
    );
    expect(tooLarge.status).toBe(413);

    // Rate limit por IP (max 2)
    const makeOkPost = (ip: string) =>
      handler.fetch(
        new Request('https://api.example/api/gemini', {
          method: 'POST',
          headers: {
            origin: 'https://app.example',
            'cf-connecting-ip': ip,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ prompt: 'cubo 10mm' }),
        }),
        env,
      );

    expect((await makeOkPost('203.0.113.10')).status).toBe(200);
    expect((await makeOkPost('203.0.113.10')).status).toBe(200);
    const limited = await makeOkPost('203.0.113.10');
    expect(limited.status).toBe(429);

    // Após 60s janela desliza e libera novamente
    now += 60_001;
    expect((await makeOkPost('203.0.113.10')).status).toBe(200);

    // Outro IP com erro contendo chave -> sanitizado
    generateContent.mockRejectedValueOnce(new Error(`Key leaked: ${fakeServerKey}`));
    const otherIpErr = await makeOkPost('203.0.113.11');
    expect(otherIpErr.status).toBe(502);
    const errText = await otherIpErr.text();
    expect(errText).not.toContain(fakeServerKey);
  });

  it('Worker falha fechado para Origin externa sem ALLOWED_ORIGINS, bloqueia stream > 150 KB sem Content-Length e limpa IPs expirados', async () => {
    const fakeServerKey = makeFakeGoogleKey('WORKERSTREAM');
    let now = 100_000;
    const handler = createWorkerHandler({
      now: () => now,
      clientFactory: () => ({
        generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify(cubeDoc()) }),
      }),
    });

    const envNoAllowlist = { GEMINI_API_KEY: fakeServerKey };

    // Sem ALLOWED_ORIGINS: bloqueia Origin externa no OPTIONS e POST (fail-closed)
    const optExt = await handler.fetch(
      new Request('https://api.example/api/gemini', {
        method: 'OPTIONS',
        headers: { origin: 'https://evil.example' },
      }),
      envNoAllowlist,
    );
    expect(optExt.status).toBe(403);
    expect(optExt.headers.get('access-control-allow-origin')).toBeNull();

    const postExt = await handler.fetch(
      new Request('https://api.example/api/gemini', {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
        body: JSON.stringify({ prompt: 'cubo' }),
      }),
      envNoAllowlist,
    );
    expect(postExt.status).toBe(403);
    expect(postExt.headers.get('access-control-allow-origin')).toBeNull();

    // Mesma origem (selfOrigin) é permitida
    const postSelf = await handler.fetch(
      new Request('https://api.example/api/gemini', {
        method: 'POST',
        headers: { origin: 'https://api.example', 'cf-connecting-ip': '192.0.2.1' },
        body: JSON.stringify({ prompt: 'cubo 10mm' }),
      }),
      envNoAllowlist,
    );
    expect(postSelf.status).toBe(200);
    expect(postSelf.headers.get('access-control-allow-origin')).toBe('https://api.example');

    // Payload chunked sem Content-Length > 150 KB deve abortar reader com 413
    let chunksRead = 0;
    const largeChunkedStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksRead += 1;
        controller.enqueue(new Uint8Array(64 * 1024));
        if (chunksRead >= 10) {
          controller.close();
        }
      },
    });
    const chunkedReq = new Request('https://api.example/api/gemini', {
      method: 'POST',
      headers: { origin: 'https://api.example', 'cf-connecting-ip': '192.0.2.2' },
      body: largeChunkedStream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    const chunkedRes = await handler.fetch(chunkedReq, envNoAllowlist);
    expect(chunkedRes.status).toBe(413);
    expect(chunksRead).toBeLessThan(10);

    // Erro no stream devolve 400 read_error
    const brokenStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('stream aborted'));
      },
    });
    const brokenReq = new Request('https://api.example/api/gemini', {
      method: 'POST',
      headers: { origin: 'https://api.example', 'cf-connecting-ip': '192.0.2.3' },
      body: brokenStream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    const brokenRes = await handler.fetch(brokenReq, envNoAllowlist);
    expect(brokenRes.status).toBe(400);

    // Evicção de IPs expirados quando > 1000 IPs são rastreados
    for (let i = 0; i < 1005; i += 1) {
      await handler.fetch(
        new Request('https://api.example/api/gemini', {
          method: 'POST',
          headers: { 'cf-connecting-ip': `198.51.${Math.floor(i / 250)}.${i % 250}` },
          body: JSON.stringify({ prompt: 'cubo 10mm' }),
        }),
        envNoAllowlist,
      );
    }
    now += 61_000;
    const afterEvict = await handler.fetch(
      new Request('https://api.example/api/gemini', {
        method: 'POST',
        headers: { 'cf-connecting-ip': '198.51.0.1' },
        body: JSON.stringify({ prompt: 'cubo 10mm' }),
      }),
      envNoAllowlist,
    );
    expect(afterEvict.status).toBe(200);
  });
});
