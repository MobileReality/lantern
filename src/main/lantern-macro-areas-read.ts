import type { LangStore } from './lantern-texts';
import { loadAreas } from './lantern-areas';
import { deriveMacroAreas } from './lantern-macro-areas';
import type { MacroAreas } from './lantern-macro-areas';
import type { ParsedRecord } from './lantern-parse';
import type { PlatformRule } from './lantern-platforms';

interface MacroAreasPart {
  areas?: MacroAreas;
  areasWarning?: string;
}

const IGNORED = 'Areas ignored, the flat view is shown';

function ignored(reason: string, more: number): MacroAreasPart {
  return { areasWarning: `${IGNORED}: ${reason}${more ? ` (and ${more} more)` : ''}` };
}

async function readMacroAreas(root: string, store: LangStore, records: ParsedRecord[], platforms: PlatformRule[], declared: ReadonlySet<string>): Promise<MacroAreasPart> {
  const syntaxErrors: string[] = [];
  const areas = await loadAreas(root, store, syntaxErrors);
  if (areas === null) return {};
  if (syntaxErrors.length) return ignored(syntaxErrors[0], syntaxErrors.length - 1);
  const derived = deriveMacroAreas(records, platforms, areas, declared);
  return derived.ok ? { areas: derived.areas } : ignored(derived.warning, 0);
}

export { readMacroAreas };
export type { MacroAreasPart };
