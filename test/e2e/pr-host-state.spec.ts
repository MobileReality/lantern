import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHostStatus } from '../../src/main/lantern-host-status';
import { fetchPrs, loadPrs } from '../../src/main/lantern-prs';
import { graphFixtures } from '../fixtures/graph/graph-fixtures';
import { startFakeGithub } from '../helpers/fake-github';
import { branchOff, commitFile, commitRecord, git, makeWorld, squashMerge } from '../helpers/git-repo';
import type { World } from '../helpers/git-repo';
import { closeGraphHarness, launchGraphHarness } from './support/graph-harness';
import type { GraphHarness } from './support/graph-harness';

const SHOTS = process.env.LANTERN_PR_SHOTS;
const LABEL = process.env.LANTERN_PR_SHOTS_LABEL ?? 'after';
const EXPECT_HOST_STATE = process.env.LANTERN_PR_EXPECT_BASE !== '1';
const ORIGIN = 'git@github.com:acme/shop.git';
const PULLS = [
  { id: 127, title: 'Add pagination to the project list', state: 'open' as const },
  { id: 126, title: 'Retry the sync job (squash and merge)', state: 'merged' as const },
  { id: 128, title: 'Drop the legacy exporter', state: 'declined' as const },
];

let world: World;
let harness: GraphHarness;
let scratch: string;
let closeStub: () => Promise<void>;
let savedSshCommand: string | undefined;
let requests: { url: string; authorization: string | undefined }[];

function pushPull(project: string, id: number, title: string) {
  const branch = `feat/pr-${id}`;
  branchOff(project, branch);
  const head = commitFile(project, `src/pull-${id}.ts`, `export const pull = ${id};\n`, `work ${id}`);
  commitRecord(project, { id, branch, head, title, opened: new Date().toISOString().slice(0, 10), url: `https://github.com/acme/shop/pull/${id}`, files: ['~ src/services/project-service.ts'] });
  git(project, ['push', '-q', 'origin', branch]);
  git(project, ['checkout', '-q', 'main']);
}

test.beforeAll(async () => {
  savedSshCommand = process.env.GIT_SSH_COMMAND;
  process.env.GIT_SSH_COMMAND = 'false';
  const stub = await startFakeGithub();
  closeStub = stub.close;
  requests = stub.requests;
  world = makeWorld();
  for (const pull of PULLS) pushPull(world.project, pull.id, pull.title);
  squashMerge(world.project, 'feat/pr-126', 126);
  git(world.project, ['remote', 'set-url', 'origin', ORIGIN]);
  for (const pull of PULLS) stub.state(pull.id, pull.state);

  const token = `ghp_${randomBytes(20).toString('hex')}`;
  const host = createHostStatus({ baseUrl: stub.baseUrl, env: {}, timeoutMs: 2000, account: async () => ({ email: 'unused@example.test', token }) });
  const mapped = new Set(graphFixtures.overview.nodes.map((n) => n.path));
  await fetchPrs(world.project, true, host);
  const { prs, warnings } = await loadPrs(world.project, mapped, host);
  expect(JSON.stringify({ prs, warnings })).not.toContain(token);

  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-pr-host-'));
  process.env.LANTERN_GRAPH_MAP = path.join(scratch, 'map.json');
  fs.writeFileSync(process.env.LANTERN_GRAPH_MAP, JSON.stringify({ ...graphFixtures.overview, prs }));
  harness = await launchGraphHarness('real');
});

test.afterAll(async () => {
  delete process.env.LANTERN_GRAPH_MAP;
  if (savedSshCommand === undefined) delete process.env.GIT_SSH_COMMAND;
  else process.env.GIT_SSH_COMMAND = savedSshCommand;
  try {
    if (harness) await closeGraphHarness(harness);
  } finally {
    await closeStub?.();
    if (world) fs.rmSync(world.dir, { recursive: true, force: true });
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('shows open, squash-merged and declined pull requests of a GitHub project as the host reports them', async ({}, testInfo) => {
  const page = harness.page;
  const expected = Object.fromEntries(PULLS.map((p) => [p.id, EXPECT_HOST_STATE ? p.state : 'open']));
  for (const [id, state] of Object.entries(expected)) {
    const chip = page.locator(`.pr-chip[data-pr="${id}"]`);
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveClass(state === 'declined' ? /pr-declined-state/ : new RegExp(`pr-${state}`));
  }
  if (EXPECT_HOST_STATE) expect(requests.map((r) => r.url).sort()).toEqual(PULLS.map((p) => `/repos/acme/shop/pulls/${p.id}`).sort());
  const strip = page.locator('.pr-chip').first().locator('xpath=ancestor::*[contains(@class,"pr-item")]/..');
  const shot = (name: string) => (SHOTS ? path.join(SHOTS, `${LABEL}-${name}.png`) : testInfo.outputPath(`${LABEL}-${name}.png`));
  await page.screenshot({ path: shot('view') });
  await strip.screenshot({ path: shot('strip') });
  await page.locator('.pr-chip[data-pr="127"]').click();
  await page.screenshot({ path: shot('open-pr-panel') });
  await page.locator('.pr-chip[data-pr="126"]').click();
  await page.screenshot({ path: shot('squash-merged-pr-panel') });
});
