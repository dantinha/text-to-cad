// Spike M0: manifold-3d (WASM) dentro de um Web Worker sob Vite, com transferência zero-copy.
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';

self.onmessage = async (e: MessageEvent<{ segments: number }>) => {
  try {
    const t0 = performance.now();
    const wasm = await Module({ locateFile: () => wasmUrl });
    wasm.setup();
    const tInit = performance.now() - t0;

    const t1 = performance.now();
    const part = wasm.Manifold.cube([40, 30, 20], true).subtract(
      wasm.Manifold.cylinder(40, 5, 5, e.data.segments, true),
    );
    const mesh = part.getMesh();
    const positions = new Float32Array(mesh.vertProperties);
    const indices = new Uint32Array(mesh.triVerts);
    const tEval = performance.now() - t1;

    const msg = {
      ok: true,
      volume: part.volume(),
      genus: part.genus(),
      triangles: indices.length / 3,
      numProp: mesh.numProp,
      tInit,
      tEval,
      positions,
      indices,
    };
    (self as unknown as Worker).postMessage(msg, [positions.buffer, indices.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: String(err) });
  }
};
