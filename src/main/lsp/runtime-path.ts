import path from 'node:path';

function lspRuntimePath(packaged: boolean, resourcesPath: string, mainDirectory: string) {
  return packaged ? path.join(resourcesPath, 'lsp-runtime') : path.join(mainDirectory, 'lsp-runtime');
}

export { lspRuntimePath };
