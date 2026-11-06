import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { checkPaths, skillReadFindings } from '../../skills/lantern-delegate/scripts/check-skill-use.mjs';
import { offEverywhere } from '../../skills/lantern-delegate/scripts/bundled-skills.mjs';
import { requiredSkills, ROLE } from '../../skills/lantern-delegate/scripts/required-skills.mjs';
import { REVIEWER_AGENT_TYPES } from '../../skills/lantern-delegate/scripts/delegate-kinds.mjs';
import { lintPaths as lintReviewerPaths } from '../../skills/lantern-delegate/scripts/lint-reviewer.mjs';
import { lintPaths as lintCommandPaths } from '../../skills/lantern-delegate/scripts/lint-transcript.mjs';
import { BUNDLE_SKILLS } from '../lantern-bundle.mjs';

export const CHECK_DOCS = {
  'map-build-session': 'the headless lantern-setup session ended with a successful result line',
  'map-pushed': 'the headless map build committed and pushed .lantern/map to main',
  'one-open-pr': 'the mock Bitbucket holds exactly one open PR, feature branch into main',
  'sync-verify-green': 'sync.mjs verify --require-pr --require-reason --require-order --require-flow is GREEN on the delegate branch, whether its record is a PR record or a branch record',
  'no-pr': 'under Delivery push and local the mock Bitbucket holds no pull request for the project',
  'branch-pushed': 'under Delivery push the remote holds the delegate branch besides main',
  'nothing-pushed': 'under Delivery local the remote holds only main',
  'panel-sees-record': 'under Delivery push and local the Lantern comparison reader (localPrs) shows the branch against main with every reason, the review order, the flow and the description',
  'validate-settled': 'validate.mjs --settled prints OK on the pushed branch',
  'panel-sees-pr': 'the Lantern panel logic (fetchPrs, loadPrs) reads the PR as open with every changed file, no warnings',
  'skills-dir-clean': 'the project holds the bundled skills as real folders and only generic convention symlinks',
  'no-transcript-errors': 'no Unknown skill, ERR_MODULE_NOT_FOUND or missing agent type tool errors in any transcript',
  'reviews-by-reviewer': 'the delegate dispatched at least one review and every one used subagent_type reviewer',
  'skill-use-gate': 'check-skill-use.mjs exits 0 on the delegate (required skills read in full)',
  'reviewer-skill-use': 'check-skill-use.mjs --role reviewer exits 0 on the reviewer (its required skills read in full)',
  'off-skill-not-read': 'for a project with a built-in skill switched off for the delegate, the delegate did not read it in full: required-skills.mjs left it out, so the skill-use gate neither demands nor expects it (informational)',
  'extra-read-in-full': 'for a project with a delegate extra, the delegate read that skill SKILL.md in full, though the dispatch prompt need not name it (the delegate gets the list from required-skills.mjs)',
  'orch-extra-read-in-full': 'for a project with an orchestrator extra, the orchestrator session read that skill SKILL.md in full (the orchestrator list of required-skills.mjs, the rule check-skill-use applies to the delegate)',
  'orch-extra-not-in-brief': 'the orchestrator extra is not named anywhere in the dispatch prompt: the orchestrator skills are never sent to a delegate',
  'command-lint-ratio': 'share of delegate commands breaking the guard rules stays below the limit (informational)',
  'reviewer-unavailable': 'for a language with no convention the reviewer says UNAVAILABLE and cites no other language rules',
  'session-finished': 'the orchestrator session ended with a successful result line',
  'no-permission-denials': 'the orchestrator result has no permission_denials',
};

