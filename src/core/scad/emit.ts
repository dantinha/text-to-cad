import type { EmitScad, IR, IRNode, Vec2, Vec3 } from '../contracts';

const INDENT_UNIT = '  ';

function indent(depth: number): string {
  return INDENT_UNIT.repeat(depth);
}

function sanitizeComment(text: string): string {
  let cleaned = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '\u2028' || ch === '\u2029' || code < 0x20 || code === 0x7f) {
      cleaned += ' ';
    } else {
      cleaned += ch;
    }
  }
  return cleaned.replace(/ +/g, ' ').trim();
}

function sanitizeColor(color: string): string {
  let cleaned = '';
  for (const ch of color) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      ch === '"' ||
      ch === '\\' ||
      ch === '\u2028' ||
      ch === '\u2029' ||
      code < 0x20 ||
      code === 0x7f
    ) {
      continue;
    }
    cleaned += ch;
  }
  return cleaned;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new RangeError(`Valor numérico inválido no IR: ${String(n)}`);
  }
  if (Number.isInteger(n)) {
    return n === 0 ? '0' : String(n);
  }
  const rounded = Number(n.toFixed(4));
  return rounded === 0 ? '0' : String(rounded);
}

function formatVec2(v: Vec2): string {
  return `[${formatNumber(v[0])}, ${formatNumber(v[1])}]`;
}

function formatVec3(v: Vec3): string {
  return `[${formatNumber(v[0])}, ${formatNumber(v[1])}, ${formatNumber(v[2])}]`;
}

function fnSuffix(segments: number | undefined): string {
  return segments !== undefined ? `, $fn = ${formatNumber(segments)}` : '';
}

function assertNever(value: never): never {
  throw new Error(`Tipo de nó IR não suportado: ${JSON.stringify(value)}`);
}

type LeafNode = Extract<
  IRNode,
  { type: 'cube' | 'cylinder' | 'sphere' | 'cone' | 'torus' | 'extrude' }
>;
type CompositeNode = Exclude<IRNode, LeafNode>;

function isLeafNode(node: IRNode): node is LeafNode {
  switch (node.type) {
    case 'cube':
    case 'cylinder':
    case 'sphere':
    case 'cone':
    case 'torus':
    case 'extrude':
      return true;
    case 'translate':
    case 'rotate':
    case 'scale':
    case 'mirror':
    case 'union':
    case 'intersection':
    case 'difference':
      return false;
    default:
      return assertNever(node);
  }
}

function emitLeafStatement(node: LeafNode): string {
  switch (node.type) {
    case 'cube':
      return `cube(${formatVec3(node.size)}, center = ${node.center ?? false});`;
    case 'cylinder':
      return `cylinder(h = ${formatNumber(node.height)}, r = ${formatNumber(node.radius)}, center = ${node.center ?? false}${fnSuffix(node.segments)});`;
    case 'cone':
      return `cylinder(h = ${formatNumber(node.height)}, r1 = ${formatNumber(node.radius)}, r2 = 0, center = ${node.center ?? false}${fnSuffix(node.segments)});`;
    case 'sphere':
      return `sphere(r = ${formatNumber(node.radius)}${fnSuffix(node.segments)});`;
    case 'torus': {
      const fnAttr = node.segments !== undefined ? `$fn = ${formatNumber(node.segments)}` : '';
      return `rotate_extrude(${fnAttr}) translate([${formatNumber(node.majorRadius)}, 0, 0]) circle(r = ${formatNumber(node.minorRadius)}${fnSuffix(node.segments)});`;
    }
    case 'extrude': {
      const points = node.polygon.map(formatVec2).join(', ');
      return `linear_extrude(height = ${formatNumber(node.height)}, center = ${node.center ?? false}) polygon(points = [${points}]);`;
    }
    default:
      return assertNever(node);
  }
}

function emitCompositeBlock(node: CompositeNode, depth: number): string[] {
  switch (node.type) {
    case 'translate':
      return emitBlock(`translate(${formatVec3(node.offset)})`, [node.child], depth);
    case 'rotate':
      return emitBlock(`rotate(${formatVec3(node.degrees)})`, [node.child], depth);
    case 'scale':
      return emitBlock(`scale(${formatVec3(node.factor)})`, [node.child], depth);
    case 'mirror':
      return emitBlock(`mirror(${formatVec3(node.normal)})`, [node.child], depth);
    case 'union':
      return emitBlock('union()', node.children, depth);
    case 'intersection':
      return emitBlock('intersection()', node.children, depth);
    case 'difference':
      return emitBlock('difference()', [node.base, ...node.subtract], depth);
    default:
      return assertNever(node);
  }
}

function emitBlock(header: string, children: readonly IRNode[], depth: number): string[] {
  const pad = indent(depth);
  const lines = [`${pad}${header} {`];
  for (const child of children) {
    lines.push(...emitNode(child, depth + 1));
  }
  lines.push(`${pad}}`);
  return lines;
}

function emitNode(node: IRNode, depth: number): string[] {
  const pad = indent(depth);
  const lines: string[] = [];

  if (node.label !== undefined) {
    const safeLabel = sanitizeComment(node.label);
    if (safeLabel.length > 0) {
      lines.push(`${pad}// ${safeLabel}`);
    }
  }

  if (isLeafNode(node)) {
    const stmt = emitLeafStatement(node);
    if (node.color !== undefined) {
      lines.push(`${pad}color("${sanitizeColor(node.color)}") ${stmt}`);
    } else {
      lines.push(`${pad}${stmt}`);
    }
    return lines;
  }

  if (node.color !== undefined) {
    lines.push(`${pad}color("${sanitizeColor(node.color)}") {`);
    lines.push(...emitCompositeBlock(node, depth + 1));
    lines.push(`${pad}}`);
    return lines;
  }

  lines.push(...emitCompositeBlock(node, depth));
  return lines;
}

/** Emite código OpenSCAD determinístico (unidade mm, Z-up) a partir de um documento IR. */
export const emitScad: EmitScad = (ir: IR): string => {
  const lines: string[] = [];
  if (ir.name !== undefined) {
    const safeName = sanitizeComment(ir.name);
    if (safeName.length > 0) {
      lines.push(`// Modelo: ${safeName}`);
    }
  }
  lines.push('// Unidade: mm | Eixo Z para cima');
  lines.push('');
  lines.push(...emitNode(ir.root, 0));
  return `${lines.join('\n')}\n`;
};
