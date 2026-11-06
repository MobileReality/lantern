import path from 'node:path';
import { PR_DIR, listBranchRecords, listPrs, parsePr } from '../../lantern-setup/scripts/prs.mjs';
import { prStates, recordsOnRemoteBranches } from './plan-git.mjs';

const isUsable = (record) => record.errors.length === 0 && record.id !== null;
const isUsableBranch = (record) => record.errors.length === 0 && record.branch !== null;
const ticksPlan = (slug) => (record) => record.plans.some((p) => p.slug === slug);

const treeRecords = (root, slug) => listPrs(root).filter(isUsable).filter(ticksPlan(slug));

const remoteRecords = (root, slug) =>
    recordsOnRemoteBranches(root, slug)
        .map(({ file, text }) => parsePr(text, `${PR_DIR}/${path.basename(file)}`))
        .filter(isUsable)
        .filter(ticksPlan(slug));

const localBranchRecords = (root, slug) => listBranchRecords(root).filter(isUsableBranch).filter(ticksPlan(slug));

const linkOf = (slug, states) => (record) =>
    record.plans
        .filter((p) => p.slug === slug)
        .map((p) => ({ item: p.item, id: record.id ?? record.branch, branch: record.branch, base: record.base, title: record.title ?? record.branch, url: record.url ?? '', state: states.get(record.id ?? record.branch) }));

export function loadLinks(root, slug) {
    const byId = new Map();
    for (const record of [...treeRecords(root, slug), ...remoteRecords(root, slug)]) if (!byId.has(record.id)) byId.set(record.id, record);
    const adoptedBranches = new Set([...byId.values()].map((record) => record.branch));
    const byBranch = new Map(localBranchRecords(root, slug).filter((record) => !adoptedBranches.has(record.branch)).map((record) => [record.branch, record]));
    const records = [...byId.values(), ...byBranch.values()];
    const states = prStates(root, records);
    return records.flatMap(linkOf(slug, states));
}
