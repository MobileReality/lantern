import { describe, expect, it } from 'vitest';
import { attributeProjects, type Attributable } from '../src/main/memory-attribute';
import { PROJECT_MOBILE, PROJECT_WEBAPP } from './helpers/memory-fixtures';

const entry = (pid: number, ppid: number, kind: Attributable['kind'], command = 'x'): Attributable => ({ pid, ppid, kind, command });
const projects = [PROJECT_WEBAPP, PROJECT_MOBILE];

describe('attributeProjects', () => {
  it('attributes a process by its working directory, worktrees included', () => {
    const result = attributeProjects(
      [entry(10, 1, 'claude'), entry(11, 1, 'shell')],
      new Map([
        [10, PROJECT_WEBAPP],
        [11, `${PROJECT_MOBILE}/.claude/worktrees/agent-1`],
      ]),
      projects,
    );
    expect(result.get(10)).toBe(PROJECT_WEBAPP);
    expect(result.get(11)).toBe(PROJECT_MOBILE);
  });

  it('attributes by a project path in the command line', () => {
    const result = attributeProjects([entry(10, 1, 'node', `node ${PROJECT_WEBAPP}/node_modules/.bin/vite --port 5173`)], new Map(), projects);
    expect(result.get(10)).toBe(PROJECT_WEBAPP);
  });

  it('does not match a longer folder name or a path under another root', () => {
    const result = attributeProjects(
      [entry(10, 1, 'node', `node ${PROJECT_WEBAPP}-old/server.js`), entry(11, 1, 'node', `node /backup${PROJECT_WEBAPP}/server.js`)],
      new Map(),
      projects,
    );
    expect(result.has(10)).toBe(false);
    expect(result.has(11)).toBe(false);
  });

  it('prefers the working directory over a path mentioned in the command', () => {
    const result = attributeProjects([entry(10, 1, 'node', `node ${PROJECT_MOBILE}/a.js`)], new Map([[10, PROJECT_WEBAPP]]), projects);
    expect(result.get(10)).toBe(PROJECT_WEBAPP);
  });

  it('picks the closest of nested projects', () => {
    const nested = `${PROJECT_WEBAPP}/packages/ui`;
    const result = attributeProjects([entry(10, 1, 'claude')], new Map([[10, `${nested}/src`]]), [PROJECT_WEBAPP, nested]);
    expect(result.get(10)).toBe(nested);
  });

  it('leaves a process in no project unattributed', () => {
    const result = attributeProjects([entry(10, 1, 'claude')], new Map([[10, '/Users/dev/other']]), projects);
    expect(result.has(10)).toBe(false);
  });

  it('gives an extension host the project its children agree on, and passes it on to the rest of its children', () => {
    const entries = [entry(20, 1, 'extension-host'), entry(21, 20, 'claude'), entry(22, 20, 'tsserver'), entry(23, 20, 'codex')];
    const cwds = new Map([
      [21, PROJECT_WEBAPP],
      [22, PROJECT_WEBAPP],
    ]);
    const result = attributeProjects(entries, cwds, projects);
    expect(result.get(20)).toBe(PROJECT_WEBAPP);
    expect(result.get(23)).toBe(PROJECT_WEBAPP);
  });

  it('leaves an extension host unattributed when its children disagree or none is known', () => {
    const mixed = attributeProjects(
      [entry(20, 1, 'extension-host'), entry(21, 20, 'claude'), entry(22, 20, 'tsserver')],
      new Map([
        [21, PROJECT_WEBAPP],
        [22, PROJECT_MOBILE],
      ]),
      projects,
    );
    expect(mixed.has(20)).toBe(false);
    const empty = attributeProjects([entry(30, 1, 'extension-host'), entry(31, 30, 'codex')], new Map(), projects);
    expect(empty.size).toBe(0);
  });

  it('never gives the app or server processes a project just because one project is open', () => {
    const entries = [entry(1, 0, 'main'), entry(2, 1, 'server'), entry(20, 2, 'extension-host'), entry(21, 20, 'claude')];
    const result = attributeProjects(entries, new Map([[21, PROJECT_WEBAPP]]), projects);
    expect(result.has(1)).toBe(false);
    expect(result.has(2)).toBe(false);
  });
});
