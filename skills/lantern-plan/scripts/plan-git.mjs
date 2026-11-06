import { PR_DIR } from '../../lantern-setup/scripts/prs.mjs';
import { runGit } from '../../lantern-setup/scripts/shell.mjs';
import { PR_STATE, TAG } from './plan-format.mjs';

export const REMOTE_NAME = 'origin';
export const REMOTE_PREFIX = `refs/remotes/${REMOTE_NAME}/`;
const LOCAL_PREFIX = 'refs/heads/';
const HEAD_REF = 'HEAD';
const DEFAULT_BRANCH = 'main';
const MAX_MERGE_LOG = 5000;
const MENTION = /pull request #(\d+)/g;
const STRONG_SUBJECT = /^\s*(Merged in |Merge pull request)/;
const ARGS_PER_CALL = 100;

export function git(root, args) {
    const result = runGit(root, args);
    return result.ok ? result.stdout : null;
}

export function resolveCommit(root, ref) {
    const out = git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return out ? out.trim() : null;
}

export function remoteBranches(root) {
    const out = git(root, ['for-each-ref', '--format=%(refname)', REMOTE_PREFIX]) ?? '';
    return out.split('\n').filter((ref) => ref.startsWith(REMOTE_PREFIX) && ref !== `${REMOTE_PREFIX}HEAD`);
}

function pushTip(tips, ref, sha, strict) {
    if (sha && !tips.some((t) => t.sha === sha)) tips.push({ ref, sha, strict });
}

function defaultLineTips(root) {
    const tips = [];
    const named = git(root, ['symbolic-ref', '--quiet', `${REMOTE_PREFIX}${HEAD_REF}`])?.trim().replace(REMOTE_PREFIX, '');
    const refs = [`${REMOTE_PREFIX}${HEAD_REF}`, `${REMOTE_PREFIX}${DEFAULT_BRANCH}`, `${LOCAL_PREFIX}${DEFAULT_BRANCH}`, ...(named ? [`${LOCAL_PREFIX}${named}`] : [])];
    for (const ref of refs) pushTip(tips, ref, resolveCommit(root, ref), true);
    pushTip(tips, HEAD_REF, resolveCommit(root, HEAD_REF), true);
    return tips;
}

function tipsFor(root, base, lineTips) {
    const tips = [];
    for (const ref of [`${REMOTE_PREFIX}${base}`, `${LOCAL_PREFIX}${base}`]) pushTip(tips, ref, resolveCommit(root, ref), false);
    for (const tip of lineTips) pushTip(tips, tip.ref, tip.sha, tip.strict);
    return tips;
}

function mentionsOn(root, tip, cache) {
    const key = `${tip.sha}\0${tip.strict}`;
    if (cache.has(key)) return cache.get(key);
    const ids = new Set();
    const out = git(root, ['log', tip.ref, '-E', '--grep=pull request #[0-9]+', `--max-count=${MAX_MERGE_LOG}`, '--format=%P%x1f%B%x1e']) ?? '';
    for (const record of out.split('\x1e')) {
        const [parents = '', ...rest] = record.split('\x1f');
        const body = rest.join('\x1f');
        if (!body.trim()) continue;
        const strong = parents.trim().split(/\s+/).filter(Boolean).length > 1 || STRONG_SUBJECT.test(body);
        if (tip.strict && !strong) continue;
        const text = tip.strict ? (body.trim().split('\n')[0] ?? '') : body;
        for (const match of text.matchAll(MENTION)) ids.add(match[1]);
    }
    cache.set(key, ids);
    return ids;
}

function isAncestor(root, ancestor, descendant) {
    return git(root, ['merge-base', '--is-ancestor', ancestor, descendant]) !== null;
}

function headPredatesBranch(root, head, branchTip, tip) {
    if (isAncestor(root, branchTip, tip.ref)) return false;
    const shared = git(root, ['merge-base', branchTip, tip.ref])?.trim();
    return Boolean(shared) && isAncestor(root, head, shared);
}

function isMerged(root, record, tips, branchTip, cache) {
    if (tips.some((tip) => mentionsOn(root, tip, cache).has(record.id))) return true;
    return tips.filter((tip) => tip.ref !== HEAD_REF).some((tip) => !(branchTip && headPredatesBranch(root, record.head, branchTip, tip)) && isAncestor(root, record.head, tip.ref));
}

export function localBranches(root) {
    const out = git(root, ['for-each-ref', '--format=%(refname)', LOCAL_PREFIX]) ?? '';
    return out.split('\n').filter((ref) => ref.startsWith(LOCAL_PREFIX));
}

const isBranchRecord = (record) => record.kind === 'branch';
const recordKey = (record) => record.id ?? record.branch;

export function prStates(root, records) {
    const lineTips = defaultLineTips(root);
    const cache = new Map();
    const branches = new Map(remoteBranches(root).map((ref) => [ref.slice(REMOTE_PREFIX.length), resolveCommit(root, ref)]));
    const locals = records.some(isBranchRecord) ? new Map(localBranches(root).map((ref) => [ref.slice(LOCAL_PREFIX.length), resolveCommit(root, ref)])) : new Map();
    const exists = (record) => branches.has(record.branch) || (isBranchRecord(record) && locals.has(record.branch));
    const tipOf = (record) => branches.get(record.branch) ?? (isBranchRecord(record) ? locals.get(record.branch) : undefined);
    const current = git(root, ['symbolic-ref', '--quiet', '--short', HEAD_REF])?.trim() ?? '';
    return new Map(
        records.map((record) => {
            const tips = tipsFor(root, record.base, lineTips).filter((tip) => tip.ref !== HEAD_REF || current !== record.branch);
            if (isMerged(root, record, tips, tipOf(record), cache)) return [recordKey(record), PR_STATE.MERGED];
            return [recordKey(record), exists(record) ? PR_STATE.OPEN : PR_STATE.CLOSED];
        }),
    );
}

export function recordsOnRemoteBranches(root, slug) {
    const refs = remoteBranches(root);
    const found = [];
    for (let i = 0; i < refs.length; i += ARGS_PER_CALL) {
        const out = git(root, ['grep', '-l', '-E', `^#${TAG.PLAN} ${slug} `, ...refs.slice(i, i + ARGS_PER_CALL), '--', `${PR_DIR}/`]) ?? '';
        for (const line of out.split('\n').filter(Boolean)) {
            const cut = line.indexOf(':');
            found.push({ ref: line.slice(0, cut), file: line.slice(cut + 1) });
        }
    }
    return found.map(({ ref, file }) => ({ ref, file, text: git(root, ['show', `${ref}:${file}`]) })).filter((entry) => entry.text !== null);
}
