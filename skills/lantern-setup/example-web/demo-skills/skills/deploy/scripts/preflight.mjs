import { execFileSync } from 'node:child_process';

export function preflight(verify = false) {
    const problems = [];
    if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) problems.push('working tree is not clean');
    if (!verify && !execFileSync('git', ['tag', '--list', 'release-*'], { encoding: 'utf8' }).trim()) problems.push('no release tag to roll back to');
    return problems;
}

if (process.argv[1]?.endsWith('preflight.mjs')) {
    const problems = preflight(process.argv.includes('--verify'));
    for (const problem of problems) console.log(problem);
    process.exit(problems.length ? 1 : 0);
}