export const ALLOWED_CONVENTIONS = [
  'code-principles',
  'typescript',
  'biome',
  'zod-schemas',
  'package-manager',
  'no-comments',
  'commit',
  'local-loop',
  'lantern-code-reviewer',
];
export const REQUIRED_BUNDLED = ['lantern-setup', 'lantern-sync', 'lantern-delegate', 'lantern-commit', 'lantern-no-comments', 'lantern-local-loop'];
export const MAX_COMMAND_VIOLATION_RATIO = 0.25;
const HARD_UNAVAILABLE_LANGUAGES = ['Python', 'Ruby'];
const NEGATION = /\b(no|not|never|without|unavailable|instead of|rather than)\b|n't\b/i;
const SKILL_NAMES = /\b(lantern-no-comments|no-comments|code-principles|package-manager)\b/gi;
const CONVENTION_CITATION = /\b(typescript|biome|zod)\b/i;

export const result = (name, ok, reason, hard = true) => ({ name, ok, reason, hard });

export function checkMapPushed(treePaths) {
  const ok = treePaths.some((p) => p === '.lantern/map' || p.startsWith('.lantern/map/'));
  return result('map-pushed', ok, ok ? 'origin/main carries .lantern/map' : 'origin/main has no .lantern/map: the map build did not commit and push');
}

export function featureBranch(prs, repoKey) {
  return prs.find((pr) => pr.key === repoKey && pr.state === 'OPEN')?.source?.branch?.name ?? null;
}

export function checkOnePr(prs, repoKey, base) {
  const own = prs.filter((pr) => pr.key === repoKey);
  const open = own.filter((pr) => pr.state === 'OPEN');
  if (open.length !== 1) return result('one-open-pr', false, `${open.length} open PR(s) of ${own.length} on ${repoKey}, expected exactly 1`);
  const [pr] = open;
  const branch = pr.source?.branch?.name;
  const destination = pr.destination?.branch?.name;
  if (!branch || branch === base) return result('one-open-pr', false, `source branch is "${branch}", expected a feature branch`);
  if (destination !== base) return result('one-open-pr', false, `destination is "${destination}", expected "${base}"`);
  return result('one-open-pr', true, `#${pr.id} ${branch} -> ${destination}`);
}

