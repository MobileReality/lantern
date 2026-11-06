import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateManifest } from 'material-icon-theme';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = path.dirname(fileURLToPath(import.meta.resolve('material-icon-theme/package.json')));
const manifestPath = path.join(root, 'src/renderer/lib/file-icon-manifest.json');

function iconName(definitions, key) {
  const iconPath = definitions[key]?.iconPath;
  return iconPath ? path.basename(iconPath, '.svg') : undefined;
}

function generateFileIconManifest() {
  const manifest = generateManifest();
  const fileNames = Object.fromEntries(Object.entries(manifest.fileNames ?? {}).flatMap(([name, key]) => {
    const icon = iconName(manifest.iconDefinitions, key);
    return icon ? [[name.toLowerCase(), icon]] : [];
  }));
  const fileExtensions = Object.fromEntries(Object.entries(manifest.fileExtensions ?? {}).flatMap(([extension, key]) => {
    const icon = iconName(manifest.iconDefinitions, key);
    return icon ? [[extension.toLowerCase(), icon]] : [];
  }));
  const fallback = iconName(manifest.iconDefinitions, manifest.file ?? 'file') ?? 'file';
  return { fallback, fileNames, fileExtensions };
}

export function generateFileIconAssets(outputDirectory) {
  const compact = generateFileIconManifest();
  const serialized = `${JSON.stringify(compact)}\n`;
  if (!existsSync(manifestPath) || readFileSync(manifestPath, 'utf8').trim() !== serialized.trim()) {
    throw new Error('File icon manifest is missing or outdated. Run pnpm icons:update and commit the updated manifest.');
  }

  mkdirSync(outputDirectory, { recursive: true });
  const icons = new Set([compact.fallback, ...Object.values(compact.fileNames), ...Object.values(compact.fileExtensions)]);
  for (const icon of icons) cpSync(path.join(packageRoot, 'icons', `${icon}.svg`), path.join(outputDirectory, `${icon}.svg`));
  cpSync(path.join(packageRoot, 'LICENSE'), path.join(outputDirectory, 'LICENSE'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argument = process.argv[2];
  if (process.argv.length !== 3 || !argument || (argument.startsWith('--') && argument !== '--update-manifest')) {
    throw new Error('Expected an output directory or --update-manifest');
  }
  if (argument === '--update-manifest') {
    writeFileSync(manifestPath, `${JSON.stringify(generateFileIconManifest())}\n`);
  } else {
    generateFileIconAssets(path.resolve(argument));
  }
}
