import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIRECTORY = path.join('dist', 'Lantern-win32-x64');
export const OUTPUT_DIRECTORY = 'dist';
export const ICON_PATH = path.join('build', 'icon.ico');
export const MAIN_EXECUTABLE = 'Lantern.exe';
export const SETUP_FILE = 'Lantern-Setup.exe';
export const RELEASES_FILE = 'RELEASES';

export function usageText() {
  return [
    'Usage: node scripts/build-windows-installer.mjs [--app <dir>] [--out <dir>] [--help]',
    '',
    'Builds the Squirrel.Windows installer from the packaged win32-x64 app (pnpm run build:win).',
    'Run it on Windows; Squirrel.Windows tooling does not run elsewhere.',
    '',
    `  --app <dir>  packaged app folder, default ${APP_DIRECTORY}`,
    `  --out <dir>  output folder, default ${OUTPUT_DIRECTORY}`,
    '',
    'Outputs, all in the output folder, named from package.json "name" and "version":',
    `  ${SETUP_FILE}               the installer`,
    `  ${RELEASES_FILE}                    the Squirrel update index`,
    '  <name>-<version>-full.nupkg    the full package, for example lantern-0.4.0-full.nupkg',
    '',
    'Installer metadata (id, version, description, author) comes from package.json; the icon is build/icon.ico.',
    'The build fails when any of the three outputs is missing.',
  ].join('\n');
}

export function readManifest(root = '.') {
  return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
}

export function authorName(manifest) {
  return typeof manifest.author === 'string' ? manifest.author : (manifest.author?.name ?? '');
}

export function installerOptions(manifest, { appDirectory = APP_DIRECTORY, outputDirectory = OUTPUT_DIRECTORY, iconPath = ICON_PATH } = {}) {
  return {
    appDirectory,
    outputDirectory,
    usePackageJson: false,
    name: manifest.name,
    title: 'Lantern',
    version: manifest.version,
    description: manifest.description,
    authors: authorName(manifest),
    exe: MAIN_EXECUTABLE,
    setupExe: SETUP_FILE,
    setupIcon: iconPath,
    noMsi: true,
    noDelta: true,
  };
}

export function expectedOutputs(manifest) {
  return [SETUP_FILE, RELEASES_FILE, `${manifest.name}-${manifest.version}-full.nupkg`];
}

export function missingOutputs(manifest, filesInOutput) {
  const present = new Set(filesInOutput);
  return expectedOutputs(manifest).filter((file) => !present.has(file));
}

export function checkOutputs(manifest, outputDirectory) {
  const files = existsSync(outputDirectory) ? readdirSync(outputDirectory) : [];
  const missing = missingOutputs(manifest, files);
  if (missing.length > 0) throw new Error(`Squirrel left no ${missing.join(', ')} in ${outputDirectory}`);
  return expectedOutputs(manifest).map((file) => path.join(outputDirectory, file));
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function main(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usageText());
    return;
  }
  const manifest = readManifest();
  const appDirectory = valueAfter(args, '--app') ?? APP_DIRECTORY;
  const outputDirectory = valueAfter(args, '--out') ?? OUTPUT_DIRECTORY;
  if (!existsSync(path.join(appDirectory, MAIN_EXECUTABLE))) {
    throw new Error(`${path.join(appDirectory, MAIN_EXECUTABLE)} not found; run pnpm run build:win first`);
  }
  const { createWindowsInstaller } = await import('electron-winstaller');
  await createWindowsInstaller(installerOptions(manifest, { appDirectory, outputDirectory }));
  for (const file of checkOutputs(manifest, outputDirectory)) console.log(`build-windows-installer: ${file}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