export function runNodeScript(args, cwd) {
  const res = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

const lastLine = (text) => text.trim().split('\n').at(-1) ?? '';

const VERIFY_WITH_RECORD = 'verify --require-pr --require-reason --require-order --require-flow';

export function checkSyncVerify(res, label = VERIFY_WITH_RECORD) {
  const ok = res.status === 0 && /\bGREEN\b/.test(res.stdout);
  return result('sync-verify-green', ok, ok ? `${label} is GREEN` : `exit ${res.status}: ${lastLine(res.stdout) || lastLine(res.stderr)}`);
}


export function checkNoPr(prs, repoKey) {
  const own = prs.filter((pr) => pr.key === repoKey);
  return result('no-pr', own.length === 0, own.length === 0 ? 'the mock Bitbucket holds no pull request, as the delivery says' : `${own.length} pull request(s) on ${repoKey}, the delivery says none`);
}

export function checkRemoteBranches(branches, base, expectPushed) {
  const feature = branches.filter((name) => name !== base);
  const ok = expectPushed ? feature.length === 1 : feature.length === 0;
  const reason = expectPushed ? `${feature.length} branch(es) besides ${base} on the remote, expected exactly 1` : `${feature.length} branch(es) besides ${base} on the remote, the delivery says nothing is pushed`;
  return result(expectPushed ? 'branch-pushed' : 'nothing-pushed', ok, ok ? (expectPushed ? `${feature[0]} is on the remote` : 'the remote holds only the base branch') : reason);
}

export function checkValidate(res) {
  const ok = res.status === 0 && /^OK$/m.test(res.stdout);
  return result('validate-settled', ok, ok ? 'validate --settled prints OK' : `exit ${res.status}: ${lastLine(res.stdout) || lastLine(res.stderr)}`);
}

export function checkPanel({ load, changedFiles }) {
  const { prs, warnings } = load;
  if (warnings.length > 0) return result('panel-sees-pr', false, `warnings: ${warnings.join(' | ')}`);
  if (prs.length !== 1) return result('panel-sees-pr', false, `${prs.length} PR(s) loaded, expected 1`);
  const [pr] = prs;
  if (pr.state !== 'open') return result('panel-sees-pr', false, `PR #${pr.id} is ${pr.state}, expected open`);
  const listed = new Set(pr.files.map((f) => f.path));
  const missing = changedFiles.filter((f) => !listed.has(f));
  if (changedFiles.length === 0 || pr.files.length === 0) return result('panel-sees-pr', false, 'no changed files on the PR record');
  if (missing.length > 0) return result('panel-sees-pr', false, `record lacks changed file(s): ${missing.join(', ')}`);
  return result('panel-sees-pr', true, `#${pr.id} open with ${pr.files.length} file(s), no warnings`);
}

export function checkPanelRecord({ pr, changedFiles }) {
  if (!pr) return result('panel-sees-record', false, 'the comparison of the branch with its base did not load');
  const listed = new Set(pr.files.map((f) => f.path));
  const problems = [
    ...(changedFiles.length === 0 ? ['no changed files'] : []),
    ...changedFiles.filter((f) => !listed.has(f)).map((f) => `${f} is not listed`),
    ...pr.files.filter((f) => !f.reason).map((f) => `${f.path} has no reason`),
    ...(pr.ordered ? [] : ['no review order']),
    ...((pr.flow ?? []).length > 0 ? [] : ['no flow']),
    ...(pr.description ? [] : ['no description']),
  ];
  return result('panel-sees-record', problems.length === 0, problems.length === 0 ? `${pr.files.length} file(s) with reasons, review order, flow and description` : problems.join('; '));
}

export function checkSkillsDir(entries, extras = [], delegateOff = []) {
  const notInstalled = offEverywhere({ [ROLE.delegate]: delegateOff });
  const bundled = new Set(BUNDLE_SKILLS.map((s) => s.name));
  const problems = [];
  for (const { name, kind } of entries) {
    if (extras.includes(name)) continue;
    if (bundled.has(name)) {
      if (kind !== 'dir') problems.push(`bundled skill ${name} is a ${kind}, not a real directory`);
    } else if (kind !== 'symlink') problems.push(`${name} is a ${kind}, only symlinked conventions are expected`);
    else if (!ALLOWED_CONVENTIONS.includes(name)) problems.push(`foreign skill ${name} is linked`);
  }
  const present = new Set(entries.map((e) => e.name));
  for (const name of REQUIRED_BUNDLED) if (!present.has(name) && !notInstalled.includes(name)) problems.push(`bundled skill ${name} is missing`);
  for (const name of notInstalled) if (present.has(name)) problems.push(`bundled skill ${name} is switched off and still installed`);
  for (const name of extras) if (!present.has(name)) problems.push(`delegate extra ${name} is missing`);
  const ok = problems.length === 0;
  return result('skills-dir-clean', ok, ok ? `${entries.length} entries, no foreign skills` : problems.join('; '));
}

export function readSkillsDir(skillsDir) {
  if (!fs.existsSync(skillsDir)) return [];
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, kind: e.isSymbolicLink() ? 'symlink' : e.isDirectory() ? 'dir' : 'file' }));
}

function entriesOf(text) {
  const entries = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    try {
      entries.push(JSON.parse(raw));
    } catch {}
  }
  return entries;
}

const blocksOf = (entry) => (Array.isArray(entry?.message?.content) ? entry.message.content : []);

function textOfContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('\n');
  return '';
}

const ERROR_PATTERNS = [
  { label: 'Unknown skill', pattern: /Unknown skill/i, needsError: true },
  { label: 'ERR_MODULE_NOT_FOUND', pattern: /ERR_MODULE_NOT_FOUND/, needsError: true },
  { label: 'agent type not found', pattern: /not found\.\s*Available agents/i, needsError: false },
];

