import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { err } from '@/core/result';
import { evaluateIR, type WorkerRequest, type WorkerResponse } from './evaluate';

let wasmPromise: Promise<ManifoldToplevel> | undefined;

async function getWorkerWasm(): Promise<ManifoldToplevel> {
  if (!wasmPromise) {
    wasmPromise = Module({ locateFile: () => wasmUrl })
      .then((wasm) => {
        wasm.setup();
        return wasm;
      })
      .catch((error: unknown) => {
        wasmPromise = undefined;
        throw error;
      });
  }
  return wasmPromise;
}

export type PostWorkerResponse = (response: WorkerResponse, transfer?: Transferable[]) => void;

/**
 * Processa uma requisição de avaliação do IR e publica a resposta via Transferables (zero-copy).
 */
export async function handleWorkerRequest(
  request: WorkerRequest,
  postResponse: PostWorkerResponse,
): Promise<void> {
  let wasm: ManifoldToplevel;
  try {
    wasm = await getWorkerWasm();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    postResponse({
      id: request.id,
      result: err({ code: 'wasm_error', message: `Falha ao carregar kernel WASM: ${detail}` }),
    });
    return;
  }

  const result = evaluateIR(wasm, request.ir);
  if (result.ok) {
    const { positions, normals, indices } = result.value;
    postResponse({ id: request.id, result }, [positions.buffer, normals.buffer, indices.buffer]);
    return;
  }

  postResponse({ id: request.id, result });
}

const isWorkerRequest = (data: unknown): data is WorkerRequest =>
  typeof data === 'object' &&
  data !== null &&
  typeof (data as Partial<WorkerRequest>).id === 'number' &&
  typeof (data as Partial<WorkerRequest>).ir === 'object' &&
  (data as Partial<WorkerRequest>).ir !== null;

if (typeof self !== 'undefined' && typeof window === 'undefined') {
  const workerSelf = self as unknown as DedicatedWorkerGlobalScope;
  workerSelf.onmessage = (event: MessageEvent<WorkerRequest>) => {
    if (!isWorkerRequest(event.data)) {
      return;
    }
    const request = event.data;
    const postResponse: PostWorkerResponse = (response, transfer) => {
      if (transfer && transfer.length > 0) {
        workerSelf.postMessage(response, transfer);
      } else {
        workerSelf.postMessage(response);
      }
    };
    void handleWorkerRequest(request, postResponse).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      try {
        workerSelf.postMessage({
          id: request.id,
          result: err({ code: 'wasm_error', message: `Erro interno no worker: ${detail}` }),
        });
      } catch {
        // Ignora falha ao postar resposta de erro
      }
    });
  };
}
