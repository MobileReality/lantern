import { deriveMacroView } from './lantern-macro';
import type { MacroOptions } from './lantern-macro';
import type { ParsedRecord } from './lantern-parse';

type BlockByPath = Readonly<Record<string, string>>;

function macroBlocksByPath(records: ParsedRecord[], options: MacroOptions): BlockByPath {
  const blocks: Record<string, string> = {};
  for (const record of records) {
    const [block] = deriveMacroView([record], options).blocks;
    if (block) blocks[record.path] = block.id;
  }
  return blocks;
}

export { macroBlocksByPath };
export type { BlockByPath };