export function checkTranscriptErrors(transcripts) {
  if (transcripts.length === 0) return result('no-transcript-errors', false, 'no session transcripts found under ~/.claude/projects: nothing was verified');
  const found = new Map();
  for (const t of transcripts) {
    for (const entry of entriesOf(t.text)) {
      for (const block of blocksOf(entry)) {
        if (block?.type !== 'tool_result') continue;
        const text = textOfContent(block.content);
        for (const { label, pattern, needsError } of ERROR_PATTERNS) {
          if (pattern.test(text) && (!needsError || block.is_error)) found.set(label, (found.get(label) ?? 0) + 1);
        }
      }
    }
  }
  const ok = found.size === 0;
  const detail = [...found].map(([label, n]) => `${label} x${n}`).join(', ');
  return result('no-transcript-errors', ok, ok ? `${transcripts.length} transcript(s) clean` : detail);
}

export const delegatesOf = (transcripts) => transcripts.filter((t) => t.agentType.startsWith('lantern-delegate'));

function needDelegate(name, transcripts) {
  const delegates = delegatesOf(transcripts);
  return delegates.length > 0 ? null : result(name, false, 'no lantern-delegate-* agent transcript found: the delegate never ran');
}

export function checkReviewsByReviewer(transcripts) {
  const missing = needDelegate('reviews-by-reviewer', transcripts);
  if (missing) return missing;
  const lint = lintReviewerPaths(delegatesOf(transcripts).map((t) => t.file));
  if (lint.badReviews > 0) return result('reviews-by-reviewer', false, lint.violations.map((v) => `${v.rule}${v.subagentType ? ` ${v.subagentType}` : ''}`).join(', '));
  if (lint.reviews === 0) return result('reviews-by-reviewer', false, 'the delegate dispatched no review');
  return result('reviews-by-reviewer', true, `${lint.reviews} review(s), all by reviewer`);
}

export function checkSkillUseGate(transcripts, extras = [], off = []) {
  const missing = needDelegate('skill-use-gate', transcripts);
  if (missing) return missing;
  const gate = checkPaths(
    delegatesOf(transcripts).map((t) => t.file),
    { required: requiredSkills(ROLE.delegate, extras, { off }) },
  );
  if (gate.findingCount === 0) return result('skill-use-gate', true, 'check-skill-use exits 0: required skills read in full');
  return result('skill-use-gate', false, gate.findings.map((f) => `${f.rule} ${f.skill}`).join(', '));
}

export const reviewersOf = (transcripts) => transcripts.filter((t) => REVIEWER_AGENT_TYPES.includes(t.agentType));

export function checkReviewerSkillUse(transcripts, extras = []) {
  const reviewers = reviewersOf(transcripts);
  if (reviewers.length === 0) return result('reviewer-skill-use', false, 'no reviewer transcript found');
  const gate = checkPaths(
    reviewers.map((t) => t.file),
    { required: requiredSkills(ROLE.reviewer, extras) },
  );
  if (gate.findingCount === 0) return result('reviewer-skill-use', true, 'check-skill-use --role reviewer exits 0: required skills read in full');
  return result('reviewer-skill-use', false, gate.findings.map((f) => `${f.rule} ${f.skill}`).join(', '));
}

export function checkOffSkillNotRead(transcripts, off) {
  const missing = needDelegate('off-skill-not-read', transcripts);
  if (missing) return { ...missing, hard: false };
  const read = off.filter((name) => delegatesOf(transcripts).some((t) => skillReadFindings(t.text, [name]).length === 0));
  if (read.length === 0) return result('off-skill-not-read', true, `the delegate did not read ${off.join(', ')}, which required-skills.mjs left out`, false);
  return result('off-skill-not-read', false, `the delegate read the switched-off ${read.join(', ')} in full`, false);
}

const EXTRA_READ_RULES = ['skill-not-read', 'skill-partly-read'];

function delegateFindings(transcripts, extras, off = []) {
  return checkPaths(
    delegatesOf(transcripts).map((t) => t.file),
    { required: requiredSkills(ROLE.delegate, extras, { off }) },
  ).findings;
}

