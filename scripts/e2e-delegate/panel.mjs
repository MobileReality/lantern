import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const PANEL_SOURCES = [path.join('src', 'main', 'lantern-prs.ts'), path.join('src', 'main', 'lantern-local.ts')];

export async function bundlePanel(repoRoot, outDir) {
  const outfile = path.join(outDir, 'lantern-prs.bundle.mjs');
  await esbuild.build({
    stdin: {
      contents: PANEL_SOURCES.map((source) => `export * from ${JSON.stringify(path.join(repoRoot, source))};`).join('\n'),
      resolveDir: repoRoot,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    outfile,
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

function gitLines(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout.split('\n').filter(Boolean);
}

export const changedFilesOf = (clone, base) => gitLines(clone, ['diff', '--name-only', `origin/${base}...HEAD`, '--', '.', ':!.lantern']);

export async function readPanel(panel, clone) {
  const fetched = await panel.fetchPrs(clone);
  if (!fetched.ok) throw new Error(`fetchPrs failed: ${fetched.error}`);
  return panel.loadPrs(clone, new Set(gitLines(clone, ['ls-files'])));
}

export async function readLocalComparison(panel, root, base, branch) {
  const [pr] = await panel.localPrs(root, [`local:cmp:${base}|${branch}`], new Set(gitLines(root, ['ls-files'])));
  return pr;
}
