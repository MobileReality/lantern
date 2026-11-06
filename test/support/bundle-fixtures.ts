import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BUNDLE_SKILLS } from '../../scripts/lantern-bundle.mjs';

const SONNET_AGENT_NAMES = ['lantern-delegate-low', 'lantern-delegate-medium', 'lantern-delegate-high', 'lantern-delegate-xhigh', 'reviewer'];
const COMPLEX_AGENT_NAMES = ['opus', 'fable'].flatMap((model) => ['medium', 'high', 'xhigh'].map((effort) => `lantern-delegate-complex-${model}-${effort}`)).concat('reviewer-complex');
const AGENT_NAMES = [...SONNET_AGENT_NAMES, ...COMPLEX_AGENT_NAMES];

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export function makeBundle(root: string, tag = 'v1') {
  for (const { name } of BUNDLE_SKILLS) {
    write(path.join(root, name, 'SKILL.md'), `${name} ${tag}`);
    write(path.join(root, name, 'scripts', 'run.mjs'), `run ${tag}`);
    write(path.join(root, name, 'references', 'authority.md'), `authority ${tag}`);
  }
  write(path.join(root, 'lantern-setup', 'example-web', 'big.json'), '{}');
  for (const agent of SONNET_AGENT_NAMES) write(path.join(root, 'lantern-delegate', 'agents', `${agent}.md`), `${agent} ${tag}`);
  for (const agent of COMPLEX_AGENT_NAMES) write(path.join(root, 'lantern-delegate-complex', 'agents', `${agent}.md`), `${agent} ${tag}`);
}

export function git(dir: string, ...args: string[]) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined } });
}

export function makeRepo(dir: string, ignore: string | null = '.claude/') {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  write(path.join(dir, 'README.md'), 'project');
  if (ignore !== null) write(path.join(dir, '.gitignore'), `${ignore}\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

export function makeLinker(dir: string): string {
  fs.mkdirSync(path.join(dir, 'core'), { recursive: true });
  const executable = path.join(dir, 'link');
  fs.writeFileSync(executable, '#!/bin/sh\n');
  fs.chmodSync(executable, 0o755);
  return executable;
}

export function makeHome(dir: string, linker: string | null = null) {
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  if (linker) fs.writeFileSync(path.join(dir, '.claude', 'lantern-extensions.json'), JSON.stringify({ skillLinker: linker }));
  return dir;
}

export function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const d of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = path.join(rel, d.name);
      if (d.isDirectory()) walk(r);
      else out.push(`${r}:${fs.readFileSync(path.join(dir, r), 'utf8')}`);
    }
  };
  walk('');
  return out.sort();
}

export { AGENT_NAMES };