const readFindingsOf = (transcripts, extras) => delegateFindings(transcripts, extras).filter((f) => EXTRA_READ_RULES.includes(f.rule) && extras.includes(f.skill));

export function checkExtraReadInFull(transcripts, extras) {
  const missing = needDelegate('extra-read-in-full', transcripts);
  if (missing) return missing;
  const findings = readFindingsOf(transcripts, extras);
  if (findings.length === 0) return result('extra-read-in-full', true, `the delegate read ${extras.join(', ')} in full`);
  return result('extra-read-in-full', false, findings.map((f) => `${f.rule} ${f.skill}`).join(', '));
}

function dispatchPrompt(text) {
  for (const raw of text.split('\n')) {
    if (!raw.includes('"user"')) continue;
    let entry;
    try {
      entry = JSON.parse(raw);
    } catch {
      continue;
    }
    if (entry?.message?.role !== 'user' && entry?.type !== 'user') continue;
    const content = entry?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map((block) => (typeof block?.text === 'string' ? block.text : '')).join('\n');
  }
  return '';
}

export const orchestratorsOf = (transcripts) => transcripts.filter((t) => t.agentType === 'orchestrator');

const orchestratorFindings = (transcript, extras) =>
  skillReadFindings(transcript.text, requiredSkills(ROLE.orchestrator, extras)).filter((f) => extras.includes(f.skill));

export function checkOrchExtraReadInFull(transcripts, extras) {
  const sessions = orchestratorsOf(transcripts);
  if (sessions.length === 0) return result('orch-extra-read-in-full', false, 'no orchestrator session transcript found');
  const unread = extras.filter((name) => sessions.every((t) => orchestratorFindings(t, extras).some((f) => f.skill === name)));
  if (unread.length === 0) return result('orch-extra-read-in-full', true, `the orchestrator read ${extras.join(', ')} in full`);
  const partial = unread.filter((name) => sessions.some((t) => orchestratorFindings(t, extras).some((f) => f.skill === name && f.rule === 'skill-partly-read')));
  return result('orch-extra-read-in-full', false, unread.map((name) => `${partial.includes(name) ? 'skill-partly-read' : 'skill-not-read'} ${name}`).join(', '));
}

export function checkOrchExtraNotInBrief(transcripts, extras) {
  const missing = needDelegate('orch-extra-not-in-brief', transcripts);
  if (missing) return missing;
  const leaked = extras.filter((name) => delegatesOf(transcripts).some((t) => dispatchPrompt(t.text).includes(name)));
  if (leaked.length === 0) return result('orch-extra-not-in-brief', true, `the dispatch prompt does not name ${extras.join(', ')}`);
  return result('orch-extra-not-in-brief', false, `the dispatch prompt names the orchestrator extra ${leaked.join(', ')}`);
}

export function checkCommandLint(transcripts) {
  const missing = needDelegate('command-lint-ratio', transcripts);
  if (missing) return { ...missing, hard: false };
  const lint = lintCommandPaths(delegatesOf(transcripts).map((t) => t.file));
  const ratio = lint.commands === 0 ? 0 : lint.violatingCommands / lint.commands;
  const ok = ratio < MAX_COMMAND_VIOLATION_RATIO;
  return result('command-lint-ratio', ok, `${lint.violatingCommands} of ${lint.commands} command(s) violate the guard rules (${(ratio * 100).toFixed(0)}%, limit ${MAX_COMMAND_VIOLATION_RATIO * 100}%)`, false);
}

export function finalAssistantText(text) {
  const assistant = entriesOf(text).filter((e) => e?.message?.role === 'assistant' || e?.type === 'assistant');
  for (let i = assistant.length - 1; i >= 0; i--) {
    const joined = blocksOf(assistant[i])
      .map((b) => (b?.type === 'text' ? b.text : b?.type === 'tool_use' && b.name === 'SubagentHandback' ? b.input?.message : ''))
      .filter((t) => typeof t === 'string')
      .join('\n');
    if (joined.trim()) return joined;
  }
  return '';
}

