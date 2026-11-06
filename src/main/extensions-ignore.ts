import os from 'node:os';
import { EXTENSIONS_FILE, EXTENSIONS_FOLDER } from '@shared/extension-slots';
import { msg } from '@shared/lang/messages';
import { ensureIgnored } from '../../scripts/lantern-bundle.mjs';
import { type ExtensionsPanel, loadExtensionsPanel, projectExtensionsPath, projectRootFor } from './extensions';

const IGNORED = 'ignored';

async function notIgnoredProblem(root: string, home: string): Promise<string | null> {
  try {
    return (await ensureIgnored(root, `${EXTENSIONS_FOLDER}/${EXTENSIONS_FILE}`, { home })) === IGNORED ? null : msg('extensions.projectNotIgnored', { file: projectExtensionsPath(root) });
  } catch {
    return null;
  }
}

export async function guardProjectFile(project: unknown, installed: string[], writesProject: boolean, run: () => ExtensionsPanel, home: string = os.homedir()): Promise<ExtensionsPanel> {
  const root = writesProject ? projectRootFor(project, home) : null;
  const problem = root ? await notIgnoredProblem(root, home) : null;
  return problem ? { ...loadExtensionsPanel(installed, home, project), error: problem } : run();
}
