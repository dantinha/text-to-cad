/** Guardrails do IR (fonte única; usados pelo schema, pelo validador e pelos prompts da IA). */
export const MAX_NODES = 200;
export const MAX_DEPTH = 12;
export const MIN_DIM_MM = 0.1;
export const MAX_DIM_MM = 1000;
export const MAX_OFFSET_MM = 1000;
export const MAX_ANGLE_DEG = 360;
export const MIN_SCALE = 0.01;
export const MAX_SCALE = 100;
export const MIN_SEGMENTS = 3;
export const MAX_SEGMENTS = 128;
export const MIN_POLYGON_VERTICES = 3;
export const MAX_POLYGON_VERTICES = 256;
export const MAX_ID_LENGTH = 64;
export const MAX_LABEL_LENGTH = 80;
