// Spike M0: valida manifold-3d (WASM) em Node: booleanos, volume analítico, malha fechada.
// Uso: node spike/manifold.spike.mjs
import Module from 'manifold-3d';

const wasm = await Module();
wasm.setup();
const { Manifold } = wasm;

const near = (a, b, tol) => Math.abs(a - b) / b <= tol;
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${detail ?? ''}`);
};

// 1) cubo 40x30x20 (mm) menos cilindro vertical (r=5, h=40) atravessando
const cube = Manifold.cube([40, 30, 20], true);
const cyl = Manifold.cylinder(40, 5, 5, 128, true);
const part = cube.subtract(cyl);

const vCube = 40 * 30 * 20;
const vCylInside = Math.PI * 5 * 5 * 20; // trecho do cilindro dentro do cubo
const expected = vCube - vCylInside;
const vol = part.volume();
check('volume cubo-cilindro (±0,5%)', near(vol, expected, 0.005), `obtido=${vol.toFixed(2)} esperado=${expected.toFixed(2)}`);
check('genus = 1 (um furo passante)', part.genus() === 1, `genus=${part.genus()}`);
check('status NoError', String(part.status()) === 'NoError' || part.status() === 0, `status=${part.status()}`);

// 2) malha: formato de saída e fechamento (cada aresta compartilhada por 2 triângulos)
const mesh = part.getMesh();
const tris = mesh.triVerts.length / 3;
check('getMesh devolve Float32Array/Uint32Array', mesh.vertProperties instanceof Float32Array && mesh.triVerts instanceof Uint32Array, `numProp=${mesh.numProp} tris=${tris}`);

const edges = new Map();
for (let i = 0; i < mesh.triVerts.length; i += 3) {
  const t = [mesh.triVerts[i], mesh.triVerts[i + 1], mesh.triVerts[i + 2]];
  for (let k = 0; k < 3; k++) {
    const a = t[k], b = t[(k + 1) % 3];
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
}
const open = [...edges.values()].filter((n) => n !== 2).length;
check('malha fechada (toda aresta tem exatamente 2 faces)', open === 0, `arestas_abertas=${open}`);

// 3) bbox
const bb = part.boundingBox();
check('bbox = 40x30x20', near(bb.max[0] - bb.min[0], 40, 1e-6) && near(bb.max[2] - bb.min[2], 20, 1e-6), JSON.stringify(bb));

// 4) tempo de uma avaliação típica
const t0 = performance.now();
for (let i = 0; i < 20; i++) Manifold.cube([40, 30, 20], true).subtract(Manifold.cylinder(40, 5, 5, 128, true)).getMesh();
const ms = (performance.now() - t0) / 20;
check('tempo médio por avaliação < 300 ms', ms < 300, `${ms.toFixed(1)} ms`);

// 5) API necessária para o IR
const need = ['cube', 'cylinder', 'sphere', 'extrude', 'union', 'difference', 'intersection'];
const missing = need.filter((n) => typeof Manifold[n] !== 'function');
check('API estática presente (cube/cylinder/sphere/extrude/union/difference/intersection)', missing.length === 0, `faltando=${missing.join(',') || '-'}`);
const inst = ['translate', 'rotate', 'scale', 'mirror', 'subtract', 'add', 'intersect', 'volume', 'boundingBox', 'getMesh', 'genus'];
const missingInst = inst.filter((n) => typeof part[n] !== 'function');
check('API de instância presente', missingInst.length === 0, `faltando=${missingInst.join(',') || '-'}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações OK`);
process.exit(failed.length ? 1 : 0);
