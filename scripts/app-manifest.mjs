export function appManifest(electronVersion, appVersion) {
  return {
    name: 'lantern',
    productName: 'Lantern',
    version: appVersion,
    main: 'main.js',
    devDependencies: { electron: electronVersion },
  };
}
