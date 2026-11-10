export interface NativeUpdater {
  setFeedUrl(url: string): void;
  checkForUpdates(): void;
  quitAndInstall(): void;
  onDownloaded(listener: (version: string) => void): void;
  onNotAvailable(listener: () => void): void;
  onError(listener: (message: string) => void): void;
}

export interface AutoUpdaterLike {
  setFeedURL(options: { url: string; serverType: 'json' }): void;
  checkForUpdates(): void;
  quitAndInstall(): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

export function squirrelUpdater(autoUpdater: AutoUpdaterLike): NativeUpdater {
  return {
    setFeedUrl: (url) => autoUpdater.setFeedURL({ url, serverType: 'json' }),
    checkForUpdates: () => autoUpdater.checkForUpdates(),
    quitAndInstall: () => autoUpdater.quitAndInstall(),
    onDownloaded: (listener) => {
      autoUpdater.on('update-downloaded', (_event, _notes, releaseName) => listener(typeof releaseName === 'string' ? releaseName : ''));
    },
    onNotAvailable: (listener) => {
      autoUpdater.on('update-not-available', () => listener());
    },
    onError: (listener) => {
      autoUpdater.on('error', (error) => listener(error instanceof Error ? error.message : String(error)));
    },
  };
}
