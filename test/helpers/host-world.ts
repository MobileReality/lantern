import { branchOff, commitFile, commitRecord, git, makeWorld } from './git-repo';
import type { World } from './git-repo';

const BITBUCKET_ORIGIN = 'git@bitbucket.org:acme/shop.git';
const EMAIL = 'dev@example.com';
const TOKEN = 'ATATT-secret-token-4f2a9c';
const ENV = { BITBUCKET_EMAIL: EMAIL, BITBUCKET_API_TOKEN: TOKEN };

function pushOpenPr(project: string, id: number, branch = `feat/pr-${id}`) {
  branchOff(project, branch);
  const head = commitFile(project, `src/${id}.ts`, `export const n = ${id};\n`, `work ${id}`);
  commitRecord(project, { id, branch, head });
  git(project, ['push', '-q', 'origin', branch]);
  git(project, ['checkout', '-q', 'main']);
}

function makeHostWorld(ids: number[], originUrl = BITBUCKET_ORIGIN): World {
  const world = makeWorld();
  for (const id of ids) pushOpenPr(world.project, id);
  git(world.project, ['remote', 'set-url', 'origin', originUrl]);
  return world;
}

export { BITBUCKET_ORIGIN, EMAIL, ENV, TOKEN, makeHostWorld, pushOpenPr };
