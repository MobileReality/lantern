import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  checkCommandLint,
  checkExtraReadInFull,
  checkOrchExtraNotInBrief,
  checkOrchExtraReadInFull,
  checkMapPushed,
  checkNoPermissionDenials,
  checkNoPr,
  checkOffSkillNotRead,
  checkOnePr,
  checkPanel,
  checkPanelRecord,
  checkReviewerUnavailable,
  checkRemoteBranches,
  checkReviewsByReviewer,
  checkSessionFinished,
  checkSkillsDir,
  checkReviewerSkillUse,
  checkSkillUseGate,
  checkSyncVerify,
  checkTranscriptErrors,
  checkValidate,
  featureBranch,
  loadTranscripts,
  readSkillsDir,
  result,
  runNodeScript,
} from './checks.mjs';
import { DELIVERY } from '../../skills/lantern-delegate/scripts/preferences.mjs';
import { changedFilesOf, readLocalComparison, readPanel } from './panel.mjs';
import { extrasOf, MAIN_BRANCH, offOf, orchestratorExtrasOf, REMOTE_WORKSPACE } from './projects.mjs';
import { fetchMockPrs, REPO_ROOT } from './workspace.mjs';

const SYNC = path.join(REPO_ROOT, 'skills', 'lantern-sync', 'scripts', 'sync.mjs');
const VALIDATE = path.join(REPO_ROOT, 'skills', 'lantern-setup', 'scripts', 'validate.mjs');

function git(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout;
}

function cloneBranch(ws, project, branch) {
  const clone = path.join(ws.root, 'checks', project.name);
  git(ws.root, ['clone', '-q', '--branch', branch, project.bare, clone]);
  git(clone, ['branch', '-q', MAIN_BRANCH, `origin/${MAIN_BRANCH}`]);
  return clone;
}

const skipped = (name, reason) => result(name, false, `skipped: ${reason}`);

async function branchChecks({ ws, project, branch, panel }) {
  let clone;
  try {
    clone = cloneBranch(ws, project, branch);
  } catch (e) {
    const reason = `could not clone ${branch}: ${e.message}`;
    return ['sync-verify-green', 'validate-settled', 'panel-sees-pr'].map((name) => skipped(name, reason));
  }
  const verifyArgs = [SYNC, 'verify', '--base', MAIN_BRANCH, '--require-pr', '--require-reason', '--require-order', '--require-flow', '--branch', branch];
  const checks = [checkSyncVerify(runNodeScript(verifyArgs, clone)), checkValidate(runNodeScript([VALIDATE, clone, '--settled'], clone))];
  try {
    const load = await readPanel(panel, clone);
    checks.push(checkPanel({ load, changedFiles: changedFilesOf(clone, MAIN_BRANCH) }));
  } catch (e) {
    checks.push(result('panel-sees-pr', false, e.message));
  }
  return checks;
}

function extraChecks(extras, transcripts) {
  if (extras.length === 0) return [];
  return [checkExtraReadInFull(transcripts, extras)];
}

function offChecks(off, transcripts) {
  if (off.length === 0) return [];
  return [checkOffSkillNotRead(transcripts, off)];
}

function orchestratorExtraChecks(extras, transcripts) {
  if (extras.length === 0) return [];
  return [checkOrchExtraReadInFull(transcripts, extras), checkOrchExtraNotInBrief(transcripts, extras)];
}

function transcriptChecks({ project, transcripts, sessionResult }) {
  const extras = extrasOf(project);
  const off = offOf(project);
  return [
    checkTranscriptErrors(transcripts),
    checkReviewsByReviewer(transcripts),
    checkSkillUseGate(transcripts, extras, off),
    checkReviewerSkillUse(transcripts),
    ...extraChecks(extras, transcripts),
    ...offChecks(off, transcripts),
    ...orchestratorExtraChecks(orchestratorExtrasOf(project), transcripts),
    checkCommandLint(transcripts),
    checkReviewerUnavailable(transcripts, project),
    checkSessionFinished(sessionResult),
    checkNoPermissionDenials(sessionResult),
  ];
}

