import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KernelError, MeshData, Result } from '@/core/contracts';
import { ok } from '@/core/result';
import { createKernelClient, type WorkerLike } from '@/kernel';
import type { WorkerRequest, WorkerResponse } from '@/kernel/evaluate';
import { cubeDoc } from '../fixtures/ir';
import { unitCubeMesh } from '../fixtures/mesh';

const require = createRequire(import.meta.url);
const realWasmPath = require.resolve('manifold-3d/manifold.wasm');

class MockWorker implements WorkerLike {
  readonly posted: Array<{ message: WorkerRequest; transfer?: Transferable[] }> = [];
  terminated = false;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onPost?: (req: WorkerRequest, worker: MockWorker) => void;

  postMessage(message: unknown, transfer?: Transferable[]): void {
    const req = message as WorkerRequest;
    this.posted.push({ message: req, transfer });
    this.onPost?.(req, this);
  }

  terminate(): void {
    this.terminated = true;
  }

  emitResult(id: number, result: Result<MeshData, KernelError>): void {
    this.onmessage?.({ data: { id, result } } as MessageEvent<WorkerResponse>);
  }

  emitError(message = 'Falha no worker'): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('createKernelClient', () => {
  it('avalia IR via worker e reutiliza worker aquecido entre chamadas sequenciais', async () => {
    const workers: MockWorker[] = [];
    const expectedMesh = unitCubeMesh(10);

    const client = createKernelClient({
      createWorker: () => {
        const w = new MockWorker();
        w.onPost = (req) => {
          queueMicrotask(() => w.emitResult(req.id, ok(expectedMesh)));
        };
        workers.push(w);
        return w;
      },
    });

    const r1 = await client.evaluate(cubeDoc());
    const r2 = await client.evaluate(cubeDoc());

    expect(r1).toEqual(ok(expectedMesh));
    expect(r2).toEqual(ok(expectedMesh));
    expect(workers).toHaveLength(1);
    expect(workers[0]?.posted).toHaveLength(2);
    expect(workers[0]?.terminated).toBe(false);

    client.dispose();
    expect(workers[0]?.terminated).toBe(true);
  });

  it('cancela a avaliação anterior quando uma nova requisição chega e recicla o worker ocupado', async () => {
    const workers: MockWorker[] = [];
    const mesh2 = unitCubeMesh(5);

    const client = createKernelClient({
      createWorker: () => {
        const w = new MockWorker();
        workers.push(w);
        return w;
      },
    });

    const p1 = client.evaluate(cubeDoc());
    expect(workers).toHaveLength(1);
    const w1 = workers[0] as MockWorker;

    const p2 = client.evaluate(cubeDoc());
    expect(w1.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    const w2 = workers[1] as MockWorker;

    // Resposta atrasada do primeiro worker não deve interferir
    w1.emitResult(w1.posted[0]?.message.id ?? 1, ok(unitCubeMesh(10)));

    const req2Id = w2.posted[0]?.message.id ?? 2;
    w2.emitResult(req2Id, ok(mesh2));

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.error.code).toBe('cancelled');
    }
    expect(r2).toEqual(ok(mesh2));

    client.dispose();
  });

  it('cancela via AbortSignal externo (já abortado e durante execução)', async () => {
    const workers: MockWorker[] = [];
    const client = createKernelClient({
      createWorker: () => {
        const w = new MockWorker();
        workers.push(w);
        return w;
      },
    });

    const preAborted = new AbortController();
    preAborted.abort();
    const rPre = await client.evaluate(cubeDoc(), preAborted.signal);
    expect(rPre.ok).toBe(false);
    if (!rPre.ok) expect(rPre.error.code).toBe('cancelled');
    expect(workers).toHaveLength(0);

    const controller = new AbortController();
    const p = client.evaluate(cubeDoc(), controller.signal);
    expect(workers).toHaveLength(1);
    controller.abort();

    const rMid = await p;
    expect(rMid.ok).toBe(false);
    if (!rMid.ok) expect(rMid.error.code).toBe('cancelled');
    expect(workers[0]?.terminated).toBe(true);

    client.dispose();
  });

  it('chamada já abortada não cancela nem termina uma avaliação ativa em andamento', async () => {
    const workers: MockWorker[] = [];
    const expectedMesh = unitCubeMesh(4);
    const client = createKernelClient({
      createWorker: () => {
        const w = new MockWorker();
        workers.push(w);
        return w;
      },
    });

    const pActive = client.evaluate(cubeDoc());
    expect(workers).toHaveLength(1);
    const w = workers[0] as MockWorker;

    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    const rAborted = await client.evaluate(cubeDoc(), alreadyAborted.signal);

    expect(rAborted.ok).toBe(false);
    if (!rAborted.ok) expect(rAborted.error.code).toBe('cancelled');
    expect(w.terminated).toBe(false);

    // Mensagem com event.data nulo também é ignorada defensivamente
    w.onmessage?.({ data: null } as unknown as MessageEvent<WorkerResponse>);

    // A tarefa ativa continua íntegra e conclui normalmente
    const reqId = w.posted[0]?.message.id ?? 1;
    w.emitResult(reqId, ok(expectedMesh));
    expect(await pActive).toEqual(ok(expectedMesh));

    client.dispose();
  });

  it('aplica timeout padrão de 10s e recicla o worker travado', async () => {
    vi.useFakeTimers();
    const workers: MockWorker[] = [];

    const client = createKernelClient({
      createWorker: () => {
        const w = new MockWorker();
        workers.push(w);
        return w;
      },
    });

    const p1 = client.evaluate(cubeDoc());
    expect(workers).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(10_000);
    const r1 = await p1;
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.error.code).toBe('timeout');
    }
    expect(workers[0]?.terminated).toBe(true);

    // Próxima chamada cria um novo worker e funciona normalmente
    const mesh = unitCubeMesh(2);
    const p2 = client.evaluate(cubeDoc());
    expect(workers).toHaveLength(2);
    const w2 = workers[1] as MockWorker;
    w2.emitResult(w2.posted[0]?.message.id ?? 2, ok(mesh));

    const r2 = await p2;
    expect(r2).toEqual(ok(mesh));

    client.dispose();
  });

  it('retorna wasm_error quando worker dispara onerror ou postMessage falha', async () => {
    const workers: MockWorker[] = [];
    const client = createKernelClient({
      createWorker: () => {
        const w = new MockWorker();
        workers.push(w);
        return w;
      },
    });

    const p1 = client.evaluate(cubeDoc());
    workers[0]?.emitError('Erro fatal no WASM');
    const r1 = await p1;
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.error.code).toBe('wasm_error');
      expect(r1.error.message).toContain('Erro fatal no WASM');
    }
    expect(workers[0]?.terminated).toBe(true);

    // Falha no postMessage
    const client2 = createKernelClient({
      createWorker: () => {
        const w = new MockWorker();
        w.onPost = () => {
          throw new Error('clone failed');
        };
        return w;
      },
    });
    const r2 = await client2.evaluate(cubeDoc());
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.error.code).toBe('wasm_error');
      expect(r2.error.message).toContain('clone failed');
    }

    client.dispose();
    client2.dispose();
  });

  it('dispose cancela tarefa ativa e rejeita novas avaliações como cancelled', async () => {
    const workers: MockWorker[] = [];
    const client = createKernelClient({
      createWorker: () => {
        const w = new MockWorker();
        workers.push(w);
        return w;
      },
    });

    const p1 = client.evaluate(cubeDoc());
    client.dispose();
    client.dispose(); // idempotente

    const r1 = await p1;
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error.code).toBe('cancelled');
    expect(workers[0]?.terminated).toBe(true);

    const r2 = await client.evaluate(cubeDoc());
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe('cancelled');
    expect(workers).toHaveLength(1);
  });

  it('ignora mensagem com id obsoleto no mesmo worker e trata onerror sem mensagem', async () => {
    const workers: MockWorker[] = [];
    const client = createKernelClient({
      createWorker: () => {
        const w = new MockWorker();
        workers.push(w);
        return w;
      },
    });

    const p1 = client.evaluate(cubeDoc());
    const w = workers[0] as MockWorker;
    const reqId = w.posted[0]?.message.id ?? 1;

    w.emitResult(reqId + 999, ok(unitCubeMesh(1)));
    w.emitError('');

    const r1 = await p1;
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.error.code).toBe('wasm_error');
      expect(r1.error.message).toContain('erro desconhecido');
    }

    client.dispose();
  });

  it('worker.ts envia buffers via Transferables (zero-copy) em resposta ok e trata erro', async () => {
    const posted: Array<{ data: WorkerResponse; transfer?: Transferable[] }> = [];
    const fakeSelf = {
      onmessage: null as ((e: MessageEvent<WorkerRequest>) => void) | null,
      postMessage: (data: WorkerResponse, transfer?: Transferable[]) => {
        posted.push({ data, transfer });
      },
    };
    vi.stubGlobal('self', fakeSelf);
    vi.resetModules();
    vi.doMock('manifold-3d/manifold.wasm?url', () => ({ default: realWasmPath }));
    const { handleWorkerRequest } = await import('@/kernel/worker');

    await handleWorkerRequest({ id: 7, ir: cubeDoc() }, fakeSelf.postMessage);
    expect(posted).toHaveLength(1);
    const first = posted[0];
    expect(first?.data.id).toBe(7);
    expect(first?.data.result.ok).toBe(true);
    if (first?.data.result.ok) {
      const { positions, normals, indices } = first.data.result.value;
      expect(first.transfer).toEqual([positions.buffer, normals.buffer, indices.buffer]);
    }

    // Também cobre self.onmessage registrado no worker.ts para erro (sem transferables)
    expect(typeof fakeSelf.onmessage).toBe('function');
    fakeSelf.onmessage?.({
      data: {
        id: 8,
        ir: {
          schemaVersion: 1,
          units: 'mm',
          root: {
            id: 'd',
            type: 'difference',
            base: { id: 'a', type: 'cube', size: [5, 5, 5] },
            subtract: [{ id: 'b', type: 'cube', size: [10, 10, 10] }],
          },
        },
      },
    } as unknown as MessageEvent<WorkerRequest>);

    await vi.waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]?.data.id).toBe(8);
    expect(posted[1]?.data.result.ok).toBe(false);
    expect(posted[1]?.transfer).toBeUndefined();
    if (posted[1]?.data.result.ok === false) {
      expect(posted[1].data.result.error.code).toBe('invalid_mesh');
    }

    // Ignora event.data inválido/nulo sem lançar nem postar
    fakeSelf.onmessage?.({ data: null } as unknown as MessageEvent<WorkerRequest>);
    expect(posted).toHaveLength(2);
  });

  it('worker.ts não registra self.onmessage quando window está definido', async () => {
    const fakeSelf = {
      onmessage: null as ((e: MessageEvent<WorkerRequest>) => void) | null,
      postMessage: vi.fn(),
    };
    vi.stubGlobal('self', fakeSelf);
    vi.stubGlobal('window', {});
    vi.resetModules();
    vi.doMock('manifold-3d/manifold.wasm?url', () => ({ default: realWasmPath }));
    await import('@/kernel/worker');

    expect(fakeSelf.onmessage).toBeNull();
  });

  it('worker.ts retorna wasm_error se o carregamento do WASM falhar', async () => {
    const posted: Array<{ data: WorkerResponse; transfer?: Transferable[] }> = [];
    vi.stubGlobal('self', undefined);
    vi.resetModules();
    vi.doMock('manifold-3d/manifold.wasm?url', () => ({ default: '/caminho/inexistente.wasm' }));
    const { handleWorkerRequest } = await import('@/kernel/worker');

    await handleWorkerRequest({ id: 9, ir: cubeDoc() }, (data, transfer) => {
      posted.push({ data, transfer });
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]?.data.id).toBe(9);
    expect(posted[0]?.data.result.ok).toBe(false);
    if (posted[0]?.data.result.ok === false) {
      expect(posted[0].data.result.error.code).toBe('wasm_error');
    }
  });
});
