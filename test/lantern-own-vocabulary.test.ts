import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.join(__dirname, '..');
const VALIDATE = path.join(REPO_ROOT, 'skills', 'lantern-setup', 'scripts', 'validate.mjs');

describe('the vocabulary of this repo own map', () => {
  it('prints no [vocabulary] warning, so no feature is named after a platform', () => {
    const validated = spawnSync(process.execPath, [VALIDATE, REPO_ROOT, '--settled'], { encoding: 'utf8' });

    expect(validated.stdout.split('\n').filter((line) => line.includes('[vocabulary]'))).toEqual([]);
  });

  it('names the skills installer by what it does', () => {
    const features = fs.readFileSync(path.join(REPO_ROOT, '.lantern', 'features'), 'utf8').split('\n');

    expect(features).toContain('skill-installer');
    expect(features).not.toContain('skills-management');
  });
});