const remoteBranches = (bare) =>
  git(bare, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
    .split('\n')
    .filter(Boolean);

async function branchRecordChecks({ root, branch, panel }) {
  const verifyArgs = [SYNC, 'verify', '--base', MAIN_BRANCH, '--require-pr', '--require-reason', '--require-order', '--require-flow', '--branch', branch];
  const checks = [checkSyncVerify(runNodeScript(verifyArgs, root)), checkValidate(runNodeScript([VALIDATE, root, '--settled'], root))];
  try {
    checks.push(checkPanelRecord({ pr: await readLocalComparison(panel, root, MAIN_BRANCH, branch), changedFiles: changedFilesOf(root, MAIN_BRANCH) }));
  } catch (e) {
    checks.push(result('panel-sees-record', false, e.message));
  }
  return checks;
}

function carryRecord({ from, into, branch }) {
  const res = runNodeScript([SYNC, 'carry', '--from', from, '--branch', branch], into);
  if (res.status !== 0) throw new Error(`sync.mjs carry exited ${res.status}: ${res.stderr.trim() || res.stdout.trim()}`);
}

const DELIVERY_CHECKS = {
  [DELIVERY.pr]: async ({ ws, project, prs, repoKey, panel }) => {
    const checks = [checkOnePr(prs, repoKey, MAIN_BRANCH)];
    const branch = featureBranch(prs, repoKey);
    if (branch) return [...checks, ...(await branchChecks({ ws, project, branch, panel }))];
    return [...checks, ...['sync-verify-green', 'validate-settled', 'panel-sees-pr'].map((name) => skipped(name, 'no open PR to take the branch from'))];
  },
  [DELIVERY.push]: async ({ ws, project, prs, repoKey, panel }) => {
    const branches = remoteBranches(project.bare);
    const checks = [checkNoPr(prs, repoKey), checkRemoteBranches(branches, MAIN_BRANCH, true)];
    const branch = branches.find((name) => name !== MAIN_BRANCH);
    if (!branch) return [...checks, ...['sync-verify-green', 'validate-settled', 'panel-sees-record'].map((name) => skipped(name, 'no pushed branch to check'))];
    const clone = cloneBranch(ws, project, branch);
    try {
      carryRecord({ from: project.dir, into: clone, branch });
    } catch (e) {
      return [...checks, ...['sync-verify-green', 'validate-settled', 'panel-sees-record'].map((name) => skipped(name, e.message))];
    }
    return [...checks, ...(await branchRecordChecks({ root: clone, branch, panel }))];
  },
  [DELIVERY.local]: async ({ project, prs, repoKey, panel }) => {
    const branch = git(project.dir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    return [checkNoPr(prs, repoKey), checkRemoteBranches(remoteBranches(project.bare), MAIN_BRANCH, false), ...(await branchRecordChecks({ root: project.dir, branch, panel }))];
  },
};

export async function verifyProject({ ws, project, sessionResult, sinceMs, projectsHome, panel, withTranscripts = true }) {
  const tree = git(project.bare, ['ls-tree', '-r', '--name-only', MAIN_BRANCH]).split('\n').filter(Boolean);
  const prs = await fetchMockPrs(ws.mock.port);
  const repoKey = `${REMOTE_WORKSPACE}/${project.name}`;
  const delivery = ws.delivery ?? DELIVERY.pr;
  const checks = [checkMapPushed(tree), ...(await DELIVERY_CHECKS[delivery]({ ws, project, prs, repoKey, panel }))];
  checks.push(checkSkillsDir(readSkillsDir(path.join(project.dir, '.claude', 'skills')), [...extrasOf(project), ...orchestratorExtrasOf(project)], offOf(project)));
  if (!withTranscripts) return checks;
  const transcripts = loadTranscripts(projectsHome, project.dir, sinceMs);
  checks.push(...transcriptChecks({ project, transcripts, sessionResult }));
  return checks;
}
