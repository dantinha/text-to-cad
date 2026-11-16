import type { Evaluate, IR, KernelError, MeshData, Result } from '@/core/contracts';
import { err } from '@/core/result';
import type { WorkerRequest, WorkerResponse } from './evaluate';

export const DEFAULT_KERNEL_TIMEOUT_MS = 10_000;

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface KernelClientOptions {
  /** Timeout por avaliação em milissegundos (padrão: 10 000 ms). */
  readonly timeoutMs?: number;
  /** Fábrica de Worker (injetável em testes unitários). */
  readonly createWorker?: () => WorkerLike;
}

export interface KernelClient {
  readonly evaluate: Evaluate;
  dispose(): void;
}

interface ActiveTask {
  readonly id: number;
  finish: (result: Result<MeshData, KernelError>) => void;
}

const defaultCreateWorker = (): WorkerLike =>
  new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

/**
 * Cria um cliente de avaliação geométrica em Web Worker dedicado.
 * Mantém fila de 1 tarefa: nova chamada cancela a anterior e recicla o worker ocupado.
 */
export function createKernelClient(options: KernelClientOptions = {}): KernelClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_KERNEL_TIMEOUT_MS;
  const createWorker = options.createWorker ?? defaultCreateWorker;

  let worker: WorkerLike | null = null;
  let activeTask: ActiveTask | null = null;
  let nextRequestId = 1;
  let disposed = false;

  const terminateWorker = (): void => {
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    worker = null;
  };

  const ensureWorker = (): WorkerLike => {
    if (worker) return worker;
    const created = createWorker();
    created.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (!activeTask || !event.data || event.data.id !== activeTask.id) return;
      activeTask.finish(event.data.result);
    };
    created.onerror = (event: ErrorEvent) => {
      const detail = event.message || 'erro desconhecido no Web Worker';
      const task = activeTask;
      terminateWorker();
      task?.finish(err({ code: 'wasm_error', message: `Erro no Web Worker do kernel: ${detail}` }));
    };
    worker = created;
    return created;
  };

  const evaluate: Evaluate = (ir: IR, signal?: AbortSignal) => {
    if (disposed) {
      return Promise.resolve(err({ code: 'cancelled', message: 'Cliente do kernel encerrado.' }));
    }

    if (signal?.aborted) {
      return Promise.resolve(err({ code: 'cancelled', message: 'Avaliação cancelada.' }));
    }

    // Nova requisição sempre cancela a anterior e recicla o worker se estava ocupado
    if (activeTask) {
      activeTask.finish(
        err({ code: 'cancelled', message: 'Avaliação cancelada por uma nova requisição.' }),
      );
      terminateWorker();
    }

    const id = nextRequestId++;

    return new Promise<Result<MeshData, KernelError>>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const onAbort = (): void => {
        finish(err({ code: 'cancelled', message: 'Avaliação cancelada.' }));
        terminateWorker();
      };

      const cleanup = (): void => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        signal?.removeEventListener('abort', onAbort);
        if (activeTask?.id === id) {
          activeTask = null;
        }
      };

      const finish = (result: Result<MeshData, KernelError>): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };

      activeTask = { id, finish };
      signal?.addEventListener('abort', onAbort, { once: true });

      timer = setTimeout(() => {
        finish(
          err({
            code: 'timeout',
            message: `Tempo limite do kernel excedido (${timeoutMs} ms).`,
          }),
        );
        terminateWorker();
      }, timeoutMs);

      try {
        const currentWorker = ensureWorker();
        const request: WorkerRequest = { id, ir };
        currentWorker.postMessage(request);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        terminateWorker();
        finish(
          err({
            code: 'wasm_error',
            message: `Falha ao enviar geometria ao Web Worker: ${detail}`,
          }),
        );
      }
    });
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    activeTask?.finish(err({ code: 'cancelled', message: 'Cliente do kernel encerrado.' }));
    terminateWorker();
  };

  return { evaluate, dispose };
}
