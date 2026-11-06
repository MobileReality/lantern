import { buildTrayModel, type TrayGroupInput, type TrayModel } from '../../src/shared/tray-model';

const HOME = '/Users/ada';
const NOW = Date.parse('2026-02-03T10:00:00Z');
const MINUTE = 60_000;

const CLEARABLE_CLAUDE = new Set(['done', 'failed', 'stopped']);
const CLEARABLE_OTHER = new Set(['done', 'idle', 'ended']);
const TESTS = [
  { kind: 'done', label: 'Done' },
  { kind: 'waiting', label: 'Waiting for you' },
  { kind: 'permission', label: 'Needs permission' },
  { kind: 'error', label: 'Failed' },
];

function session(state: string, minutesAgo = 5, provider = 'claude') {
  return { state, provider, updatedAt: NOW - minutesAgo * MINUTE };
}

function group(name: string, parent: string, sessions: TrayGroupInput['sessions']): TrayGroupInput {
  return { name, path: `${parent}/${name}`, sessions };
}

function model(groups: TrayGroupInput[], notifications = true): TrayModel {
  return buildTrayModel(groups, {
    home: HOME,
    tests: notifications ? TESTS : [],
    isClearable: (provider, state) => (provider === 'claude' ? CLEARABLE_CLAUDE : CLEARABLE_OTHER).has(state),
  });
}

const manyGroups = (): TrayGroupInput[] => [
  group('shop-frontend', `${HOME}/GIT/clients/acme`, [session('permission', 2), session('running', 1)]),
  group('ledger', `${HOME}/GIT/clients/acme`, [session('idle', 9)]),
  group('payments-api', `${HOME}/GIT/clients`, [session('failed', 14, 'codex'), session('failed', 20)]),
  group('lantern', `${HOME}/GIT`, [session('running', 1), session('running', 3, 'codex')]),
  group('docs-site', `${HOME}/GIT`, [session('running', 6)]),
  group('infra', `${HOME}/GIT/ops`, [session('done', 31)]),
  group('mobile-app', `${HOME}/GIT/clients/globex`, [session('done', 55), session('stopped', 60)]),
  group('scratch', `${HOME}/tmp`, [session('stopped', 120)]),
  group('data-science', '/Volumes/work/research/notebooks', [session('unknown', 3)]),
  group('archive', `${HOME}/GIT/old`, []),
  group('gateway', `${HOME}/GIT/clients/initech`, [session('unavailable', 0)]),
];

const longGroups = (): TrayGroupInput[] => [
  group('a-remarkably-long-project-name-that-keeps-going-and-going-and-never-fits', '/Volumes/shared-engineering-drive/organisation/department/team/workstream/project-folder', [session('permission', 1)]),
  group('x', `${HOME}`, [session('done', 30), session('shell', 2)]),
  group('okay', `${HOME}/GIT`, [session('idle', 4)]),
];

const quietGroups = (): TrayGroupInput[] => [
  group('lantern', `${HOME}/GIT`, [session('running', 1)]),
  group('infra', `${HOME}/GIT/ops`, [session('done', 31)]),
];

const crowdedGroups = (): TrayGroupInput[] =>
  Array.from({ length: 30 }, (_, i) => group(`service-${String(i + 1).padStart(2, '0')}`, `${HOME}/GIT/platform`, [session(['running', 'done', 'idle', 'running', 'permission'][i % 5], i + 1)]));

export { crowdedGroups, longGroups, manyGroups, model, quietGroups };
