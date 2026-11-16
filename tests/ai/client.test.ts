import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cubeDoc } from '../fixtures/ir';
import { BYOK_SESSION_KEY, clearByokKey, getByokKey, setByokKey } from '@/ai/byok';
import { createAiGenerator, generateIR as defaultGenerateIR } from '@/ai/client';
import { createRateLimiter } from '@/ai/rateLimit';

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('byok sessionStorage helpers', () => {
  const store = new Map<string, string>();
  const fakeSessionStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
  };

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('window', {
      sessionStorage: fakeSessionStorage,
      localStorage: {
        setItem: () => {
          throw new Error('localStorage não deve ser usado para BYOK');
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('usa somente sessionStorage com BYOK_SESSION_KEY', () => {
    expect(BYOK_SESSION_KEY).toBe('text-to-cad:byok-gemini-key');
    expect(getByokKey()).toBe('');

    setByokKey('  minha-chave-teste  ');
    expect(getByokKey()).toBe('minha-chave-teste');
    expect(store.get(BYOK_SESSION_KEY)).toBe('minha-chave-teste');

    setByokKey('   ');
    expect(getByokKey()).toBe('');

    setByokKey('outra-chave');
    clearByokKey();
    expect(getByokKey()).toBe('');
  });

  it('retorna vazio quando window é indefinido', () => {
    vi.stubGlobal('window', undefined);
    expect(getByokKey()).toBe('');
    expect(() => setByokKey('abc')).not.toThrow();
    expect(() => clearByokKey()).not.toThrow();
  });

  it('não lança erro sem DOM ou se sessionStorage bloquear acesso', () => {
    vi.stubGlobal('window', {
      get sessionStorage() {
        throw new Error('SecurityError');
      },
    });
    expect(() => setByokKey('abc')).not.toThrow();
    expect(getByokKey()).toBe('');
    expect(() => clearByokKey()).not.toThrow();
  });
});

describe('createAiGenerator', () => {
  it('fluxo feliz: valida e retorna IR no primeiro retorno', async () => {
    const expected = cubeDoc();
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(
      makeJsonResponse(200, {
        ok: true,
        text: JSON.stringify(expected),
        model: 'gemini-2.5-flash',
      }),
    );

    const generateIR = createAiGenerator({ fetchFn });
    const result = await generateIR('cubo de 10mm');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(expected);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('/api/gemini');
    expect(init?.method).toBe('POST');
  });

  it('executa loop de reparo (JSON inválido -> IRIssue -> IR válido) em até 3 chamadas', async () => {
    const validDoc = cubeDoc();
    const invalidIr = {
      schemaVersion: 1,
      units: 'mm',
      root: { id: 'c1', type: 'cube', size: [-5, 10, 10] },
    };

    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        makeJsonResponse(200, { ok: true, text: '{json-quebrado', model: 'gemini-2.5-flash' }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse(200, {
          ok: true,
          text: JSON.stringify(invalidIr),
          model: 'gemini-2.5-flash',
        }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse(200, {
          ok: true,
          text: JSON.stringify(validDoc),
          model: 'gemini-2.5-flash',
        }),
      );

    const generateIR = createAiGenerator({ fetchFn });
    const result = await generateIR('cubo 10x10x10');

    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(3);

    const secondBody = JSON.parse(String(fetchFn.mock.calls[1]?.[1]?.body)) as {
      repair?: { previousJson: string; issues: Array<{ code: string }> };
    };
    expect(secondBody.repair?.previousJson).toBe('{json-quebrado');
    expect(secondBody.repair?.issues[0]?.code).toBe('formato_invalido');

    const thirdBody = JSON.parse(String(fetchFn.mock.calls[2]?.[1]?.body)) as {
      repair?: { previousJson: string; issues: Array<{ path: string; code: string }> };
    };
    expect(thirdBody.repair?.issues[0]?.path).toBe('root.size[0]');
    expect(thirdBody.repair?.issues[0]?.code).toBe('valor_fora_do_limite');
  });

  it('retorna repair_failed com issues após esgotar as 2 tentativas de reparo', async () => {
    const invalidIr = {
      schemaVersion: 1,
      units: 'mm',
      root: { id: 'c1', type: 'cube', size: [0, 10, 10] },
    };

    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () =>
      makeJsonResponse(200, {
        ok: true,
        text: JSON.stringify(invalidIr),
        model: 'gemini-2.5-flash',
      }),
    );

    const generateIR = createAiGenerator({ fetchFn });
    const result = await generateIR('cubo inválido');

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('repair_failed');
      expect(result.error.issues?.length).toBeGreaterThan(0);
    }
  });

  it('envia header x-user-key quando userKey existe e nunca vaza a chave em erros', async () => {
    const fakeUserKey = `AIza${'UserSecret987654321'.repeat(2)}`;
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error(`Falha com ${fakeUserKey}`));

    const generateIR = createAiGenerator({ fetchFn });
    const result = await generateIR('cubo 10mm', { userKey: `  ${fakeUserKey}  ` });

    const headers = fetchFn.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['x-user-key']).toBe(fakeUserKey);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('network');
      expect(result.error.message).not.toContain(fakeUserKey);
      expect(result.error.message).not.toContain('AIza');
    }
  });

  it('aplica timeout de 30s e cancelamento via AbortSignal', async () => {
    vi.useFakeTimers();
    try {
      const slowFetch = vi.fn<typeof fetch>((_input, init) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const generateIR = createAiGenerator({ fetchFn: slowFetch });
      const pending = generateIR('cubo lento');
      await vi.advanceTimersByTimeAsync(30_000);
      const timedOut = await pending;

      expect(timedOut.ok).toBe(false);
      if (!timedOut.ok) expect(timedOut.error.code).toBe('timeout');

      const controller = new AbortController();
      const pendingCancel = generateIR('cubo cancelado', { signal: controller.signal });
      controller.abort();
      const cancelled = await pendingCancel;

      expect(cancelled.ok).toBe(false);
      if (!cancelled.ok) expect(cancelled.error.code).toBe('cancelled');
    } finally {
      vi.useRealTimers();
    }
  });

  it('retorna cancelled imediatamente se AbortSignal já estiver abortado', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const controller = new AbortController();
    controller.abort();

    const generateIR = createAiGenerator({ fetchFn });
    const result = await generateIR('cubo', { signal: controller.signal });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('cancelled');
  });

  it('respeita concorrência=1 do rateLimiter e libera no finally mesmo em erro', async () => {
    let releaseFetch!: () => void;
    const blockingFetch = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          releaseFetch = () =>
            resolve(makeJsonResponse(500, { ok: false, error: { code: 'err', message: 'boom' } }));
        }),
    );

    const limiter = createRateLimiter();
    const generateIR = createAiGenerator({ fetchFn: blockingFetch, rateLimiter: limiter });

    const firstPromise = generateIR('peça 1');
    const secondResult = await generateIR('peça 2');
    expect(secondResult.ok).toBe(false);
    if (!secondResult.ok) expect(secondResult.error.code).toBe('rate_limited');

    releaseFetch();
    const firstResult = await firstPromise;
    expect(firstResult.ok).toBe(false);
    if (!firstResult.ok) expect(firstResult.error.code).toBe('proxy_error');

    // Após finally, slot deve estar livre novamente
    blockingFetch.mockResolvedValueOnce(
      makeJsonResponse(200, {
        ok: true,
        text: JSON.stringify(cubeDoc()),
        model: 'gemini-2.5-flash',
      }),
    );
    const thirdResult = await generateIR('peça 3');
    expect(thirdResult.ok).toBe(true);
  });

  it('mapeia erros HTTP 429, 400, 500, não-JSON e payload inesperado', async () => {
    expect(typeof defaultGenerateIR).toBe('function');

    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        makeJsonResponse(429, {
          ok: false,
          error: { code: 'rate_limited', message: 'Muitas reqs' },
        }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse(400, {
          ok: false,
          error: { code: 'prompt_invalid', message: 'Inválido' },
        }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse(503, {
          ok: false,
          error: { code: 'missing_api_key', message: 'Sem chave' },
        }),
      )
      .mockResolvedValueOnce(makeJsonResponse(200, { ok: true }))
      .mockResolvedValueOnce(new Response('bad-gateway-text', { status: 502 }))
      .mockResolvedValueOnce(new Response('not-json', { status: 200 }))
      .mockResolvedValueOnce(
        makeJsonResponse(200, { ok: false, error: { code: 'rate_limited', message: 'Quota' } }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse(200, { ok: false, error: { code: 'upstream', message: 'Falha' } }),
      );

    const generateIR = createAiGenerator({ fetchFn });

    const rInvalidPrompt = await generateIR('   ');
    expect(rInvalidPrompt.ok).toBe(false);
    if (!rInvalidPrompt.ok) expect(rInvalidPrompt.error.code).toBe('prompt_invalid');

    const r429 = await generateIR('cubo');
    expect(r429.ok).toBe(false);
    if (!r429.ok) expect(r429.error.code).toBe('rate_limited');

    const r400 = await generateIR('cubo');
    expect(r400.ok).toBe(false);
    if (!r400.ok) expect(r400.error.code).toBe('prompt_invalid');

    const r503 = await generateIR('cubo');
    expect(r503.ok).toBe(false);
    if (!r503.ok) expect(r503.error.code).toBe('proxy_error');

    const rBad = await generateIR('cubo');
    expect(rBad.ok).toBe(false);
    if (!rBad.ok) expect(rBad.error.code).toBe('invalid_response');

    const r502Text = await generateIR('cubo');
    expect(r502Text.ok).toBe(false);
    if (!r502Text.ok) expect(r502Text.error.code).toBe('proxy_error');

    const r200Text = await generateIR('cubo');
    expect(r200Text.ok).toBe(false);
    if (!r200Text.ok) expect(r200Text.error.code).toBe('invalid_response');

    const rOkFalseRate = await generateIR('cubo');
    expect(rOkFalseRate.ok).toBe(false);
    if (!rOkFalseRate.ok) expect(rOkFalseRate.error.code).toBe('rate_limited');

    const rOkFalseProxy = await generateIR('cubo');
    expect(rOkFalseProxy.ok).toBe(false);
    if (!rOkFalseProxy.ok) expect(rOkFalseProxy.error.code).toBe('proxy_error');
  });

  it('trata abort e timeout durante a leitura de response.json() com mensagem dinâmica', async () => {
    vi.useFakeTimers();
    try {
      const slowBodyFetch = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
        return {
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => {
                const err = new Error('Aborted body');
                err.name = 'AbortError';
                reject(err);
              });
            }),
        } as unknown as Response;
      });

      const generateWithShortTimeout = createAiGenerator({
        fetchFn: slowBodyFetch,
        timeoutMs: 5_000,
      });
      const timeoutPromise = generateWithShortTimeout('cubo lento');
      await vi.advanceTimersByTimeAsync(5_000);
      const timedOut = await timeoutPromise;

      expect(timedOut.ok).toBe(false);
      if (!timedOut.ok) {
        expect(timedOut.error.code).toBe('timeout');
        expect(timedOut.error.message).toContain('5 segundos');
      }

      const controller = new AbortController();
      const cancelPromise = generateWithShortTimeout('cubo cancelado', {
        signal: controller.signal,
      });
      await Promise.resolve();
      controller.abort();
      const cancelled = await cancelPromise;

      expect(cancelled.ok).toBe(false);
      if (!cancelled.ok) expect(cancelled.error.code).toBe('cancelled');
    } finally {
      vi.useRealTimers();
    }
  });
});
