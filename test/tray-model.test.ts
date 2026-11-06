import { describe, expect, it } from 'vitest';
import { buildTrayModel, pathTail } from '../src/shared/tray-model';
import { manyGroups, model, quietGroups } from './fixtures/tray-groups';

const group = (name: string, states: string[], parent = '/work', at = 0) => ({ name, path: `${parent}/${name}`, sessions: states.map((state) => ({ state, provider: 'claude', updatedAt: at })) });
const names = (m: ReturnType<typeof model>) => m.sections.flatMap((section) => section.rows.map((row) => row.name));
const ids = (m: ReturnType<typeof model>) => m.sections.map((section) => section.id);

describe('the tray sections', () => {
  it('puts what needs you first, then working, then finished, then the rest', () => {
    const m = model(manyGroups());
    expect(ids(m)).toEqual(['needs', 'working', 'finished', 'other']);
    expect(m.sections[0].rows.map((row) => row.state)).toEqual(['permission', 'failed', 'idle']);
  });

  it('orders approval before failure before waiting inside the needs-you section', () => {
    const m = model([group('c', ['idle']), group('b', ['failed']), group('a', ['permission'])]);
    expect(names(m)).toEqual(['a', 'b', 'c']);
  });

  it('shows the most urgent state a project has, not the aggregate order of the sidebar', () => {
    const m = model([group('mixed', ['done', 'running', 'idle'])]);
    expect(m.sections).toHaveLength(1);
    expect(m.sections[0]).toMatchObject({ id: 'needs', rows: [{ name: 'mixed', state: 'idle', tone: 'waiting', count: 1 }] });
  });

  it('counts the sessions in the row state, so two failures read as two', () => {
    const m = model([group('p', ['failed', 'failed', 'running'])]);
    expect(m.sections[0].rows[0]).toMatchObject({ state: 'failed', count: 2 });
  });

  it('puts the most recently changed project first within a section, then by name', () => {
    const m = model([group('old', ['running'], '/w', 1000), group('new', ['running'], '/w', 5000), group('also-old', ['running'], '/w', 1000)]);
    expect(names(m)).toEqual(['new', 'also-old', 'old']);
  });

  it('keeps a finished project with a background task among the finished', () => {
    const m = model([group('p', ['shell'])]);
    expect(m.sections[0]).toMatchObject({ id: 'finished', rows: [{ state: 'shell', tone: 'finished' }] });
  });

  it('files stopped, unknown, unavailable, closed and session-less projects under other', () => {
    const m = model([group('s', ['stopped']), group('u', ['unknown']), group('n', ['unavailable']), group('e', ['ended']), group('o', [])]);
    expect(ids(m)).toEqual(['other']);
    expect(m.sections[0].rows.map((row) => row.state)).toEqual(['stopped', 'unknown', 'unavailable', 'ended', 'open']);
  });

  it('reads a state it does not know as unknown instead of dropping the project', () => {
    const m = model([group('p', ['teleporting'])]);
    expect(m.sections[0].rows[0]).toMatchObject({ name: 'p', state: 'unknown' });
  });

  it('leaves out a section with no projects', () => {
    expect(ids(model(quietGroups()))).toEqual(['working', 'finished']);
  });
});

describe('the header summary', () => {
  it('counts the sessions that need you across projects', () => {
    expect(model(manyGroups()).needsYou).toBe(4);
  });

  it('is zero and quiet when nothing needs you', () => {
    expect(model([group('p', ['running', 'done', 'stopped'])]).needsYou).toBe(0);
  });

  it('takes the pill colour from the most urgent project', () => {
    expect(model([group('a', ['running']), group('b', ['permission'])]).tone).toBe('permission');
    expect(model([group('a', ['running']), group('b', ['done'])]).tone).toBe('working');
    expect(model([group('a', ['done'])]).tone).toBe('finished');
  });

  it('stays quiet when only the other section has projects', () => {
    expect(model([group('a', ['stopped'])]).tone).toBe('quiet');
    expect(model([]).tone).toBe('quiet');
  });
});

describe('the empty state', () => {
  it('is empty when no project is known, with no sections and nothing to clear', () => {
    expect(model([])).toMatchObject({ empty: true, sections: [], needsYou: 0, canClear: false });
  });

  it('is not empty for a project that has no session yet', () => {
    expect(model([group('fresh', [])]).empty).toBe(false);
  });
});

describe('what the footer offers', () => {
  it('offers Clear finished only when a session can be cleared', () => {
    expect(model([group('p', ['running', 'shell'])]).canClear).toBe(false);
    expect(model([group('p', ['running', 'done'])]).canClear).toBe(true);
  });

  it('asks the injected rule per provider, so Claude and Codex clear different states', () => {
    const asked: [string | undefined, string][] = [];
    buildTrayModel([{ name: 'p', path: '/p', sessions: [{ state: 'idle', provider: 'codex' }] }], { home: '', tests: [], isClearable: (provider, state) => (asked.push([provider, state]), false) });
    expect(asked).toEqual([['codex', 'idle']]);
  });

  it('carries the test notification entries, none when notifications are off', () => {
    expect(model(manyGroups(), true).tests.map((test) => test.kind)).toEqual(['done', 'waiting', 'permission', 'error']);
    expect(model(manyGroups(), false).tests).toEqual([]);
  });
});

describe('pathTail', () => {
  const home = '/Users/ada';

  it('shows the parent folder with the home folder as a tilde', () => {
    expect(pathTail('/Users/ada/GIT/shop', home)).toBe('~/GIT');
    expect(pathTail('/Users/ada/shop', home)).toBe('~');
  });

  it('keeps the tilde and the closest two folders when the path is deep', () => {
    expect(pathTail('/Users/ada/GIT/clients/acme/shop', home)).toBe('~/…/clients/acme');
  });

  it('keeps the closest three folders of a path outside home', () => {
    expect(pathTail('/Volumes/work/research/notebooks/lab', home)).toBe('…/work/research/notebooks');
    expect(pathTail('/srv/apps/shop', home)).toBe('/srv/apps');
  });

  it('is empty for a project at the root', () => {
    expect(pathTail('/shop', home)).toBe('');
  });

  it('does not treat a sibling of the home folder as inside it', () => {
    expect(pathTail('/Users/adam/GIT/shop', home)).toBe('/Users/adam/GIT');
  });

  it('works without a home folder', () => {
    expect(pathTail('/Users/ada/GIT/shop', '')).toBe('/Users/ada/GIT');
  });
});
