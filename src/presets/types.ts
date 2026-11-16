import type { IRDocument } from '@/core/contracts';

export interface ParamSpec {
  readonly key: string;
  readonly label: string;
  readonly unit: 'mm' | 'un';
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly defaultValue: number;
  readonly integer?: boolean;
}

export type ParamValues = Readonly<Record<string, number>>;

export interface PresetDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly parameters: readonly ParamSpec[];
  readonly defaultParams: ParamValues;
  readonly clampParams: (values: ParamValues) => ParamValues;
  readonly buildIR: (values: ParamValues) => IRDocument;
}
