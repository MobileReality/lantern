import { esc } from './lanternctx';
import { fileIconHtml } from './file-icons';

export function fileLabelHtml(path: string, iconClass = '') {
  const normalized = path.replaceAll('\\', '/');
  const cut = normalized.lastIndexOf('/');
  const name = normalized.slice(cut + 1);
  const directory = normalized.slice(0, cut + 1);
  return `<span class="file-label" data-tip="${esc(path)}">${fileIconHtml(path, `file-label-icon ${iconClass}`)}<b class="file-name">${esc(name)}</b>${directory ? ` <span class="file-directory">${esc(directory)}</span>` : ''}</span>`;
}
