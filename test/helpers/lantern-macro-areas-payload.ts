import type { LanternArea } from '../../src/main/lantern-areas';
import { MIN_STRONG_EDGE } from '../../src/main/lantern-macro';
import { deriveMacroAreas } from '../../src/main/lantern-macro-areas';
import type { MacroAreas } from '../../src/main/lantern-macro-areas';
import type { MacroLoad } from '../../src/main/lantern-macro-load';
import { macroSystemsByPath } from '../../src/main/lantern-macro-systems';
import { macroFixtureBlocks, macroFixtureOptions, macroFixtureRecords, macroFixtureView } from './lantern-macro-fixture';

type Loaded = Extract<MacroLoad, { ok: true }>;

const FEATURE_TEXTS: Record<string, string> = {
  'agent-runs': 'starting agent sessions and following what they print',
  'code-insight': 'reading and highlighting the code of a file next to the graph',
  'delegate-runs': 'handing a task to a background agent and tracking its branch',
  'lantern-map': 'the map of the project, drawn as a graph of files and relations',
  'lantern-sections': 'project-wide notes shown below the graph',
  notifications: 'telling the user when an agent needs attention',
  'projects-hub': 'listing the projects and opening one of them',
  'pull-requests': 'listing pull requests and marking what each one touches',
  'serve-web': 'running the editor of a project in the browser',
  'session-monitoring': 'watching which sessions are busy, idle or waiting',
  'skills-management': 'installing and refreshing the skills of a project',
};

const AREA_LIST: LanternArea[] = [
  { id: 'project-map', description: 'mapping a project and reading its code', features: ['lantern-map', 'lantern-sections', 'code-insight'] },
  { id: 'pull-request-review', description: 'following pull requests and the agents that open them', features: ['pull-requests', 'delegate-runs'] },
  { id: 'agent-sessions', description: 'watching what the agents are doing and being told when they stop', features: ['agent-runs', 'session-monitoring', 'notifications'] },
  { id: 'workspace-setup', description: 'setting up projects, skills and the editor', features: ['projects-hub', 'skills-management'] },
];

function derivedAreas(list: LanternArea[] = AREA_LIST): MacroAreas {
  const derived = deriveMacroAreas(macroFixtureRecords(), macroFixtureOptions().platforms, list, new Set(Object.keys(FEATURE_TEXTS)));
  if (!derived.ok) throw new Error(derived.warning);
  return derived.areas;
}

function areasPayload(list: LanternArea[] = AREA_LIST): Loaded {
  return { ok: true, view: macroFixtureView(), texts: FEATURE_TEXTS, blockByPath: macroFixtureBlocks(), systemsByPath: macroSystemsByPath(macroFixtureRecords()), minStrongEdge: MIN_STRONG_EDGE, areas: derivedAreas(list) };
}

export { AREA_LIST, FEATURE_TEXTS, areasPayload, derivedAreas };
export type { Loaded };
