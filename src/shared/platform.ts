export type PlatformName = 'windows' | 'mac' | 'linux';

export function platformName(nodePlatform: string): PlatformName {
  switch (nodePlatform) {
    case 'darwin':
      return 'mac';
    case 'win32':
      return 'windows';
    default:
      return 'linux';
  }
}
