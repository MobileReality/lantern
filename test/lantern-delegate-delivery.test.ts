import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ES module, no declarations
import { DELIVERY } from '../skills/lantern-delegate/scripts/preferences.mjs';

const SKILL = path.join(__dirname, '..', 'skills', 'lantern-delegate');
const read = (rel: string) => fs.readFileSync(path.join(SKILL, rel), 'utf8');
const protocol = read('protocol.md');
const orchestrator = read('SKILL.md');
const VALUES = Object.values(DELIVERY) as string[];

const section = (text: string, heading: string) => {
  const start = text.indexOf(heading);
  expect(start, heading).toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + heading.length);
  return rest.slice(0, rest.search(/\n## /) === -1 ? undefined : rest.search(/\n## /));
};

describe('protocol.md and the three Delivery values', () => {
  const delivery = section(protocol, '\n## Delivery');

  it('names exactly pr, push and local, in that order', () => {
    expect(VALUES).toEqual(['pr', 'push', 'local']);
    const bullets = [...delivery.matchAll(/^- \*\*`(\w+)`\*\*/gm)].map((match) => match[1]);
    expect(bullets).toEqual(VALUES);
  });

  it('obeys the brief line and never asks the user', () => {
    expect(protocol).toContain("The brief's `Delivery:` line is the user's recorded choice and you obey");
    expect(protocol).toContain('You never ask the user which');
    expect(protocol).toContain('never open a\npull request under `push` or `local`');
  });

  it('opens the PR through the host skill, with no token of its own', () => {
    expect(delivery).toContain('`Host skill:` line');
    expect(delivery).toContain('you hold\n  no token and read no `.ai/.env`');
    expect(protocol).toContain('opens the PR through the host skill');
    expect(protocol).toContain('never\n   look for a token, never write one');
  });

  it('push: a plain push of the conventional branch, no PR, and the same record gate as a PR', () => {
    const push = delivery.slice(delivery.indexOf('- **`push`**'), delivery.indexOf('- **`local`**'));
    expect(push).toContain('git push origin HEAD:refs/heads/<type>/<slug>');
    expect(push).toContain('never forced');
    expect(push).toContain('No step 9 (no PR, no PR body)');
    expect(push).toContain('Step 10 writes the record with no host PR');
    expect(push).toContain('`no PR (Delivery: push)`');
    const record = delivery.slice(delivery.indexOf('**A record with no host PR**'));
    expect(record).toContain('called without `<id>`, `--url`\nand `--title`, and with every other argument as for a PR');
    expect(record).toContain('.lantern/local/<branch, with / as __>.branch');
    expect(record).toContain('never committed');
    expect(record).toContain('copies it into the project\'s own `.lantern/local/` itself');
    expect(record).toContain('the same `verify` with the same four `--require-*` flags');
    expect(protocol).not.toMatch(/skip steps 9-12|no `--require-pr`/);
  });

  it('local: the existing local mode, with or without a remote', () => {
    const local = delivery.slice(delivery.indexOf('- **`local`**'));
    expect(local).toContain('"Local mode" below, whether or not a remote exists');
    expect(local).toContain('push nothing');
    expect(protocol).toContain('No remote, or `Delivery: local`: nothing leaves the machine');
  });

  it('keeps the remote work bound to the two acts, and fewer under push and local', () => {
    expect(protocol).toContain('Under\n`Delivery: push` only the first act exists; under `local` neither.');
  });

  it('builds the PR body from its template, the host skill saved one, or a convention skill the brief names', () => {
    expect(protocol).toContain('If the host skill prints a saved template');
    expect(protocol).toContain('template show pr');
    expect(protocol).toContain('If the brief names a\nconvention skill for the PR text');
    expect(protocol).toContain('Never ask which to follow, and never save or change a template');
    expect(protocol).toContain('<!-- delegate:cost -->');
  });

  it('restricts the PR itself, its commit and its second push to Delivery pr, and keeps steps 10 and 13 for every delivery', () => {
    expect(protocol).toContain('9. Open the PR with `pr-create.mjs` as above (`Delivery: pr` only).');
    expect(protocol).toContain('(`pr` only: the local record is never committed.)');
    expect(protocol).toContain('Under `Delivery: push` this is the last remote act');
    expect(protocol).toContain('**With no host PR** (`push`, `local`) the same call without `<id>`, `--url` and `--title`');
  });

  it('adds no reading of a token to the delegate', () => {
    expect(protocol).not.toMatch(/BITBUCKET_API_TOKEN|GITHUB_TOKEN|BITBUCKET_EMAIL/);
    expect(protocol).not.toContain('credential-scaffold');
  });
});

describe('SKILL.md and the recorded delivery', () => {
  const rule = section(orchestrator, '**PR delivery: ask once per project, then remember.**');

  it('asks once, with one question and three options, and only when nothing is stored', () => {
    expect(rule).toContain('node $D/scripts/preferences.mjs get delivery');
    expect(rule).toContain('ask the user **once**, one question, three options');
    expect(rule).toContain('Stored: **do not ask**');
    for (const value of VALUES) expect(rule).toContain(`(\`${value}\`)`);
  });

  it('stores the answer in the project file, keeping other keys', () => {
    expect(rule).toContain('node $D/scripts/preferences.mjs set delivery <value>');
    expect(rule).toContain('.claude/lantern-preferences.json');
    expect(rule).toContain('{ "delivery": "pr|push|local" }');
    expect(rule).toContain('keeps any other key');
  });

  it('lets the user override one task, or change the standing choice', () => {
    expect(rule).toContain('"this time no PR"');
    expect(rule).toContain('this task\'s\n  brief only; the stored one is unchanged');
    expect(rule).toContain('"Always open PRs", "stop opening PRs"');
  });

  it('puts the Delivery line and the Host skill line in the brief template', () => {
    const brief = section(orchestrator, '## Protocol\nLoad `lantern-delegate`');
    expect(brief).toContain('Delivery: <pr|push|local>');
    expect(brief).toContain('Host skill: <lantern-bitbucket|lantern-github');
  });

  it('uses the existing status vocabulary for push and local, adding none', () => {
    expect(orchestrator).toContain('**`pushed, no PR`** is also\nthe finished state of `Delivery: push`');
    expect(orchestrator).toContain('**`branch ready`** is the finished state of local mode and of\n`Delivery: local`');
    expect(orchestrator).toContain('`pushed, no PR`, `not pushed`, `branch ready`, `fix first`, `rejected`, `failed` or `running`');
  });

  it('closes with a branch-record map line, and gates push and local with all four --require flags', () => {
    expect(orchestrator).toContain('map: <N> files re-mapped, branch record written for <branch>');
    expect(orchestrator).not.toContain('no PR record (local mode)');
    expect(orchestrator).toContain('**Local mode, `Delivery: push` and\n`Delivery: local`** run it exactly the same, with all four `--require-*` flags');
    expect(orchestrator).toContain('sync.mjs carry --from .claude/worktrees/agent-<id> --branch <type>/<slug>');
  });

  it('runs a plan in local mode too: the delegate record ticks the item', () => {
    expect(orchestrator).not.toContain('run a plan in a project with a remote');
    expect(orchestrator).toContain("a branch's local record included");
  });

  it('no longer scaffolds credentials or reads them from a file', () => {
    expect(orchestrator).not.toContain('write the host\'s placeholders');
    expect(orchestrator).not.toContain('scaffold');
    expect(orchestrator).toContain('A token\nin `.ai/.env` is no longer read.');
    expect(orchestrator).toContain('pr-append-cost.mjs` works on both hosts');
  });

  it('keeps asking about PRs out of the delegate: a PR task is only unquestioned under pr', () => {
    expect(orchestrator).toContain('with `Delivery: pr` a task to open a PR is not a question');
    expect(orchestrator).toContain('With `push` or `local` never open one');
  });
});

describe('no text still tells anyone to put a token in a file', () => {
  it.each(['SKILL.md', 'protocol.md', 'README.md', 'references/codex.md'])('%s', (file) => {
    expect(read(file)).not.toMatch(/export (BITBUCKET|GITHUB)_|put (both|it) in \.ai\/\.env|Scaffolded .*\.ai\/\.env/);
  });
});
