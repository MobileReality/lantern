import manifest from './file-icon-manifest.json';

const ASSET_DIRECTORY = '../assets/file-icons/';

function own(mapping: Record<string, string>, key: string) {
  return Object.prototype.hasOwnProperty.call(mapping, key) ? mapping[key] : undefined;
}

function fileName(path: string) {
  return path.replaceAll('\\', '/').split('/').at(-1)?.toLowerCase() ?? '';
}

function fileIconName(path: string) {
  const name = fileName(path);
  const exact = own(manifest.fileNames, name);
  if (exact) return exact;
  const parts = name.split('.');
  for (let index = 1; index < parts.length; index += 1) {
    const icon = own(manifest.fileExtensions, parts.slice(index).join('.'));
    if (icon) return icon;
  }
  return manifest.fallback;
}

function fileIconUrl(path: string) {
  return new URL(`${ASSET_DIRECTORY}${fileIconName(path)}.svg`, window.location.href).href;
}

function fileIconHtml(path: string, className = 'file-icon') {
  return `<img class="${className}" src="${fileIconUrl(path)}" alt="" aria-hidden="true">`;
}

export { fileIconHtml, fileIconName, fileIconUrl };
