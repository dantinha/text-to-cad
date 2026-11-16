const out = document.getElementById('out') as HTMLPreElement;
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
worker.onmessage = (e) => {
  const d = e.data;
  const summary = d.ok
    ? { ...d, positions: `Float32Array(${d.positions.length})`, indices: `Uint32Array(${d.indices.length})` }
    : d;
  out.textContent = JSON.stringify(summary);
  out.dataset['done'] = '1';
};
worker.onerror = (e) => {
  out.textContent = JSON.stringify({ ok: false, error: e.message });
  out.dataset['done'] = '1';
};
worker.postMessage({ segments: 128 });
