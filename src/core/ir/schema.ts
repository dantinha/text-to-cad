import { z } from 'zod';
import {
  MAX_ANGLE_DEG,
  MAX_DIM_MM,
  MAX_ID_LENGTH,
  MAX_LABEL_LENGTH,
  MAX_OFFSET_MM,
  MAX_POLYGON_VERTICES,
  MAX_SCALE,
  MAX_SEGMENTS,
  MIN_DIM_MM,
  MIN_POLYGON_VERTICES,
  MIN_SCALE,
  MIN_SEGMENTS,
} from './limits';
import type { IRDocument, IRNode } from './types';

const dim = z.number().min(MIN_DIM_MM).max(MAX_DIM_MM);
const offset = z.number().min(-MAX_OFFSET_MM).max(MAX_OFFSET_MM);
const angle = z.number().min(-MAX_ANGLE_DEG).max(MAX_ANGLE_DEG);
const factor = z.number().min(MIN_SCALE).max(MAX_SCALE);
const segments = z.number().int().min(MIN_SEGMENTS).max(MAX_SEGMENTS);

const vec3 = <T extends z.ZodNumber>(item: T) => z.tuple([item, item, item]);

const baseShape = {
  id: z
    .string()
    .min(1)
    .max(MAX_ID_LENGTH)
    .regex(/^[A-Za-z0-9_.-]+$/),
  label: z.string().max(MAX_LABEL_LENGTH).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
};

export const NODE_TYPES = [
  'cube',
  'cylinder',
  'sphere',
  'cone',
  'torus',
  'extrude',
  'translate',
  'rotate',
  'scale',
  'mirror',
  'union',
  'intersection',
  'difference',
] as const;

export const irNodeSchema: z.ZodType<IRNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.strictObject({
      ...baseShape,
      type: z.literal('cube'),
      size: vec3(dim),
      center: z.boolean().optional(),
    }),
    z.strictObject({
      ...baseShape,
      type: z.literal('cylinder'),
      height: dim,
      radius: dim,
      segments: segments.optional(),
      center: z.boolean().optional(),
    }),
    z.strictObject({
      ...baseShape,
      type: z.literal('sphere'),
      radius: dim,
      segments: segments.optional(),
    }),
    z.strictObject({
      ...baseShape,
      type: z.literal('cone'),
      height: dim,
      radius: dim,
      segments: segments.optional(),
      center: z.boolean().optional(),
    }),
    z
      .strictObject({
        ...baseShape,
        type: z.literal('torus'),
        majorRadius: dim,
        minorRadius: dim,
        segments: segments.optional(),
      })
      .refine((t) => t.minorRadius < t.majorRadius, {
        path: ['minorRadius'],
        message: 'O raio menor do torus deve ser menor que o raio maior.',
      }),
    z.strictObject({
      ...baseShape,
      type: z.literal('extrude'),
      polygon: z
        .array(z.tuple([offset, offset]))
        .min(MIN_POLYGON_VERTICES)
        .max(MAX_POLYGON_VERTICES),
      height: dim,
      center: z.boolean().optional(),
    }),
    z.strictObject({
      ...baseShape,
      type: z.literal('translate'),
      offset: vec3(offset),
      child: irNodeSchema,
    }),
    z.strictObject({
      ...baseShape,
      type: z.literal('rotate'),
      degrees: vec3(angle),
      child: irNodeSchema,
    }),
    z.strictObject({
      ...baseShape,
      type: z.literal('scale'),
      factor: vec3(factor),
      child: irNodeSchema,
    }),
    z.strictObject({
      ...baseShape,
      type: z.literal('mirror'),
      normal: vec3(offset).refine((v) => v.some((c) => c !== 0), {
        message: 'O vetor normal do espelhamento não pode ser nulo.',
      }),
      child: irNodeSchema,
    }),
    z.strictObject({
      ...baseShape,
      type: z.literal('union'),
      children: z.array(irNodeSchema).min(2),
    }),
    z.strictObject({
      ...baseShape,
      type: z.literal('intersection'),
      children: z.array(irNodeSchema).min(2),
    }),
    z.strictObject({
      ...baseShape,
      type: z.literal('difference'),
      base: irNodeSchema,
      subtract: z.array(irNodeSchema).min(1),
    }),
  ]),
);

export const irDocumentSchema: z.ZodType<IRDocument> = z.strictObject({
  schemaVersion: z.literal(1),
  units: z.literal('mm'),
  name: z.string().max(MAX_LABEL_LENGTH).optional(),
  root: irNodeSchema,
});
