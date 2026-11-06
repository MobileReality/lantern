import path from 'node:path';

const APP_NAME = 'Lantern';

function userDataDir(appData: string): string {
  return path.join(appData, APP_NAME);
}

export { APP_NAME, userDataDir };
