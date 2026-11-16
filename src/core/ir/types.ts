/**
 * Tipos do IR (árvore CSG). Unidade fixa: mm. Eixo Z para cima.
 * O schema Zod em `schema.ts` é validado contra estes tipos em tempo de compilação.
 */
export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

interface NodeBase {
  /** Único no documento; a v2 (tutorial) referencia nós por este id. */
  readonly id: string;
  readonly label?: string | undefined;
  /** `#rrggbb` */
  readonly color?: string | undefined;
}

export interface CubeNode extends NodeBase {
  readonly type: 'cube';
  readonly size: Vec3;
  readonly center?: boolean | undefined;
}
export interface CylinderNode extends NodeBase {
  readonly type: 'cylinder';
  readonly height: number;
  readonly radius: number;
  readonly segments?: number | undefined;
  readonly center?: boolean | undefined;
}
export interface SphereNode extends NodeBase {
  readonly type: 'sphere';
  readonly radius: number;
  readonly segments?: number | undefined;
}
/** Cone com a base (raio `radius`) em z=0 e o vértice em z=`height`. */
export interface ConeNode extends NodeBase {
  readonly type: 'cone';
  readonly height: number;
  readonly radius: number;
  readonly segments?: number | undefined;
  readonly center?: boolean | undefined;
}
export interface TorusNode extends NodeBase {
  readonly type: 'torus';
  readonly majorRadius: number;
  readonly minorRadius: number;
  readonly segments?: number | undefined;
}
/** Polígono 2D (plano XY) extrudado ao longo de Z. */
export interface ExtrudeNode extends NodeBase {
  readonly type: 'extrude';
  readonly polygon: readonly Vec2[];
  readonly height: number;
  readonly center?: boolean | undefined;
}
export interface TranslateNode extends NodeBase {
  readonly type: 'translate';
  readonly offset: Vec3;
  readonly child: IRNode;
}
export interface RotateNode extends NodeBase {
  readonly type: 'rotate';
  /** Graus em torno de X, depois Y, depois Z (mesma convenção do OpenSCAD e manifold-3d). */
  readonly degrees: Vec3;
  readonly child: IRNode;
}
export interface ScaleNode extends NodeBase {
  readonly type: 'scale';
  readonly factor: Vec3;
  readonly child: IRNode;
}
export interface MirrorNode extends NodeBase {
  readonly type: 'mirror';
  /** Normal do plano de espelhamento (não nula). */
  readonly normal: Vec3;
  readonly child: IRNode;
}
export interface UnionNode extends NodeBase {
  readonly type: 'union';
  readonly children: readonly IRNode[];
}
export interface IntersectionNode extends NodeBase {
  readonly type: 'intersection';
  readonly children: readonly IRNode[];
}
export interface DifferenceNode extends NodeBase {
  readonly type: 'difference';
  readonly base: IRNode;
  readonly subtract: readonly IRNode[];
}

export type IRNode =
  | CubeNode
  | CylinderNode
  | SphereNode
  | ConeNode
  | TorusNode
  | ExtrudeNode
  | TranslateNode
  | RotateNode
  | ScaleNode
  | MirrorNode
  | UnionNode
  | IntersectionNode
  | DifferenceNode;

export type IRNodeType = IRNode['type'];

export interface IRDocument {
  readonly schemaVersion: 1;
  readonly units: 'mm';
  readonly name?: string | undefined;
  readonly root: IRNode;
}

/** Alias usado nos contratos: um IR é sempre um documento. */
export type IR = IRDocument;
