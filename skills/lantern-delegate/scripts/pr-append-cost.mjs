#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { COST_BLOCK_NAME, costContent } from './cost-block.mjs';
import { runHostSkill } from './host-skill.mjs';
import { classifyRemote, listRemotes, pickRemote } from './host.mjs';
import { message } from './messages.mjs';

const REQUIRED = ['pr', 'table-file'];
const OWNER_FLAGS = ['workspace', 'owner'];

function die(text) {
    console.error(text);
    process.exit(1);
}

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i += 2) {
        const key = argv[i]?.replace(/^--/, '');
        if (!key || argv[i + 1] === undefined) die(message('appendCost.badArgument', { argument: argv[i] }));
        out[key] = argv[i + 1];
    }
    for (const name of REQUIRED) if (!out[name]) die(message('appendCost.missing', { name }));
    return out;
}

function readTable(file) {
    try {
        return readFileSync(file, 'utf8');
    } catch (cause) {
        return die(message('appendCost.unreadable', { reason: cause.message }));
    }
}

function chooseHost(args) {
    const owner = OWNER_FLAGS.map((flag) => args[flag]).find(Boolean);
    const picked = pickRemote(listRemotes(process.cwd()), { name: args.remote, owner, repo: args.repo });
    if (picked.error) die(picked.error);
    const kind = classifyRemote(picked.remote.url, undefined, picked.remote.rawUrl);
    if (kind.error) die(kind.error);
    return { host: kind.host, remote: picked.remote };
}

const args = parseArgs(process.argv.slice(2));
const content = costContent(readTable(args['table-file']));
const { host, remote } = chooseHost(args);
const folder = mkdtempSync(join(tmpdir(), 'pr-cost-'));
const file = join(folder, 'cost.md');
writeFileSync(file, content);
const written = runHostSkill(host, ['description-block', args.pr, '--name', COST_BLOCK_NAME, '--file', file, '--remote', remote.name]);
rmSync(folder, { recursive: true, force: true });
if (written.status !== 0) die(written.stderr.trim());
console.log(written.stdout.trim());
