import { COMMANDS, commandTitle } from '../../shared/commands';
import type { CommandId } from '../../shared/commands';
import type { Keymap } from '../../shared/commands/keymap';
import { matchesWords } from '../lib/settings-search';

export interface LabelSegment {
  text: string;
  hit: boolean;
}

export function labelSegments(label: string, query: string): LabelSegment[] {
  const hits = new Array<boolean>(label.length).fill(false);
  const lower = label.toLowerCase();
  for (const word of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + 1)) hits.fill(true, at, at + word.length);
  }
  const segments: LabelSegment[] = [];
  for (let i = 0; i < label.length; i++) {
    const last = segments[segments.length - 1];
    if (last && last.hit === hits[i]) last.text += label[i];
    else segments.push({ text: label[i], hit: hits[i] });
  }
  return segments;
}

export interface PaletteItem {
  id: CommandId;
  label: string;
  keys: string | undefined;
}

export function paletteItems({
  available,
  byCommand,
  usage,
  query,
}: {
  available: readonly CommandId[];
  byCommand: Keymap['byCommand'];
  usage: Record<string, number>;
  query: string;
}): PaletteItem[] {
  return COMMANDS.filter((c) => c.id !== 'palette.open' && available.includes(c.id))
    .map((c) => ({ id: c.id, label: commandTitle(c.id), keys: byCommand.get(c.id) }))
    .filter((item) => matchesWords(item.label, query))
    .sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0));
}