export function citesForeignConvention(verdict) {
  return verdict.split('\n').filter((line) => CONVENTION_CITATION.test(line) && !NEGATION.test(line.replace(SKILL_NAMES, '')));
}

export function checkReviewerUnavailable(transcripts, project) {
  const hard = HARD_UNAVAILABLE_LANGUAGES.includes(project.language);
  const reviewers = reviewersOf(transcripts).sort((a, b) => a.mtimeMs - b.mtimeMs);
  const last = reviewers.at(-1);
  if (!last) return result('reviewer-unavailable', false, 'no reviewer transcript found', hard);
  const verdict = finalAssistantText(last.text);
  const expected = new RegExp(`no ${project.language} convention available`, 'i');
  if (!/UNAVAILABLE:/.test(verdict) || !expected.test(verdict)) {
    return result('reviewer-unavailable', false, `verdict lacks "UNAVAILABLE:" with "no ${project.language} convention available"`, hard);
  }
  const cited = citesForeignConvention(verdict);
  if (cited.length > 0) return result('reviewer-unavailable', false, `verdict cites another language's rules: ${cited[0].trim().slice(0, 100)}`, hard);
  return result('reviewer-unavailable', true, `reviewer reported no ${project.language} convention available`, hard);
}

export function checkSessionFinished(sessionResult) {
  if (!sessionResult) return result('session-finished', false, 'the orchestrator session produced no result line');
  const ok = sessionResult.is_error !== true && sessionResult.subtype === 'success';
  return result('session-finished', ok, ok ? `finished in ${sessionResult.num_turns ?? '?'} turn(s)` : `subtype ${sessionResult.subtype}, is_error ${sessionResult.is_error}`);
}

export function checkNoPermissionDenials(sessionResult) {
  const denials = sessionResult?.permission_denials;
  if (!Array.isArray(denials)) return result('no-permission-denials', false, 'the result line has no permission_denials field');
  if (denials.length === 0) return result('no-permission-denials', true, 'no permission denials');
  const names = denials.map((d) => d.tool_name ?? 'unknown').join(', ');
  return result('no-permission-denials', false, `${denials.length} denial(s): ${names}`);
}

export function claudeProjectKeys(cwd) {
  return [...new Set([cwd.replace(/[^a-zA-Z0-9]/g, '-'), cwd.replace(/[/.]/g, '-')])];
}

export function transcriptDirs(projectsHome, cwd) {
  if (!fs.existsSync(projectsHome)) return [];
  const keys = claudeProjectKeys(cwd);
  return fs
    .readdirSync(projectsHome)
    .filter((name) => keys.some((key) => name === key || name.startsWith(`${key}-`)))
    .map((name) => path.join(projectsHome, name));
}

function jsonlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return jsonlFiles(full);
    return e.name.endsWith('.jsonl') ? [full] : [];
  });
}

function agentTypeOf(file) {
  const meta = file.replace(/\.jsonl$/, '.meta.json');
  try {
    return JSON.parse(fs.readFileSync(meta, 'utf8')).agentType ?? 'unknown';
  } catch {
    return path.basename(path.dirname(file)) === 'subagents' ? 'unknown' : 'orchestrator';
  }
}

export function loadTranscripts(projectsHome, cwd, sinceMs) {
  const transcripts = [];
  for (const dir of transcriptDirs(projectsHome, cwd)) {
    for (const file of jsonlFiles(dir)) {
      const { mtimeMs } = fs.statSync(file);
      if (mtimeMs < sinceMs) continue;
      const agentId = path.basename(file).match(/^agent-(.+)\.jsonl$/)?.[1] ?? null;
      transcripts.push({ file, agentId, agentType: agentTypeOf(file), mtimeMs, text: fs.readFileSync(file, 'utf8') });
    }
  }
  return transcripts;
}
