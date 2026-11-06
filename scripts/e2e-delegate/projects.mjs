import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const REMOTE_WORKSPACE = 'e2e';
export const MAIN_BRANCH = 'main';
export const GIT_IDENTITY = { name: 'E2E Tester', email: 'e2e@example.test' };
export const GITIGNORE = ['.ai/.env', '.ai/tmp/', '.ai/runs/', '.claude/', '__pycache__/', '*.pyc'];

const TODO_CLI = {
  'package.json': '{ "name": "todo-cli", "version": "0.1.0", "type": "module", "scripts": { "test": "node --test" } }\n',
  'src.mjs': `export function add(list, text) { return [...list, { text, done: false }]; }
export function complete(list, i) { return list.map((t, j) => (j === i ? { ...t, done: true } : t)); }
export function render(list) { return list.map((t, i) => \`\${i + 1}. [\${t.done ? 'x' : ' '}] \${t.text}\`).join('\\n'); }
`,
  'cli.mjs': `import { add, complete, render } from './src.mjs';
let list = [];
for (const a of process.argv.slice(2)) list = a.startsWith('done:') ? complete(list, Number(a.slice(5)) - 1) : add(list, a);
console.log(render(list));
`,
  'src.test.mjs': `import test from 'node:test';
import assert from 'node:assert/strict';
import { add, complete, render } from './src.mjs';
test('add then complete', () => { assert.equal(render(complete(add([], 'a'), 0)), '1. [x] a'); });
`,
  'README.md': '# todo-cli\n',
};

const TINY_API = {
  'package.json': '{ "name": "tiny-api", "version": "0.1.0", "type": "module", "scripts": { "test": "node --test" } }\n',
  'server.mjs': `import http from 'node:http';
import { route } from './routes.mjs';
export const server = http.createServer((req, res) => { const r = route(req.method, req.url); res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(r.body)); });
if (process.argv[1]?.endsWith('server.mjs')) server.listen(3000);
`,
  'routes.mjs': `export function route(method, url) {
  if (method === 'GET' && url === '/health') return { status: 200, body: { ok: true } };
  return { status: 404, body: { error: 'not found' } };
}
`,
  'routes.test.mjs': `import test from 'node:test';
import assert from 'node:assert/strict';
import { route } from './routes.mjs';
test('health', () => { assert.equal(route('GET', '/health').status, 200); });
test('unknown', () => { assert.equal(route('GET', '/x').status, 404); });
`,
  'README.md': '# tiny-api\n',
};

const PYUTIL = {
  'pyutil/__init__.py': 'from .text import slugify, truncate\n',
  'pyutil/text.py': `import re


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def truncate(s: str, n: int) -> str:
    return s if len(s) <= n else s[: n - 1] + "…"
`,
  'tests/test_text.py': `import unittest
from pyutil import slugify, truncate


class T(unittest.TestCase):
    def test_slugify(self):
        self.assertEqual(slugify("Hello, World!"), "hello-world")

    def test_truncate(self):
        self.assertEqual(truncate("abcdef", 4), "abcdef"[:3] + "…")
`,
  'README.md': '# pyutil\nRun: python3 -m unittest discover -s tests\n',
};

const RUBYUTIL = {
  'lib/stringx.rb': `module Stringx
  def self.reverse_words(s)
    s.split(" ").reverse.join(" ")
  end

  def self.shout(s)
    s.upcase + "!"
  end
end
`,
  'test/test_stringx.rb': `require "minitest/autorun"
require "stringx"

class TestStringx < Minitest::Test
  def test_reverse_words
    assert_equal "b a", Stringx.reverse_words("a b")
  end

  def test_shout
    assert_equal "HI!", Stringx.shout("hi")
  end
end
`,
  'README.md': '# rubyutil\nRun: ruby -Ilib -Itest test/test_stringx.rb\n',
};

const neutralSkill = (name, rule) => ({
  name,
  files: {
    'SKILL.md': `---
name: ${name}
description: A neutral rule for the lantern-delegate end-to-end test. Use whenever the extensions config names it.
---

# ${name}

${rule}
`,
  },
});

export const EXTRA_SKILL = neutralSkill('e2e-extra', 'Keep every function you add under 25 lines.');
export const ORCH_EXTRA_SKILL = neutralSkill('e2e-orch-extra', 'Name the branch of the task after what it changes, in kebab case.');
export const NEUTRAL_SKILLS = [EXTRA_SKILL, ORCH_EXTRA_SKILL];

export const extrasOf = (project) => project.delegateExtras ?? [];
export const orchestratorExtrasOf = (project) => project.orchestratorExtras ?? [];
export const offOf = (project) => project.delegateOff ?? [];

