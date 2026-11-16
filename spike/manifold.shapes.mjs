import Module from 'manifold-3d';

const wasm = await Module();
wasm.setup();
const { Manifold, CrossSection } = wasm;

// torus: círculo deslocado revolucionado
const ring = CrossSection.circle(3, 48).translate([10, 0]);
const torus = Manifold.revolve(ring, 96);
const expected = 2 * Math.PI * Math.PI * 10 * 3 * 3;
console.log('torus volume', torus.volume().toFixed(1), 'esperado', expected.toFixed(1), 'genus', torus.genus());

// extrude de polígono (L)
const L = [[0, 0], [20, 0], [20, 5], [5, 5], [5, 20], [0, 20]];
const ext = Manifold.extrude(L, 10);
console.log('extrude volume', ext.volume(), 'esperado', (20 * 5 + 5 * 15) * 10);

// transforms
const m = Manifold.cube([10, 10, 10], true)
  .rotate([0, 0, 45])
  .scale([2, 1, 1])
  .translate([5, 0, 0])
  .mirror([1, 0, 0]);
console.log(
  'mirror/rotate/scale ok',
  m.volume().toFixed(1),
  JSON.stringify(m.boundingBox().min.map((v) => +v.toFixed(2))),
);

// cone e esfera
console.log(
  'cone',
  Manifold.cylinder(10, 5, 0, 64).volume().toFixed(1),
  'esfera',
  Manifold.sphere(5, 64).volume().toFixed(1),
  'esperado',
  ((4 / 3) * Math.PI * 125).toFixed(1),
);

// união/interseção em lote
console.log(
  'union batch',
  Manifold.union([Manifold.cube([1, 1, 1]), Manifold.cube([1, 1, 1]).translate([0.5, 0, 0])]).volume(),
);
console.log('compose', typeof Manifold.compose, 'batch intersection', typeof Manifold.intersection);
