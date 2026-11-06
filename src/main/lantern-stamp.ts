import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { mapInBatches } from './lantern-batch';
import { hostStatus } from './lantern-host-status';
import { LANTERN_DIR, PROJECT_DATA_NAME } from '../shared/project-data';

async function listFiles(dir: string, skipped: string[] = []): Promise<string[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(entries.filter((e) => e.isDirectory() && !skipped.includes(e.name)).map((e) => listFiles(path.join(dir, e.name))));
  return [...entries.filter((e) => !e.isDirectory()).map((e) => path.join(dir, e.name)), ...nested.flat()];
}

async function gitDirOf(root: string): Promise<string | null> {
  const dotGit = path.join(root, '.git');
  try {
    if ((await fs.promises.stat(dotGit)).isDirectory()) return dotGit;
    const pointer = /^gitdir:\s*(.+)$/m.exec(await fs.promises.readFile(dotGit, 'utf8'));
    return pointer ? path.resolve(root, pointer[1].trim()) : null;
  } catch {
    return null;
  }
}

async function commonDirOf(gitDir: string): Promise<string> {
  try {
    return path.resolve(gitDir, (await fs.promises.readFile(path.join(gitDir, 'commondir'), 'utf8')).trim());
  } catch {
    return gitDir;
  }
}

async function statLines(files: string[]): Promise<string[]> {
  const lines = await mapInBatches(files, async (file) => {
    try {
      const stat = await fs.promises.stat(file);
      return `${file}:${stat.mtimeMs}:${stat.size}`;
    } catch {
      return `${file}:gone`;
    }
  });
  return lines.sort();
}

async function lanternStamp(projectPath: string): Promise<string> {
  const root = path.resolve(projectPath);
  const gitDir = await gitDirOf(root);
  const commonDir = gitDir ? await commonDirOf(gitDir) : null;
  const [lanternFiles, refFiles] = await Promise.all([listFiles(path.join(root, LANTERN_DIR), [PROJECT_DATA_NAME]), commonDir ? listFiles(path.join(commonDir, 'refs')) : []]);
  const heads = gitDir && commonDir ? [path.join(gitDir, 'HEAD'), path.join(commonDir, 'packed-refs')] : [];
  const lines = await statLines([...lanternFiles, ...refFiles, ...heads]);
  return createHash('sha1').update([...lines, `host:${hostStatus.version(root)}`].join('\n')).digest('hex');
}

export { lanternStamp };
