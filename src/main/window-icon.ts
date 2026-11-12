import path from 'node:path';

// Only Linux needs it: macOS takes the dock icon and Windows the executable's, but a Linux window has no icon of its own.
function windowIconPath(platform: NodeJS.Platform, packaged: boolean, resourcesPath: string, mainDirectory: string) {
  if (platform !== 'linux') return undefined;
  return packaged ? path.join(resourcesPath, 'icon.png') : path.join(mainDirectory, 'assets', 'appicon.png');
}

export { windowIconPath };
