import { openCodeModal } from '../../../src/renderer/lib/codemodal';
import { openPrDiffModal } from '../../../src/renderer/lib/prdiffmodal';
import type { CodeSource } from '../../../src/shared/code-highlighting';

const params = new URLSearchParams(location.search);
const project = params.get('project')!;
const file = 'src/main.ts';
const host = document.querySelector('#code') as HTMLElement;
const semantic = (path: string, source: CodeSource) => window.ccmws.semanticHighlight({ project, path, source });

if (params.get('diff') === '1') {
  openPrDiffModal(host, (_pr, path) => window.ccmws.lanternPrFileDiff(project, '1', path), '1', file, undefined, undefined, semantic);
} else {
  openCodeModal(host, (path) => window.ccmws.projectReadFile(project, path), file, '', undefined, undefined, semantic);
}
document.documentElement.dataset.ready = 'true';
