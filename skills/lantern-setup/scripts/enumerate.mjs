#!/usr/bin/env node
import { enumerate } from './lib.mjs';

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith('--')) ?? '.';
const skipped = [];
const files = enumerate(root, (rel, reason) => skipped.push(`${rel} (${reason})`));

if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(files, null, 2)}\n`);
} else {
    for (const file of files) process.stdout.write(`${file.path}\n`);
}
const bytes = files.reduce((sum, f) => sum + f.size, 0);
process.stderr.write(`${files.length} files, ${bytes} bytes\n`);
if (skipped.length) process.stderr.write(`skipped by name/content (not mapped):\n  ${skipped.join('\n  ')}\n`);
