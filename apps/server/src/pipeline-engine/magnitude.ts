/**
 * The business rule that answers the client's key question: is this a UI skin, an extension of
 * existing systems, or a change to the core engine? Agents rate impact per component; the rule
 * combines those levels with each component's sensitivity from the Architecture Overview.
 *
 * Only medium and high impacts count; low impacts (config, data, a new field in the save) never
 * change the class on their own.
 *
 * - core_engine: a core component (movement, game loop, level generation, save format) rated
 *   medium or high.
 * - feature_extension: any other non-cosmetic component rated medium or high.
 * - cosmetic: everything else, e.g. skins, screens and audio, plus small data or config changes.
 */

export type Magnitude = 'cosmetic' | 'feature_extension' | 'core_engine';
export type ImpactLevel = 'none' | 'low' | 'medium' | 'high';
export type Sensitivity = 'core' | 'feature' | 'cosmetic';

export const MAGNITUDE_LABEL: Record<Magnitude, string> = {
  cosmetic: 'UI/cosmetic only',
  feature_extension: 'Feature extension',
  core_engine: 'Core engine change',
};

const significant = (level: ImpactLevel) => level === 'medium' || level === 'high';

export function classifyChange(
  impacts: { component: string; level: ImpactLevel }[],
  components: { name: string; sensitivity: Sensitivity }[],
): { magnitude: Magnitude; reason: string } {
  // Components missing from the map count as feature-level, the cautious middle.
  const sensitivityOf = (name: string): Sensitivity =>
    components.find((c) => c.name === name)?.sensitivity ?? 'feature';
  const describe = (list: { component: string; level: ImpactLevel }[]) =>
    list.map((i) => `${i.component} (${i.level})`).join(', ');
  const heavy = impacts.filter((i) => significant(i.level));
  const light = impacts.filter((i) => i.level === 'low');

  const core = heavy.filter((i) => sensitivityOf(i.component) === 'core');
  if (core.length > 0) {
    return { magnitude: 'core_engine', reason: `Core components need real changes: ${describe(core)}.` };
  }
  const feature = heavy.filter((i) => sensitivityOf(i.component) === 'feature');
  if (feature.length > 0) {
    return { magnitude: 'feature_extension', reason: `Extends existing systems: ${describe(feature)}.` };
  }
  const touched = [...heavy, ...light];
  return {
    magnitude: 'cosmetic',
    reason: touched.length
      ? `Only looks, content, or small data and config changes: ${describe(touched)}.`
      : 'No component needs a real change.',
  };
}
