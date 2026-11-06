import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SKILLS = path.join(__dirname, '..', 'skills');

describe('Codex skill package', () => {
  it('packages local Codex and authority references with every skill', () => {
    for (const skill of ['lantern-setup', 'lantern-sync', 'lantern-delegate']) {
      expect(fs.statSync(path.join(SKILLS, skill, 'references', 'authority.md')).isFile()).toBe(true);
      expect(fs.statSync(path.join(SKILLS, skill, 'references', 'codex.md')).isFile()).toBe(true);
    }
  });

  it('does not package unsupported custom Codex agent profiles', () => {
    expect(fs.existsSync(path.join(SKILLS, 'lantern-setup', 'codex-agents'))).toBe(false);
    expect(fs.existsSync(path.join(SKILLS, 'lantern-delegate', 'codex-agents'))).toBe(false);
  });
});
