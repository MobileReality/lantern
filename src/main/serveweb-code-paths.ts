import path from 'node:path';

export interface CodeLookup {
  platform: NodeJS.Platform;
  home: string;
  env: Record<string, string | undefined>;
}

const FLATPAK_CODE = 'com.visualstudio.code';
const LINUX_FIXED_PATHS = [
  '/usr/bin/code',
  '/snap/bin/code',
  '/usr/share/code/bin/code',
  '/opt/visual-studio-code/bin/code',
  `/var/lib/flatpak/exports/bin/${FLATPAK_CODE}`,
  '/usr/local/bin/code',
];

function windowsCandidates(env: CodeLookup['env']) {
  const la = env.LOCALAPPDATA || '';
  const pf = env.ProgramFiles || '';
  const pf86 = env['ProgramFiles(x86)'] || '';
  return [
    la && path.join(la, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
    la && path.join(la, 'Programs', 'Microsoft VS Code Insiders', 'bin', 'code-insiders.cmd'),
    pf && path.join(pf, 'Microsoft VS Code', 'bin', 'code.cmd'),
    pf86 && path.join(pf86, 'Microsoft VS Code', 'bin', 'code.cmd'),
  ].filter(Boolean);
}

function macCandidates() {
  return [
    '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
    '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders',
    '/usr/local/bin/code',
    '/opt/homebrew/bin/code',
  ];
}

function linuxCandidates({ home, env }: CodeLookup) {
  const onPath = (env.PATH || '')
    .split(path.posix.delimiter)
    .filter(Boolean)
    .map((dir) => path.posix.join(dir, 'code'));
  const homeLocalBin = home ? [path.posix.join(home, '.local', 'bin', 'code')] : [];
  const homeFlatpak = home ? [path.posix.join(home, '.local', 'share', 'flatpak', 'exports', 'bin', FLATPAK_CODE)] : [];
  return [...new Set([...LINUX_FIXED_PATHS, ...homeLocalBin, ...homeFlatpak, ...onPath])];
}

export function codeCandidates(lookup: CodeLookup): string[] {
  if (lookup.platform === 'win32') return windowsCandidates(lookup.env);
  if (lookup.platform === 'linux') return linuxCandidates(lookup);
  return macCandidates();
}

export function findCodeBin(candidates: string[], exists: (file: string) => boolean) {
  return candidates.find((file) => {
    try {
      return exists(file);
    } catch {
      return false;
    }
  });
}
