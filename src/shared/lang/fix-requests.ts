import de from './de/fix-requests.json';
import en from './en/fix-requests.json';
import es from './es/fix-requests.json';
import fr from './fr/fix-requests.json';
import it from './it/fix-requests.json';
import pl from './pl/fix-requests.json';
import pt from './pt/fix-requests.json';
import uk from './uk/fix-requests.json';

const PRESET_IDS = ['fix', 'test', 'rename', 'simplify', 'explain', 'remove'] as const;
const INTENT_IDS = ['fix', 'explain', 'question'] as const;
const DEFAULT_CODE = 'en';

type PresetId = (typeof PRESET_IDS)[number];
type IntentId = (typeof INTENT_IDS)[number];

const DEFAULT_INTENT: IntentId = 'fix';
const PRESET_INTENT: Partial<Record<PresetId, IntentId>> = { explain: 'explain' };

interface FixPreset {
  id: PresetId;
  text: string;
}

interface IntentTexts {
  label: string;
  instruction: string;
}

interface CopyTexts {
  header: string;
  scope: string;
  mixed: string;
  intentWord: string;
  intents: Record<IntentId, IntentTexts>;
}

type PresetTables = Record<string, unknown>;

const BUNDLED: PresetTables = { en, pl, de, es, fr, it, pt, uk };

function stringAt(table: unknown, path: readonly string[]): string | null {
  let at: unknown = table;
  for (const key of path) {
    if (!at || typeof at !== 'object') return null;
    at = (at as Record<string, unknown>)[key];
  }
  return typeof at === 'string' && at.trim() ? at : null;
}

function textOf(table: unknown, id: PresetId) {
  return stringAt(table, ['text', id]);
}

function isIntentId(value: unknown): value is IntentId {
  return INTENT_IDS.some((id) => id === value);
}

function tableFor(code: string | undefined, tables: PresetTables) {
  const base = code?.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return Object.hasOwn(tables, base) ? tables[base] : undefined;
}

function fixPresets(code?: string, tables: PresetTables = BUNDLED): FixPreset[] {
  const own = tableFor(code, tables);
  const fallback = tableFor(DEFAULT_CODE, tables);
  return PRESET_IDS.flatMap((id) => {
    const text = textOf(own, id) ?? textOf(fallback, id);
    return text ? [{ id, text }] : [];
  });
}

function presetText(id: string | undefined, presets: readonly FixPreset[]) {
  return presets.find((preset) => preset.id === id)?.text ?? '';
}

function suggestedIntent(preset: string | undefined): IntentId | undefined {
  return preset !== undefined && Object.hasOwn(PRESET_INTENT, preset) ? PRESET_INTENT[preset as PresetId] : undefined;
}

function copyTexts(code?: string, tables: PresetTables = BUNDLED): CopyTexts {
  const own = tableFor(code, tables);
  const fallback = tableFor(DEFAULT_CODE, tables);
  const pick = (...path: string[]) => stringAt(own, path) ?? stringAt(fallback, path) ?? '';
  const intent = (id: IntentId): IntentTexts => ({ label: pick('intent', id, 'label'), instruction: pick('intent', id, 'instruction') });
  return {
    header: pick('copy', 'header'),
    scope: pick('copy', 'scope'),
    mixed: pick('copy', 'mixed'),
    intentWord: pick('copy', 'intent'),
    intents: Object.fromEntries(INTENT_IDS.map((id) => [id, intent(id)])) as Record<IntentId, IntentTexts>,
  };
}

export { DEFAULT_INTENT, INTENT_IDS, PRESET_IDS, copyTexts, fixPresets, isIntentId, presetText, suggestedIntent };
export type { CopyTexts, FixPreset, IntentId, IntentTexts, PresetId, PresetTables };