export const PROJECTS = [
  {
    name: 'todo-cli',
    language: 'JavaScript',
    runtime: 'node',
    testCommand: ['node', '--test'],
    taskTestCommand: 'npm test',
    delegateExtras: [EXTRA_SKILL.name],
    orchestratorExtras: [ORCH_EXTRA_SKILL.name],
    task: 'Add a `rename:N:new text` command to cli.mjs that renames item N (1-based) of the todo list, implemented as a `rename(list, i, text)` function in src.mjs with a unit test in src.test.mjs. Verify with `npm test`.',
    files: TODO_CLI,
  },
  {
    name: 'tiny-api',
    language: 'JavaScript',
    runtime: 'node',
    testCommand: ['node', '--test'],
    taskTestCommand: 'npm test',
    delegateOff: ['lantern-local-loop'],
    task: 'Add a `GET /time` route to routes.mjs that answers 200 with `{ "now": <ISO timestamp> }`, taking an injectable clock (a function returning a Date) so it is testable, with a test in routes.test.mjs. Verify with `npm test`.',
    files: TINY_API,
  },
  {
    name: 'pyutil',
    language: 'Python',
    runtime: 'python3',
    testCommand: ['python3', '-m', 'unittest', 'discover', '-s', 'tests'],
    taskTestCommand: 'python3 -m unittest discover -s tests',
    task: 'Add `count_vowels(s)` to pyutil/text.py (case-insensitive count of a, e, i, o, u), export it from pyutil/__init__.py and test it in tests/test_text.py. Verify with `python3 -m unittest discover -s tests`.',
    files: PYUTIL,
  },
  {
    name: 'rubyutil',
    language: 'Ruby',
    runtime: 'ruby',
    testCommand: ['ruby', '-Ilib', '-Itest', 'test/test_stringx.rb'],
    taskTestCommand: 'ruby -Ilib -Itest test/test_stringx.rb',
    task: 'Add `Stringx.squish(s)` to lib/stringx.rb (strip the string and collapse every run of whitespace to one space) and a minitest for it in test/test_stringx.rb. Verify with `ruby -Ilib -Itest test/test_stringx.rb`.',
    files: RUBYUTIL,
  },
];

export function writeExtraSkills(dir, names) {
  for (const name of names) {
    const skill = NEUTRAL_SKILLS.find((candidate) => candidate.name === name);
    if (!skill) throw new Error(`unknown extra skill "${name}"`);
    for (const [rel, content] of Object.entries(skill.files)) {
      const file = path.join(dir, '.claude', 'skills', name, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
  }
}

export const remoteUrl = (name) => `git@bitbucket.org:${REMOTE_WORKSPACE}/${name}.git`;

export function writeProjectFiles(dir, project) {
  for (const [rel, content] of Object.entries(project.files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  fs.writeFileSync(path.join(dir, '.gitignore'), `${GITIGNORE.join('\n')}\n`);
}

function git(cwd, args, env) {
  const res = spawnSync('git', args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${res.stderr || res.stdout}`);
  return res.stdout;
}

export function createProject({ root, project, remotesDir, fakeSsh }) {
  const dir = path.join(root, 'projects', project.name);
  const bare = path.join(remotesDir, `${project.name}.git`);
  const env = { GIT_SSH_COMMAND: fakeSsh, E2E_REMOTES: remotesDir };
  fs.mkdirSync(dir, { recursive: true });
  writeProjectFiles(dir, project);
  git(dir, ['init', '-q', '-b', MAIN_BRANCH]);
  git(dir, ['config', 'user.name', GIT_IDENTITY.name]);
  git(dir, ['config', 'user.email', GIT_IDENTITY.email]);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'chore: initial commit']);
  fs.mkdirSync(bare, { recursive: true });
  git(bare, ['init', '-q', '--bare', '-b', MAIN_BRANCH]);
  git(dir, ['remote', 'add', 'origin', remoteUrl(project.name)]);
  git(dir, ['push', '-q', 'origin', MAIN_BRANCH], env);
  return { dir, bare };
}

export function projectSettings({ redirectFetch, fakeSsh, remotesDir, mockPort, credentialSocket }) {
  const nodeOptions = `--max-old-space-size=3072 --import ${pathToFileURL(redirectFetch).href}`;
  return { env: { NODE_OPTIONS: nodeOptions, MOCK_BB_PORT: String(mockPort), GIT_SSH_COMMAND: fakeSsh, E2E_REMOTES: remotesDir, LANTERN_CREDENTIAL_SOCKET: credentialSocket } };
}
