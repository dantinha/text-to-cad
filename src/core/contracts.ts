/**
 * Contratos congelados no M1. Mudanças exigem aprovação do coordenador e um ADR.
 * Este arquivo só declara tipos; as implementações vivem em `core/`, `kernel/`, `export/` e `ai/`.
 */
import type { IR, Vec3 } from './ir/types';

export type {
  ConeNode,
  CubeNode,
  CylinderNode,
  DifferenceNode,
  ExtrudeNode,
  IntersectionNode,
  IR,
  IRDocument,
  IRNode,
  IRNodeType,
  MirrorNode,
  RotateNode,
  ScaleNode,
  SphereNode,
  TorusNode,
  TranslateNode,
  UnionNode,
  Vec2,
  Vec3,
} from './ir/types';

/** Resultado explícito: erros esperados nunca são exceções. */
export type Result<T, E> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/** Problema de validação do IR. `path` no formato `root.children[1].size[0]`; `message` em PT-BR. */
export interface IRIssue {
  readonly path: string;
  readonly code: IRIssueCode;
  readonly message: string;
}

export type IRIssueCode =
  | 'campo_obrigatorio'
  | 'campo_desconhecido'
  | 'tipo_invalido'
  | 'formato_invalido'
  | 'valor_invalido'
  | 'valor_fora_do_limite'
  | 'schema_version'
  | 'unidade_invalida'
  | 'id_duplicado'
  | 'limite_nos'
  | 'limite_profundidade'
  | 'ciclo';

/** Malha avaliada pelo kernel. Trafega worker -> UI por Transferable (zero-copy). */
export interface MeshData {
  /** xyz por vértice, 3 floats cada. */
  readonly positions: Float32Array;
  /** Normais por vértice (mesmo tamanho de `positions`). */
  readonly normals: Float32Array;
  /** 3 índices por triângulo. */
  readonly indices: Uint32Array;
  readonly bbox: { readonly min: Vec3; readonly max: Vec3 };
  readonly volumeMm3: number;
  readonly triangleCount: number;
}

export type KernelErrorCode = 'timeout' | 'cancelled' | 'invalid_mesh' | 'wasm_error';
export interface KernelError {
  readonly code: KernelErrorCode;
  readonly message: string;
}

export type GenErrorCode =
  | 'prompt_invalid'
  | 'rate_limited'
  | 'timeout'
  | 'cancelled'
  | 'network'
  | 'proxy_error'
  | 'invalid_response'
  | 'repair_failed';
export interface GenError {
  readonly code: GenErrorCode;
  readonly message: string;
  /** Presente quando o IR gerado falhou na validação (`repair_failed`). */
  readonly issues?: readonly IRIssue[];
}

export interface GenOptions {
  readonly signal?: AbortSignal;
  /** Chave BYOK do usuário (vinda de sessionStorage). Nunca persistida nem logada. */
  readonly userKey?: string;
}

/** Assinaturas dos módulos. Cada uma tem um único dono (ver `.agents/.../rules/AGENTS.md`). */
export type ValidateIR = (input: unknown) => Result<IR, readonly IRIssue[]>;
export type Evaluate = (ir: IR, signal?: AbortSignal) => Promise<Result<MeshData, KernelError>>;
export type EmitScad = (ir: IR) => string;
export type GenerateIR = (prompt: string, opts?: GenOptions) => Promise<Result<IR, GenError>>;
export type ExportStl = (mesh: MeshData) => Blob;
