import { MIN_STRONG_EDGE } from './lantern-macro';
import type { MacroView } from './lantern-macro';
import type { MacroAreasPart } from './lantern-macro-areas-read';
import type { BlockByPath } from './lantern-macro-files';
import type { SystemsByPath } from './lantern-macro-systems';

interface MacroHintPart {
  areasHint?: true;
}

interface MacroData extends MacroAreasPart, MacroHintPart {
  view: MacroView;
  texts: Record<string, string>;
  blockByPath: BlockByPath;
  systemsByPath: SystemsByPath;
}

type MacroLoad = ({ ok: true; view: MacroView; texts: Record<string, string>; blockByPath: BlockByPath; systemsByPath: SystemsByPath; minStrongEdge: number } & MacroAreasPart & MacroHintPart) | { ok: false; error: string };

type MacroSource = (project: string, lang?: string) => Promise<MacroData | null>;

const NO_MAP = 'this project has no Lantern map';

async function readRegisteredMacro(isRegistered: (dir: string) => boolean, source: MacroSource, project: unknown, lang?: unknown): Promise<MacroLoad> {
  if (typeof project !== 'string' || !project.trim()) return { ok: false, error: 'invalid project' };
  if (!isRegistered(project)) return { ok: false, error: 'not a registered project' };
  try {
    const data = await source(project, typeof lang === 'string' ? lang : undefined);
    if (!data) return { ok: false, error: NO_MAP };
    const { areas, areasWarning, areasHint } = data;
    return { ok: true, view: data.view, texts: data.texts, blockByPath: data.blockByPath, systemsByPath: data.systemsByPath, minStrongEdge: MIN_STRONG_EDGE, ...(areas ? { areas } : {}), ...(areasWarning ? { areasWarning } : {}), ...(areasHint ? { areasHint } : {}) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export { NO_MAP, readRegisteredMacro };
export type { MacroData, MacroLoad };
