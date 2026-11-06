import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { registeredProject, safeAgentRequest } from '../src/main/agent-request';

const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-request-'));
const other = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-request-other-'));
const registered = [project];
afterAll(() => [project, other].forEach((dir) => { fs.rmSync(dir, { recursive: true, force: true }); }));

describe('safeAgentRequest', () => {
  it('accepts a known kind for a registered project', () => {
    expect(safeAgentRequest({ project, kind: 'lantern' }, registered)).toEqual({ project, kind: 'lantern', target: undefined });
    expect(safeAgentRequest({ project: `${project}${path.sep}`, kind: 'lantern-refresh' }, registered)?.project).toBe(project);
  });

  it.each([
    ['not an object', 'lantern'],
    ['an unregistered project', { project: other, kind: 'lantern' }],
    ['a relative project', { project: 'repo', kind: 'lantern' }],
    ['a missing directory', { project: path.join(project, 'nope'), kind: 'lantern' }],
    ['an unknown kind', { project, kind: 'shell' }],
    ['a kind that does not exist', { project, kind: 'dataflow' }],
    ['a target on a kind that takes none', { project, kind: 'lantern', target: 'x.md' }],
  ])('rejects %s', (_label, value) => {
    expect(safeAgentRequest(value, registered)).toBeNull();
  });
});

describe('registeredProject', () => {
  it('returns the registered path only for an existing absolute directory in the list', () => {
    expect(registeredProject(project, registered)).toBe(project);
    expect(registeredProject(other, registered)).toBeNull();
    expect(registeredProject(42, registered)).toBeNull();
  });
});
