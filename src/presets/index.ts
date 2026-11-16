import { bushingPreset } from './bushing';
import { dividerBoxPreset } from './dividerBox';
import { flangePreset } from './flange';
import { lBracketPreset } from './lBracket';
import type { PresetDefinition } from './types';

export type { ParamSpec, ParamValues, PresetDefinition } from './types';
export { lBracketPreset, flangePreset, dividerBoxPreset, bushingPreset };

export const PRESETS: readonly PresetDefinition[] = Object.freeze([
  lBracketPreset,
  flangePreset,
  dividerBoxPreset,
  bushingPreset,
]);

export function getPresetById(id: string): PresetDefinition | undefined {
  return PRESETS.find((preset) => preset.id === id);
}
